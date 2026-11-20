// Declaration-level liveness: which top-level declarations stay reachable from
// live roots once the legacy app, legacy routes, and legacy runtime are cut.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const ts = createRequire(process.cwd() + '/package.json')('typescript') as typeof import('typescript');

const S = path.dirname(new URL(import.meta.url).pathname);
const cutFiles = new Set((process.env.CUT_FILES ?? 'src/LegacyApp.tsx,server/routes/legacy-study-routes.ts,server/routes/legacy-reflection-routes.ts').split(',').filter(Boolean).map((f) => path.resolve(f)));
const cutSymbols = new Set(process.env.NO_CUT_SYMBOLS ? [] : ['recoverPendingReflectionApplicationsAtStartup', 'createSessionCompletionWorker', 'createInitialReflectionGenerationService',
  'createStdoutReflectionLifecycleLogger', 'createFileReflectionFailureArtifactSink', 'createFileReflectionProviderDiagnosticSink']);
const withScripts = process.argv.includes('--scripts');
const scriptFiles = withScripts ? fs.readdirSync('scripts').filter((f) => f.endsWith('.ts')).map((f) => path.resolve('scripts', f)) : [];
const rootFiles = ['server/index.ts', 'src/main.tsx'].map((f) => path.resolve(f)).concat(scriptFiles);
const excludeScripts = (process.env.EXCLUDE_SCRIPTS ?? '').split(',').filter(Boolean).map((f) => path.resolve('scripts', f + '.ts'));
const liveFiles0 = new Set([...fs.readFileSync(`${S}/${process.env.REACH ?? 'reach-live.txt'}`, 'utf8').trim().split('\n').map((f) => path.resolve(f)), ...scriptFiles]);
const liveFiles = new Set([...liveFiles0].filter((f) => !excludeScripts.includes(f)));

const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'fixtures' ? [] : walk(p);
  return /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : [];
});
const files = [...walk(path.resolve('server')), ...walk(path.resolve('src')), ...walk(path.resolve('scripts')), path.resolve('src/vite-env.d.ts')].filter((f) => fs.existsSync(f));
const program = ts.createProgram(files, {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true, noEmit: true, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, esModuleInterop: true,
  resolveJsonModule: true, types: ['node'], lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
});
const checker = program.getTypeChecker();
const projectRoot = path.resolve('.');

type Key = string; // file::index
const keyOf = (sf: ts.SourceFile, st: ts.Statement) => `${sf.fileName}::${sf.statements.indexOf(st)}`;
const topStatement = (n: ts.Node): ts.Statement | undefined => {
  let cur: ts.Node = n;
  while (cur.parent && !ts.isSourceFile(cur.parent)) cur = cur.parent;
  return cur.parent ? (cur as ts.Statement) : undefined;
};
const isDecl = (st: ts.Statement) => ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isVariableStatement(st)
  || ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isEnumDeclaration(st);
const declName = (st: ts.Statement): string => {
  if (ts.isVariableStatement(st)) return st.declarationList.declarations.map((d) => d.name.getText()).join(',');
  return (st as ts.FunctionDeclaration).name?.text ?? (ts.isExportAssignment(st) ? 'default' : '?');
};

const edges = new Map<Key, Set<Key>>();
const exportedByName = new Map<string, Key[]>();
for (const sf of program.getSourceFiles()) {
  if (!sf.fileName.startsWith(projectRoot) || sf.fileName.includes('node_modules')) continue;
  for (const st of sf.statements) {
    const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) ?? [] : [];
    if (!mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const n of declName(st).split(',')) { const k = `${sf.fileName}::${sf.statements.indexOf(st)}`; exportedByName.set(n, [...(exportedByName.get(n) ?? []), k]); }
  }
}
const roots = new Set<Key>();
const meta = new Map<Key, { file: string; name: string; lines: number; decl: boolean }>();
const addEdge = (a: Key, b: Key) => { if (!edges.has(a)) edges.set(a, new Set()); edges.get(a)!.add(b); };

