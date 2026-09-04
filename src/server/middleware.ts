/**
 * Shared server-function middleware for the API/auth layer.
 * Handles cookie transport + error serialization, so route handlers stay small.
 */
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import {
  authMiddleware,
  UnauthorizedError,
  setSessionCookie,
  clearSessionCookie,
  readSessionToken,
} from "~/server/session-middleware.ts";
import * as auth from "~/server/auth.ts";
import type { SessionContext } from "~/server/auth.ts";

/** Attach the authenticated session context to handlers. */
export { authMiddleware, type SessionContext };

export function unauthenticatedError() {
  return new UnauthorizedError();
}

export type ApiErrorBody = {
  error: string;
  status: number;
};

export function serializeError(err: unknown): ApiErrorBody {
  if (err instanceof auth.AuthError) {
    return { error: err.message, status: err.status };
  }
  if (err instanceof UnauthorizedError) {
    return { error: err.message, status: 401 };
  }
  return { error: err instanceof Error ? err.message : "Unexpected error.", status: 500 };
}

/** Response envelope for mutation server fns (data or error). */
export function ok<T>(data: T) {
  return { ok: true as const, data };
}
export function fail(error: unknown) {
  return { ok: false as const, error: serializeError(error) };
}

// --- Per-request auth helpers used by handlers -----------------------------

export async function requireSession(): Promise<SessionContext> {
  const token = readSessionToken();
  const ctx = await auth.getSessionUser(token);
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}

export function issueSessionCookie(session: { sessionToken: string; expiresAt: string }) {
  setSessionCookie(session.sessionToken, session.expiresAt);
}

/** Compatibility: some callers pass the AuthResult shape directly. */
export function issueSessionCookieFromAuthResult(result: auth.AuthResult) {
  setSessionCookie(result.sessionToken, result.expiresAt);
}

export function revokeSessionCookie() {
  clearSessionCookie();
}

// --- Convenience server-fn factory for api modules -------------------------
export const authAction = createServerFn; // re-export for uniform imports