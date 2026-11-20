import { lazy, Suspense } from 'react';
import OperatorApp from './OperatorApp';
import { isOperatorPath } from './features/operator/routes';
const VocabularyApp = lazy(() => import('./VocabularyApp'));

export default function App(props:{onSignOut?:()=>Promise<void>;accountScope?:string}) {
  if (typeof window !== 'undefined' && isOperatorPath(window.location.pathname)) return <OperatorApp onSignOut={props.onSignOut} />;
  return <Suspense fallback={<p>Loading…</p>}><VocabularyApp {...props}/></Suspense>;
}
