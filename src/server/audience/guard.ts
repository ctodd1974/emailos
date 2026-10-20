/**
 * Shared guard for every audience-area server function.
 *
 * Slice 2 audit point: EVERY handler resolves the session user, validates the
 * workspace id, and calls requireWorkspaceMember (proposal §4.3) BEFORE
 * touching a repository. The repo layer additionally filters by workspace_id,
 * so a missing guard would still not leak another workspace's rows — the guard
 * is the authorization answer, the filter is the defense in depth.
 */
import { readSessionToken, UnauthorizedError } from "../session-middleware.ts";
import { requireWorkspaceMember } from "../workspace.ts";
import * as auth from "../auth.ts";
import { requireUuid } from "../audience/validation.ts";

export interface AudienceRequestContext {
  user: { id: string; email: string; name: string | null };
  workspaceId: string;
}

export async function requireAudienceContext(workspaceId: unknown): Promise<AudienceRequestContext> {
  const token = readSessionToken();
  const ctx = await auth.getSessionUser(token);
  if (!ctx) throw new UnauthorizedError();
  const wsId = requireUuid(workspaceId, "Workspace");
  await requireWorkspaceMember(wsId, ctx.user); // throws ForbiddenError (403) for non-members
  return { user: ctx.user, workspaceId: wsId };
}
