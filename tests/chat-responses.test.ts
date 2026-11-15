import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOpenAiResponsesChatProvider } from '../server/llm/chat-openai-responses.ts';
import type { ChatProviderRequest } from '../server/llm/chat-types.ts';
import { priceInvocationUsage } from '../server/llm/invocation-pricing.ts';

const config = { apiKey: 'fixture-key', baseUrl: 'https://provider.invalid/v1' };
const request: ChatProviderRequest = { model: 'gpt-6-luna', messages: [{role:'system',content:'Use the allowed tools.'},{role:'user',content:'帮派'}],
  tools: [{name:'lookup',description:'Look up a word',parameters:{type:'object',properties:{word:{type:'string'}},required:['word'],additionalProperties:false}}],
  maxOutputTokens: 1000, toolChoice:'required', reasoningEffort:'low', timeoutMs:1000, provenance:{} };
const completion = (output: unknown[], status = 'completed') => ({type:`response.${status}`,response:{id:'response-1',status,output,usage:{input_tokens:100,output_tokens:20,total_tokens:120}}});
function stream(events: unknown[]) {
  return new Response(events.map(event=>`event: ${(event as {type:string}).type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    {headers:{'content-type':'text/event-stream'}});
}
test('Responses round trips complete reasoning and call items and streams only visible text',async()=>{
  const bodies: Array<Record<string,unknown>>=[];
  const reasoning={id:'reasoning-1',type:'reasoning',summary:[],encrypted_content:'encrypted-fixture'};
  const call={id:'function-1',type:'function_call',call_id:'call-1',name:'lookup',arguments:'{"word":"帮派"}',status:'completed'};
  const provider=createOpenAiResponsesChatProvider({fetchImplementation:async(url,init)=>{
    assert.equal(String(url),'https://provider.invalid/v1/responses');
    bodies.push(JSON.parse(String(init?.body)));
    return stream(bodies.length===1 ? [completion([reasoning,call])] : [
      {type:'response.reasoning_text.delta',delta:'Private reasoning'},
      {type:'response.output_text.delta',delta:'A gang.'},
      completion([{id:'message-1',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'A gang.',annotations:[]}]}]),
    ]);
  }});
  const text:string[]=[];
  const first=await provider.stream(request,config,delta=>{text.push(delta);});
  assert.deepEqual(first.message.toolCalls,[{id:'call-1',name:'lookup',arguments:'{"word":"帮派"}'}]);
  const second=await provider.stream({...request,messages:[...request.messages,first.message,{role:'tool',toolCallId:'call-1',content:'{"found":true}'}]},config,delta=>{text.push(delta);});
  assert.deepEqual(bodies[1]!.input,[...request.messages,reasoning,call,{type:'function_call_output',call_id:'call-1',output:'{"found":true}'}]);
  assert.equal(bodies[0]!.store,false);
  assert.equal(bodies[0]!.tool_choice,'required');
  assert.deepEqual(bodies[0]!.include,['reasoning.encrypted_content']);
  assert.deepEqual(bodies[0]!.reasoning,{effort:'low'});
  assert.equal((bodies[0]!.tools as Array<{strict:boolean}>)[0]?.strict,true);
  assert.deepEqual(text,['A gang.']);assert.equal(second.message.content,'A gang.');
});
test('Responses rejects interrupted, truncated, refused, duplicate and empty output before any tool is run',async()=>{
  for(const events of [[],[completion([], 'incomplete')],[completion([{type:'message',content:[{type:'refusal',refusal:'No'}]}])],
    [completion([1,2].map(()=>({type:'function_call',call_id:'same',name:'lookup',arguments:'{}'})))],[completion([])]]) {
    const provider=createOpenAiResponsesChatProvider({fetchImplementation:async()=>stream(events)});
    await assert.rejects(provider.stream(request,config,()=>{}));
  }
});
test('Responses aborts timed-out requests and disables hidden SDK retries',async()=>{
  let attempts=0;
  const provider=createOpenAiResponsesChatProvider({fetchImplementation:async(_url,init)=>{
    attempts++;
    return await new Promise<Response>((_resolve,reject)=>{
      init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true});
    });
  }});
  const keepAlive=setTimeout(()=>{},1000);
  try { await assert.rejects(provider.stream({...request,timeoutMs:15},config,()=>{}),/timed out/); }
  finally {clearTimeout(keepAlive);}
  assert.equal(attempts,1);
});
test('Responses usage receives the same cached-input pricing as Chat Completions usage',()=>{
  const base={provider:'openai',model:'gpt-6-luna',reportedAt:'2026-11-15T00:00:00Z'};
  assert.deepEqual(priceInvocationUsage({...base,usage:{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:200},output_tokens_details:{reasoning_tokens:50},total_tokens:1100}}),
    priceInvocationUsage({...base,usage:{prompt_tokens:1000,completion_tokens:100,prompt_tokens_details:{cached_tokens:200},completion_tokens_details:{reasoning_tokens:50},total_tokens:1100}}));
});
test('SDK streaming preserves UTF-8 and CRLF boundaries and hides function arguments',async()=>{
  const output=[{type:'function_call',call_id:'call-utf8',name:'lookup',arguments:'{"word":"绵长"}'}];
  const events=[{type:'response.output_text.delta',delta:'你好！'},
    {type:'response.function_call_arguments.delta',delta:'{"word":"绵长"}'},completion(output)];
  const encoded=new TextEncoder().encode(events.map(event=>`data: ${JSON.stringify(event)}\r\n\r\n`).join(''));
  const provider=createOpenAiResponsesChatProvider({fetchImplementation:async()=>new Response(new ReadableStream({start(controller){
    for(let i=0;i<encoded.length;i++)controller.enqueue(encoded.slice(i,i+1));controller.close();
  }}),{headers:{'content-type':'text/event-stream'}})});
  const seen:string[]=[];const result=await provider.stream(request,config,delta=>{seen.push(delta);});
  assert.deepEqual(seen,['你好！']);assert.equal(result.message.toolCalls[0]?.arguments,'{"word":"绵长"}');
});
test('abort before transport prevents a provider call',async()=>{
  const controller=new AbortController();controller.abort();
  const provider=createOpenAiResponsesChatProvider({fetchImplementation:async()=>assert.fail('transport ran')});
  await assert.rejects(provider.stream({...request,signal:controller.signal},config,()=>{}));
});
