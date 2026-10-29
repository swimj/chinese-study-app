/** Reset only the local preview identity, before React reads its welcome state. */
export function resetPreviewWelcome(url: URL, storage: Pick<Storage, 'removeItem'>): string | null {
  if (url.searchParams.get('reset-welcome') !== '1') return null;
  for (const step of ['seen', 'stash-seen', 'settings-seen']) {
    storage.removeItem(`getting-started-${step}:v1:trusted-local`);
  }
  url.searchParams.delete('reset-welcome');
  // The reset should land on Home even when opened from an operator deep link.
  return `${url.pathname}${url.search}`;
}
