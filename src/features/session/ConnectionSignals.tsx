import { useLayoutEffect, useRef, useState } from 'react';

// Alternate broad curves and sparse angular turns; only the passing signal is
// painted temporarily. Geometry is fixed, while route order and forks vary.
const routes = [
  { direction: 1, path: 'M-20 120 C80 100 95 190 170 160 S225 85 290 125 S335 220 410 180 S475 95 540 150 S580 255 650 215 S705 145 770 190 S860 295 920 245 S975 200 1020 235' },
  { direction: -1, path: 'M1020 500 L908 453 L802 434 L710 475 L612 390 L513 426 L410 367 L312 309 L211 299 L100 238 L-20 270' },
  { direction: 1, path: 'M-20 390 C45 420 65 310 140 345 S215 455 275 390 S295 270 370 310 S455 400 510 310 S535 180 600 220 S675 310 745 235 S795 100 865 155 S975 245 1020 180' },
  { direction: -1, path: 'M1020 90 L907 155 L804 158 L698 249 L597 262 L497 345 L393 367 L291 450 L182 461 L76 530 L-20 535' },
  { direction: 1, path: 'M-20 535 C45 475 75 555 145 500 S200 390 270 435 S345 540 405 465 S430 350 500 395 S570 475 630 400 S680 265 745 325 S845 420 905 350 S980 265 1020 300' },
  { direction: -1, path: 'M1020 360 L902 370 L800 301 L695 308 L592 240 L484 234 L380 172 L276 168 L172 105 L67 114 L-20 96' },
];
type Branch = { path: string; delay: number };

function SignalPulse({ route, onComplete }: { route: typeof routes[number]; onComplete: () => void }) {
  const mainPath = useRef<SVGPathElement>(null);
  const [branches, setBranches] = useState<Branch[] | null>(null);
  useLayoutEffect(() => {
    const parent = mainPath.current;
    if (!parent) throw new Error('Expected a mounted signal path.');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || Math.random() >= .65) {
      setBranches([]);
      return;
    }
    const fraction = .2 + Math.random() * .35;
    const length = parent.getTotalLength();
    const reach = .16 + Math.random() * .08;
    const spread = 45 + Math.random() * 50;
    // Sample the same forward corridor for both offshoots. Opposite, steadily
    // increasing offsets keep them apart and on either side of the parent.
    const corridor = Array.from({ length: 17 }, (_, index) => {
      const progress = index / 16;
      const point = parent.getPointAtLength(length * (fraction + reach * progress));
      return { x: point.x, y: point.y, progress };
    });
    setBranches([-1, 1].map((side) => ({
      path: corridor.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y + side * spread * point.progress}`).join(' '),
      delay: fraction * 6300,
    })));
  }, [route]);
  // Prepare every path before starting any animation: trunk and forks now share
  // the same clock, rather than mounting delayed forks after the trunk started.
  if (branches === null) return <path ref={mainPath} d={route.path} visibility="hidden" style={{ animation: 'none' }} />;
  return <g className="home-connection-signal-wave" onAnimationEnd={(event) => {
    if (event.target === event.currentTarget) onComplete();
  }}>
    <path className="home-connection-signal-glow" d={route.path} pathLength="100" />
    <path className="home-connection-signal" d={route.path} pathLength="100" />
    {branches.map((branch, index) => <g key={index} className="home-connection-signal-branch" style={{ animationDelay: `${branch.delay}ms` }}>
      <path className="home-connection-signal-glow" d={branch.path} pathLength="100" />
      <path className="home-connection-signal" d={branch.path} pathLength="100" />
    </g>)}
  </g>;
}

export function ConnectionSignals() {
  const [signal, setSignal] = useState({ route: 0, generation: 0 });
  return <svg className="home-connection-signals" viewBox="0 0 1000 650" preserveAspectRatio="none"
    aria-hidden="true" focusable="false">
    <SignalPulse key={signal.generation} route={routes[signal.route]} onComplete={() => {
      // Switch between curved and angular families so neither disappears from
      // the mix; choose a different height/direction within the next family.
      const nextFamily = signal.route % 2 === 0 ? 1 : 0;
      setSignal({ route: nextFamily + Math.floor(Math.random() * 3) * 2, generation: signal.generation + 1 });
    }} />
  </svg>;
}
