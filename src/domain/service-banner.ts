/** A planned update keeps its kickoff instant separate from the notice lifecycle. */
export type ServiceBannerContent = { message: string; kickoffAt?: string };
export type ServiceBannerRequest =
  | { kickoffAt: string; message?: never; expiresAt?: never }
  | { message: string; expiresAt?: string; kickoffAt?: never };
export const PLANNED_UPDATE_MESSAGE = 'A service update is planned. The app may be briefly unavailable. Please finish your study session before then.';
export const UPDATE_NOTICE_TTL_MS = 24 * 60 * 60 * 1000;
