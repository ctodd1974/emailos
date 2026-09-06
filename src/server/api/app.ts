/**
 * App API — non-auth server functions (dashboard/settings, workspace switching).
 * Every handler enforces membership against the session principal.
 */
import { createServerFn } from "@tanstack/react-start";
import { readSessionToken, UnauthorizedError } from "~/server/session-middleware.ts";
import * as auth from "~/server/auth.ts";
import { requireWorkspaceMember, listMyWorkspaces, getWorkspaceForMember, createWorkspaceWithOwner } from "~/server/workspace.ts";
import * as workspacesRepo from "~/server/db/repos/workspaces.ts";
import { getResendProvider } from "~/server/resend/provider.ts";
import { fail, ok } from "~/server/middleware.ts";
import { serializeRow } from "~/server/db/client.ts";

async function currentUser() {
  const token = readSessionToken();
  const ctx = await auth.getSessionUser(token);
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}

/** The user's own workspaces (switcher + session bootstrap). */
export const myWorkspaces = createServerFn({ method: "GET" })
  .handler(async () => {
    try {
      const { user } = await currentUser();
      const workspaces = await listMyWorkspaces(user.id);
      return ok(workspaces.map((w) => serializeRow({ ...w }) as any).map((r: any) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        status: r.status,
        owner: r.owner_user_id === user.id,
      })));
    } catch (err) {
      return fail(err);
    }
  });

export const getDashboard = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => {
    try {
      const ctx = await currentUser();
      await requireWorkspaceMember(data.workspaceId, ctx.user); // 403 for non-members
      const { workspace } = await getWorkspaceForMember(data.workspaceId, ctx.user);

      // REAL state only — never fabricated numbers. Phase 1: counts are all
      // zero-ed out by absence of features, so we return booleans instead.
      const provider = getResendProvider().status();

      return ok({
        workspace: serializeRow({ ...workspace }) as any,
        providerStatus: provider.status,
        hasSubscribers: false, // Slice 2 adds real subscriber table reads
        hasCampaigns: false,
        hasForms: false,
      });
    } catch (err) {
      return fail(err);
    }
  });

export const getSettings = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => {
    try {
      const ctx = await currentUser();
      await requireWorkspaceMember(data.workspaceId, ctx.user);
      const { workspace, member } = await getWorkspaceForMember(data.workspaceId, ctx.user);
      const provider = getResendProvider().status();
      return ok({
        workspace: serializeRow({ ...workspace }) as any,
        role: member.role,
        providerStatus: provider.status,
      });
    } catch (err) {
      return fail(err);
    }
  });

export const updateWorkspaceSettings = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; name: string; slug: string }) => input)
  .handler(async ({ data }) => {
    try {
      const ctx = await currentUser();
      await requireWorkspaceMember(data.workspaceId, ctx.user);
      const name = auth.validateWorkspaceName(data.name);
      const slug = auth.validateSlug(data.slug);
      if (await workspacesRepo.slugExists(slug, data.workspaceId)) {
        return fail({ message: "That slug is already taken." });
      }
      const ws = await workspacesRepo.updateWorkspace({ workspaceId: data.workspaceId, name, slug });
      return ok(serializeRow({ ...(ws as any) }));
    } catch (err) {
      return fail(err);
    }
  });
export const createWorkspace = createServerFn({ method: "POST" })
  .validator((input: { name: unknown; slug: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const ctx = await currentUser();
      const name = auth.validateWorkspaceName(data.name);
      const slug = auth.validateSlug(data.slug);
      const ws = await createWorkspaceWithOwner({ name, slug, ownerUserId: ctx.user.id });
      return ok({ workspace: serializeRow({ ...ws }) as any });
    } catch (err) {
      return fail(err);
    }
  });
