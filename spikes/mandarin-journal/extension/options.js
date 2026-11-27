import { accessToken, getPairing, journalOrigin, permissionFor } from './journal.js';

const form = document.querySelector('#pair');
const address = document.querySelector('#origin');
const token = document.querySelector('#token');
const save = document.querySelector('#save');
const disconnect = document.querySelector('#disconnect');
const status = document.querySelector('#status');

let pairing;
function showPairing() {
  address.value = pairing?.origin || '';
  token.value = '';
  token.placeholder = pairing ? 'Token saved' : '';
  disconnect.hidden = !pairing;
  status.textContent = pairing ? 'Paired with ' + pairing.origin : '';
}
try {
  pairing = await getPairing();
  showPairing();
  save.disabled = false;
} catch (error) {
  status.textContent = error.message;
}

function busy(value) {
  address.disabled = token.disabled = save.disabled = disconnect.disabled = value;
}

form.onsubmit = async event => {
  event.preventDefault();
  try {
    const origin = journalOrigin(address.value);
    const nextToken = accessToken(token.value || (pairing?.origin === origin ? pairing.token : ''));
    busy(true);
    if (!await chrome.permissions.request(permissionFor(origin))) {
      status.textContent = 'Allow access to this Journal address to pair it.';
      return;
    }
    const previousOrigin = pairing?.origin;
    const next = { origin, token: nextToken };
    await chrome.storage.local.set({ pairing: next });
    pairing = next;
    showPairing();
    if (previousOrigin && previousOrigin !== origin) {
      await chrome.permissions.remove(permissionFor(previousOrigin));
    }
  } catch (error) {
    status.textContent = error.message;
  } finally {
    busy(false);
  }
};

disconnect.onclick = async () => {
  busy(true);
  try {
    await chrome.permissions.remove(permissionFor(pairing.origin));
    await chrome.storage.local.remove('pairing');
    pairing = undefined;
    showPairing();
    status.textContent = 'Journal disconnected.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    busy(false);
  }
};
