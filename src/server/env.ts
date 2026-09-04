/**
 * EmailOS server-side environment accessor.
 *
 * Read env lazily inside the function that needs it (module-level reads are
 * wrong on edge runtimes and make tests awkward). Values are ONLY ever read
 * here; nothing is exported to the client. Secrets never appear in logs —
 * callers that log should log presence/length, never the value.
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`${name} is required but not set. See .env.example.`);
  }
  return v;
}

/** DATABASE_URL — required for any DB access. Asserted at use (lazy). */
export function getDatabaseUrl(): string {
  return requireEnv("DATABASE_URL");
}

/**
 * APP_SECRET — required for auth (cookie/secret material). Auth routes fail
 * with a clear server-side error when missing; we never fabricate a secret.
 */
export function getAppSecret(): string {
  return requireEnv("APP_SECRET");
}

/** RESEND_API_KEY — nullable. Absence means "not configured" (Slice 3 wires it). */
export function getResendApiKey(): string | null {
  const v = process.env.RESEND_API_KEY;
  return v && v.trim() !== "" ? v : null;
}

/** Presence/length-only summary for a settings page (never the values). */
export function envPresenceSummary(): {
  databaseUrl: boolean;
  appSecret: boolean;
  resendApiKey: boolean;
} {
  return {
    databaseUrl: Boolean(process.env.DATABASE_URL),
    appSecret: Boolean(process.env.APP_SECRET),
    resendApiKey: getResendApiKey() !== null,
  };
}