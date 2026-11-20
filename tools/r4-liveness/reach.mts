import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const ts = createRequire(process.cwd() + '/package.json')('typescript') as typeof import('typescript');
// usage: reach.mts <cut-file,...> <entry,...>
const cuts = new Set(process.argv[2].split(',').filter(Boolean).map((p) => path.resolve(p)));
const entries = process.argv[3].split(',').filter(Boolean).map((p) => path.resolve(p));
const exts = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
const resolve = (from: string, spec: string) => {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec.split('?')[0]);
  for (const e of exts) { const f = base + e; if (fs.existsSync(f) && fs.statSync(f).isFile()) return f; }
  return null;
};
const deps = (f: string) => {
  const out: string[] = []; const src = fs.readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
  const visit = (n: ts.Node) => {
    let spec: string | undefined;
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) spec = n.moduleSpecifier.text;
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) spec = n.arguments[0].text;
    if (spec) { const r = resolve(f, spec); if (r && /\.(ts|tsx)$/.test(r)) out.push(r); }
    ts.forEachChild(n, visit);
  };
  visit(sf); return out;
};
const seen = new Set<string>(); const stack = [...entries];
while (stack.length) { const f = stack.pop()!; if (seen.has(f) || cuts.has(f)) continue; seen.add(f); stack.push(...deps(f)); }
for (const f of [...seen].sort()) console.log(path.relative(process.cwd(), f));
