# Media on the board

**Status: first cut implemented** (`media/`, `situations/media.ts`,
`public/media-policy.js`, `public/scrapbook.js`, `media-report.ts`). The
notes in each section record where the implementation settled something the
proposal left open.

This document is for anyone deciding how pictures, and later other media,
appear in the scrapbook without the learner asking for them. It explains the
model for making that decision and gives a first-cut implementation spec.
Thresholds and caps are *policy*; they are expected to change as the board and
Justin's taste evolve. The judgments and plumbing are meant to stay stable.

## The problem

A picture the learner brings is always welcome. A picture the system adds on
its own has to earn its place. Unprompted media tends to go wrong in a few
recognizable ways:

- **Literalism:** an idiom drawn literally, such as 透透气 shown as a picture
  of air.
- **Generic stock emotion:** a "distracted person" photo for 分心.
- **Wrong sense:** a homonym (an album called *Birdseed* for 鸟食), or a
  picture from elsewhere for a term or context that is specifically Chinese.
- **Tonal mismatch** with the conversation.
- **A board that turns into a mood board:** images crowd out the learner's
  own words.
- **Fabrication:** a generated "film still" or historical scene presented as
  real.

## The model: two layers

1. **Per-case judgment and local policy.** For each candidate, the model
   reports structured judgments. A local policy in code turns them into a
   *ceiling*: the most visible the item may ever be.
2. **Global composition policy.** A policy that runs *over* all ceilings on
   the board decides what is actually shown, based on the mix of media, the
   density, the pacing and the learner's taste. It may only lower a ceiling,
   never raise it.

The model reports judgments; the app owns both policies. Changing taste means
changing rules and thresholds in code, not the prompt.

### Visibility levels

| Level | Meaning |
| --- | --- |
| `none` | Not attached. The proposal is logged only. |
| `latent` | Attached to its piece but invisible until the learner focuses that piece. Then a small affordance materializes ("a picture of this"). A wrong guess costs almost nothing. |
| `placed` | Shown on the board as its own clipping. |

Learner-initiated media (their photos, and anything they choose to keep) is
always `placed` and is not subject to either policy.

### Judgments (reported by the model, each with a short reason)

| Judgment | Values | Question |
| --- | --- | --- |
| `referent` | `named`, `concrete`, `scene`, `abstract` | Is there one specific thing a picture could show? A named entity (芳华, 愚园路), a concrete noun (报刊亭), a scene (下雨天看书), or something abstract (分心)? |
| `senseMatch` | `entity`, `search`, `none` | How do we know the picture shows *this* sense? `entity` means the candidate came from the Wikidata item for the intended sense. `search` means only a text search matched. |
| `addedValue` | `cultural`, `recognition`, `memory`, `interest`, `none` | What does it say that the words don't? |
| `truthfulness` | `real`, `illustration` | A real thing needs a real, credited photo. An illustration must be labelled. v1 allows only `real`. |
| `tone` | `fits`, `jarring` | Does it suit the emotional register of its context? |

Categorical values are deliberate: they are more stable and easier to write
policy over than a confidence number.

### Local policy v1 (case → ceiling)

```text
truthfulness != real                                  → none (v1 has no generation)
tone == jarring                                       → none
referent in {scene, abstract}                         → none
senseMatch == none                                    → none
referent in {named, concrete}
  and senseMatch == entity
  and addedValue in {cultural, recognition, interest} → placed
otherwise                                             → latent
```

### Composition policy v1 (ceilings → what is shown)

These inputs are evaluated over the whole board each time it renders. Each
rule can only demote, and each demotion records a reason code.

| Rule | v1 setting | Reason code |
| --- | --- | --- |
| Learner setting `pictures` | `off` → everything system-initiated becomes `none`. `quiet` → `placed` becomes `latent`. `normal` → no change. | `setting` |
| Mix: system images per cluster | at most 1 `placed` | `cluster-cap` |
| Mix: images vs text on the board | `placed` system images ≤ 1 per 6 placed text pieces, rounded up | `mix-ratio` |
| Pacing | at most 2 newly `placed` system images per rolling 24 h. Older placements stay. | `pacing` |
| Taste | 2 dismissals in one `referent` category within 14 days cap that category at `latent` for 30 days | `taste` |

Where a rule must choose which items keep `placed`, it prefers higher
`addedValue` (`cultural` > `interest` > `recognition` > `memory`), then the
newer anchor piece. The item's attachment time stands in for its anchor's age,
because the media job runs right after the piece is created and saved words
carry no time of their own. The order is deterministic, so the board doesn't
reshuffle between renders.

