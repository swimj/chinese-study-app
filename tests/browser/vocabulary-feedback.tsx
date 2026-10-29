import React,{useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AppChrome} from '../../src/components/AppChrome';
import {VocabularyFeedbackPage,type vocabularyFeedbackApi} from '../../src/pages/VocabularyFeedbackPage';
import type {VocabularyFeedbackInbox} from '../../src/services/api';
import '../../src/styles.css';
import '../../src/features/vocabulary-study/pages.css';
import './vocabulary-feedback.css';
const examples=[
  {label:'A useful correction',trigger:'A rejected production answer leads to a short language lesson.',lesson:'饿 describes being hungry; 馋 describes wanting something tasty. You can be 馋 even after a full meal.\n\n我不饿，就是闻到烤红薯的香味，有点馋了。\nI’m not hungry—the smell of roasted sweet potatoes just made me want some.'},
  {label:'An unfair rejection',trigger:'A plausible answer was rejected. The lesson can acknowledge that without becoming a repair report. Eligible scheduling compensation happens separately.',lesson:'Your answer 局势 was reasonable for the broad question you saw. 局面 often describes how a situation has developed and what can be done about it.\n\n打开局面 — make a breakthrough\n扭转局面 — turn the situation around\n\n新厂长上任后，很快就打开了工作局面。\nAfter taking over, the new factory manager quickly got things moving.'},
  {label:'A question after a correct answer',trigger:'A written comment can trigger feedback even when the answer was accepted.',lesson:'报备 means letting the responsible people know so that something is on record. It does not by itself mean asking for permission.\n\n我先向物业报备一下朋友的车牌号。\nI’ll let the property management office know my friend’s license plate number first.\n\nIf approval is the point, 申请 is usually more explicit: 我想申请休假。'},
  {label:'A shared-expression exercise',trigger:'A rejected answer or comment on a pure cue can produce feedback about the expressions together.',lesson:'会谈 focuses on the discussion; 会见 focuses on the meeting between people; 谈判 focuses on negotiating terms or resolving competing interests.\n\n双方就价格问题进行了谈判。\nThe two sides negotiated over the price.\n\nA broad sentence about leaders meeting may allow more than one of these. The purpose of the meeting makes the distinction useful.'},
  {label:'Still generating',trigger:'Queued and generating feedback appear in the inbox before a lesson is ready.',lesson:null},
  {label:'One call failed',trigger:'Successful lessons remain readable. Retry feedback requeues the failed job; this preview simulates its successful return.',lesson:null},
  {label:'Nothing to share',trigger:'No useful lesson was produced, or no eligible rejection/comment triggered feedback. Skipping alone and a rating without a comment do not trigger a learner lesson.',lesson:null},
] as const;
function message(body:string,id='example',subjectLabel='馋',createdAt='2026-10-26T14:10:00.000Z'):VocabularyFeedbackInbox['messages'][number]{return {messageId:id,caseId:id,subjectLabel,body,createdAt,seenAt:null,dismissedAt:null};}
function Preview(){
  const [selected,setSelected]=useState(0),[opened,setOpened]=useState(false),[unread,setUnread]=useState(3),[retried,setRetried]=useState(false);
  const example=examples[selected];
  const api=useMemo<typeof vocabularyFeedbackApi>(()=>{
    let recovered=false;
    const seenIds=new Set<string>();
    const dismissedIds=new Set<string>();
    const labels=['馋','局面','报备','会谈 · 会见 · 谈判'];
    const earlier=message(examples[2].lesson,'earlier','报备','2026-10-25T14:10:00.000Z');
    const oldest=message(examples[3].lesson,'oldest','会谈 · 会见 · 谈判','2026-10-24T14:10:00.000Z');
    return {
      fetch:async()=>{
        const messages=example.lesson?[oldest,earlier,message(example.lesson,'example',labels[selected])]:selected===5?[earlier,...(recovered?[message(examples[0].lesson,'failed-example','馋')]:[])]:[];
        return {messages:messages.map(item=>({...item,dismissedAt:dismissedIds.has(item.messageId)?'2026-10-26T15:00:00.000Z':null,seenAt:seenIds.has(item.messageId)?'2026-10-26T15:00:00.000Z':null})),
          jobs:selected===4?[{jobId:'pending',caseId:'pending',subjectLabel:'报备',status:'running',createdAt:'2026-10-26T14:10:00.000Z',error:null},{jobId:'queued',caseId:'queued',subjectLabel:'局面',status:'queued',createdAt:'2026-10-26T14:09:00.000Z',error:null}]:selected===5&&!recovered?[{jobId:'failed-example',caseId:'failed-example',subjectLabel:'馋',status:'failed',createdAt:'2026-10-26T14:10:00.000Z',error:'Feedback could not finish. You can retry.'}]:[],
          failures:selected===5&&!recovered?[{jobId:'failed-example',error:'Feedback could not finish. You can retry.'}]:[]};
      },
      markSeen:async(id)=>{seenIds.add(id);setUnread(Math.max(0,(example.lesson?3:selected===5?recovered?2:1:0)-seenIds.size));return {};},
      dismiss:async(id)=>{dismissedIds.add(id);return {};},
      restore:async(id)=>{dismissedIds.delete(id);return {};},
      retry:async()=>{recovered=true;setRetried(true);return {};},
    };
  },[selected]);
  return <><aside className="feedback-example-controls"><strong>Learner feedback preview · illustrative copy</strong><label>Scenario <select value={selected} onChange={event=>{setSelected(Number(event.target.value));setOpened(false);setUnread(Number(event.target.value)<4?3:Number(event.target.value)===5?1:0);setRetried(false);}}>{examples.map((item,i)=><option key={item.label} value={i}>{item.label}</option>)}</select></label><p>{example.trigger}</p></aside>
    <AppChrome currentPage={opened?'reflections':'home'} error={null} serviceBanner={null} sessionActive={false} priorityPageLoading={false} reflectionPageLoading={false} contentPageLoading={false}
      reflectionUnseenCount={unread} reflectionGenerating={selected===4} hasUnseenReflectionFailure={selected===5&&!retried}
      onOpenHomePage={()=>setOpened(false)} onOpenReflectionsPage={()=>setOpened(true)} onOpenPriorityPage={()=>{}} onOpenContentPage={()=>{}} onOpenAboutPage={()=>{}}>
      {opened?<VocabularyFeedbackPage key={selected} api={api}/>:<section className="panel feedback-example-arrival"><h1>{example.label}</h1><p>Open Feedback in the sidebar to see this example.</p><button onClick={()=>setOpened(true)}>Open feedback</button></section>}
    </AppChrome></>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
