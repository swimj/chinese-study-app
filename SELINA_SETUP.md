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

Install the app packages:

```bash
npm install
```

Download the pristine French words database from Google Drive. It should be named `app.db`, but it can live anywhere on your computer, such as Downloads.

Set up the repo-local user data directory by giving the command the path to that downloaded database:

```bash
npm run setup:local-user-data -- /path/to/downloaded/app.db
```

For example, if it is in Downloads on a Mac:

```bash
npm run setup:local-user-data -- ~/Downloads/app.db
```

This copies the database into `data/local-user-data/app.db`. If that file already exists, the command makes a backup first.

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
