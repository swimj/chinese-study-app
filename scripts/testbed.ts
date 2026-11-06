import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { scenarios, scenarioById } from './testbed/catalog.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const [command = 'list', id = 'word', ...options] = process.argv.slice(2);
if (!['list','start'].includes(command)) throw new Error('Usage: npm run testbed -- list | start SCENARIO [--port=N]');
if (command === 'list') {
  console.log(scenarios.map(s => `${s.id.padEnd(21)} ${s.archetype.padEnd(14)} ${s.title}`).join('\n'));
  process.exit(0);
}
const scenario = scenarioById(id);
if (options.length > 1 || options.some(value => !/^--port=\d+$/.test(value))) throw new Error('Only --port=N is supported');
const requestedPort = options.length ? Number(options[0].split('=')[1]) : 0;
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error('Invalid port');
async function freePort(requested = 0): Promise<number> {
  return new Promise((resolve,reject)=>{
    const server=net.createServer();server.once('error',reject);
    server.listen({host:'127.0.0.1',port:requested,exclusive:true},()=>{
      const address=server.address();if (!address || typeof address==='string') throw new Error('Expected TCP address');
      server.close(error=>error?reject(error):resolve(address.port));
    });
  });
}
const port = await freePort(requestedPort);
const runDir = fs.mkdtempSync(path.join(os.tmpdir(),'chinese-study-testbed-'));
// Child processes receive no inherited application configuration or provider credentials.
const env: NodeJS.ProcessEnv = Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].flatMap(key=>process.env[key]===undefined?[]:[[key,process.env[key]!]]));
Object.assign(env,{APP_MODE:'study',APP_AUTH_MODE:'trusted_local',APP_OPERATOR_CLERK_USER_IDS:'trusted_local',APP_STUDY_PROFILE:'mandarin',APP_LEARNER_ID:'dev-learner',APP_HOST:'127.0.0.1',APP_METRICS_PORT:''});
let backend: ChildProcess | undefined;
let vite: ViteDevServer | undefined;
let stopping = false;
async function stop(code:number) {
  if (stopping) return;stopping=true;process.exitCode=code;
  await vite?.close();
  if (backend && backend.exitCode === null) {
    backend.kill('SIGTERM');
    const timer=setTimeout(()=>backend?.kill('SIGKILL'),5000);timer.unref();
  }
}
process.once('SIGINT',()=>void stop(0));process.once('SIGTERM',()=>void stop(0));
function prepare(script:string,dataDir:string) {
  const result=spawnSync(process.execPath,['--import','tsx',script,`--data-dir=${dataDir}`],{cwd:root,env,encoding:'utf8'});
  fs.appendFileSync(path.join(runDir,'setup.log'),result.stdout??'');
  fs.appendFileSync(path.join(runDir,'setup.log'),result.stderr??'');
  if(result.error || result.status!==0) throw new Error(`Fixture setup failed; inspect ${path.join(runDir,'setup.log')}`,{cause:result.error});
}
try {
  let apiPort:number|undefined;
  if(scenario.archetype==='real-backend') {
    apiPort=await freePort();
    const dataDir=path.join(runDir,'data');env.APP_DATA_DIR=dataDir;
    prepare('scripts/prepare-vocabulary-fixtures.ts',dataDir);
    prepare('scripts/testbed/prepare-operator.ts',dataDir);
    backend=spawn(process.execPath,['--import','tsx','scripts/testbed/backend.ts',`--port=${apiPort}`],{cwd:root,env,stdio:['ignore','pipe','pipe']});
    const log=fs.createWriteStream(path.join(runDir,'backend.log'));
    backend.stdout!.pipe(log,{end:false});backend.stderr!.pipe(log,{end:false});
    backend.once('error',error=>{console.error(error.message);void stop(1);});
    backend.once('exit',()=>{log.end();if(!stopping){console.error('Backend exited; inspect backend.log');void stop(1);}});
    let ready=false;
    for(let attempt=0;attempt<100;attempt++) {
      if(backend.exitCode!==null || stopping) throw new Error('Backend failed to start');
      try {const response=await fetch(`http://127.0.0.1:${apiPort}/healthz`);if(response.ok){ready=true;break;}} catch {}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!ready) throw new Error('Backend readiness timed out');
  }
  // Vite's default .env loading and inherited VITE_* values must not select hosted services.
  for(const key of Object.keys(process.env)) if(key.startsWith('VITE_')) delete process.env[key];
  const origin=`http://127.0.0.1:${port}`;
  const entry=scenario.archetype==='presentation'?`/tests/browser/${scenario.fixture}.html`:'/operator/improvement';
  const previewUrl=`${origin}${entry}${scenario.query?'?'+scenario.query:''}`;
  const escape=(text:string)=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const catalog=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Chinese Study preview testbed</title><style>body{font:18px/1.5 system-ui;max-width:70rem;margin:2rem auto;padding:0 1rem}td,th{text-align:left;vertical-align:top;padding:.7rem;border-bottom:1px solid #ccc}table{width:100%}code{overflow-wrap:anywhere}a{color:#075d73}</style><h1>Preview testbed</h1><p>Running: <strong>${escape(scenario.title)}</strong> · ${scenario.archetype}</p><p><a href="${escape(previewUrl)}">Open preview</a></p><p>${escape(scenario.limits)}</p><p>${scenario.archetype==='real-backend'?'Reload preserves saved data. Stop and rerun the launch command for a fresh database.':'Reload the preview to restore its starting state.'}</p><h2>Scenario catalog</h2><table><thead><tr><th>Scenario</th><th>Fixture level and purpose</th><th>Launch</th></tr></thead><tbody>${scenarios.map(s=>`<tr><td>${escape(s.title)}</td><td>${s.archetype}<br>${escape(s.purpose)}</td><td><code>npm run testbed -- start ${s.id}</code></td></tr>`).join('')}</tbody></table></html>`;
  vite=await createServer({root,configFile:false,envDir:runDir,plugins:[react(),{
    name:'preview-testbed',configureServer(server){server.middlewares.use((req,res,next)=>{
      const url=new URL(req.url??'/',origin);
      if(url.pathname==='/'||url.pathname==='/testbed') {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(catalog);return;}
      if(scenario.archetype==='app-simulated'&&url.pathname.startsWith('/operator')) req.url=`/tests/browser/${scenario.fixture}.html${url.search}`;
      next();
    });},
  }],define:{'import.meta.env.VITE_TESTBED_QUERY':JSON.stringify(scenario.query),__APP_VERSION__:JSON.stringify('testbed'),'import.meta.env.VITE_API_BASE':JSON.stringify(''),'import.meta.env.VITE_AUTH_MODE':JSON.stringify('trusted_local'),'import.meta.env.VITE_STUDY_PROFILE':JSON.stringify('mandarin')},server:{host:'127.0.0.1',port,strictPort:true,...(apiPort?{proxy:{'/api':`http://127.0.0.1:${apiPort}`}}:{})}});
  await vite.listen();
  const handoff=`# Preview handoff\n\n- Scenario: ${scenario.id}\n- Archetype: ${scenario.archetype}\n- URL: ${previewUrl}\n- Starting situation and purpose: ${scenario.purpose}\n- Real versus simulated / limits: ${scenario.limits}\n- Reset: ${scenario.archetype==='real-backend'?'stop and rerun the launch command; each run creates a fresh database':'reload the preview URL'}\n- Launch: npm run testbed -- start ${scenario.id}\n- Cleanup: Ctrl-C stops this run; artifacts are retained in ${runDir}. Remove only that disposable directory when no longer needed.\n`;
  fs.writeFileSync(path.join(runDir,'handoff.md'),handoff);
  console.log(`Catalog: ${origin}/testbed\nPreview: ${previewUrl}\nHandoff and logs: ${runDir}\nCtrl-C stops this run. Each new launch has isolated ports and fresh state.`);
} catch(error) {console.error(error);await stop(1);}
