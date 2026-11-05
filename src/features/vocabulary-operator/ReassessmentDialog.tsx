import { useEffect, useRef, type ReactNode } from 'react';

/** Keep mounted children so target loading and application guards remain active. */
export function ReassessmentDialog({open,onClose,busy,children}:{open:boolean;onClose:()=>void;busy:boolean;children:ReactNode}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const element=dialog.current;
    if(!element)return;
    if(open&&!element.open)element.showModal();
    if(!open&&element.open)element.close();
  },[open]);
  return <dialog ref={dialog} className="vocabulary-reassessment-dialog" aria-label="Reassess exercise" onKeyDown={event=>event.stopPropagation()} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <header><h3>Reassess exercise</h3><button type="button" className="secondary-button" aria-label="Close reassessment" disabled={busy} onClick={onClose}>Close</button></header>
    {children}
  </dialog>;
}
