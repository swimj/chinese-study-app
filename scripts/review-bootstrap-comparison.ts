import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createWordIntroductionProvider, WORD_INTRODUCTION_MODEL } from '../server/word-content/provider.ts';
import {
  comparisonWordsFromSource, normalizedComparisonCues, renderComparisonHtml, sha256,
  type ComparisonReport,
} from './lib/review-bootstrap-comparison.ts';

function options(args: string[]): { sourceReport: string; outputDir: string; live: boolean } {
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = /^--(source-report|output-dir|live)=(.*)$/.exec(arg);
    if (!match || values.has(match[1]!)) throw new Error(`Unknown or duplicate option: ${arg}`);
    values.set(match[1]!, match[2]!);
  }
  const source = values.get('source-report');
  const output = values.get('output-dir');
  if (!source || !output || (values.has('live') && values.get('live') !== 'true' && values.get('live') !== 'false')) {
    throw new Error('Usage: node --import tsx scripts/review-bootstrap-comparison.ts --source-report=path --output-dir=isolated-path [--live=true]');
  }
  return { sourceReport: resolve(source), outputDir: resolve(output), live: values.get('live') === 'true' };
}
function inside(child: string, parent: string): boolean {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
function safeError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  const secrets = Object.entries(process.env).filter(([name, value]) => (
    /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name) && typeof value === 'string' && value.length >= 5
  )).map(([, value]) => value!);
  for (const secret of secrets) message = message.replaceAll(secret, '[redacted]');
  return message.replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]');
}
async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
async function save(report: ComparisonReport, directory: string): Promise<void> {
  await writeFile(resolve(directory, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(resolve(directory, 'comparison.html'), renderComparisonHtml(report));
}

/** Offline by default. Live mode makes exactly one new review request per saved word. */
export async function runComparison(args: string[]): Promise<ComparisonReport> {
  const { sourceReport, outputDir, live } = options(args);
  const sourceDir = resolve(sourceReport, '..');
  if (inside(outputDir, sourceDir) || inside(sourceDir, outputDir)) {
    throw new Error('Output directory must be isolated from the source report directory.');
  }
  const sourceText = await readFile(sourceReport, 'utf8');
  const sourceReportSha256 = sha256(sourceText);
  const source = comparisonWordsFromSource(JSON.parse(sourceText) as unknown);
  const currentReviewPromptSha256 = sha256(await readFile(new URL('../server/word-content/prompts/review.md', import.meta.url), 'utf8'));
  const currentTransport = live
    ? process.env.APP_USE_LOCAL_PROVIDER_PROXY === 'true' ? 'local_proxy' : 'direct'
    : 'not_run';
  if (live && currentTransport !== source.sourceTransport) {
    throw new Error(`Live transport must match source report (${source.sourceTransport}). Set APP_USE_LOCAL_PROVIDER_PROXY accordingly.`);
  }
  if (live && !process.env.OPENAI_API_KEY?.trim()) throw new Error('OPENAI_API_KEY is required for --live=true.');
  await mkdir(outputDir, { recursive: true });
  const jsonPath = resolve(outputDir, 'comparison.json');
  if (await exists(jsonPath)) {
    if (live) throw new Error('This output directory already has a comparison; use a new directory for an explicit rerun.');
    const saved = JSON.parse(await readFile(jsonPath, 'utf8')) as ComparisonReport;
    if (saved.schemaVersion !== 1 || saved.sourceReportSha256 !== sourceReportSha256) {
      throw new Error('Existing comparison was made from a different source report.');
    }
    await writeFile(resolve(outputDir, 'comparison.html'), renderComparisonHtml(saved));
    return saved;
  }
  const report: ComparisonReport = {
    schemaVersion: 1, sourceReport, sourceReportSha256,
    sourceModel: source.sourceModel, currentModel: WORD_INTRODUCTION_MODEL,
    sourceTransport: source.sourceTransport, currentTransport,
    sourceReviewPromptSha256: source.sourceReviewPromptSha256, currentReviewPromptSha256,
    mode: live ? 'live' : 'offline', startedAt: new Date().toISOString(), finishedAt: null,
    words: source.words,
  };
  await save(report, outputDir);
  if (live) {
    for (const word of report.words) {
      let rawText: string | undefined;
      const provider = createWordIntroductionProvider({
        onRawText: (stage, value) => { if (stage === 'review') rawText = value; },
      });
      const started = performance.now();
      try {
        // Reuse the exact saved bootstrap document. Never regenerate bootstrap or teaching.
        const rawOutput = await provider.generateReview(word.sourceContent);
        word.current.rawOutput = rawOutput;
        try {
          word.current.cues = normalizedComparisonCues(rawOutput, word.sourceContent);
          word.current.status = 'valid';
        } catch (error) {
          word.current.status = 'invalid';
          word.current.validationError = safeError(error);
          word.current.rawText = rawText;
        }
      } catch (error) {
        word.current.status = 'error';
        word.current.error = safeError(error);
        word.current.rawText = rawText;
      } finally {
        word.current.elapsedMs = performance.now() - started;
        // Persist each result so interruption does not silently retry prior calls.
        await save(report, outputDir);
      }
    }
  }
  report.finishedAt = new Date().toISOString();
  await save(report, outputDir);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runComparison(process.argv.slice(2)).then((report) => {
    console.log(`Comparison saved: ${resolve(process.argv.find((arg) => arg.startsWith('--output-dir='))!.slice('--output-dir='.length), 'comparison.html')}`);
    if (report.mode === 'live' && report.words.some((word) => word.current.status !== 'valid')) process.exitCode = 1;
  }).catch((error: unknown) => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
