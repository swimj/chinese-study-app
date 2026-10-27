import { useEffect, useId, useRef } from 'react';

export function VocabularyShortcutGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    closeButton.current?.focus();
    return () => element.close();
  }, [open]);

  return <dialog ref={dialog} className="vocab-shortcut-dialog" aria-labelledby={titleId}
    aria-describedby={descriptionId} style={{ maxHeight: '85dvh', overflowY: 'auto' }}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => event.stopPropagation()}>
    <header>
      <h2 id={titleId}>Keyboard shortcuts</h2>
      <button type="button" ref={closeButton} onClick={onClose}>Close <kbd>Escape</kbd></button>
    </header>
    <p id={descriptionId}>Shortcuts work when their action is available. Letter and number shortcuts pause while typing.</p>
    <section aria-label="Teaching cards">
      <h3>Teaching cards</h3>
      <dl>
        <div><dt><kbd>Space</kbd></dt><dd>Next teaching step (or return to the current step)</dd></div>
        <div><dt><kbd>←</kbd></dt><dd>Previous teaching step</dd></div>
        <div><dt><kbd>Enter</kbd></dt><dd>Continue from the teaching recap</dd></div>
      </dl>
    </section>
    <section aria-label="Exercises">
      <h3>Exercises</h3>
      <dl>
        <div><dt><kbd>Enter</kbd></dt><dd>Submit, reveal, or continue</dd></div>
        <div><dt><kbd>Space</kbd></dt><dd>Reveal or continue; mark Correct after revealing a recognition answer</dd></div>
        <div><dt><kbd>Shift+Enter</kbd></dt><dd>No clue, even with a partial answer</dd></div>
        <div><dt><kbd>Escape</kbd></dt><dd>Move focus into or out of the answer field</dd></div>
        <div><dt><kbd>1</kbd> / <kbd>2</kbd></dt><dd>Recognition: Forgot / Correct. Contrast: select the first / second option, then press Enter.</dd></div>
        <div><dt><kbd>U</kbd> or <kbd>Z</kbd></dt><dd>Undo</dd></div>
        <div><dt><kbd>A</kbd></dt><dd>Try another</dd></div>
        <div><dt><kbd>S</kbd></dt><dd>Skip</dd></div>
        <div><dt><kbd>D</kbd></dt><dd>Enough for today</dd></div>
        <div><dt><kbd>M</kbd></dt><dd>More practice</dd></div>
      </dl>
    </section>
    <section aria-label="Session and reactions">
      <h3>Session and reactions</h3>
      <dl>
        <div><dt><kbd>F</kbd></dt><dd>Finish for now</dd></div>
        <div><dt><kbd>R</kbd></dt><dd>Open or close reactions</dd></div>
        <div><dt><kbd>[</kbd> / <kbd>]</kbd></dt><dd>Not helpful / Helpful</dd></div>
        <div><dt><kbd>?</kbd></dt><dd>Open this guide</dd></div>
        <div><dt><kbd>Space</kbd></dt><dd>Return Home after completion</dd></div>
      </dl>
      <p>Finish immediately uses its confirmation button and has no keyboard shortcut.</p>
    </section>
    <p>Space in an answer field types a space. Enter and Space on a focused button activate that button.</p>
  </dialog>;
}
