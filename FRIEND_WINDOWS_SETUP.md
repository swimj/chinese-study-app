# Windows Mandarin Friend Setup

This is the rough alpha setup for trying the Mandarin app on Windows.

## Requirements

- Git
- Node.js 22 or newer

## One-Step Start

Double-click:

```text
scripts\windows-start-mandarin.cmd
```

The launcher will:

1. install npm packages if `node_modules` is missing
2. create `data\friend-mandarin-user-data\app.db` if it is missing
3. start the backend and frontend in separate terminal windows
4. open `http://localhost:4173`

To stop the app, close both terminal windows or press `Ctrl+C` in each one.

## Manual Start

From PowerShell or Command Prompt:

```bat
npm install
npm run friend:mandarin:setup-db
npm run friend:mandarin:backend
```

Then open a second terminal in the repo and run:

```bat
npm run friend:mandarin:frontend
```

Open:

```text
http://localhost:4173
```

## Data

The friend database lives at:

```text
data\friend-mandarin-user-data\app.db
```

It is generated from `data\canonical-corpus.json` with all words and meanings marked `unstudied`. It does not include review history, session events, scheduler state, user priority state, or personal notes.

To reset it back to a fresh database:

```bat
npm run friend:mandarin:setup-db
```

## Creating a Bundle

On the machine preparing the app for someone else:

```bat
npm run friend:mandarin:setup-db
npm run friend:mandarin:bundle
```

The bundle is written to:

```text
friend-bundles\chinese-study-app-mandarin-alpha-<version>.zip
```

The zip includes the app files and `data\friend-mandarin-user-data\app.db`. It excludes `.git`, `node_modules`, build output, `tmp`, and the rest of `data`.
