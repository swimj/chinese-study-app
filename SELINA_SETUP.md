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
