# Chinese Study App

A browser-based language learning starter built with React, Vite, and TypeScript.

## Features

- Vocabulary flashcard browser
- Category filtering
- AI practice prompt generator
- Lightweight, single-page setup for fast experimentation

## Getting Started

1. Install packages:

   ```bash
   npm install
   ```

2. Start development server:

   ```bash
   npm run dev
   ```

3. Open the app in your browser at `http://localhost:4173`.

## AI Integration

The app includes a sample AI helper in `src/lib/ai.ts`.

To use OpenAI, set `VITE_OPENAI_API_KEY` in a `.env` file at the project root:

```env
VITE_OPENAI_API_KEY=your_openai_api_key
```

Then extend the `onGenerate` callback in `src/App.tsx` to call `fetchAICompletion`.

## Customize

- Update vocabulary in `src/data/words.ts`
- Adjust UI in `src/styles.css`
- Add more practice modes in `src/components/PracticePanel.tsx`

## Notes

This is a starter workspace for building a personalized language study browser app. The code is intentionally simple so you can iterate quickly.
