/**
 * Server-only DB client wrapper.
 *
 * `sql()` lazily resolves DATABASE_URL so the site still builds/serves before a
 * database is connected. Errors are normalized (NeonDbError surface) but the
 * message never contains the connection string.
 */
import { neon } from "@neondatabase/serverless";

export function sql() {
  return neon(process.env.DATABASE_URL!); // env presence asserted by callers via env.getDatabaseUrl()
}

export function assertDbConfigured() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — database not connected.");
  }
}

/**
 * Serialize rows for client transport: Neo neon returns JS Dates for
 * timestamptz columns; React refuses to render them. Convert recursively
 * (shallow) when returning rows to the client.
 */
export function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}