/**
 * Suppressions repository. Safety-critical table (proposal §4.5): an email in
 * here for a workspace must never receive a marketing send from that workspace.
 * Slice 4 enforces it in the send pipeline; Slice 2 gets the state model right
 * and keeps it visible in the UI.
 */
import { sql } from "../client.ts";
import type { SuppressionReason } from "../../audience/validation.ts";

export interface Suppression {
  id: string;
  workspace_id: string;
  email: string;
  reason: SuppressionReason | string;
  source: string;
  provider_suppression_id: string | null;
  subscriber_id: string | null;
  created_at: Date;
}

export async function listSuppressions(workspaceId: string, limit = 200): Promise<Suppression[]> {
  const rows = await sql()`
    SELECT * FROM suppressions
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 500)}
  `;
  return rows as Suppression[];
}

export async function countSuppressions(workspaceId: string): Promise<number> {
  const rows = await sql()`
    SELECT count(*)::int AS n FROM suppressions WHERE workspace_id = ${workspaceId}
  `;
  return (rows[0] as { n: number }).n;
}

export async function findSuppressionByEmail(workspaceId: string, email: string): Promise<Suppression | null> {
  const rows = await sql()`
    SELECT * FROM suppressions
    WHERE workspace_id = ${workspaceId} AND email = ${email}
    LIMIT 1
  `;
  return (rows[0] as Suppression | undefined) ?? null;
}

export async function findSuppressionForSubscriber(
  workspaceId: string,
  subscriberId: string,
): Promise<Suppression | null> {
  const rows = await sql()`
    SELECT * FROM suppressions
    WHERE workspace_id = ${workspaceId} AND subscriber_id = ${subscriberId}
    LIMIT 1
  `;
  return (rows[0] as Suppression | undefined) ?? null;
}

/**
 * Idempotent add. Re-adding an existing suppression keeps the original row
 * (created_at untouched) so the audit trail of when an address became
 * unmailable is preserved, but refreshes reason/source when they are explicit.
 */
export async function upsertSuppression(input: {
  workspaceId: string;
  email: string;
  reason: SuppressionReason;
  source?: string;
  subscriberId?: string | null;
}): Promise<Suppression> {
  const rows = await sql()`
    INSERT INTO suppressions (workspace_id, email, reason, source, subscriber_id)
    VALUES (
      ${input.workspaceId}, ${input.email}, ${input.reason},
      ${input.source ?? "emailos"}, ${input.subscriberId ?? null}
    )
    ON CONFLICT (workspace_id, email) DO UPDATE
      SET reason = EXCLUDED.reason,
          source = EXCLUDED.source,
          subscriber_id = COALESCE(EXCLUDED.subscriber_id, suppressions.subscriber_id)
    RETURNING *
  `;
  return rows[0] as Suppression;
}

export async function removeSuppression(workspaceId: string, email: string): Promise<boolean> {
  const rows = await sql()`
    DELETE FROM suppressions WHERE workspace_id = ${workspaceId} AND email = ${email} RETURNING id
  `;
  return rows.length > 0;
}