for (const sf of program.getSourceFiles()) {
  if (!sf.fileName.startsWith(projectRoot) || sf.fileName.includes('node_modules')) continue;
  const fileLive = liveFiles.has(sf.fileName) && !cutFiles.has(sf.fileName);
  for (const st of sf.statements) {
    const k = keyOf(sf, st);
    const decl = isDecl(st) || ts.isExportAssignment(st);
    meta.set(k, { file: path.relative(projectRoot, sf.fileName), name: declName(st), lines: sf.getLineAndCharacterOfPosition(st.end).line - sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1, decl });
    if (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) continue;
    if (fileLive && (rootFiles.includes(sf.fileName) || !decl)) {
      if (!(cutSymbols.has(declName(st)))) roots.add(k);
    }
  }
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    // dynamic import of a file: its default export is reachable from the importing statement
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const sym = checker.getSymbolAtLocation(n.arguments[0]);
      const target = sym?.valueDeclaration as ts.SourceFile | undefined;
      const from = topStatement(n);
      if (target && ts.isSourceFile(target) && from && !cutFiles.has(target.fileName)) {
        for (const st of target.statements) {
          const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) ?? [] : [];
          if (mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || ts.isExportAssignment(st)) addEdge(keyOf(sf, from), keyOf(target, st));
        }
      }
    }
    if (ts.isPropertyAccessExpression(n)) {
      const t = checker.getTypeAtLocation(n.expression);
      const from = topStatement(n);
      if (from && (t.flags & ts.TypeFlags.Any)) for (const k of exportedByName.get(n.name.text) ?? []) if (!cutSymbols.has(n.name.text)) addEdge(keyOf(sf, from), k);
    }
    if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
      const prop = (n.propertyName ?? n.name);
      const from = topStatement(n);
      if (from && ts.isIdentifier(prop)) {
        const t = checker.getTypeAtLocation(n.parent);
        let psym = t.getProperty(prop.text);
        if (psym && psym.flags & ts.SymbolFlags.Alias) { try { psym = checker.getAliasedSymbol(psym); } catch { /* ignore */ } }
        for (const d of psym?.declarations ?? []) {
          const tsf = d.getSourceFile(); const tst = topStatement(d);
          if (!tst || !tsf.fileName.startsWith(projectRoot) || tsf.fileName.includes('node_modules') || cutFiles.has(tsf.fileName)) continue;
          if (keyOf(sf, from) !== keyOf(tsf, tst)) addEdge(keyOf(sf, from), keyOf(tsf, tst));
        }
      }
    }
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) {
      let sym = checker.getSymbolAtLocation(n);
      if (sym && sym.flags & ts.SymbolFlags.Alias) { try { sym = checker.getAliasedSymbol(sym); } catch { /* ignore */ } }
      const from = topStatement(n);
      if (sym?.declarations && from) {
        for (const d of sym.declarations) {
          const tsf = d.getSourceFile();
          if (!tsf.fileName.startsWith(projectRoot) || tsf.fileName.includes('node_modules') || cutFiles.has(tsf.fileName)) continue;
          const tst = topStatement(d) ?? (ts.isSourceFile(d) ? undefined : undefined);
          if (!tst) continue;
          if (cutSymbols.has(declName(tst))) continue;
          const a = keyOf(sf, from), b = keyOf(tsf, tst);
          if (a !== b) addEdge(a, b);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

const live = new Set<Key>(); const parent = new Map<Key, Key>();
const queue = [...roots]; for (const r of roots) live.add(r);
while (queue.length) { const k = queue.shift()!; for (const n of edges.get(k) ?? []) if (!live.has(n)) { live.add(n); parent.set(n, k); queue.push(n); } }
for (const want of (process.env.WHY ?? '').split(',').filter(Boolean)) {
  const k = [...meta].find(([kk, m]) => m.name === want && live.has(kk))?.[0];
  if (!k) { console.log(`WHY ${want}: dead`); continue; }
  const chain: string[] = []; let c: Key | undefined = k;
  while (c) { const m = meta.get(c)!; chain.push(`${m.file}:${m.name}`); c = parent.get(c); }
  console.log(`WHY ${want}: ${chain.join(' <- ')}`);
}

// report per file: dead declaration lines among files that are live-reachable or legacy-only
const perFile = new Map<string, { total: number; dead: number; deadNames: string[] }>();
for (const [k, m] of meta) {
  if (!m.decl) continue;
  if (!/^(server|src)\//.test(m.file)) continue;
  const e = perFile.get(m.file) ?? { total: 0, dead: 0, deadNames: [] };
  e.total += m.lines;
  if (!live.has(k)) { e.dead += m.lines; e.deadNames.push(`${m.name}(${m.lines})`); }
  perFile.set(m.file, e);
}
const rows = [...perFile].filter(([, e]) => e.dead > 0).sort((a, b) => b[1].dead - a[1].dead);
fs.writeFileSync(`${S}/dead-decls${process.env.OUT ?? ''}.txt`, rows.map(([f, e]) => `${f}\t${e.dead}/${e.total}\t${e.deadNames.join(' ')}`).join('\n'));
let sum = 0; for (const [, e] of rows) sum += e.dead;
console.log(`dead declaration lines: ${sum} across ${rows.length} files`);
for (const [f, e] of rows.slice(0, 60)) console.log(`${String(e.dead).padStart(6)} / ${String(e.total).padStart(5)}  ${f}`);
