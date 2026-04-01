import type { WordItem } from '../types';

export function buildPracticePrompt(word: WordItem) {
  return `Create a short Chinese learning prompt using the word ${word.chinese} (${word.pinyin}). Use simple English instructions and include one example sentence with meaning. Category: ${word.category}.`;
}

export async function fetchAICompletion(prompt: string) {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing VITE_OPENAI_API_KEY in environment variables.');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a friendly Mandarin practice assistant.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 180,
    }),
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? 'No response from AI.';
}
