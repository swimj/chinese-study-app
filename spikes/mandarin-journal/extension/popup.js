import { getPairing, permissionFor, sendReading } from './journal.js';

const importButton = document.querySelector('#import');
const optionsButton = document.querySelector('#options');
const status = document.querySelector('#status');
const readingLink = document.querySelector('#reading');

async function capture() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !/^https?:\/\//i.test(tab.url ?? '')) {
    throw new Error('Open an article in this tab, then try again.');
  }
  let snapshot;
  try {
    [{ result: snapshot }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['extract.js'],
    });
  } catch {
    throw new Error('Chrome could not read this tab. Open the article in a regular web page and try again.');
  }
  if (!snapshot?.reading) {
    throw new Error(snapshot?.error || 'No readable article was found. Select the passage and try again.');
  }

  document.querySelector('#page-title').textContent = snapshot.reading.title;
  const count = snapshot.reading.paragraphs.filter(p => p.kind !== 'heading').length;
  document.querySelector('#paragraph-count').textContent = count + (count === 1 ? ' paragraph' : ' paragraphs');
  document.querySelector('#preview').hidden = false;
  return snapshot.reading;
}

optionsButton.onclick = () => {
  chrome.runtime.openOptionsPage().catch(error => { status.textContent = error.message; });
};

let pairing;
let reading;
const [pairingResult, captureResult] = await Promise.allSettled([getPairing(), capture()]);
if (pairingResult.status === 'fulfilled') {
  pairing = pairingResult.value;
  try {
    if (pairing && !await chrome.permissions.contains(permissionFor(pairing.origin))) pairing = undefined;
  } catch (error) {
    pairing = undefined;
    status.textContent = error.message;
  }
} else {
  status.textContent = pairingResult.reason.message;
}
if (pairing) optionsButton.textContent = 'Settings';
if (captureResult.status === 'fulfilled') {
  reading = captureResult.value;
  if (status.textContent === 'Finding reading text…') status.textContent = '';
} else {
  status.textContent = captureResult.reason.message;
}
importButton.disabled = !pairing || !reading;

importButton.onclick = async () => {
  importButton.disabled = true;
  optionsButton.disabled = true;
  status.textContent = 'Sending to the Journal…';
  try {
    readingLink.href = await sendReading(pairing, reading);
    readingLink.hidden = false;
    status.textContent = 'Reading imported.';
    readingLink.focus();
  } catch (error) {
    status.textContent = error.message;
    importButton.disabled = false;
  } finally {
    optionsButton.disabled = false;
  }
};
