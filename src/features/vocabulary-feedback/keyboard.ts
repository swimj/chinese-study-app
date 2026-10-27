import { shortcutEventBlocked, type ShortcutKeyEvent } from '../../lib/keyboard';
export function feedbackShortcut(event:ShortcutKeyEvent,editing:boolean):'previous'|'next'|'dismiss'|null {
  if(editing||shortcutEventBlocked(event, { allowRepeat: true })||event.shiftKey)return null;
  if(event.key==='ArrowLeft')return 'previous';
  if(event.key==='ArrowRight')return 'next';
  if(!event.repeat&&event.key.toLowerCase()==='d')return 'dismiss';
  return null;
}
