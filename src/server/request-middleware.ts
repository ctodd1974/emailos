/**
 * Request-level middleware: session guard for the authenticated app.
 *
 * Why this file exists (Slice 1 verification, lead decision): an
 * unauthenticated GET /app/dashboard currently returns the SSR app shell
 * (HTTP 200) because the beforeLoad redirect only fires client-side in
 * development. This middleware runs before routing on EVERY request and
 * short-circuits HTML requests under /app/* with a real 302 to /login when
 * the session cookie is absent.
 *
 * The browser itself has already set the cookie to HttpOnly, Secure,
 * SameSite=Lax; on the TLS reverse proxy the Secure flag is fine. Guarding on
 * the cookie PRESENCE preserves a private-dashboard default without touching
 * the database on anonymous traffic. Subsessions (server-side validation) stay
 * in handlers; this is a coarse gate, not a trust boundary.
 *
 * Env-gated: APP_REQUIRE_SESSION_COOKIE must be "true" (set in .env for local
 * dev). It is off by default so template/`bun run build` prerenders (which run
 * unauthenticated) still emit the shell, and so the public landing page is
 * never affected.
 */
import { createMiddleware } from "@tanstack/react-start";
import { SESSION_COOKIE } from "./auth.ts";

function hasSessionCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === SESSION_COOKIE) return true;
  }
  return false;
}

export const sessionRequestMiddleware = createMiddleware({ type: "request" as const }).server(
  async ({ next, request }) => {
    const url = new URL(request.url);
    // Gate only HTML app pages; serverFn RPCs and the public site are exempt.
    if (
      process.env.APP_REQUIRE_SESSION_COOKIE === "true" &&
      (url.pathname === "/app" || url.pathname.startsWith("/app/"))
    ) {
      const accept = request.headers.get("accept") ?? "";
      const wantsHtml = accept === "" || /text\/html|\*\/\*/.test(accept);
      if (wantsHtml && !hasSessionCookie(request.headers.get("cookie"))) {
        return new Response(null, {
          status: 302,
          headers: { location: "/login" },
        });
      }
    }
    return next();
  },
);