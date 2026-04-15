I've started using the app to do real study. The following is a list of
small improvements I'd like to quickly ship based on the experience.

1. Edit definition mid-session. Some of the word definitions I do not find satisfactory.
I want to be able to update definitions mid session. Ideally the flow would be,
every card has a small "edit" icon (maybe a little pen?),
clicking this disables the session response inputs and text input box hovers over instead,
with a save button. upon save, the new definition is written through to the backend database,
and upon returning to the card view the definition also reflects the user input.
also provide a cancel button if that has no effect if the user decides to give up on the edit.
ideally edit pauses the session timer but if that is too much state management
it doesn't have to in the first cut, in which case note it as an optional BACKLOG.md item.
possibly some other semantics to work through.
2. undo (at least 1 step). sometimes i accidentally rate wrong, i'd like to undo.
in theory indefinite rollback would be best, but my gut tells me that would be a more difficult
state tracking problem, perhaps ok if we rearchitected session into a log-replay like form (probably desirable actually).
i'd like to see if we can come up with a small stopgap solution that allows for a single undo, which includes undoing the
database side change. maybe we can simply delay the commit one round in the frontend, or add a bit of "recent retired updated rows" somewhere for recollection. don't know, wide design space. help me iterate on this.
3. i'd like to optionally include cloze tests for the english -> hanzi definition, sometimes the context helps
you properly understand which word to select when multiple hanzi may be appropriate for the pure definition.
4. since i run the app in both study and dev modes, i'd like to have some more guardrails so i don't accidnetally
use the study app thinking its in dev mode and do a bunch of stuff i can't rollback. perhaps different ports for the frontend would be enough? or maybe the dev mode is also actually a different temporary end-point? open to ideas
5. similarly, worried about frontend in dev mode talking to backend in study mode. some minimal compatibility guard should exist.
6. come up with a ligheweight data backup process for study mode. as you can maybe tell, i'm a bit worried about fat finger risk.
7. minor UI/auxiliary state tweaks: show count of forgotten recalls (identified by reviewItem id), reinforcement ratings actually can just be binary yes/no like learning (in any case backend will consider it failure and only care about failure count), reinforcement card and show N/3 where N is current yes streak.