/**
 * Audiences repository (workspace-scoped).
 *
 * An audience is a hand-curated group of subscribers. Deleting an audience
 * deletes only the audience and its membership rows — never the subscribers
 * themselves (audience_memberships cascades from audiences.id).
 */
import { sql } from "../client.ts";

export interface Audience {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AudienceWithCount extends Audience {
  member_count: number;
}

export async function listAudiences(workspaceId: string): Promise<AudienceWithCount[]> {
  const rows = await sql()`
    SELECT a.*, (
      SELECT count(*)::int FROM audience_memberships am
      WHERE am.audience_id = a.id AND am.workspace_id = a.workspace_id
    ) AS member_count
    FROM audiences a
    WHERE a.workspace_id = ${workspaceId}
    ORDER BY lower(a.name) ASC
  `;
  return rows as AudienceWithCount[];
}

export async function countAudiences(workspaceId: string): Promise<number> {
  const rows = await sql()`
    SELECT count(*)::int AS n FROM audiences WHERE workspace_id = ${workspaceId}
  `;
  return (rows[0] as { n: number }).n;
}

export async function findAudienceById(workspaceId: string, audienceId: string): Promise<Audience | null> {
  const rows = await sql()`
    SELECT * FROM audiences WHERE workspace_id = ${workspaceId} AND id = ${audienceId} LIMIT 1
  `;
  return (rows[0] as Audience | undefined) ?? null;
}

export async function createAudience(
  workspaceId: string,
  name: string,
  description?: string | null,
): Promise<Audience> {
  const rows = await sql()`
    INSERT INTO audiences (workspace_id, name, description)
    VALUES (${workspaceId}, ${name}, ${description ?? null})
    RETURNING *
  `;
  return rows[0] as Audience;
}

export async function updateAudience(
  workspaceId: string,
  audienceId: string,
  patch: { name?: string; description?: string | null },
): Promise<Audience | null> {
  const current = await findAudienceById(workspaceId, audienceId);
  if (!current) return null;
  const name = patch.name ?? current.name;
  const description = patch.description === undefined ? current.description : patch.description;
  const rows = await sql()`
    UPDATE audiences SET name = ${name}, description = ${description}, updated_at = now()
    WHERE workspace_id = ${workspaceId} AND id = ${audienceId}
    RETURNING *
  `;
  return (rows[0] as Audience | undefined) ?? null;
}

/** Subscribers are NOT touched — only the audience and its memberships go. */
export async function deleteAudience(workspaceId: string, audienceId: string): Promise<boolean> {
  const rows = await sql()`
    DELETE FROM audiences WHERE workspace_id = ${workspaceId} AND id = ${audienceId} RETURNING id
  `;
  return rows.length > 0;
}

/** Audiences one subscriber belongs to. */
export async function audiencesForSubscriber(workspaceId: string, subscriberId: string): Promise<Audience[]> {
  const rows = await sql()`
    SELECT a.* FROM audiences a
    JOIN audience_memberships am ON am.audience_id = a.id
    WHERE am.workspace_id = ${workspaceId} AND am.subscriber_id = ${subscriberId}
    ORDER BY lower(a.name) ASC
  `;
  return rows as Audience[];
}

export async function addMembership(workspaceId: string, audienceId: string, subscriberId: string): Promise<void> {
  await sql()`
    INSERT INTO audience_memberships (audience_id, subscriber_id, workspace_id)
    VALUES (${audienceId}, ${subscriberId}, ${workspaceId})
    ON CONFLICT (audience_id, subscriber_id) DO NOTHING
  `;
}

export async function removeMembership(
  workspaceId: string,
  audienceId: string,
  subscriberId: string,
): Promise<void> {
  await sql()`
    DELETE FROM audience_memberships
    WHERE workspace_id = ${workspaceId} AND audience_id = ${audienceId} AND subscriber_id = ${subscriberId}
  `;
}

export async function isMember(workspaceId: string, audienceId: string, subscriberId: string): Promise<boolean> {
  const rows = await sql()`
    SELECT 1 FROM audience_memberships
    WHERE workspace_id = ${workspaceId} AND audience_id = ${audienceId} AND subscriber_id = ${subscriberId}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function countMembers(workspaceId: string, audienceId: string): Promise<number> {
  const rows = await sql()`
    SELECT count(*)::int AS n FROM audience_memberships
    WHERE workspace_id = ${workspaceId} AND audience_id = ${audienceId}
  `;
  return (rows[0] as { n: number }).n;
}

export interface AudienceMember {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  added_at: Date;
}

export async function listMembers(
  workspaceId: string,
  audienceId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<AudienceMember[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const rows = await sql()`
    SELECT s.id, s.email, s.first_name, s.last_name, s.status, am.added_at
    FROM audience_memberships am
    JOIN subscribers s ON s.id = am.subscriber_id
    WHERE am.workspace_id = ${workspaceId} AND am.audience_id = ${audienceId}
    ORDER BY am.added_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return rows as AudienceMember[];
}
