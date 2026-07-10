/// <reference types="vite/client" />

declare var pendo: any;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_MOQ_RELAY_URL: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY: string;
  readonly VITE_FACEBOOK_GROUP_URL: string;
  readonly VITE_DISCORD_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
