import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { renderExperimentComparison, type ComparisonGuide } from '../server/word-content-lab/vocabulary-experiments/preview.ts';

const { values } = parseArgs({ options: { archive: { type: 'string' }, output: { type: 'string' } } });
if (!values.archive || !values.output) throw new Error('Expected --archive and --output directories. This renderer makes no model calls.');
const root = path.resolve(values.archive);
const outputDirectory = path.resolve(values.output);
type Trial = { id: string; variant: string; word: string; role: string; status: string; count: number | null };
const rows = JSON.parse(await readFile(path.join(root, 'trial-summary.json'), 'utf8')) as Trial[];
function run(word: string, variant: string): string {
  const matches = rows.filter((row) => row.word === word && row.variant === variant && row.status === 'completed');
  if (matches.length !== 1) throw new Error(`Expected one completed ${variant} run for ${word}.`);
  return matches[0]!.id;
}
const back = { label: 'Findings overview', href: 'vocabulary-trial-findings.html' };
const foam = { label: 'Keep simple cues', href: 'trial-泡沫.html' };
const scope = { label: 'Target the right unit', href: 'trial-不堪.html' };
const teaching = { label: 'Match the teaching', href: 'trial-scope.html' };
async function page(file: string, ids: string[], guide: ComparisonGuide): Promise<void> {
  await writeFile(path.join(outputDirectory, file), await renderExperimentComparison(root, ids, guide), { mode: 0o600 });
}
await mkdir(outputDirectory, { recursive: true });

{
  const earlier = run('泡沫', 'broad-v1'); const current = run('泡沫', 'broad-v4');
  await page(foam.href, [earlier, current], {
    title: '1 · 泡沫: keep an easy way in',
    question: 'Can a bigger pool keep the simple cues that already work?',
    context: 'The source covers physical foam/lather and an economic bubble. The first broad draft generated plenty of situations, but lost the short conceptual entry points. The current candidate explicitly keeps those alongside alternatives.',
    takeaway: '“Foam or lather” can remain a complete, useful exercise. A broader repertoire can offer other routes without making the simplest one longer.',
    back, next: scope,
    versions: {
      [earlier]: { label: 'Earlier: lots of situations', description: 'Broad v1 encouraged volume and variation. The pool grew, but mostly through sentences and scenarios.' },
      [current]: { label: 'Current candidate: simple cues + alternatives', description: 'Broad v4 preserves direct meanings where they fit, then explores context and phrasing.' },
    },
    examples: [
      { runId: earlier, exerciseId: 'paomo-foam-01', label: 'Earlier: a whole situation', observation: 'This describes soap starting to foam. Compare the reading and the requested answer with the plain cue in the other version.' },
      { runId: current, exerciseId: 'foam-1', label: 'Current: the plain meaning returns', observation: 'A short concept anchor sits alongside a larger pool; it has not been replaced by a miniature story.' },
      { runId: current, exerciseId: 'foam-3', label: 'Current: put the action in a cloze', observation: 'Here the sentence supplies the action and the blank asks for the noun. The plain cue and this context can coexist.' },
    ],
  });
}
{
  const earlier = run('不堪', 'broad-v2'); const current = run('不堪', 'broad-v4');
  await page(scope.href, [earlier, current], {
    title: '2 · 不堪: what exactly should the learner recall?',
    question: 'Does the cue ask for this expression, or for a whole phrase containing it?',
    context: 'The source teaches 不堪 after a description, as in 疲惫不堪, and before an action, as in 不堪忍受. “Utterly exhausted” naturally describes the whole state. A cloze can supply the rest and isolate 不堪’s contribution.',
    takeaway: 'The important choice is the unit being retrieved. For this use, simple practice can be a short familiar construction rather than a standalone definition.',
    back, previous: foam, next: teaching,
    versions: {
      [earlier]: { label: 'Earlier: simple cues, loose answer scope', description: 'Broad v2 restored direct meanings but sometimes described more language than the target itself supplies.' },
      [current]: { label: 'Current candidate: choose the answer scope first', description: 'Broad v4 lets a constructional use rely on clozes. It does not force every use to have a definition card.' },
    },
    examples: [
      { runId: earlier, exerciseId: 'after-1', label: 'Earlier: “Utterly exhausted”', observation: 'The expected answer is 不堪, but the English cue names the full state. Revealing a note about intensification cannot supply missing context before the answer.' },
      { runId: current, exerciseId: 'after-1', label: 'Current: 疲惫____', observation: 'The surrounding construction is visible. The learner is now recalling the target’s particular contribution.' },
    ],
  });
}
{
  const current = run('报备', 'teaching-v2');
  await page(teaching.href, [current], {
    title: '3 · 报备: reinforce what was actually taught',
    question: 'Will exercises follow the introduction’s scope?',
    context: 'This was a deliberate scope test. The full source includes both formal notification and keeping a partner informed. The learner was shown only the first four introduction beats, covering formal notification to property management. The partner use was available to the model but had not been taught.',
    takeaway: 'In this trial the exercises stayed with formal notification. That supports passing the actual introduction to teaching-exercise generation, while keeping broader practice separate.',
    back, previous: scope,
    next: { label: 'Back to the findings', href: back.href + '#recommendation' },
    versions: { [current]: { label: 'Current teaching candidate', description: 'Teaching v2 received the full source plus a deliberately narrower delivered introduction. Open “What the learner was shown” to inspect it.' } },
    examples: [
      { runId: current, exerciseId: 'baobei-formal-1', label: 'A plain cue for the taught meaning', observation: 'Formal notification appears as a direct meaning; the untaught relationship use does not appear.' },
      { runId: current, exerciseId: 'baobei-formal-2', label: 'A familiar construction from the introduction', observation: 'The property-management example reinforces the material just introduced. It does not need to explore every source use yet.' },
    ],
  });
}
{
  const earlier = run('不堪', 'teaching-v1'); const current = run('不堪', 'teaching-v2');
  await page('trial-teaching.html', [earlier, current], {
    title: 'Optional · 不堪: teaching through familiar patterns',
    question: 'Which feels more useful immediately after the introduction?',
    context: 'Both calls received the same complete introduction: exhaustion, intolerable noise and a weak team. The revision encourages a familiar construction when a direct definition would become a grammar drill.',
    takeaway: 'The second draft practises the patterns from the introduction directly. That is my preferred next review candidate, not a measured learning advantage.',
    back, next: { label: 'The teaching-scope test', href: teaching.href },
    versions: {
      [earlier]: { label: 'Earlier: definitions + constructions', description: 'Teaching v1 includes explicit grammatical descriptions as direct recall cues.' },
      [current]: { label: 'Current candidate: familiar construction recall', description: 'Teaching v2 concentrates on the three constructions the introduction actually develops.' },
    },
    examples: [
      { runId: earlier, exerciseId: 'bukan-ex-1', label: 'Earlier: describe the grammatical contribution', observation: 'This explains what the expression does, but may feel like a grammar-category recall task.' },
      { runId: current, exerciseId: 'bukan-ex-1', label: 'Current: practise the introduced pattern', observation: 'This gives the familiar context and asks the learner to complete it.' },
    ],
  });
}
{
  const earlier = run('报备', 'broad-v1'); const current = run('报备', 'broad-v4');
  await page('trial-报备.html', [earlier, current], {
    title: 'Optional · 报备: broaden situations and tone',
    question: 'What variety does the broader pool actually provide?',
    context: 'Both source uses are active in general practice: formal notification and keeping a partner informed. Unlike the teaching-scope test, this pool may explore both. Compare the plain anchors, administrative situations, and considerate versus controlling relationship tone.',
    takeaway: 'The current pool keeps plain meanings alongside contexts. Much of the variation is still within familiar cue forms; learner use will tell us which differences matter.',
    back, next: { label: 'Return to the findings', href: back.href },
    versions: {
      [earlier]: { label: 'Earlier: scenario-heavy breadth', description: 'Broad v1 offers many situations and framed clozes.' },
      [current]: { label: 'Current candidate: anchors + contextual options', description: 'Broad v4 adds short meaning anchors while allowing close variants and different tones.' },
    },
    examples: [
      { runId: earlier, exerciseId: 'baobei-formal-01', label: 'Earlier: the administrative scenario', observation: 'A complete setting evokes the use, at the cost of more reading.' },
      { runId: current, exerciseId: 'formal-1', label: 'Current: a shorter anchor', observation: 'This offers a more direct entry into the same formal use.' },
      { runId: current, exerciseId: 'relationship-4', label: 'Current: a different interpersonal tone', observation: 'This variant evokes the burdensome expectation to report even minor outings.' },
    ],
  });
}

