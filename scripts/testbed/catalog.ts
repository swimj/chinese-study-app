export type Archetype = 'presentation' | 'app-simulated' | 'real-backend';
export interface PreviewScenario {
  id: string;
  title: string;
  archetype: Archetype;
  fixture?: 'vocabulary-case-review' | 'vocabulary-attention';
  query: string;
  entryPath?: string;
  purpose: string;
  limits: string;
}
const simulated = 'Synthetic content and in-memory API methods; reload resets edits. No HTTP persistence, authentication, provider execution, or learner handoff is validated. Unsupported requests fail visibly.';
export const scenarios: readonly PreviewScenario[] = [
  {id:'card',title:'Compact word review',archetype:'presentation',fixture:'vocabulary-case-review',query:'hideControls=1',purpose:'Explore the compact review component outside the application shell.',limits:simulated},
  {id:'word',title:'Word review in the application',archetype:'app-simulated',fixture:'vocabulary-case-review',query:'shell=1&hideControls=1',purpose:'Enter the actual operator route, review a word case, inspect full details, and apply or dismiss.',limits:simulated},
  {id:'pure-cue',title:'Word and pure-cue comparisons',archetype:'app-simulated',fixture:'vocabulary-case-review',query:'shell=1&design=1&hideControls=1',purpose:'Compare the first word case and next shared pure-cue case; inspect full review and reassessment.',limits:simulated},
  {id:'teaching',title:'Teaching review',archetype:'app-simulated',fixture:'vocabulary-case-review',query:'shell=1&teaching=1&hideControls=1',purpose:'Inspect a teaching case awaiting an operator decision.',limits:simulated},
  {id:'repertoire',title:'Selected senses and retained exercises',archetype:'app-simulated',fixture:'vocabulary-case-review',query:'shell=1&repertoire=1&hideControls=1',purpose:'Remove and restore selected senses in compact and full review; inspect explicit reassessment for an ungenerated sense.',limits:simulated},
  {id:'repertoire-failure',title:'Reassessment admission failure',archetype:'app-simulated',fixture:'vocabulary-case-review',query:'shell=1&repertoire=1&selectionQueueFailure=1&hideControls=1',purpose:'Check that a failed selection-and-reassessment request retains the editable draft.',limits:simulated},
  {id:'attention',title:'Attention queue and recovery',archetype:'app-simulated',fixture:'vocabulary-attention',query:'shell=1&clean=1',purpose:'Choose word defaults, inspect standalone proposals, and retry failed work across pages.',limits:simulated},
  {id:'attention-failure',title:'Failed default selection save',archetype:'app-simulated',fixture:'vocabulary-attention',query:'shell=1&saveFailure=1&clean=1',purpose:'Check that a failed save preserves selections and a retry can complete.',limits:simulated},
  {id:'empty',title:'Empty operator review',archetype:'app-simulated',fixture:'vocabulary-case-review',query:'shell=1&empty=1&hideControls=1',purpose:'Inspect the empty review entry point.',limits:simulated},
  {id:'persist',title:'Save and Apply with SQLite',archetype:'real-backend',query:'',purpose:'Open a review proposal, edit and save it, reload, and apply the saved revision.',limits:'Real application, HTTP handlers, SQLite, and approval journal/worker. Synthetic encounter, failed-assessment state, and manual proposal; trusted-local authentication. Provider workers are absent and provider work is disabled. This is not a provider-generated assessment, repertoire, or hosted-auth test.'},
  {id:'reconciliation',title:'Reconcile teaching and canonical senses',archetype:'real-backend',entryPath:'/operator/improvement',query:'view=attention',purpose:'Resolve the different teaching and canonical views of 挂钩, save and reopen the decision, inspect application blockers, and apply a supported resolution.',limits:'Real application, HTTP handlers, SQLite, and resolution/application semantics. Synthetic original and replacement teaching documents with a three-sense canonical inventory. Trusted-local authentication. Provider workers are absent and provider work is disabled: replacement content remains pending; this does not validate provider generation or hosted authentication.'},
];
export function scenarioById(id: string): PreviewScenario {
  const scenario = scenarios.find(value => value.id === id);
  if (!scenario) throw new Error(`Unknown scenario ${id}. Run npm run testbed -- list.`);
  return scenario;
}
