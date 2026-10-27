import {test} from 'node:test';
import assert from 'node:assert/strict';
import {feedbackShortcut} from '../src/features/vocabulary-feedback/keyboard.ts';
const base={key:'d',altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,isComposing:false,repeat:false,defaultPrevented:false};
test('feedback shortcuts navigate with arrows and dismiss once with D',()=>{
  assert.equal(feedbackShortcut({...base,key:'ArrowLeft'},false),'previous');
  assert.equal(feedbackShortcut({...base,key:'ArrowRight'},false),'next');
  assert.equal(feedbackShortcut(base,false),'dismiss');
  assert.equal(feedbackShortcut({...base,repeat:true},false),null);
  assert.equal(feedbackShortcut({...base,key:'Enter'},false),null);
});
test('typing, compositions, modified keys and handled events keep their native behavior',()=>{
  for(const key of ['d','ArrowLeft','ArrowRight']){
    assert.equal(feedbackShortcut({...base,key},true),null);
    for(const flag of ['altKey','ctrlKey','metaKey','shiftKey','isComposing','defaultPrevented'])assert.equal(feedbackShortcut({...base,key,[flag]:true},false),null);
  }
});
