/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_STUDY_PROFILE?: string;
  readonly VITE_AUTH_MODE?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}
