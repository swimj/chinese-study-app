import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import '../../src/styles.css';

// Adapted from the isolation scenarios in PR #453: exercise the actual root,
// now with separate full-page operator/learner entry rather than paused hooks.
const requests: string[] = [];
window.fetch = async input => {
  const path = new URL(String(input), location.origin).pathname;
  requests.push(path);
  if (path === '/api/operator/vocabulary/case-queue') return Response.json({items:[],nextCursor:null,previousCursor:null,anchorCursor:null,total:0,startIndex:0});
  if (path.endsWith('/completion/current')) return Response.json(null);
  if (path === '/api/attention-badges') return Response.json({reflectionUnseenCount:0,reflectionGenerating:false,failedReflectionRunIds:[]});
  if (path === '/api/whats-new-attention') return Response.json({serverNow:new Date().toISOString(),items:[],unseenPostIds:[]});
  if (path === '/api/whats-new') return Response.json({posts:[]});
  if (path.endsWith('/feedback/attention')) return Response.json({unseenCount:0,hasFailure:false,generating:false});
  return Response.json({error:'Unavailable in isolation fixture'},{status:503});
};
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const lines:string[]=[];
function check(condition:boolean,label:string){if(!condition)throw new Error(`${label}: ${JSON.stringify(requests)}`);lines.push(`PASS ${label}`);document.getElementById('results')!.textContent=lines.join('\n');}
async function run(){
  for(const route of ['/operator/usage','/operator/improvement']){
    history.replaceState(null,'',route);requests.length=0;
    const root=createRoot(document.getElementById('root')!);root.render(<App/>);
    await wait(150);window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));await wait(5300);
    check(requests.some(path=>path.startsWith('/api/operator/')),`${route}: operator requests run`);
    check(requests.every(path=>path.startsWith('/api/operator/')),`${route}: no learner requests on mount/focus/visibility/poll`);
    check(!document.querySelector('.app-sidebar'),`${route}: no learner rail`);
    const back=document.querySelector<HTMLAnchorElement>('a.operator-return');
    check(back?.getAttribute('href')==='/',`${route}: Return to study is full-page link`);
    const reviewWorkspace=document.querySelector('.vocabulary-case-review-page');
    const quality=document.querySelector<HTMLAnchorElement>('a[href="/operator/quality"]');quality!.click();await wait(100);
    check(location.pathname==='/operator/quality','rail navigation owns distinct URL');
    if(reviewWorkspace){const before=requests.filter(path=>path.includes('/case-queue')).length;window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));await wait(5300);check(requests.filter(path=>path.includes('/case-queue')).length===before,'hidden review workspace does not refresh on focus/visibility/poll');}
    history.back();await wait(150);check(location.pathname===route,'browser back restores operator route');
    if(reviewWorkspace)check(document.querySelector('.vocabulary-case-review-page')===reviewWorkspace,'operator rail retains the existing review workspace');
    check(requests.every(path=>path.startsWith('/api/operator/')),'operator tab navigation does not start learner controllers');
    root.unmount();await wait(30);
  }
  history.replaceState(null,'','/#operator-usage');requests.length=0;
  const root=createRoot(document.getElementById('root')!);root.render(<App/>);await wait(500);
  check(requests.includes('/api/status')&&requests.includes('/api/vocabulary/completion/current'),'study entry mounts learner controllers; old operator hash has no routing effect');
  check(!document.querySelector('.operator-shell'),'study entry does not mount operator shell');
  root.unmount();lines.push('ALL CHECKS PASSED');document.getElementById('results')!.textContent=lines.join('\n');
}
void run().catch(error=>{document.getElementById('results')!.textContent=`${lines.join('\n')}\nFAIL ${String(error)}`;});
