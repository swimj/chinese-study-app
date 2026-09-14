import { NestedNav } from '../components/AppChrome';

const ABOUT_VIEWS = [
  ['getting-started', 'Getting Started'],
  ['usage-guide', 'Usage Guide'],
  ['known-issues', 'Known Issues'],
  ['whats-new', "What's New"],
] as const;

export type AboutView = typeof ABOUT_VIEWS[number][0];

export function AboutPage({ view, onSelectView }: {
  view: AboutView;
  onSelectView: (view: AboutView) => void;
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
              {label}
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
                <li><strong>Use a desktop browser and a Chinese input method.</strong> Some exercises ask you to type the Chinese word. The hosted beta is invite-only; use the account you were invited with.</li>
                <li><strong>Choose a starting point on Home.</strong> Answer the background and goals questions for an AI assessment, or choose your own level. If you skip, you start from the beginning.</li>
                <li><strong>Select Start session.</strong> Read the introduction for each new word, then try the recall exercises. Reveal the answer when needed and rate how well you remembered it.</li>
                <li><strong>Finish before you leave.</strong> To stop early, use End session and work through the remaining in-progress items. On the summary, select Finish session to save the final attempt.</li>
              </ol>
            </section>
            <section>
              <h2>Make it yours</h2>
              <p>Add words you care about in Words → Stash. The gear beside Start session lets you adjust the daily new-word limit and choose whether new words come from your stash alone or a mix of your stash and the app’s selection.</p>
              <p>After studying, visit Reflections for optional explanations and suggestions based on your session. You can review them later; you do not need to act on every suggestion.</p>
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
              <p>The live session lives in your browser’s memory. Refreshing or closing the tab can lose unfinished work; the app does not restore the active session. Use End session and then Finish session before leaving.</p>
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
            <p>Recent changes in this build, with the learner-facing highlights first.</p>
            <section>
              <h2>Help inside the app</h2>
              <p>The new About section brings getting-started advice, a usage guide, known limitations, and these update notes into the left rail.</p>
            </section>
            <section>
              <h2>Study just the words in your stash</h2>
              <p>Session settings now let you choose stash-only new words. The default still mixes your stash with the app’s selection. Adding words puts them in your stash; use the selected-word Require control when you want to explicitly request them for the next session.</p>
            </section>
            <section>
              <h2>Undo a dismissed suggestion</h2>
              <p>Dismissed a reflection proposal by mistake? Open By session in Reflections and use Undo dismiss to return it to Help.</p>
            </section>
            <section>
              <h2>A smoother invitation flow</h2>
              <p>New hosted invitations can take you straight to the study app to set your password and continue to Home.</p>
            </section>
          </>
        )}
      </article>
    </>
  );
}
