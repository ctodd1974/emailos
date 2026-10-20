/**
 * Tags repository. Every function takes workspaceId first and every query
 * filters `workspace_id = $n` (isolation convention, proposal §4.3).
 */
import { sql } from "../client.ts";

export interface Tag {
  id: string;
  workspace_id: string;
  name: string;
  color: string | null;
  created_at: Date;
}

export interface TagWithCount extends Tag {
  subscriber_count: number;
}

export async function listTags(workspaceId: string): Promise<TagWithCount[]> {
  const rows = await sql()`
    SELECT t.*, (
      SELECT count(*)::int FROM subscriber_tags st
      WHERE st.tag_id = t.id AND st.workspace_id = t.workspace_id
    ) AS subscriber_count
    FROM tags t
    WHERE t.workspace_id = ${workspaceId}
    ORDER BY lower(t.name) ASC
  `;
  return rows as TagWithCount[];
}

export async function countTags(workspaceId: string): Promise<number> {
  const rows = await sql()`
    SELECT count(*)::int AS n FROM tags WHERE workspace_id = ${workspaceId}
  `;
  return (rows[0] as { n: number }).n;
}

export async function findTagById(workspaceId: string, tagId: string): Promise<Tag | null> {
  const rows = await sql()`
    SELECT * FROM tags WHERE workspace_id = ${workspaceId} AND id = ${tagId} LIMIT 1
  `;
  return (rows[0] as Tag | undefined) ?? null;
}

export async function createTag(workspaceId: string, name: string, color?: string | null): Promise<Tag> {
  const rows = await sql()`
    INSERT INTO tags (workspace_id, name, color)
    VALUES (${workspaceId}, ${name}, ${color ?? null})
    RETURNING *
  `;
  return rows[0] as Tag;
}

export async function renameTag(workspaceId: string, tagId: string, name: string): Promise<Tag | null> {
  const rows = await sql()`
    UPDATE tags SET name = ${name}
    WHERE workspace_id = ${workspaceId} AND id = ${tagId}
    RETURNING *
  `;
  return (rows[0] as Tag | undefined) ?? null;
}

/**
 * Deleting a tag only removes the tag rows; subscriber_tags rows cascade, so
 * tagged subscribers keep their records (they merely lose the tag).
 */
export async function deleteTag(workspaceId: string, tagId: string): Promise<boolean> {
  const rows = await sql()`
    DELETE FROM tags WHERE workspace_id = ${workspaceId} AND id = ${tagId} RETURNING id
  `;
  return rows.length > 0;
}

/** Tags attached to one subscriber. */
export async function tagsForSubscriber(workspaceId: string, subscriberId: string): Promise<Tag[]> {
  const rows = await sql()`
    SELECT t.* FROM tags t
    JOIN subscriber_tags st ON st.tag_id = t.id
    WHERE st.workspace_id = ${workspaceId} AND st.subscriber_id = ${subscriberId}
    ORDER BY lower(t.name) ASC
  `;
  return rows as Tag[];
}

export async function attachTag(workspaceId: string, subscriberId: string, tagId: string): Promise<void> {
  await sql()`
    INSERT INTO subscriber_tags (subscriber_id, tag_id, workspace_id)
    VALUES (${subscriberId}, ${tagId}, ${workspaceId})
    ON CONFLICT (subscriber_id, tag_id) DO NOTHING
  `;
}

export async function detachTag(workspaceId: string, subscriberId: string, tagId: string): Promise<void> {
  await sql()`
    DELETE FROM subscriber_tags
    WHERE workspace_id = ${workspaceId} AND subscriber_id = ${subscriberId} AND tag_id = ${tagId}
  `;
}

/** True when the tag exists in this workspace AND is attached to the subscriber. */
export async function hasTag(workspaceId: string, subscriberId: string, tagId: string): Promise<boolean> {
  const rows = await sql()`
    SELECT 1 FROM subscriber_tags
    WHERE workspace_id = ${workspaceId} AND subscriber_id = ${subscriberId} AND tag_id = ${tagId}
    LIMIT 1
  `;
  return rows.length > 0;
}
