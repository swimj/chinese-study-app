import fs from 'node:fs';
import { readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';
import { observeHosted, validateRequest } from './lib/cloud-hosted-observation.ts';

const args = readStrictArguments(['app', 'machine', 'queries', 'transport']);
const transport = args.get('transport') ?? 'ssh';
if (transport !== 'ssh' && transport !== 'machine-exec') throw new Error('--transport must be ssh or machine-exec.');
const file = args.get('queries');
const request = validateRequest(file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
console.log(JSON.stringify(observeHosted(requireArgument(args, 'app'), requireArgument(args, 'machine'), request, undefined, transport), null, 2));
