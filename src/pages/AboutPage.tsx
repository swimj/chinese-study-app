import { NestedNav } from '../components/AppChrome';

const ABOUT_VIEWS = [
  ['getting-started', 'Getting Started'],
  ['usage-guide', 'Usage Guide'],
  ['known-issues', 'Known Issues'],
  ['whats-new', "What's New"],
] as const;

// Entry dates follow the change history; add new posts at the top.
const UPDATES = [
  {
    date: '2026-09-22',
    displayDate: 'September 22, 2026',
    title: 'A smoother ride when more than one answer is right',
    paragraphs: [
      'Some prompts really do have more than one good Chinese answer. We’re making that feel less like a gotcha. If you type something that fits the cue, we want the app to treat it as a success more often, instead of acting as if you’d missed one hidden target word.',
      'You may see this in a few places. After you reveal a production cue, the card can list every accepted answer, not just one. Some of that practice now follows the prompt itself rather than a single word, so a card labeled Pure cue production can show up alongside ordinary word reviews. And if a reflection decides your “Forgot” was actually a valid alternative, it can offer to treat the cue as shared. Authorize that and it can also unwind the unfair miss so the original word isn’t punished.',
      'This is new, so expect a few bumps. A suggestion might be too broad, a card might show up at an odd time, or the reveal might list more answers than you expected. Read those proposals before applying them. If something feels off, send the cue, what you typed, and what you expected to the person who invited you.',
      'A few smaller changes. Fixed a bug in My Words which led to the Recent Lapses selector picking up today’s newly learned words. Reflections shows a spinner on the tab while a reflection is generating, hides its count while you’re already there, and uses a red ! if generation failed — open Run meta to clear that.',
    ],
  },
  {
    date: '2026-09-17',
    displayDate: 'September 17, 2026',
    title: 'See what’s waiting, finish with Space, and pick the right stash word',
    paragraphs: [
      'Reflections and About can now show a little number when something’s waiting. Reflections counts new Help cards after a session. About counts unread What’s New notes, including this one. Open the page and the count goes away.',
      'When you hit the session summary, Space now finishes the session the same way Finish session does. Heading somewhere else in the app also wraps it up, so the last attempt is saved and a reflection can start without you sitting on the waiting screen. Leaving in the middle of a session is unchanged, and closing the tab still isn’t a reliable way to finish.',
      'Stash add got two small improvements. You no longer have to type the comma in a saying: 吃一堑长一智 still finds 吃一堑，长一智. And if what you typed matches more than one unstudied word, a picker pops up so you can choose which ones to add instead of getting all of them. One match still adds immediately.',
    ],
  },
  {
    date: '2026-09-16',
    displayDate: 'September 16, 2026',
    title: 'Filter My words by stage or recent lapses',
    paragraphs: [
      'Words → My words now has chips to show only Not yet studied, Learning, or In review words. Turn on Recent lapses when you want to look at words you recently forgot or whose last learning attempt didn’t go well. The chips work with search across Recently studied, Personally added, and Current deck.',
    ],
  },
  {
    date: '2026-09-14',
    displayDate: 'September 14, 2026',
    title: 'A home for help and updates',
    paragraphs: [
      'About now brings getting-started advice, a usage guide, known limitations, and these update notes into the left rail. We’ll keep adding entries here as the app evolves.',
    ],
  },
  {
    date: '2026-09-13',
    displayDate: 'September 13, 2026',
    title: 'Find your words and your starting point',
    paragraphs: [
      'Words → My words gives you a place to browse your collection and inspect individual words, including recent additions and words with personal notes.',
      'Before your first session, you can answer a few questions to help choose a starting level or pick it yourself. After a session, you can nudge the suggested vocabulary easier or harder.',
    ],
  },
  {
    date: '2026-09-11',
    displayDate: 'September 11, 2026',
    title: 'Study just the words in your stash',
    paragraphs: [
      'Session settings now let you choose stash-only new words. The default still mixes your stash with the app’s selection. Choose stash-only when you want to concentrate on vocabulary you’ve picked yourself.',
    ],
  },
  {
    date: '2026-09-09',
    displayDate: 'September 9, 2026',
    title: 'Give a dismissed suggestion another look',
    paragraphs: [
      'Dismissed a reflection proposal by mistake? Open By session in Reflections and use Undo dismiss to return it to Help.',
    ],
  },
] as const;

export type AboutView = typeof ABOUT_VIEWS[number][0];

export function latestWhatsNewDate(): string {
  const latest = UPDATES[0];
  if (latest === undefined) {
    throw new Error('Expected at least one What’s New entry.');
  }
  return latest.date;
}

export function countUnseenWhatsNew(seenThroughDate: string | null): number {
  if (seenThroughDate === null) return 0;
  return UPDATES.filter((entry) => entry.date > seenThroughDate).length;
}

