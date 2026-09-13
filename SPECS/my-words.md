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
  source. Order by last recorded study date descending, missing dates last.
- **Personally added** includes retained non-dismissed personal-priority
  overlays, whether the word is waiting or studied. Order by the retained
  overlay update timestamp descending. This timestamp may reflect a priority
  edit or entry into study; it is not presented as an original addition date.
- **Current deck** is available when Mandarin deck data and a stored learner
  placement exist and the entire current mix consists of explicit HSK decks.
  It includes all words assigned to any deck with positive
  effective weight in that learner's current mix, including unseen words.
  This is the actual deck/part selection, not the cumulative HSK level or
  session-time spill into later decks. All positive-weight decks contribute
  their full membership once each, regardless of relative weight. Dismissed
  words remain excluded. Order by pronunciation, then stable word identity.
  The view identifies the current HSK level/part(s). Beyond HSK is deferred:
  its unbounded remainder has no small explicit membership list. If any
  positive-weight deck is Beyond HSK, this shortcut is unavailable rather
  than showing a partial mix. No scheduling weights or deck-edit controls
  are exposed.

Ties use stable word identity ordering. The same list, search, and detail pane
serve every shortcut. Changing placement or nudging easier/harder changes
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
Words subview and My words shortcut/search while navigating during the current
app lifetime. Changing collection or search resets the result position and
selection. Returning to My words refreshes its first result page.

Search covers the whole selected collection, including unloaded rows, using
word spelling, traditional spelling, pronunciation, and meanings. Recent and
personal results load in bounded batches of 50 with a Load more control; the
visible batch is not the logical extent of the collection. Current deck loads
its entire explicit membership, with no 50-word cutoff or Load more control.
Empty collection, no search matches,
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
as the diet. Both paths share an in-memory manifest-to-database loader: collect
only the selected decks' keys, probe the indexed characters column in bounded
parameter chunks, then match pronunciation. Deck dates use indexed per-word
probes; deck browsing never scans the corpus or entire attempt history to
discover membership or dates. All results and private
notes are scoped to the current learner beneath HTTP.
Browsing never changes study state or scheduling.
