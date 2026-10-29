/** The shared hover/focus keycap treatment used by study controls. */
export function ShortcutHint({ shortcut, shortcuts }: {
  shortcut?: string | null;
  shortcuts?: Array<string | null | undefined>;
}) {
  const keys = (shortcuts ?? [shortcut]).filter((key): key is string => Boolean(key));
  return keys.length ? <span className="session-shortcut-hints" aria-hidden="true">
    {keys.map((key) => <kbd key={key} className="session-shortcut-hint">{key}</kbd>)}
  </span> : null;
}