const overview = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Vocabulary prompt findings: guided review</title><style>
*{box-sizing:border-box}body{max-width:68rem;margin:0 auto;padding:2rem 1.5rem;background:#f5f4ee;color:#243226;font:18px/1.6 system-ui,sans-serif}h1{font-size:2rem;line-height:1.25}h2{font-size:1.4rem}h3{font-size:1.15rem}a{color:#245e40;text-underline-offset:.2em}a:focus-visible,summary:focus-visible{outline:3px solid #367958;outline-offset:3px}.eyebrow{font-size:.9rem;color:#526351;letter-spacing:.04em}.lead{font-size:1.15rem;max-width:54rem}nav{display:flex;flex-wrap:wrap;gap:.6rem 1.5rem;border-block:1px solid #c1cdbb;padding:.7rem 0;margin:1.5rem 0}.route{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));gap:1rem}article,.recommendation{background:#fff;border:1px solid #c1cdbb;border-radius:.6rem;padding:1.2rem}article p{margin:.6rem 0}.step{color:#3e6940;font-weight:700}.recommendation{background:#e7ede2;margin-top:2rem}details{border-top:1px solid #c1cdbb;padding:1rem 0;margin:1rem 0}summary{cursor:pointer}table{border-collapse:collapse;width:100%;font-size:1rem}td,th{padding:.5rem;border-bottom:1px solid #c1cdbb;text-align:left}li{margin:.65rem 0}.muted{color:#526351;font-size:1rem}.versions{display:grid;grid-template-columns:max-content 1fr;gap:.6rem 1rem}.versions dt{font-weight:600}.versions dd{margin:0}@media(max-width:600px){body{padding:1rem}.versions{grid-template-columns:1fr;gap:.2rem}.versions dd{margin-bottom:.8rem}}
</style><body><p class="eyebrow">PROMPT TRIALS · GUIDED REVIEW</p><h1>More ways to practise, with the same linguistic judgment</h1><p class="lead">The experiments ask how to open up the practice pool while preserving what the existing prompts care about: a graspable meaning, natural expression, and a cue that asks for the right piece of language.</p><p>My current review candidates are <strong>general v4</strong> and <strong>teaching v2</strong>. The three stops below explain why. You can review the argument through a few highlighted exercises before browsing any complete pool.</p><nav aria-label="Findings sections"><a href="#start">Start here</a><a href="#recommendation">My recommendation</a><a href="#more">More comparisons</a><a href="#versions">Version key & evidence</a></nav>
<section id="start"><h2>Start here: a three-stop route</h2><p>Each page has a short reading guide, descriptive version labels, highlighted examples, and a next link. Open an answer only when you want to check it.</p><div class="route">
<article><p class="step">1 · Keep an easy way in</p><h3>泡沫: simple cues survive expansion</h3><p>What changed when “more options” stopped meaning mostly more situations?</p><p><strong>Look for:</strong> “Foam or lather” alongside context-based alternatives.</p><a href="trial-泡沫.html">Begin with 泡沫 →</a></article>
<article><p class="step">2 · Target the right unit</p><h3>不堪: meaning alone is not enough</h3><p>Does a cue ask for the exact expression, or a whole phrase containing it?</p><p><strong>Look for:</strong> “Utterly exhausted” versus <span lang="zh">疲惫____</span>.</p><a href="trial-不堪.html">Compare the answer scope →</a></article>
<article><p class="step">3 · Match the teaching</p><h3>报备: respect what was introduced</h3><p>Can teaching exercises stay within the lesson, even with more uses in the source?</p><p><strong>Look for:</strong> formal notification taught; relationship usage left for later.</p><a href="trial-scope.html">Inspect the teaching boundary →</a></article>
</div></section>
<section class="recommendation" id="recommendation"><h2>My recommendation</h2><p>Use <strong>general v4</strong> and <strong>teaching v2</strong> as the next candidates for your judgment. Keep plain meanings where they fit, provide constructional context where the target needs it, and let the pool contain several plausible routes into the same use.</p><p>Keep light curation. Expanded pools still produce a questionable construction or an artificial clue occasionally. These trials support a direction for prompt review; they do not establish that the cues work better for learners.</p></section>
<section id="more"><h2>Optional comparisons</h2><ul><li><a href="trial-报备.html">General 报备: administrative situations and relationship tone</a> — what variety looks like within familiar exercise forms.</li><li><a href="trial-teaching.html">Teaching 不堪: grammar descriptions versus familiar constructions</a> — a closer look at the teaching revision.</li></ul></section>
<section id="versions"><details><summary>What the version names mean</summary><dl class="versions"><dt>Compact baseline</dt><dd>Existing practice-prompt editorial policy, adapted to the experiment input/output shape. A reference point, not a replay of deployed study.</dd><dt>General v1</dt><dd>First broad-pool draft: many options, mostly scenarios and clozes.</dd><dt>General v2</dt><dd>Restored plain meaning anchors. Some cues still asked for the wrong unit of language.</dd><dt>General v3</dt><dd>Added a softer answer-scope warning; the problem persisted in the 不堪 sample.</dd><dt>General v4</dt><dd>Chooses answer scope first. Current practice candidate; still subject to curation.</dd><dt>Teaching v1 → v2</dt><dd>Both use the actual delivered introduction. V2 favors familiar constructions when a direct definition becomes a grammar drill.</dd></dl><p>The guided pages show the two versions most relevant to their question, rather than every iteration at once.</p></details>
<details><summary>Trial size, counts, cost and limitations</summary><p>21 completed calls across five fixed-source words using gpt-5.6-luna with high reasoning. There was one draw per word/variant. These are Codex editorial judgments on generated drafts, not learner-outcome evidence.</p><table><caption>Number of exercises returned; counts are not quality scores.</caption><tr><th>Word</th><th>Compact</th><th>General v1</th><th>General v4</th></tr><tr><td>报备</td><td>2</td><td>14</td><td>10</td></tr><tr><td>泡沫</td><td>2</td><td>16</td><td>12</td></tr><tr><td>不堪</td><td>2</td><td>16</td><td>10</td></tr></table><p>The recorded repository-based estimate is about $0.042, not verified billing. Exact prompts, inputs, outputs and review notes are retained in the experiment archive. No content was published to study by these experiments.</p></details></section><p class="muted">Suggested first pass: the three linked stops, then your reaction to the current candidates. Full pools and raw prompt details are available on each comparison page.</p></body></html>`;
await writeFile(path.join(outputDirectory, 'vocabulary-trial-findings.html'), overview, { mode: 0o600 });
console.log(path.join(outputDirectory, 'vocabulary-trial-findings.html'));
