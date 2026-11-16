// Run against an isolated Chrome debugging endpoint and the intake browser fixture.
// Node 22+: node browser-check.mjs [debugging URL] [fixture URL] [screenshot path]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const debugging = process.argv[2] ?? 'http://127.0.0.1:9229';
const fixture = process.argv[3] ?? 'http://127.0.0.1:4219/tests/browser/vocabulary-intake.html';
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
  await evaluate('document.documentElement.style.fontSize="125%";document.querySelector(".intake-preview-controls").style.display="none"');
  await type('蒸馏'); await key('Enter', 8); await type('AI');
  assert.equal(await evaluate('document.querySelector("textarea").value'), '蒸馏\nAI');
  await key('Enter'); await waitFor('document.querySelector(".intake-card") && !document.querySelector(".intake-composer button").textContent.includes("Sending")');
  assert.equal((await focus()).tag, 'TEXTAREA');
  await key('ArrowUp'); assert.equal((await focus()).text, 'Add 蒸馏');
  await key('ArrowRight'); assert.equal((await focus()).text, 'Return to defaults');
  await key('Enter'); await waitFor('document.activeElement.getAttribute("aria-disabled")==="true"');
  await key('ArrowRight'); assert.equal((await focus()).text, 'Only the AI sense');
  await key('ArrowLeft'); assert.equal((await focus()).text, 'Add 蒸馏');
  await key('End'); assert.equal((await focus()).text, 'Only the AI sense');
  await key(' '); await waitFor('document.querySelector(".intake-senses input").checked===false');
  await key('Escape'); assert.equal((await focus()).tag, 'TEXTAREA');
  await type('draft'); await key('ArrowUp'); assert.equal((await focus()).tag, 'TEXTAREA');
  await evaluate('document.querySelector("textarea").select()'); await key('Backspace');
  assert.equal(await evaluate('document.querySelector("textarea").value'), '');
  await key('ArrowUp'); await key('Enter');
  await waitFor('document.querySelector(".intake-card-state").textContent!=="Proposed"');
  assert.notEqual((await focus()).tag, 'BODY');
  await key('Escape'); assert.equal((await focus()).tag, 'TEXTAREA');
  await key('ArrowUp'); assert.equal((await focus()).text, 'Undo add');
  await key('Enter'); await waitFor('document.querySelector(".intake-card-state").textContent==="Proposed"');
  await key('Escape');
  await type('帮派');
  // Exercise React's IME guards with browser-delivered composing and legacy-229 events.
  const count = await evaluate('document.querySelectorAll(".intake-turn").length');
  await evaluate('document.querySelector("textarea").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true,cancelable:true}))');
  await evaluate('document.querySelector("textarea").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",keyCode:229,bubbles:true,cancelable:true}))');
  assert.equal(await evaluate('document.querySelectorAll(".intake-turn").length'), count);
  assert.equal(await evaluate('document.querySelector("textarea").value'), '帮派');
  // Mouse Send must return focus to the composer as well.
  await evaluate('document.querySelector(".intake-composer button").focus();document.querySelector(".intake-composer button").click()');
  await waitFor(`document.querySelectorAll('.intake-turn').length===${count + 1} && document.querySelector('.intake-composer button').textContent==='Send'`);
  assert.equal((await focus()).tag, 'TEXTAREA');
  await key('ArrowUp'); assert.equal((await focus()).text, 'Undo add');
  await key('ArrowRight'); assert.equal((await focus()).text, 'Return to defaults');
  await key('Escape');
  await click('Stash search'); await click('Chat'); await waitFor('document.activeElement.tagName==="TEXTAREA"');
  const beforeModifiedSend = await evaluate('document.querySelectorAll(".intake-turn").length');
  await type('Why that meaning?'); await key('Enter', 4);
  await waitFor(`document.querySelectorAll('.intake-turn').length===${beforeModifiedSend + 1} && document.querySelector('.intake-composer button').textContent==='Send'`);
  assert.equal((await focus()).tag, 'TEXTAREA');
  // A streaming revision can move a card while the learner is navigating its controls.
  const beforeRevision = await evaluate('document.querySelectorAll(".intake-turn").length');
  await type('Only the second sense'); await key('Enter'); await key('ArrowUp');
  assert.equal((await focus()).tag, 'BUTTON');
  await waitFor(`document.querySelectorAll('.intake-turn').length===${beforeRevision + 1} && document.querySelector('.intake-composer button').textContent==='Send'`);
  assert.equal((await focus()).tag, 'TEXTAREA');
  // Native dialog focus containment, Escape, and opener restoration.
  await evaluate('const b=[...document.querySelectorAll("button")].find(e=>e.textContent.startsWith("Outstanding"));b.focus();b.click()');
  await waitFor('document.querySelector("dialog[open]")');
  assert.equal(await evaluate('document.querySelector("dialog").contains(document.activeElement)'), true);
  await key('Tab', 8);
  assert.equal(await evaluate('document.querySelector("dialog").contains(document.activeElement)'), true);
  await key('Escape'); await waitFor('!document.querySelector("dialog[open]")');
  assert.ok((await focus()).text.startsWith('Outstanding'));
  // Native Tab / Shift+Tab and keyboard-help disclosure.
  await click('Stash search'); await click('Chat'); await waitFor('document.activeElement.tagName==="TEXTAREA"');
  await key('Tab'); assert.equal((await focus()).text, 'Keyboard shortcuts');
  await key('Enter'); await waitFor('document.querySelector(".intake-keyboard-help").open');
  await key('Tab', 8); assert.equal((await focus()).tag, 'TEXTAREA');
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false);
  if (process.argv[4]) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(process.argv[4], Buffer.from(shot.data, 'base64'));
  }
  console.log('PASS: composer focus, multiline/send, card actions, draft preservation, Add/Undo focus, IME guards, toggle, modal focus/Escape, Tab order, help and narrow layout.');
} finally { socket.close(); }
