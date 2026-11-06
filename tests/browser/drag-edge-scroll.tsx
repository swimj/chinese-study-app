// Real scroll hook and DOM pane; synthetic native drag events, no backend.
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useDragEdgeScroll } from '../../src/hooks/useDragEdgeScroll';

function Fixture() {
  const start = useDragEdgeScroll();
  const pane = useRef<HTMLDivElement>(null), handle = useRef<HTMLButtonElement>(null);
  const [result, setResult] = useState('Not run');
  async function run() {
    const container = pane.current!, origin = handle.current!;
    const pause = () => new Promise(resolve => setTimeout(resolve, 160));
    const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
    setResult('Running');
    try {
      const bounds = container.getBoundingClientRect(), middle = (bounds.top + bounds.bottom) / 2;
      container.scrollTop = 250;
      start(origin, middle);
      await pause();
      check(container.scrollTop === 250, 'Center must not scroll');
      document.dispatchEvent(new DragEvent('dragover', {clientY: bounds.top + 2}));
      await pause();
      check(container.scrollTop < 220, 'Top edge must scroll upward while pointer rests');
      document.dispatchEvent(new DragEvent('dragover', {clientY: bounds.bottom - 2}));
      const beforeDown = container.scrollTop;
      await pause();
      check(container.scrollTop > beforeDown + 30, 'Bottom edge must scroll downward');
      document.dispatchEvent(new DragEvent('drop'));
      const afterDrop = container.scrollTop;
      await pause();
      check(container.scrollTop === afterDrop, 'Drop must stop scrolling');
      start(origin, bounds.bottom - 2);
      await pause();
      document.dispatchEvent(new DragEvent('dragend'));
      const afterCancel = container.scrollTop;
      await pause();
      check(container.scrollTop === afterCancel, 'Cancel must stop scrolling');
      setResult('PASS: center, upward hold, downward hold, drop and cancellation');
    } catch (error) {
      document.dispatchEvent(new DragEvent('dragend'));
      setResult(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return <><h1>Drag edge scrolling</h1><button onClick={() => void run()} disabled={result === 'Running'}>Run regression</button><p role="status">{result}</p>
    <div ref={pane} style={{height:250, overflow:'auto', border:'1px solid', marginTop:20}}>
      <div style={{height:1000, padding:10}}><button ref={handle} draggable onDragStart={event => start(event.currentTarget, event.clientY)}>Drag handle</button></div>
    </div></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
