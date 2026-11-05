import { lazy, Suspense } from 'react';
import { studyProfile } from './study-profile';
import OperatorApp from './OperatorApp';
import { isOperatorPath } from './features/operator/routes';
const VocabularyApp = lazy(() => import('./VocabularyApp'));
const LegacyApp = lazy(() => import('./LegacyApp'));

// The adaptive vocabulary cutover is scoped to the Mandarin product.
export default function App(props:{onSignOut?:()=>Promise<void>;accountScope?:string}) {
  if (typeof window !== 'undefined' && isOperatorPath(window.location.pathname)) return <OperatorApp onSignOut={props.onSignOut} />;
  return <Suspense fallback={<p>Loading…</p>}>{studyProfile.id === 'mandarin' ? <VocabularyApp {...props}/> : <LegacyApp {...props}/>}</Suspense>;
}
