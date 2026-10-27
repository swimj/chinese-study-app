/** The accepted prototype's slow timing (210 + 260 ms, at 2.7x). */
export const TUCK_LIFT_MS = 567;
export const TUCK_SETTLE_MS = 702;

/** An inert paper copy moves behind the live card; no study state lives here. */
export function tuckBehind(host: HTMLElement, source: HTMLElement, fromTray: boolean, rattle = false) {
  // Keep the moving paper outside the session's scrolling/clipping region.
  const layer = host.closest<HTMLElement>('.vocab-layout') ?? host;
  const bounds = layer.getBoundingClientRect();
  const start = source.getBoundingClientRect();
  const paper = host.querySelector<HTMLElement>('.vocab-paper');
  if (!paper) throw new Error('Tuck motion requires a vocabulary card');
  const destination = paper.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'vocab-session desk-tuck';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  Object.assign(ghost.style, { left: `${start.left - bounds.left}px`, top: `${start.top - bounds.top}px`, width: `${start.width}px`, height: `${start.height}px` });
  const copy = source.cloneNode(true) as HTMLElement;
  if (!fromTray) copy.classList.add('desk-tuck-paper');
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  copy.querySelectorAll('.is-confirming-action').forEach(node => node.classList.remove('is-confirming-action'));
  ghost.append(copy);
  layer.append(ghost);
  const originals = source.querySelectorAll<HTMLElement>('*');
  copy.querySelectorAll<HTMLElement>('*').forEach((node, index) => {
    node.scrollTop = originals[index]!.scrollTop;
    node.scrollLeft = originals[index]!.scrollLeft;
  });
  layer.classList.add('is-tucking');
  let cancelled = false;
  let active: Animation | undefined;
  function cancel() {
    cancelled = true;
    active?.cancel();
    ghost.remove();
    layer.classList.remove('is-tucking');
  }
  async function animate(frames: Keyframe[], duration: number) {
    if (cancelled) return;
    active = ghost.animate(frames, { duration, easing: 'cubic-bezier(.22,.7,.24,1)', fill: 'forwards' });
    await active.finished.catch(() => undefined);
  }
  // Aim at the actual card edge, including a covered drawer below a narrow card.
  const x = destination.right - start.left - start.width * .85;
  const y = destination.top + Math.min(60, destination.height * .15) - start.top;
  const narrow = start.width <= 540;
  const lift = fromTray ? `translate(${x * .55}px,${y * .55 + 22}px) rotate(-9deg) scale(.9)`
    : narrow ? 'translate(0,12px) rotate(1deg) scale(.94)' : 'translate(36px,18px) rotate(3deg) scale(.95)';
  const landing = fromTray ? `translate(${x}px,${y}px) rotate(-3deg) scale(.72)`
    : narrow ? 'translate(3px,8px) rotate(0) scale(.97)' : 'translate(9px,12px) rotate(0) scale(.97)';
  const finished = (async () => {
    try {
      if (rattle) await animate([
        { transform: 'translateX(0)' }, { transform: 'translateX(-7px)' },
        { transform: 'translateX(6px)' }, { transform: 'translateX(0)' },
      ], 300);
      await animate([{ transform: 'translate(0,0)' }, { transform: lift }], TUCK_LIFT_MS);
      if (cancelled) return;
      ghost.style.zIndex = '0';
      await animate([{ transform: lift, opacity: 1 }, { transform: landing, opacity: 0 }], TUCK_SETTLE_MS);
    } finally { cancel(); }
  })();
  return { finished, cancel };
}