export function AboutPage({ view, onSelectView, whatsNewUnseenCount = 0 }: {
  view: AboutView;
  onSelectView: (view: AboutView) => void;
  whatsNewUnseenCount?: number;
}) {
  return (
    <>
      <NestedNav>
        <nav className="reflection-view-rail" aria-label="About views">
          {ABOUT_VIEWS.map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={`reflection-view-rail-tab${view === key ? ' active' : ''}`}
              aria-current={view === key ? 'page' : undefined}
              onClick={() => onSelectView(key)}
            >
              <span>{label}</span>
              {key === 'whats-new' && whatsNewUnseenCount > 0 ? (
                <span className="reflection-view-rail-count">{whatsNewUnseenCount}</span>
              ) : null}
            </button>
          ))}
        </nav>
      </NestedNav>
      <article className="panel about-page" aria-labelledby="about-title">
        <p className="notes">About · Mandarin private beta</p>
        <h1 id="about-title">{ABOUT_VIEWS.find(([key]) => key === view)?.[1]}</h1>
        {view === 'getting-started' ? (
          <>
            <p>A place to build a Chinese vocabulary you can actually recall and use. Short study sessions mix new words, practice, and spaced review, with extra help for words that are easy to confuse.</p>
            <section>
              <h2>Your first session</h2>
              <ol>
                <li><strong>Use a desktop browser and a Chinese input method.</strong> Some exercises ask you to type the Chinese word.</li>
                <li><strong>Choose a starting point on Home.</strong> Answer the background and goals questions for an AI assessment, or choose your own level. If you skip, you start from the beginning.</li>
                <li><strong>Select Start session.</strong> Read the introduction for each new word, then try the recall exercises. Reveal the answer when needed and rate how well you remembered it.</li>
                <li><strong>End when you are done studying.</strong> To stop early, use End session and work through the remaining in-progress items. The summary saves the final attempt when you finish or go to another page.</li>
              </ol>
            </section>
            <section>
              <h2>Make it yours</h2>
              <p>Add words you care about in Words → Stash. The gear beside Start session lets you adjust the daily new-word limit and choose whether new words come from your stash alone or a mix of your stash and the app’s selection.</p>
              <p>Each mistake is a chance to make your study content fit you better. Reflections uses your session to suggest clearer cues, useful explanations, and practice that targets the distinctions you find tricky. Visit Reflections after studying to review those suggestions and choose which to apply. You can come back later; you do not need to act on every suggestion.</p>
            </section>
          </>
        ) : view === 'usage-guide' ? (
          <>
            <p>The core rhythm is simple: study on Home, shape your vocabulary in Words, and use Reflections when you want to investigate a difficulty.</p>
            <section>
              <h2>Answer and rate honestly</h2>
              <p>Recognition asks you to recall a word’s meaning and pronunciation. Production asks you to type the Chinese word from a cue. Contextual selection asks you to choose between similar words in a sentence.</p>
              <p>Use the ratings offered by the exercise: Forgot for a miss, Hard for effortful recall, Good for comfortable recall, and Easy when it feels effortless. Incorrect typed answers and incorrect choices are recorded as Forgot. Use Undo when you need to correct the most recent answer or rating.</p>
              <p>New words and missed reviews can repeat within a session. This is deliberate practice. Learning words later graduate into spaced review, where different skills can become due at different times.</p>
            </section>
            <section>
              <h2>Choose what comes next</h2>
              <p>Words → Stash holds words you want to study. Move selected words to the top to prioritize them, or use Require for words you want included in the next session. Words → My words lets you browse your collection and inspect individual words.</p>
              <p>The daily new-word limit controls new vocabulary, not the number of reviews. If the suggested vocabulary feels too easy or too hard, use the difficulty adjustment offered after a session.</p>
            </section>
            <section>
              <h2>Get help from reflections</h2>
              <p>Reflections can explain a mistake and propose changes such as a better cue or practice distinguishing similar words. Read each proposal before authorizing it. You can dismiss an unhelpful suggestion, request a second opinion where offered, or return to a session’s proposals later.</p>
              <p>Content Bin is a read-only browser for supporting study content. It is useful for looking around, but you do not need it for everyday study.</p>
            </section>
          </>
        ) : view === 'known-issues' ? (
          <>
            <p>This is an early private beta. These are the main limitations to keep in mind while studying.</p>
            <section>
              <h2>Keep an active session open</h2>
              <p>The live session lives in your browser’s memory. Refreshing or closing the tab can lose unfinished work; the app does not restore the active session. Use End session to wrap up in-progress cards. On the summary, Finish session, Space, or going to another page saves the final attempt. Closing the tab from the summary is still not a reliable way to finish.</p>
            </section>
            <section>
              <h2>Prompts and AI help can be imperfect</h2>
              <p>A cue may be ambiguous, a valid alternative answer may be missing, or a reflection may give weak advice. Use the available feedback and proposal review controls. If something seems wrong, share the word, prompt, your answer, and what you expected with the person who invited you.</p>
            </section>
            <section>
              <h2>Reflection can take time or fail</h2>
              <p>Reflection generation happens separately from saving your completed study. A reflection failure does not undo saved progress. Check Reflections for its status and retry options. If saving the session itself shows an error, keep the tab open and report the message.</p>
            </section>
            <section>
              <h2>A narrow beta experience</h2>
              <p>The supported experience is Mandarin study on desktop web with an internet connection. Mobile polish, offline study, and importing an existing vocabulary history are not available as supported beta workflows. Maintenance may temporarily interrupt access.</p>
              <p>Daily study counters use UTC, so “today” may roll over at a different time from your local midnight.</p>
            </section>
          </>
        ) : (
          <>
            <p>Notes on how the app is evolving, newest first.</p>
            <div className="about-updates">
              {UPDATES.map((entry) => (
                <article className="about-update" key={entry.date} aria-labelledby={`update-${entry.date}`}>
                  <time className="notes" dateTime={entry.date}>{entry.displayDate}</time>
                  <h2 id={`update-${entry.date}`}>{entry.title}</h2>
                  {entry.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </article>
              ))}
            </div>
          </>
        )}
      </article>
    </>
  );
}
