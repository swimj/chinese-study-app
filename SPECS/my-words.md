# Words And My Words

Status: initial read-only vocabulary browsing contract.

## Information architecture

The primary **Words** destination contains **Stash** and **My words**.
Stash preserves the existing unstudied add/prioritize/remove workflow.
My words lets the learner inspect words they have personally selected or
begun studying. Ordinary unseen deck candidates do not enter this collection
solely because they are eligible for a session.

My words starts with two collection shortcuts:

- **Recently studied** includes words in `learning` or `review`, from any
  source. Order by last recorded study date descending, missing dates last.
- **Personally added** includes retained non-dismissed personal-priority
  overlays, whether the word is waiting or studied. Order by the retained
  overlay update timestamp descending. This timestamp may reflect a priority
  edit or entry into study; it is not presented as an original addition date.

Ties use stable word identity ordering. Future collection shortcuts, such as
deck membership, can select from the same conceptual collection without
changing the top-level navigation.

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
word spelling, traditional spelling, pronunciation, and meanings. Results load
in bounded batches of 50 with a Load more control; the visible batch is not the
logical extent of the collection. Empty collection, no search matches,
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

All results and private notes are scoped to the current learner beneath HTTP.
Browsing never changes study state or scheduling.
