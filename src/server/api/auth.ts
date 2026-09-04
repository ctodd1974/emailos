/**
 * Auth API — server functions callable as RPCs from the UI and via HTTP.
 *
 * These are the data-security boundary: each handler enforces auth / input
 * validation server-side and transports the session cookie explicitly.
 */
import { createServerFn } from "@tanstack/react-start";
import * as auth from "~/server/auth.ts";
import { fail, ok, issueSessionCookie, revokeSessionCookie } from "~/server/middleware.ts";
import { readSessionToken, UnauthorizedError } from "~/server/session-middleware.ts";
import { serializeRow } from "~/server/db/client.ts";
import * as workspacesRepo from "~/server/db/repos/workspaces.ts";

export const register = createServerFn({ method: "POST" })
  .validator((input: auth.RegisterInput) => input)
  .handler(async ({ data }) => {
    try {
      const result = await auth.register(data);
      issueSessionCookie(result);
      return ok({ user: result.user, workspace: result.workspace });
    } catch (err) {
      return fail(err);
    }
  });

export const login = createServerFn({ method: "POST" })
  .validator((input: { email: unknown; password: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const result = await auth.login(data);
      issueSessionCookie(result);
      return ok({ user: result.user, workspace: result.workspace });
    } catch (err) {
      return fail(err);
    }
  });

export const logout = createServerFn({ method: "POST" })
  .handler(async () => {
    try {
      // revoke the server-side session, then clear the cookie
      const token = readSessionToken();
      if (token) await auth.logout(token);
      revokeSessionCookie();
      return ok({ signedOut: true });
    } catch (err) {
      return fail(err);
    }
  });

/** Session bootstrap — used by the app shell to resolve user + current workspace. */
export const getCurrentSession = createServerFn({ method: "GET" })
  .handler(async () => {
    try {
      const token = readSessionToken();
      const ctx = token ? await auth.getSessionUser(token) : null;
      if (!ctx) {
        return ok({ user: null, workspaces: [] });
      }
      const workspaces = await workspacesRepo.listWorkspacesForUser(ctx.user.id);
      return ok({
        user: { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name },
        workspaces: workspaces
          .map((w) => serializeRow({ ...w }) as any)
          .map((r: any) => ({
            id: r.id,
            name: r.name,
            slug: r.slug,
            status: r.status,
            owner: r.owner_user_id === ctx.user.id,
          })),
      });
    } catch (err) {
      if (err instanceof UnauthorizedError) return fail(err);
      return fail(err);
    }
  });