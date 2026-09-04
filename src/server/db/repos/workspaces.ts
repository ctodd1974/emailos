/**
 * Workspaces + membership repository.
 *
 * Scoping convention (enforced from day one): every tenant-owned query carries
 * `workspace_id = $n` in its WHERE clause. The authorization gate lives in
 * src/server/workspace.ts (requireWorkspaceMember) and is called by EVERY
 * handler before any query; these repo functions additionally take
 * workspaceId as their first argument and filter by it.
 */
import { sql } from "../client.ts";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  provider_connection_id: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: string;
  created_at: Date;
}

export async function createWorkspace(input: {
  name: string;
  slug: string;
  ownerUserId: string;
}): Promise<Workspace> {
  const rows = await sql()`
    INSERT INTO workspaces (name, slug, owner_user_id)
    VALUES (${input.name}, ${input.slug}, ${input.ownerUserId})
    RETURNING *
  `;
  const ws = rows[0] as Workspace;
  // The creator is owner.
  await sql()`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (${ws.id}, ${input.ownerUserId}, 'owner')
  `;
  return ws;
}

export async function addMember(input: {
  workspaceId: string;
  userId: string;
  role: string;
}): Promise<void> {
  await sql()`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (${input.workspaceId}, ${input.userId}, ${input.role})
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
  `;
}

/** Membership row or null (used by requireWorkspaceMember). */
export async function findMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
  const rows = await sql()`
    SELECT * FROM workspace_members
    WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
    LIMIT 1
  `;
  return (rows[0] as WorkspaceMember | undefined) ?? null;
}

/** Workspaces the user belongs to (workspace switcher + session resolution). */
export async function listWorkspacesForUser(userId: string): Promise<Workspace[]> {
  const rows = await sql()`
    SELECT w.* FROM workspaces w
    JOIN workspace_members m ON m.workspace_id = w.id
    WHERE m.user_id = ${userId}
    ORDER BY w.created_at ASC
  `;
  return rows as Workspace[];
}

/** Fetch a single workspace by id — scope is NOT implied; caller must check membership. */
export async function findWorkspaceById(workspaceId: string): Promise<Workspace | null> {
  const rows = await sql()`SELECT * FROM workspaces WHERE id = ${workspaceId} LIMIT 1`;
  return (rows[0] as Workspace | undefined) ?? null;
}

export async function updateWorkspace(input: {
  workspaceId: string;
  name: string;
  slug: string;
}): Promise<Workspace | null> {
  const rows = await sql()`
    UPDATE workspaces SET name = ${input.name}, slug = ${input.slug}, updated_at = now()
    WHERE id = ${input.workspaceId}
    RETURNING *
  `;
  return (rows[0] as Workspace | undefined) ?? null;
}

export async function slugExists(slug: string, excludeWorkspaceId?: string): Promise<boolean> {
  const rows = excludeWorkspaceId
    ? await sql()`SELECT 1 FROM workspaces WHERE slug = ${slug} AND id <> ${excludeWorkspaceId} LIMIT 1`
    : await sql()`SELECT 1 FROM workspaces WHERE slug = ${slug} LIMIT 1`;
  return rows.length > 0;
}