/// <reference types="vite/client" />

declare var pendo: any;

interface ImportMetaEnv {
  readonly VITE_NEON_AUTH_URL: string;
  readonly VITE_AGORA_APP_ID: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