Two further demotions to `none` are not taste rules: `not-for-me` when the
learner's latest reaction to the item was "Not for me", and `no-anchor` when
its piece is no longer on the board. Items the learner brought or kept are
excluded from every rule except `no-anchor`, and they don't count toward the
caps. The per-cluster, mix and pacing caps count system images and link cards
together.

"Mix" is defined over media *kinds* (`text`, `image`, and later `link`,
`audio`), so the same rules extend when other kinds arrive. v1 implements
`image`, and `link` cards for named works whose stills are not licensed.

### Worked examples

| Case | Judgments | Ceiling | Typical result |
| --- | --- | --- | --- |
| 报刊亭 noted in a Chinese story about one riverside kiosk | concrete · entity · cultural | placed | placed, unless that cluster already shows a system image |
| 报刊亭 saved as a bare word | concrete · entity · memory | latent | latent. Any newsstand is a fair picture: 报刊亭 is the general word, used by Chinese speakers abroad too. |
| 糖葫芦 saved as a word | concrete · entity · cultural | placed | placed. The term is China-specific, so a Chinese example matters. |
| 鸟食 saved as a word | concrete · entity · memory | latent | latent |
| 芳华 discussed | named · entity · interest | placed (link card) | placed link card. A cleared period photo, if any, is latent. |
| 透透气, 分心, 报备 | abstract | none | none |
| 冲得发白 | scene · search | none | none |

## Rights

- **License allowlist:** public domain, CC0, CC BY, CC BY-SA. Exclude NC and
  ND licenses, so monetization stays possible. Exclude unknown or missing
  licenses.
- **Credit every system image** with its author, its license (linked) and its
  source page. A clipping's credit line doubles as attribution.
- **Store references, not rehosted files:** the Commons thumbnail URL, source
  page and license metadata.
- **Films and other media stills:** v1 uses a link card (title, year, link to
  the Wikipedia or Douban page). No poster or still.
- **API etiquette:** requests use a generic, descriptive User-Agent
  (`mandarin-journal-prototype/0.1`) with no personal details.

## Implementation spec (first cut)

### Scope

v1 proposes pictures for **concrete nouns and places** that come from
**readings** (margin notes on a reading) and **saved words**. Pictures come
from Wikidata and Commons only. The default ceiling for anything the system
starts is `latent`; `placed` only comes from the local policy's strongest
case. The following are out of scope: generation, Openverse, audio and video,
images on conversation lines, the tutor talking about images, and thresholds
that learn automatically.

### Data (journal state)

```ts
type MediaItem = {
  id: string;
  kind: 'image' | 'link';
  origin: 'system' | 'learner';
  anchor: { kind: 'word' | 'annotation' | 'reading'; id: string };   // the piece it belongs to
  caption: string;                                                    // the anchor term
  source: { provider: 'wikidata-commons'; entityId?: string; pageUrl: string; thumbUrl?: string; width?: number; height?: number; title?: string; year?: string };
  license?: { code: 'PD' | 'CC0' | 'CC-BY' | 'CC-BY-SA'; url: string };
  credit?: { author: string; text: string };   // rendered credit line
  judgment?: Judgment;                          // absent for learner media
  ceiling: 'latent' | 'placed';                 // from the local policy; 'none' is never stored
  createdAt: string;
  reactions: { kept?: string; notForMe?: string };   // ISO times; the later one wins
};
type MediaDecision = { at: string; anchor: MediaItem['anchor']; judgment: Judgment; ceiling: 'none' | 'latent' | 'placed'; mediaId?: string };
// Judgment holds the five categorical values plus reasons: { referent, senseMatch, addedValue, truthfulness, tone }.
// "Not for me" is the dismissal the taste rule counts; there is no separate dismissed reaction.
// State gains: media: MediaItem[]; mediaDecisions: MediaDecision[] (newest 200 kept); settings.pictures: 'off' | 'quiet' | 'normal'
```

Old journals open with empty arrays and `pictures: 'normal'`.

### Components

