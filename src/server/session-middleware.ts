/**
 * Session middleware: read the session cookie, resolve the user, and expose a
 * typed session context to server functions via `next({ context })`.
 *
 * Cookie transport: httpOnly, Secure, SameSite=Lax (per proposal §4.2). The
 * cookie name/options mirror the canonical TanStack Start auth pattern for
 * this framework version.
 */
import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { SESSION_COOKIE, getSessionUser, type SessionContext } from "./auth.ts";

export function readSessionToken(): string | null {
  const header = getRequestHeader("cookie");
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === SESSION_COOKIE) return part.slice(eq + 1);
  }
  return null;
}

export function setSessionCookie(token: string, expiresAt: string): void {
  setResponseHeader("Set-Cookie", [
    `${SESSION_COOKIE}=${token}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
    `Path=/`,
    `Max-Age=${30 * 24 * 60 * 60}`,
    expiresAt ? `Expires=${new Date(expiresAt).toUTCString()}` : "",
  ].filter(Boolean).join("; "));
}

export function clearSessionCookie(): void {
  setResponseHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

export class UnauthorizedError extends Error {
  constructor(message = "Not signed in.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export const authMiddleware = createMiddleware({ type: "function" })
  .server(async ({ next }) => {
    const token = readSessionToken();
    const ctx = await getSessionUser(token);
    if (!ctx) {
      throw new UnauthorizedError();
    }
    return next({ context: { session: ctx } as { session: SessionContext } });
  })
  .client(async ({ next }) => {
    return next();
  });