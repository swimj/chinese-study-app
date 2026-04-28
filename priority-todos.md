2. Make meaning display order configurable.
3. I'd like to add a new behavior to the production training (english->hanzi), where the user can select between meaning/cloze-deletion. The initial idea is to just lazily populate cloze deletions on a on-demand basis, as the motivation comes from me encountering certain hanzi production review items where the pure meaning is too vague/broad/context-dependent. For such cases, I will identify this and then click a button that says 'add cloze option', and then additionally be able to configure whether by default the prompt side shows the cloze or the meaning. I think in future review, the user can still have the option to look at either meaning/cloze even though only one shows by default.
I'd eventually like to more deeply integrate cloze deletions so this is just a first step / POC type thing, so I can get a better handle.
5. Add some non-determinisim to the scheduling interval to prevent words from clumping together in the same order across multiple sessions.
6. reorganize frontend pages
8. undo - is deep clone strictly necessary
9. getSessionItems() - delete
10. pronunciation