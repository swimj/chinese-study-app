- [UI] add keyboard mappings for active session
    space: reveal/good/done looking at unstudied word
    1/2/3/4: forgot/hard/good/easy

- [session-flow] session drain mode
    Add a button to the UI in an active session that lets the user end the session.
    Upon hitting "end", the session doesn't immediately terminate, but rather checks
    if there are any "uncommitted and open" words or reviewItems. If so, it keeps
    presenting them to the user until the user covers them. It does not present any
    "unstarted" work. If this spec is not sufficiently clear, let me know why.

- [UI] add a timer to the active session UI, counting up in seconds from 0:00.

- [session-flow] forward/reverse reviewItems scheduling
    I noticed that matching forward/reverse reviewItems can follow each other in close
    succession, sometimes immediate, which makes the memory recall test slightly less
    effective. While this is simply unavoidable to some extent, especially when we consider
    the single word session case, i think in the common case with many words involved in a
    session, we can do something better. a simple approach would be to group directions within
    the session schedule, in which case I would propose first reviewing reverse (english->hanzi)
    and then reviewing forwward. perhaps the order can be randomized in each grouping too so that
    the user can't rely on memory of the "ordering" as much (because in many cases both directions 
    will appear in the same session). If you have other ideas to work around the core issue I described,
    please share too.

- [UI] add a session summary page after session termination

- [UI] move "start session" buttton to its own box, place it in the top-left of the page body, not buried below the session overview stats

- [UI] OK, I see that the "start session" button converts into "end session" upon entering active session. that's great. 
    then just adjust the earlier "end session" goal to make it behave in a "drain uncommitted" mode.

- [UI] card reveal
    can you make it so that the pinyin appears above the corresponding hanzi? not sure if the current pinyin format allows this to be done unambiguously, if not then defer this to BACKLOG with notes of where it is ambiguous. 
    at the very least, upon reveal, show two lines. the first line has the pinyin in smaller text, and the second line
    has the definition as it currently is (don't like the pinyin in parentheses)    