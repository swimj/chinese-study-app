import fs from 'node:fs';
import { readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';
import { observeHosted, validateRequest } from './lib/cloud-hosted-observation.ts';

const args = readStrictArguments(['app', 'machine', 'queries']);
const file = args.get('queries');
const request = validateRequest(file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
console.log(JSON.stringify(observeHosted(requireArgument(args, 'app'), requireArgument(args, 'machine'), request), null, 2));
