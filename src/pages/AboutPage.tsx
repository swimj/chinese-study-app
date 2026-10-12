import type { WhatsNewCatalog } from '../features/attention/useWhatsNewCatalog';
import { WhatsNewFeed } from './WhatsNewFeed';
import { NestedNav } from '../components/AppChrome';

const ABOUT_VIEWS = [
  ['getting-started', 'Getting Started'],
  ['usage-guide', 'Usage Guide'],
  ['known-issues', 'Known Issues'],
  ['whats-new', 'What’s new'],
] as const;

export type AboutView = typeof ABOUT_VIEWS[number][0];

export function AboutPage({ updatesCatalog, view, onSelectView, onWhatsNewRead, selectedPostId, onViewAllUpdates }: {
  updatesCatalog: WhatsNewCatalog;
  view: AboutView;
  onSelectView: (view: AboutView) => void;
  onWhatsNewRead?: (postIds: string[]) => Promise<void>;
  selectedPostId?: string | null;
  onViewAllUpdates?: () => void;
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
            </button>
          ))}
        </nav>
      </NestedNav>
      <article className="panel about-page" aria-labelledby="about-title">
        <h1 id="about-title">{ABOUT_VIEWS.find(([key]) => key === view)?.[1]}</h1>
        {view === 'getting-started' ? (
          <>
            <p>Follow your curiosity. Bring the Chinese words you meet in conversations, books, and everyday life, and build the instincts to use them with confidence. Short sessions introduce new words, strengthen recall, and help you tell similar expressions apart. As you practice and reflect, your study material grows with you.</p>
            <section>
              <h2>Your first session</h2>
              <ol>
                <li><strong>Use a desktop browser and a Chinese input method.</strong> Some exercises ask you to type the Chinese word.</li>
                <li><strong>Add words to your stash.</strong> Open Words → Stash and add words you want to learn. By default, new words in your sessions come only from your stash.</li>
                <li><strong>Return to Home and select Start session.</strong> Read the introduction for each new word, then try the recall exercises. Reveal the answer when needed and rate how well you remembered it.</li>
                <li><strong>If you need to wrap up early,</strong> select End session. You’ll finish the exercises already underway, then you’re done.</li>
                <li><strong>Let each session shape the next.</strong> Visit Feedback for explanations and suggestions that help your study material fit you better. Choose which suggestions to apply, whenever you are ready. Back on Home, Connections offers little discoveries linking the words you studied to language, culture, and your interests.</li>
              </ol>
            </section>
            <section>
              <h2>Make it yours</h2>
              <p>Open the session settings gear on Home to choose your daily new-word limit, study new words first, and select simplified characters, traditional characters, or both.</p>
              <p>Want to explore beyond your stash? Uncheck <strong>New words from stash only</strong> to include the app’s vocabulary selection. After a session, tell the app if those words felt too easy or too hard to adjust what comes next.</p>
              <p>Add a few topics you enjoy under <strong>Interests</strong> in session settings. Connections can use them to bring your vocabulary closer to the things you care about. Change them whenever curiosity takes you somewhere new.</p>
            </section>
          </>
        ) : view === 'usage-guide' ? (
          <>
            <p>The core rhythm is simple: study on Home, shape your vocabulary in Words, and use Feedback when you want to investigate a difficulty.</p>
            <section>
              <h2>Answer and rate honestly</h2>
              <p>Recognition asks you to recall a word’s meaning and pronunciation. Production asks you to type the Chinese word from a cue. Contextual selection asks you to choose between similar words in a sentence.</p>
              <p>Use the ratings offered by the exercise: Forgot for a miss, Hard for effortful recall, Good for comfortable recall, and Easy when it feels effortless. Incorrect typed answers and incorrect choices are recorded as Forgot. Use Undo when you need to correct the most recent answer or rating.</p>
              <p>New words and missed reviews can repeat within a session. This is deliberate practice. Words in Practice later graduate into spaced review, where different skills can become due at different times.</p>
            </section>
            <section>
              <h2>Choose what comes next</h2>
              <p>Words → Stash holds words you want to study. Move selected words to the top to prioritize them. Words → My words lets you browse your collection and inspect individual words.</p>
              <p>The daily new-word limit controls new vocabulary, not the number of reviews. If the suggested vocabulary feels too easy or too hard, use the difficulty adjustment offered after a session.</p>
            </section>
            <section>
              <h2>Get help from feedback</h2>
              <p>Feedback can explain a mistake and propose changes such as a better cue or practice distinguishing similar words. Read each proposal before authorizing it. You can dismiss an unhelpful suggestion, request a second opinion where offered, or return to a session’s proposals later.</p>
              <p>Content Bin is a read-only browser for supporting study content. It is useful for looking around, but you do not need it for everyday study.</p>
            </section>
          </>
        ) : view === 'known-issues' ? (
          <>
            <p>This is an early private beta. These are the main limitations to keep in mind while studying.</p>
            <section>
              <h2>Keep an active session open</h2>
              <p>The live session lives in your browser’s memory. Refreshing or closing the tab can lose unfinished work; the app does not restore the active session. Use End session to wrap up in-progress cards. If saving reports an error, keep the tab open and follow the message before leaving.</p>
            </section>
            <section>
              <h2>Prompts and AI help can be imperfect</h2>
              <p>A cue may be ambiguous, a valid alternative answer may be missing, or generated feedback may give weak advice. Use the available feedback and proposal review controls. If something seems wrong, share the word, prompt, your answer, and what you expected with the person who invited you.</p>
            </section>
            <section>
              <h2>Feedback can take time or fail</h2>
              <p>Feedback generation happens separately from saving your completed study. A feedback generation failure does not undo saved progress. Check Feedback for its status and retry options. If saving the session itself shows an error, keep the tab open and report the message.</p>
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
            <WhatsNewFeed catalog={updatesCatalog} onRead={onWhatsNewRead} selectedPostId={selectedPostId} onViewAll={onViewAllUpdates} />
          </>
        )}
      </article>
    </>
  );
}
