declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    CALLBACK_ALLOW_LIVE_CALLS?: string;
    CALLE_API_KEY?: string;
    CALLE_API_KEY_OWNER_ID?: string;
    CALLE_KEY_ENCRYPTION_SECRET?: string;
    CALLBACK_TEST_OWNER_ID?: string;
    CALLBACK_TEST_INQUIRY_ID?: string;
    CALLBACK_TEST_PHONE?: string;
  }
}
