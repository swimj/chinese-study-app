const dnsLabel = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const journalAddress = new RegExp(`^https://${dnsLabel}\\.${dnsLabel}\\.ts\\.net/?$`, 'i');

export function journalOrigin(address) {
  const value = address.trim();
  if (!journalAddress.test(value)) {
    throw new Error('Enter the Journal’s HTTPS address, such as https://mini.tailnet.ts.net.');
  }
  return new URL(value).origin;
}

export function accessToken(value) {
  const token = value.trim();
  if (!/^[!-~]+$/.test(token)) {
    throw new Error('Enter the import token from your Journal’s configuration.');
  }
  return token;
}

export function permissionFor(origin) {
  return { origins: [origin + '/*'] };
}

export async function getPairing() {
  // Only the extension’s own pages may read the credential.
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const { pairing } = await chrome.storage.local.get('pairing');
  if (!pairing) return undefined;
  return { origin: journalOrigin(pairing.origin), token: accessToken(pairing.token) };
}

export async function sendReading(pairing, reading, deadline = 15_000) {
  const signal = AbortSignal.timeout(deadline);
  let response;
  let result;
  try {
    response = await fetch(pairing.origin + '/api/extension/import', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + pairing.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(reading),
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal,
    });
    try {
      result = await response.json();
    } catch (error) {
      if (signal.aborted) throw error;
    }
  } catch {
    throw new Error(`Could not reach the journal at ${pairing.origin}. Check that the journal is running and Tailscale is connected.`);
  }
  if (!response.ok) {
    throw new Error(typeof result?.error === 'string' && result.error
      ? result.error
      : 'The Journal replied with HTTP ' + response.status + '.');
  }
  if (typeof result?.documentId !== 'string' || !result.documentId) {
    throw new Error('The Journal did not return a reading link. Check your Library before retrying.');
  }
  const reader = new URL('/', pairing.origin);
  reader.searchParams.set('from', 'extension');
  reader.hash = 'read/library/' + encodeURIComponent(result.documentId);
  return reader.href;
}
