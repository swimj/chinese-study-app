# Themed open passages: a hand-run experiment

status: active
type: research
created: 2026-11-14
retire-when: revised by later experiments, or graduated into an owning product note
related:
  - notes/active/2026-11-10-daily-practice-orientation.md
  - SPECS/vocabulary-learning.md
  - SPECS/session-debrief.md

Exploratory record of a conversation and four hand-run practice rounds on
2026-11-13 and 2026-11-14. Provisional. It describes no shipped behavior and
changes no contract. Its purpose is to keep what the rounds felt like and what
they suggested, so later ideation does not start from zero.

## The question

Words in a session are independent of each other. Could part of a session be
one semantic unit, such as a story or a topic the learner cares about, so that
study is more engaging and personal? A second, optional goal: a new kind of
evidence about the learner.

Content quality is the main risk. A themed passage is single-use, so it cannot
lean on incremental repair or on sharing across learners the way word
exercises do.

## How the rounds were run

Justin answered; an agent wrote each exercise and judged the answers in the
conversation. No application code ran. The agent was both author and judge, so
individual verdicts are illustrative, not validated. Justin's position is that
verdict accuracy can be tuned later; what matters now is the kinds of outcome
the practice produces and how it feels.

Seeds for rounds 1 to 3 came from a random sample of 400 of his production
skills with an interval of 60 days or more, read from the hosted database with
the read-only observer. Round 4 simulated a capable learner who has only just
started tracking words: the bank was 300 of those words, the passage was
written freely at about B2/C1, and three blanks were probes on words outside
the bank. The agent chose every theme after seeing the sample, which makes word
fit easier than it would be with a learner-chosen theme.

| Round | Format | Result | How it felt |
| --- | --- | --- | --- |
| 1 | Connected story, open blanks, no English | 2 planned words, 4 accepted alternatives, 1 marginal, 1 miss | Best by a clear margin |
| 2 | Connected story with a word bank | 8 of 8 | Disliked: "too logic brain mode" |
| 3 | Standalone sentences with English cues, ordered as one night | 5 planned words, 3 marginal | OK |
| 4 | Connected exposition, open blanks, bank and probe blanks mixed | 3 planned words, 3 accepted, 2 marginal, 2 empty | Useful, harder to enter than round 1 |

An earlier pass without database access drafted the same three formats on a
stand-in pool; it showed only that every open blank has several correct
answers.

## What the rounds showed

### The open passage is the format

A connected story with open blanks and no English read as reading. The story
did the narrowing that an English frame does for a single cloze: answers
stayed inside one meaning, and the spread was near-synonyms.

The word bank turned the task into elimination. The last blanks fill
themselves, and the round said nothing about whether a word would come
unprompted.

English cues raised the hit rate on planned words and introduced translation
slips: "repair" drew 修理 where data takes 修复, and "test" drew 检测 where an
ordeal is a 考验.

Narrative may suit this better than exposition. In the detective story the
plot pinned each blank down. In the Nokia passage the blanks were mostly
abstract nouns and several were wide. Two passages are too few to settle it.

### Planned words are scaffolding

Exact match is unusable: every blank had correct alternatives, and several of
Justin's alternatives were as good as the planned word or better (线索 for 细节,
衰落 for 兴衰). The planned words did one job well, which was keeping the passage
inside the learner's vocabulary. The judgement that mattered was whether the
learner's word fits, plus a short note when it does not.

Because of that, probes on untracked words behaved the same as bank blanks. A
passage need not be built from the learner's bank, which answers the
small-bank quality worry for a learner who is capable but new to the app. A
probe hit is also evidence that a word needs no teaching.

### What the responses reveal

The app has no view of a learner's active vocabulary today. Drills measure
whether a given target can be produced. An open blank shows which word the
learner chooses.

Almost none of the slips were recall failures:

| Slip | Planned | What it was |
| --- | --- | --- |
| 仿佛 | 假装 | Narrator's "as if" used for deliberate pretending |
| 曝光 | 识破 | Public exposure used for one person seeing through a lie |
| 修理 | 修复 | Right meaning, wrong partner for data |
| 检测 | 考验 | Right meaning, wrong partner for an ordeal |
| 迅猛 | 残酷 | Drifted to speed where the sentence wanted character |
| 阴影 | 教训 | Pulled by 留下阴影; the clause that followed was a lesson |

A near neighbour won each time. These are confusions between words the learner
knows, which word drills cannot see.

The two empty blanks in round 4 had different causes, and only Justin's account
separated them:

