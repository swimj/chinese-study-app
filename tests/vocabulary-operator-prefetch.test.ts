import test from 'node:test';
import assert from 'node:assert/strict';
import { OperatorPrefetchCache } from '../src/features/vocabulary-operator/prefetch-cache.ts';

test('review cache bounds entries and retains only current versions', () => {
  const cache = new OperatorPrefetchCache<{ text:string }>(2, 1000);
  cache.set('a:1', {text:'first'}); cache.set('b:1', {text:'second'}); cache.set('c:1', {text:'third'});
  assert.equal(cache.get('a:1'), undefined);
  assert.equal(cache.get('b:1')?.text, 'second');
  cache.retain(new Set(['b:2','c:1']));
  assert.equal(cache.get('b:1'), undefined);
  assert.equal(cache.get('c:1')?.text, 'third');
});

test('review cache accounts for encoded bytes and retains one oversized item', () => {
  const cache = new OperatorPrefetchCache<{ text:string }>(20, 30);
  cache.set('small', {text:'小'}); cache.set('large', {text:'汉'.repeat(20)});
  assert.equal(cache.get('small'), undefined);
  assert.equal(cache.get('large')?.text, '汉'.repeat(20));
  cache.set('other', {text:'字'.repeat(4)});
  assert.equal(cache.get('large'), undefined);
  assert.equal(cache.get('other')?.text, '字'.repeat(4));
});

test('scope invalidation retains unrelated snapshots and rejects earlier in-flight responses',()=>{
  const cache=new OperatorPrefetchCache<{word:string}>();
  cache.set('first',{word:'a'});cache.set('sibling',{word:'a'});cache.set('other',{word:'b'});
  const oldEpoch=cache.epoch();cache.invalidateWhere(value=>value.word==='a');
  assert.equal(cache.get('first'),undefined);assert.equal(cache.get('sibling'),undefined);assert.equal(cache.get('other')?.word,'b');
  assert.equal(cache.setIfCurrent('sibling',{word:'a'},oldEpoch),false);assert.equal(cache.get('sibling'),undefined);
  assert.equal(cache.setIfCurrent('sibling',{word:'a'},cache.epoch()),true);
});
