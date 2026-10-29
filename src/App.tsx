import { lazy, Suspense } from 'react';
import { studyProfile } from './study-profile';
import VocabularyApp from './VocabularyApp';
const LegacyApp = lazy(() => import('./LegacyApp'));

// The adaptive vocabulary cutover is scoped to the Mandarin product.
export default function App(props:{onSignOut?:()=>Promise<void>;accountScope?:string}) {
  return studyProfile.id === 'mandarin' ? <VocabularyApp {...props}/> : <Suspense fallback={<p>Loading…</p>}><LegacyApp {...props}/></Suspense>;
}