| Component | Where | Kind |
| --- | --- | --- |
| `media/judgment.ts`: zod schema for `Judgment` and the candidate pick | server | schema |
| `media/local-policy.ts`: `ceilingFor(judgment)` | shared pure function | policy |
| `public/media-policy.js`: `compose(state, now)` returns `{ mediaId → { level, reasons[] } }` | shared pure module, tested in Node like `scrapbook.js` | policy |
| `media/find-image.ts`: read tool. Wikidata search (`wbsearchentities`, zh then en) → entity image (P18) → Commons `imageinfo` with `extmetadata` (license, artist) and a thumbnail. Returns ≤ 3 candidates, already filtered to the allowlist. The model passes the Chinese term and an English phrase for the same sense; the English search runs only when the Chinese one finds nothing. An item with a publication date (P577) is treated as a named work and yields a link card to its zh or en Wikipedia article instead of its image. | server | read tool |
| `situations/media.ts`: back-office situation `mediaConsider`. Input is the anchor piece and its context. Tool: `find_image`. Output: `{ pick: candidateIndex \| null, judgment }`. It never speaks to the learner. | server | situation |
| Validator for `mediaConsider`: license on the allowlist; `senseMatch: entity` requires the picked candidate's `entityId`; `truthfulness: real` only. These checks apply to a picked candidate. With `pick: null` the judgment is recorded as a decision with ceiling `none`, so an honest "illustration only" or "abstract" report is kept rather than rejected. A reply addressed to the learner is rejected. | server | validation |
| Media job: queued when a word is saved (by word intake or a tutor stash) or a note is created on a reading. Runs outside the learner's request, in the same pattern as word intake, at most one job at a time and 20 model turns per UTC day. Jobs over the limit wait for the next day's activity. With `pictures: off` a job is skipped without a model turn. It records a `MediaDecision`; when the ceiling isn't `none`, it attaches a `MediaItem`. Jobs live in `mediaJobs` in the journal state; the newest 200 finished jobs are kept. | server | effect |
| Offline/demo provider: canned candidates for a few fixture words (报刊亭, 鸟食), so the fixture shows one placed and one latent item | server | test support |
| `npm run journal:media-report`: lists recent decisions, ceilings, composed levels, reasons and reactions | CLI | observability |

### Learner surface

- **Placed** image: a clipping in its anchor's cluster, showing the image, a
  one-line caption (the anchor term) and a credit line, with "Not for me" in
  the control layer when focused. A link card has the same shape, with title,
  year and the outbound link.
- **Latent** image: nothing visible. When the learner focuses or hovers the
  anchor piece, a small "picture ↗" affordance materializes on it. Opening it
  shows the image with its credit and two actions:
  - **Keep on board:** becomes learner-kept, so it is shown regardless of
    either policy;
  - **Not for me:** dismissed. This feeds the taste rule.
- **Settings:** a single `Pictures: off / quiet / normal` control in the dock
  menu.
- **List view:** placed and kept images appear under their cluster. It is
  built from the same clusters as the table, so latent cues appear there too.

Notes on the first implementation:

- "Not for me" also appears on a kept clipping; the later reaction wins, so it
  takes the picture off the board again.
- Reactions are the `mediaReaction` action (`keep` or `notForMe`) and the
  setting is the `settings` action; both are ordinary journal actions.
- The cue shows on hover or keyboard focus of its piece. On a touch screen a
  saved word takes focus when tapped, but a margin note is a link, so tapping it
  opens the note; its cue is reachable only by keyboard there.
- A picture attached in the background appears the next time the page loads
  state, for example after the learner's next action.

### Tests

- `ceilingFor` covers every row of the local-policy table.
- `compose` covers:
  - each composition rule;
  - only-demote behaviour, including that it never raises a ceiling;
  - deterministic choice of which item keeps `placed`;
  - learner media is unaffected;
  - setting `off` and `quiet`;
  - the taste cap and its expiry.
- `find_image`, with HTTP mocked:
  - allowlist filtering;
  - missing licenses are rejected;
  - credit text is assembled from `extmetadata`.
- `mediaConsider` validator rejects:
  - a non-allowlisted license;
  - `entity` without a matching `entityId`;
  - `illustration`.
- Journal behaviour:
  - a saved word queues one job;
  - the demo provider attaches a latent item;
  - reactions persist;
  - old journals open.
- Fixture: one placed (报刊亭) and one latent (鸟食) item render. The table
  view and the list view agree.

### Delivery

A Graphite stack, each branch reviewable alone:

1. Data, local policy, composition policy, and their tests. No UI, no
   network.
2. `find_image`, the `mediaConsider` situation, the validator, and the media
   job with the demo provider.
3. UI: placed clippings, latent affordance, reactions, and the pictures
   setting.
4. The media report command, plus a short live check on real readings, with
   decisions reviewed by hand.

### Open questions

- Should a reading itself (not only notes on it) be able to anchor a picture
  of its subject?
- How should "Keep on board" interact with the cluster cap when the learner
  keeps many? Kept items are excluded from the caps today.
- Should composition be per viewport instead of per board, once boards grow
  large?
- When generated illustrations arrive, they get their own `truthfulness`
  value and kind, and their own mix target. Which house style?
- A Wikidata item's own image (P18) for a generic concept is often a Western
  example. Since the first live check, the rule is relaxed: for a general term
  that's a fair picture. A Chinese example is preferred only when the term is
  China-specific or its context is a particular Chinese place. For those
  cases a more targeted source (a Commons category for the Chinese variant)
  may still be needed. Later policy may also weigh per-learner preferences.
