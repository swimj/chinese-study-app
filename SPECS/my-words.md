# Words And My Words

Status: initial read-only vocabulary browsing contract.

## Information architecture

The primary **Words** destination contains **Stash** and **My words**.
Stash preserves the existing unstudied add/prioritize/remove workflow.
My words lets the learner inspect personal study collections and, after
placement, the vocabulary in their current deck mix. Unseen deck words appear
in Current deck; browsing does not add them to Personally added or Recently
studied.

My words offers these collection shortcuts:

- **Recently studied** includes words in `learning` or `review`, from any
  source.
- **Personally added** includes retained non-dismissed personal-priority
  overlays, whether the word is waiting or studied. Overlay update timestamps
  may reflect a priority edit or entry into study; they are not presented as
  an original addition date.
- **Current deck** is available when Mandarin deck data and a stored learner
  placement exist and the entire current mix consists of explicit HSK decks.
  It includes all words assigned to any deck with positive
  effective weight in that learner's current mix, including unseen words.
  This is the actual deck/part selection, not the cumulative HSK level or
  session-time spill into later decks. All positive-weight decks contribute
  their full membership once each, regardless of relative weight. Dismissed
  words remain excluded.
  The view identifies the current HSK level/part(s). Beyond HSK is deferred:
  its unbounded remainder has no small explicit membership list. If any
  positive-weight deck is Beyond HSK, this shortcut is unavailable rather
  than showing a partial mix. No scheduling weights or deck-edit controls
  are exposed.

Lists share one sort: `learning` by last recorded study date descending
(missing dates last), then `unstudied` / Not yet studied by pronunciation,
then `review` by last recorded study date descending (missing dates last).
Ties use stable word identity. Recently studied has no unstudied words, so it
is learning then review.

The same list, search, stage filter, Recent lapses filter, and detail pane serve every shortcut.
Changing placement or nudging easier/harder changes
Current deck membership on the next load; a missing placement or manifest
makes the shortcut unavailable rather than inventing a default placement.

Removing a waiting word from personal priority removes it from Personally
added. Entering study retains personal membership, including a required-only
overlay whose requirement is cleared during completion. Study entry does not
remove the word from this view. Dismissal is excluded through the existing
sunk overlay and lifecycle behavior. This surface does not introduce an
ever-added archive, new membership persistence, or a study-state mutation.

## Browsing and interaction

Recently studied is the initial My words shortcut. The app retains the chosen
Words subview and My words shortcut, search, stage filter, and Recent lapses
filter while navigating during the current app lifetime. Changing collection,
search, stage filter, or Recent lapses resets the result position and
selection. Returning to My words refreshes its first result page.

Search covers the whole selected collection, including unloaded rows, using
word spelling, traditional spelling, pronunciation, and meanings. Stage chips
(Not yet studied / Learning / In review) further restrict membership as AND
with search. Default all selected. Empty selection is treated as all selected.
Recently studied disables Not yet studied; if it is the only selected stage,
the effective filter is that collection's remaining stages (learning and
review) rather than an empty list. Recent lapses is an independent extra chip,
off by default. When on, it keeps words that either have a projected Forgot /
incorrect attempt in the last three UTC days (any Forgot in the window counts)
or whose last learning coverage day is unsuccessful. Combinations that cannot
match, such as Recent lapses with only Not yet studied, return an empty list.
Recent and
personal results load in bounded batches of 50 with a Load more control; the
visible batch is not the logical extent of the collection. Current deck loads
its entire explicit membership, with no 50-word cutoff or Load more control.
Personally added, Current deck, and any collection with Recent lapses on show
a muted full matching count (not the loaded page size). Recently studied
without lapses does not; it is recency pagination of all learning and review
words, not a date-bounded slice. Search or stage chips alone do not make that
list count-worthy.
Empty collection, no search or filter matches,
loading, and request failure have distinct states.

Each compact row shows the word, pronunciation, a short meaning, and
Not yet studied / Learning / In review. Recent rows also show last study date.
Selecting a row opens a nonmodal detail pane beside the list, with full
meanings, pronunciation, traditional spelling where different, study stage,
last study date where applicable, and existing personal notes if present.
Selecting another row updates the pane without navigating away. Up/Down on a
word row selects the adjacent loaded row; Escape or Close dismisses details
and restores focus to the selected row. Opening/closing details preserves
search, loaded rows, and list position. No bulk actions are introduced here.

## Truthful study information

Dates have UTC day precision, consistent with the current lifecycle contract.
Last study is the latest recorded learning coverage day, word-skill study date,
or accepted/projected target-word attempt day. Failed accepted review attempts
count; contrast distractors and unprojected attempts do not. Existing seed and
legacy scheduler dates are used as recorded state. Unknown dates are explicit.

First-study dates cannot be reconstructed reliably from the current records
and are omitted. Review is a lifecycle stage, not a mastery claim. Scores,
accuracy, progress graphics, due dates, and scheduler controls are deferred.

Deck membership follows the same normalized characters/pronunciation assignment
as the diet. Both paths share a cache of resolved word IDs for the manifest's
explicit decks. Cache construction probes indexed characters in bounded chunks
and matches normalized pronunciation. Requests hydrate current word details and
learner state by those IDs; learner state is never cached. Bootstrap/seed imports
invalidate the cache, other-connection commits refresh it, and transaction-local
identities are never retained. Current deck dates batch the requested IDs into
one pass over the current learner's attempt history, plus word-ID lookups for
skill and learning dates. This avoids an additional event index and repeated
history scans per word; date-query cost still grows with that learner's history.
All results and private notes are scoped to the current learner beneath HTTP.
Browsing never changes study state or scheduling.
