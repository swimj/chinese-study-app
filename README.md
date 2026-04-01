# Chinese Study App

A local-first Mandarin study app built with a React/Vite frontend and a small local backend.

## Unit 1 Status

The current milestone includes:

- local Express backend in [`server/`](/Users/jw/dev/chinese-study-app/server)
- SQLite persistence in [`data/app.db`](/Users/jw/dev/chinese-study-app/data/app.db)
- sample `Word` and `ReviewItem` records
- frontend dashboard that loads words and due review items from the backend API

## Getting Started

1. Install packages:

   ```bash
   npm install
   ```

2. Start the backend:

   ```bash
   npm run dev:backend
   ```

3. In a second terminal, start the frontend:

   ```bash
   npm run dev:frontend
   ```

4. Open the app in your browser at `http://localhost:4173`.

The frontend calls the backend at `http://localhost:5174` by default. You can override that with `VITE_API_BASE`.

## Data

- SQLite database: [`data/app.db`](/Users/jw/dev/chinese-study-app/data/app.db)
- Backend entrypoint: [`server/index.ts`](/Users/jw/dev/chinese-study-app/server/index.ts)
- Database setup: [`server/db.ts`](/Users/jw/dev/chinese-study-app/server/db.ts)

If a legacy [`data/app.json`](/Users/jw/dev/chinese-study-app/data/app.json) file exists from the earlier prototype, the backend will import that data into SQLite the first time it initializes an empty database.
