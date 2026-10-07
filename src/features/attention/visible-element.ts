// A mounted element alone is not exposure: its element and tab must be visible.
export function observeVisibleElement(element: HTMLElement, onVisible: () => void): () => void {
  let intersecting = false;
  function check() {
    if (intersecting && document.visibilityState === 'visible' && document.hasFocus()) onVisible();
  }
  const observer = new IntersectionObserver(([entry]) => {
    intersecting = entry.isIntersecting && entry.intersectionRatio > 0;
    check();
  });
  observer.observe(element);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  return () => {
    observer.disconnect();
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('focus', check);
  };
}
