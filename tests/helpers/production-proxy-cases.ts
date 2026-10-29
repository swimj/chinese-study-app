/** One set of preserved outcomes for the policy and both persisted-content adapters. */
export const productionProxyCases = [
  { name: 'no pure coverage permits dictionary production', pure: false, targeted: null, recognition: false, proxied: false, skills: ['production'] },
  { name: 'targeted production without pure coverage remains eligible', pure: false, targeted: 'shared', recognition: false, proxied: false, skills: ['production'] },
  { name: 'shared pure coverage excludes dictionary production', pure: true, targeted: null, recognition: false, proxied: true, skills: [] },
  { name: 'shared targeted content restores production', pure: true, targeted: 'shared', recognition: false, proxied: false, skills: ['production'] },
  { name: 'usable private targeted content serves while shared coverage remains proxied', pure: true, targeted: 'learner', recognition: false, proxied: true, skills: ['production'] },
  { name: 'proxied production leaves due recognition eligible', pure: true, targeted: null, recognition: true, proxied: true, skills: ['recognition'] },
] as const;