- 傲慢: he did not parse the frame 多少带着…的傲慢 ("had something of … about
  it"). The word was never in doubt. The gap is a phrase construction.
- 内耗: the word occurred to him, but he knew it in its emotional sense
  (精神内耗) and did not trust it for an organization. The gap is a sense.

The learner's own account at reveal carried more than the verdict. The formats
also invited hedged answers and pairs of candidates (低估/忽略), which show which
neighbours were being weighed.

## Ideas this opened

**Keep everything; promote little.** Mistakes here are open-ended and a
learner's attention is bounded. Each response can be retained as evidence
(sentence, planned word, answer, verdict, short note, a coarse tag such as
collocation, register, sense, construction, translation from English). Turning
one into practice should wait for the learner's own signal that it matters, or
for recurrence across sessions. A passage segment that converts every slip
into a drill becomes a generator of chores.

**A learner backlog richer than the word stash.** The things surfaced here are
not words: "this sense of 内耗", "修理 against 修复", "the 带着 + abstract noun
frame". A backlog could hold items of those kinds, forming a fuller picture of
the learner for the system to serve from. It could also be shown to learners
who are curious, as something to look over now and then. It belongs to the
outer loop of the orientation note: present for those who care, never required.

**Senses already exist in the model.** The 内耗 case is evidence about a sense,
and the vocabulary contract separates senses from words. Shifting which uses
of a word get exercised has somewhere to attach.

**Confusion pairs as a lighter choice exercise.** Presenting two near
neighbours in context and asking which way to go felt acceptable where the
word bank did not: no long scan of unrelated options, and weighing two
connotations resembles what happens in real speech. The passages would supply
pairs from the learner's own slips. Contextual selection is the nearest
existing skill.

**Tendencies over time.** Justin's idealized picture is a strength function
over a semantic space of concepts and patterns, in which a non-target answer
is information about how the learner's vocabulary orients around a field. That
is too theoretical to build toward now. The tractable step is a record of
which words the learner reaches for and how often each was apt or stretched.
Overused words and broader confusions can only be looked for once such
practice has been served for a while, and only if the evidence was kept in a
minable shape from the first session.

**A responsive, conversational surface.** The most useful information in
these rounds came from Justin saying in his own words what felt off. That
happened because the exchange was a conversation. A rigid reveal screen with
fixed reactions would likely have recorded two empty blanks and nothing else.
How open the practice is makes the responsiveness of the interface part of
the practice, not decoration.

**The app noticing its own gaps.** The 带着 case exposed that phrase and
sentence constructions are not a concept in the app's model at all. That was
discovered from one learner interaction. Evidence of this kind could
surface product needs, not only learner needs.

**Long-running themes.** A learner might keep a few themes that a span of
sessions attaches to, giving a reason to come back for the content as well as
the learning. Arc each one loosely at the outset, choose words late according
to timing, and let the learner reflect on theme and content quality at a
slower cadence that steers the next stretch. The agent's suggestion is to make
installments episodic (same world, each readable alone), so a missed day costs
nothing.

## Open questions

- Alongside ordinary drills, or leading them? The agent's recommendation is
  alongside, as a closing segment, until judging and feel are better
  understood. Justin raised the stronger version: start with this practice and
  let it inform what needs drilling. Unsettled.
- What, if anything, feeds back into scheduling? An earlier suggestion was
  that success awards nothing and a failure only nominates an ordinary
  recheck. The rounds weakened even that: most misses were not recall
  failures.
- Live semantic judging conflicts with the current rule that model judgement
  does not enter live-session grading. Serving this for real needs an explicit
  decision about where such judgement sits.
- Does the feel hold for other learners, other themes, and themes the learner
  chose? All four rounds had one learner with a very large vocabulary and
  agent-chosen themes.
- Narrative against exposition, and how long a passage can be before it tires.
- Cost per session was set aside deliberately: product fit first.

## Round 1 as served

Kept as the reference example of the format that worked. Planned words in
order: 认定, 潦草, 细节, 债务, 假装, 辩解, 识破, 坦白. Justin's answers: 怀疑, 潦草,
线索, 债, 仿佛, 辩护, 曝光, 坦白.

> 深夜，有人敲门。福尔摩斯开门一看，是一位脸色苍白的年轻律师。他说，他的雇主昨晚死在书房里，警方【1】是自杀，可他不信。
>
> 到了现场，福尔摩斯没有先看尸体，而是盯着书桌上的遗书看了很久。字写得很【2】，像是匆忙中留下的。但真正引起他注意的是另一个【3】：钢笔放在墨水瓶的右边，而死者是左撇子。
>
> 死者的侄子当晚也在场。他表现得很平静，说叔叔最近因为赌博欠了一大笔【4】，早就不想活了。福尔摩斯听完，只问了一句：“既然如此，他为什么上周还订了去欧洲的船票？”
>
> 侄子先是【5】没听清，接着开始为自己【6】，话却越说越乱。其实欠钱的不是叔叔，而是他自己。谎言被【7】以后，他终于【8】了一切，当晚就被捕了。
