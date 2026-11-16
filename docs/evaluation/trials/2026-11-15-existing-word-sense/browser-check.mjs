// Run against an isolated Chrome debugging endpoint and the intake browser fixture.
// Node 22+: node browser-check.mjs [debugging URL] [fixture URL] [screenshot path]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const debugging = process.argv[2] ?? 'http://127.0.0.1:9229';
const fixture = process.argv[3] ?? 'http://127.0.0.1:4219/tests/browser/vocabulary-intake.html?existingSense&largeText';
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
  await waitFor('[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="Words")');
  await click('Words'); await waitFor('[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="Chat")');
  await click('Chat'); await waitFor('document.activeElement.tagName==="TEXTAREA"');
  await type('蒸馏 in AI'); await key('Enter');
  await waitFor('document.querySelector(".intake-card-state")?.textContent==="New sense proposed"');
  assert.equal(await evaluate('document.querySelectorAll(".intake-transcript input[type=checkbox]").length'),0);
  assert.ok((await evaluate('document.querySelector(".intake-sense-proposal").innerText')).includes('Current senses (1)'));
  await key('ArrowUp');assert.equal((await focus()).text,'Add sense');
  await click('Make next save stale');
  await evaluate('document.querySelector(".intake-card-actions button").focus()');await key('Enter');
  await waitFor('document.querySelector(".intake-card-recovery")?.innerText.includes("This card changed")');
  await evaluate('document.querySelector(".intake-card-recovery button").focus()');await key('Enter');
  await waitFor('document.querySelector(".intake-card-state")?.textContent==="Sense added"');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".intake-senses input")].map(e=>e.checked)'),[true,true]);
  assert.equal(await evaluate('[...document.querySelectorAll(".intake-card-actions button")].some(e=>e.textContent.includes("Undo"))'),false);
  await key('Escape');assert.equal((await focus()).tag,'TEXTAREA');
  await evaluate('document.querySelector(".intake-preview-controls").style.display="none"');
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
  if(process.argv[4]) {
    const shot=await send('Page.captureScreenshot',{format:'png'});
    await fs.writeFile(process.argv[4],Buffer.from(shot.data,'base64'));
  }
  await send('Page.navigate', { url: fixture });
  await waitFor('document.querySelector(".intake-preview-controls")');
  await waitFor('[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="Words")');
  await click('Words');
  await waitFor('[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="Chat")');
  await click('Chat');
  await waitFor('document.querySelector(".intake-composer textarea")');
  await evaluate('document.querySelector(".intake-composer textarea").focus()');
  await type('蒸馏 in AI');await key('Enter');
  await waitFor('document.querySelector(".intake-card-state")?.textContent==="New sense proposed"');
  await key('ArrowUp');assert.equal((await focus()).text,'Add sense');
  await key(' ');
  await waitFor('document.querySelector(".intake-card-state")?.textContent==="Sense added"');
  // The streamed card may move to its retained turn during confirmation; both
  // its container and composer are intentional recovery targets, never body.
  assert.ok(['ARTICLE','TEXTAREA'].includes((await focus()).tag));
  await key('Escape');assert.equal((await focus()).tag,'TEXTAREA');
  console.log('PASS: native Space confirms Add sense; focus stays in the chat and Escape returns to composer.');
  console.log('PASS: additive proposal, keyboard confirmation, stale reload/reconfirmation, both senses tracked, no enrollment Undo, composer focus, narrow layout.');
} finally { socket.close(); }
