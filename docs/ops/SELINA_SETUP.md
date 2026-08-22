# Selina Setup

## Install Node.js and npm

This app needs Node.js. Installing Node.js also installs `npm`, which is the command used below to install and start the app.

Use the official Node.js download page:

```text
https://nodejs.org/en/download
```

The official npm guide is here if you want more detail:

```text
https://docs.npmjs.com/downloading-and-installing-node-js-and-npm
```

After installing Node.js, open a new terminal window and check that both commands work:

```bash
node -v
npm -v
```

## Set Up the App

Pick a normal folder where you keep projects, such as `Documents`, `Desktop`, or a `dev` folder. Run this command from that folder:

```bash
git clone https://github.com/swimj/chinese-study-app.git
```

Go into the app project directory:

```bash
cd chinese-study-app
```

If you already cloned the app before and are updating it later, run this from inside the `chinese-study-app` directory:

```bash
git pull
```

Install the app packages exactly as specified by the project:

```bash
npm ci
```

Download the pristine French words database from Google Drive. It should be named `app.db`, but it can live anywhere on your computer, such as Downloads.

One-time database bootstrap: set up the repo-local user data directory by giving the command the path to that downloaded database:

```bash
npm run setup:local-user-data -- /path/to/downloaded/app.db
```

For example, if it is in Downloads on a Mac:

```bash
npm run setup:local-user-data -- ~/Downloads/app.db
```

This copies the database into `data/local-user-data/app.db`. If that file already exists, the command makes a backup first.

You should only need to run `setup:local-user-data` once, when first setting up the app. Running it again replaces the current local database with the downloaded one, which may overwrite your study progress.

## Move From A Downloaded Zip To The Git Repo

If you started by downloading the app as a GitHub zip file and now want to use the real git repo, first follow the clone and install steps above:

```bash
git clone https://github.com/swimj/chinese-study-app.git
cd chinese-study-app
npm ci
```

Then copy your existing study database from the old zip-based app folder into this new git clone:

```bash
npm run import:local-user-data -- /path/to/old/chinese-study-app-folder
```

For example, if the old downloaded folder is in Downloads on a Mac:

```bash
npm run import:local-user-data -- ~/Downloads/chinese-study-app-main
```

The command expects the old database at `data/local-user-data/app.db`, which is where `setup:local-user-data` put it.

## Quick User Guide

This app is currently a practical local study tool, so it is useful to think of it as two pieces:

1. a word queue, where you decide which unstudied words should be allowed into study sooner
2. a study session, where the app mixes due reviews, active learning words, and a small number of new words

### The unstudied queue

The big unstudied queue comes from the prepared word database. For the French setup, that database is based on a CEFR-style vocabulary list. The app then layers your personal priority on top of that list.

In plain English: the CEFR list gives the app a reasonable default order, and your priority actions nudge or override that order. If you mark a word as important, it should float upward. If you require a word for the next session, the app treats it as something that should be pulled in as soon as the next session can include new words.

### Adding words by search

Go to `Priority`, then `Manage`, and use the bottom `Add by French term` field.

The search can match the exact canonical term, but it can also find aliases. That is helpful for French because the word you naturally type might not be the exact stored headword. For example, an inflected form, a spelling variant, or a related alias may point at one or more canonical entries.

After adding matches, skim what landed in the stash word bank. Alias matching is intentionally useful, not magical, so it can occasionally pull in a false match or a word you do not actually want. Hover a chip and use the remove icon, or select chips and use `Remove`. If the word shows up in `Triage` and you do not want it as a new word at all, use `Move to bottom`.

### Triage top 50

`Triage top 50` is a quick cleanup pass over the highest-ranked unstudied words. Use it when you want the next new-word intake to feel less random.

A good way to use it:

1. Open `Priority`.
2. Click `Triage`.
3. Dismiss words you definitely do not want to study.
4. Leave words that look useful, even if you do not need them immediately.

On touch devices, long-press a row to enter bulk-select mode, then dismiss several at once.

### Word statuses

Words move through three main statuses:

- `unstudied`: not actively learned yet. These only enter a session through the new-word intake.
- `learning`: actively being acquired. These come back until you cover both directions for the day.
- `review`: graduated into spaced review. Each direction can become due on its own schedule.

For a brand-new word, the app first shows an introduction card. After that, it asks recall drills in both directions. Once that first encounter is completed, the word becomes `learning`.

For a `learning` word, the app wants a `Good` in both directions during the session. If both directions are good on the first try for several successful sessions, the word graduates to `review`.

For a `review` word, `Hard`, `Good`, and `Easy` are all successful recalls with different scheduling effects. `Forgot` creates same-session reinforcement: the app will ask that item again until it has been recovered.

### Session flow

Start from `Home`, then click `Start session`.

During a session, the app may show:

- due review cards
- learning cards
- new-word introduction cards
- typed production prompts, where you type the French answer

For recognition cards, reveal the answer, then choose a rating. For typed production cards, type the answer and submit it. If the typed answer is accepted, you can rate it. If it is wrong, the app records it as `Forgot` and shows the expected answer.

When the queue naturally runs out, the app shows a session summary. Click `Close summary` to fully exit back to the overview. This matters because the summary screen is still part of the session UI.

### Drain mode

Clicking `End session` during an active session does not instantly throw everything away. It switches the session into drain mode.

Drain mode means: stop taking in fresh work from the session buckets, but finish the open work that is already in motion. Once that remaining work is done, the app shows a summary marked as completed via drain mode.

Use this when you are ready to wrap up but do not want to leave the current session in a messy halfway state.

### Keyboard shortcuts

These shortcuts work during a study session, as long as you are not typing in a text box or editing notes:

- `Space`: reveal the answer; after the answer is visible, rate `Good`; on a new-word intro, begin recall drills; after a wrong typed answer, continue to the next card.
- `1`: rate `Forgot`.
- `2`: rate `Hard` on review cards, or `Good` on simple binary cards.
- `3`: rate `Good`.
- `4`: rate `Easy` on review cards.
- `e`: edit notes for the current word.
- `z`: undo the last rating when undo is available.
- `Escape`: while a typed-answer input is active, move focus in or out of the input.

## Typical Lifecycle

### Start the app

Start the backend server in one terminal window:

```bash
npm run study:local:backend
```

Leave that running. Then open a second terminal window in the same app project directory (on Mac, command + T will do this in a new terminal tab), and start the frontend server:

```bash
npm run study:local:frontend
```

Open the app in your browser:

```text
http://localhost:4173
```

### Stop the app

When you are done studying, stop both running servers:

1. Click each terminal window.
2. Press `Control` + `C`.
3. Close the terminal windows if you want.

### Start it again later

Open two terminal windows and go into the app project directory in each one:

```bash
cd chinese-study-app
```

Then run the backend in one terminal:

```bash
npm run study:local:backend
```

And run the frontend in the other terminal:

```bash
npm run study:local:frontend
```

Then open:

```text
http://localhost:4173
```

Do not run `setup:local-user-data` again during normal use.

### Update the app

When there are new app updates, stop both servers first with `Control` + `C`. Then, from inside the `chinese-study-app` directory, run:

```bash
git pull
npm ci
```

After the update finishes, start the backend and frontend again using the same two terminal commands above.

For a quick summary of what changed since the last shared version, see [`CHANGELOG.md`](/Users/jw/dev/chinese-study-app/CHANGELOG.md).
