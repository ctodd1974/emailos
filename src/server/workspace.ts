/**
 * Workspace model + switching.
 *
 * Mechanic (proposal §4.3): every handler resolves the workspace id and calls
 * requireWorkspaceMember BEFORE any query. The id is never client-trusted for
 * scoping — it only selects WHICH workspace an authorized user operates on.
 * A 403 "ForbiddenError" is returned for non-members (matching the brief's
 * workspace isolation requirement).
 */
import * as workspacesRepo from "./db/repos/workspaces.ts";

export class ForbiddenError extends Error {
  constructor(message = "You are not a member of this workspace.") {
    super(message);
    this.name = "ForbiddenError";
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

export class NotFoundError extends Error {
  constructor(message = "Workspace not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export interface SessionPrincipal {
  user: { id: string; email: string; name: string | null };
  session: { id: string };
}

/** Membership gate — call as the FIRST step of every workspace-scoped handler. */
export async function requireWorkspaceMember(
  workspaceId: string,
  user: { id: string },
): Promise<workspacesRepo.WorkspaceMember> {
  const member = await workspacesRepo.findMembership(workspaceId, user.id);
  if (!member) {
    throw new ForbiddenError();
  }
  return member;
}

export async function listMyWorkspaces(userId: string): Promise<workspacesRepo.Workspace[]> {
  return workspacesRepo.listWorkspacesForUser(userId);
}

export async function getWorkspaceForMember(workspaceId: string, user: { id: string }) {
  const member = await requireWorkspaceMember(workspaceId, user); // 403 if not a member
  const workspace = await workspacesRepo.findWorkspaceById(workspaceId);
  if (!workspace) throw new NotFoundError();
  return { member, workspace };
}