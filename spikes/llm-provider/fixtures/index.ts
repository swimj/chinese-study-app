import type { ReflectionProviderFixtureV0 } from '../contracts.js';
import { stressCaseFixtures } from './stress-cases.js';
import { workflowAppendixFixtures } from './workflow-appendix.js';

export { stressCaseFixtures, workflowAppendixFixtures };

export const allProviderFixtures: ReflectionProviderFixtureV0[] = [
  ...workflowAppendixFixtures,
  ...stressCaseFixtures,
];
