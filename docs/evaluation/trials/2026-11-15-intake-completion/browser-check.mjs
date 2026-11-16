// Run against an isolated Chrome debugging endpoint and the intake browser fixture.
// Node 22+: node browser-check.mjs [debugging URL] [fixture URL] [screenshot path]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const debugging = process.argv[2] ?? 'http://127.0.0.1:9229';
const fixture = process.argv[3] ?? 'http://127.0.0.1:4219/tests/browser/vocabulary-intake.html?slowChat&largeText';
const target = await (await fetch(`${debugging}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data), request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(Error(message.error.message)); else request.resolve(message.result);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function waitFor(expression) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error(`Timed out: ${expression}`);
}
const codes = { Enter: 13, Escape: 27, Tab: 9, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, Backspace: 8, a: 65, ' ': 32 };
async function key(key, modifiers = 0) {
  const params = { key, code: key === 'a' ? 'KeyA' : key === ' ' ? 'Space' : key, windowsVirtualKeyCode: codes[key], modifiers };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...(key === 'Enter' ? { text: '\r' } : key === ' ' ? { text: ' ' } : {}) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}
const focus = () => evaluate('({tag:document.activeElement.tagName,text:document.activeElement.textContent.trim()})');
const click = text => evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`);
const type = text => send('Input.insertText', { text });
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 760, height: 900, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: fixture });
  await waitFor('document.querySelector(".intake-preview-controls")');
  await click('Words'); await waitFor('[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="Chat")');
  await click('Chat'); await waitFor('document.activeElement.tagName==="TEXTAREA"');
  const last = '[...document.querySelectorAll("[data-intake-turn]")].at(-1)';
  const done = () => waitFor(`!document.querySelector('.intake-composer button').textContent.includes('Sending') && ${last}?.querySelector('.intake-reply')`);
  async function message(text) {
    await evaluate('document.querySelector("textarea").focus()'); await type(text); await key('Enter');
  }
  await message('纠结');
  await waitFor(`${last}?.querySelector(':scope > [role=status]')`);
  assert.equal(await evaluate(`${last}.querySelector('.intake-reply')===null`),true);
  await done();
  assert.equal(await evaluate(`${last}.querySelector(':scope > [role=status]')===null`),true);
  assert.equal(await evaluate('document.querySelectorAll(".intake-transcript .intake-card").length'),1);
  await message('Why are those senses included?'); await done();
  assert.equal(await evaluate(`${last}.querySelector('.intake-card')===null`),true);
  await message('Only the second sense'); await done();
  assert.equal(await evaluate('document.querySelectorAll(".intake-transcript .intake-card").length'),1);
  assert.equal(await evaluate('document.querySelectorAll(".intake-transcript input:checked").length'),1);
  await click('Fail next message'); await message('帮派');
  await waitFor('[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="Retry message")');
  await click('Retry message'); await done();
  await waitFor('!document.querySelector(".intake-card-recovery")');
  assert.equal(await evaluate(`${last}.querySelector('.intake-card')!==null`),true);
  await click('Interrupt next reply'); await message('蒸馏 in AI');
  await waitFor('[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="Retry message")');
  const cardIds = await evaluate('[...document.querySelectorAll(".intake-transcript .intake-card")].map(e=>e.id)');
  await click('Retry message'); await done();
  await waitFor('!document.querySelector(".intake-card-recovery")');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".intake-transcript .intake-card")].map(e=>e.id)'),cardIds);
  await key('ArrowUp'); assert.notEqual((await focus()).tag,'TEXTAREA');
  await key('Escape'); assert.equal((await focus()).tag,'TEXTAREA');
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
  if (process.argv[4]) {
    await evaluate('document.querySelector(".intake-preview-controls").style.display="none"');
    const shot=await send('Page.captureScreenshot',{format:'png'});
    await fs.writeFile(process.argv[4],Buffer.from(shot.data,'base64'));
  }
  console.log('PASS: progress replaced by packaged reply, answer-only turn, revision without duplicate card, terminal-failure retry, interrupted-result replay, keyboard focus and 760px enlarged-text layout.');
} finally { socket.close(); await fetch(`${debugging}/json/close/${target.id}`); }
