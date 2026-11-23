// Types for the shared composition policy, for TypeScript callers in Node.
export type Level = 'none' | 'latent' | 'placed';
export type Verdict = { level: Level; reasons: string[] };
type MediaLike = {
  id: string;
  origin: 'system' | 'learner';
  ceiling: 'latent' | 'placed';
  createdAt: string;
  anchor: { id: string };
  judgment?: { referent: string; addedValue: string };
  reactions?: { kept?: string; notForMe?: string };
};
export const policy: {
  clusterCap: number;
  textPerImage: number;
  pacing: { count: number; window: number };
  taste: { dismissals: number; window: number; cap: number };
};
export function learnerChosen(item: MediaLike): boolean;
export function tasteCaps(media: MediaLike[], now: number): Map<string, number>;
export function compose(state: { media?: MediaLike[]; settings?: { pictures: string } }, now?: number | string): Record<string, Verdict>;
