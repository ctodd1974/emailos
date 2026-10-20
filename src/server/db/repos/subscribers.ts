/**
 * Subscribers repository — the owned subscriber database (proposal §5).
 *
 * Isolation convention (proposal §4.3): workspaceId is always the first
 * argument and every statement filters `workspace_id = $n`. Queries that need
 * dynamic filters build `$n` placeholders explicitly and execute through
 * `sql.query()` (verified working with the Neon HTTP driver).
 */
import { sql } from "../client.ts";
import type { SubscriberSource, SubscriberStatus } from "../../audience/validation.ts";

export interface Subscriber {
  id: string;
  workspace_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: SubscriberStatus | string;
  source: SubscriberSource | string;
  source_detail: string | null;
  custom_fields: Record<string, unknown>;
  consent_metadata: Record<string, unknown> | null;
  subscribed_at: Date;
  engaged_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface TagRef {
  id: string;
  name: string;
  color: string | null;
}
export interface AudienceRef {
  id: string;
  name: string;
}

export interface SubscriberWithRelations extends Subscriber {
  tags: TagRef[];
  audiences: AudienceRef[];
}

export interface SubscriberListFilters {
  q?: string | null;
  status?: string | null;
  source?: string | null;
  tagId?: string | null;
  audienceId?: string | null;
}

export interface SubscriberListResult {
  rows: SubscriberWithRelations[];
  total: number;
  limit: number;
  offset: number;
}

const RELATIONS_SQL = `
  COALESCE((
    SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) ORDER BY lower(t.name))
    FROM subscriber_tags st
    JOIN tags t ON t.id = st.tag_id
    WHERE st.subscriber_id = s.id AND st.workspace_id = s.workspace_id
  ), '[]'::json) AS tags,
  COALESCE((
    SELECT json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY lower(a.name))
    FROM audience_memberships am
    JOIN audiences a ON a.id = am.audience_id
    WHERE am.subscriber_id = s.id AND am.workspace_id = s.workspace_id
  ), '[]'::json) AS audiences
`;

/**
 * Build the shared WHERE clause for list/count/export.
 *
 * NUMBERING (verified 2026-09-05 — an off-by-one here silently produced
 * `s.status = $1`, i.e. comparing a text column against the workspace UUID):
 * $1 is always workspaceId, so the i-th filter value (0-based) is `$i+2`,
 * which is exactly `params.length + 1` when computed right after the push.
 * LIMIT/OFFSET then follow at `params.length + 2` / `+ 3`.
 */
function buildFilter(f: SubscriberListFilters): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  const parts: string[] = [];
  if (f.q && f.q.trim() !== "") {
    params.push(`%${f.q.trim()}%`);
    const p = `$${params.length + 1}`;
    parts.push(
      `(s.email::text ILIKE ${p} OR (coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) ILIKE ${p})`,
    );
  }
  if (f.status) {
    params.push(f.status);
    parts.push(`s.status = $${params.length + 1}`);
  }
  if (f.source) {
    params.push(f.source);
    parts.push(`s.source = $${params.length + 1}`);
  }
  if (f.tagId) {
    params.push(f.tagId);
    parts.push(
      `EXISTS (SELECT 1 FROM subscriber_tags stf WHERE stf.subscriber_id = s.id AND stf.tag_id = $${params.length + 1}::uuid)`,
    );
  }
  if (f.audienceId) {
    params.push(f.audienceId);
    parts.push(
      `EXISTS (SELECT 1 FROM audience_memberships amf WHERE amf.subscriber_id = s.id AND amf.audience_id = $${params.length + 1}::uuid)`,
    );
  }
  return { clause: parts.length > 0 ? ` AND ${parts.join(" AND ")}` : "", params };
}

export async function listSubscribers(
  workspaceId: string,
  filters: SubscriberListFilters = {},
  opts: { limit?: number; offset?: number } = {},
): Promise<SubscriberListResult> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const { clause, params } = buildFilter(filters);
  const from = `FROM subscribers s WHERE s.workspace_id = $1${clause}`;

  const rows = await sql().query(
    `SELECT s.*, ${RELATIONS_SQL} ${from} ORDER BY s.created_at DESC, s.id DESC
     LIMIT $${params.length + 2} OFFSET $${params.length + 3}`,
    [workspaceId, ...params, limit, offset],
  );
  const totals = await sql().query(`SELECT count(*)::int AS n ${from}`, [workspaceId, ...params]);
  const total = (totals[0] as { n: number }).n;
  return { rows: rows as SubscriberWithRelations[], total, limit, offset };
}

export async function findSubscriber(workspaceId: string, subscriberId: string): Promise<Subscriber | null> {
  const rows = await sql()`
    SELECT * FROM subscribers WHERE workspace_id = ${workspaceId} AND id = ${subscriberId} LIMIT 1
  `;
  return (rows[0] as Subscriber | undefined) ?? null;
}

export async function findSubscriberWithRelations(
  workspaceId: string,
  subscriberId: string,
): Promise<SubscriberWithRelations | null> {
  const rows = await sql().query(
    `SELECT s.*, ${RELATIONS_SQL} FROM subscribers s
     WHERE s.workspace_id = $1 AND s.id = $2 LIMIT 1`,
    [workspaceId, subscriberId],
  );
  return (rows[0] as SubscriberWithRelations | undefined) ?? null;
}

export async function findSubscriberByEmail(workspaceId: string, email: string): Promise<Subscriber | null> {
  const rows = await sql()`
    SELECT * FROM subscribers WHERE workspace_id = ${workspaceId} AND email = ${email} LIMIT 1
  `;
  return (rows[0] as Subscriber | undefined) ?? null;
}

export async function createSubscriber(input: {
  workspaceId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  status?: SubscriberStatus;
  source?: SubscriberSource;
  sourceDetail?: string | null;
  customFields?: Record<string, unknown> | null;
  consentMetadata?: Record<string, unknown> | null;
}): Promise<Subscriber> {
  const rows = await sql()`
    INSERT INTO subscribers (
      workspace_id, email, first_name, last_name, status, source, source_detail,
      custom_fields, consent_metadata
    ) VALUES (
      ${input.workspaceId}, ${input.email}, ${input.firstName ?? null}, ${input.lastName ?? null},
      ${input.status ?? "active"}, ${input.source ?? "manual"}, ${input.sourceDetail ?? null},
      ${JSON.stringify(input.customFields ?? {})}::jsonb,
      ${input.consentMetadata ? JSON.stringify(input.consentMetadata) : null}::jsonb
    )
    RETURNING *
  `;
  return rows[0] as Subscriber;
}

export async function updateSubscriber(
  workspaceId: string,
  subscriberId: string,
  patch: {
    firstName?: string | null;
    lastName?: string | null;
    customFields?: Record<string, unknown>;
    sourceDetail?: string | null;
  },
): Promise<Subscriber | null> {
  const current = await findSubscriber(workspaceId, subscriberId);
  if (!current) return null;
  const firstName = patch.firstName === undefined ? current.first_name : patch.firstName;
  const lastName = patch.lastName === undefined ? current.last_name : patch.lastName;
  const sourceDetail = patch.sourceDetail === undefined ? current.source_detail : patch.sourceDetail;
  const customFields = patch.customFields === undefined ? current.custom_fields : patch.customFields;
  const rows = await sql()`
    UPDATE subscribers
    SET first_name = ${firstName},
        last_name = ${lastName},
        source_detail = ${sourceDetail},
        custom_fields = ${JSON.stringify(customFields ?? {})}::jsonb,
        updated_at = now()
    WHERE workspace_id = ${workspaceId} AND id = ${subscriberId}
    RETURNING *
  `;
  return (rows[0] as Subscriber | undefined) ?? null;
}

export async function setStatus(
  workspaceId: string,
  subscriberId: string,
  status: SubscriberStatus,
): Promise<Subscriber | null> {
  const rows = await sql()`
    UPDATE subscribers SET status = ${status}, updated_at = now()
    WHERE workspace_id = ${workspaceId} AND id = ${subscriberId}
    RETURNING *
  `;
  return (rows[0] as Subscriber | undefined) ?? null;
}

export interface StatusCounts {
  total: number;
  active: number;
  unsubscribed: number;
  suppressed: number;
  bounced: number;
  complained: number;
}

/** Real counts only. A zero here means genuinely zero rows in this workspace. */
export async function statusCounts(workspaceId: string): Promise<StatusCounts> {
  const rows = await sql()`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status = 'active')::int AS active,
      count(*) FILTER (WHERE status = 'unsubscribed')::int AS unsubscribed,
      count(*) FILTER (WHERE status = 'suppressed')::int AS suppressed,
      count(*) FILTER (WHERE status = 'bounced')::int AS bounced,
      count(*) FILTER (WHERE status = 'complained')::int AS complained
    FROM subscribers WHERE workspace_id = ${workspaceId}
  `;
  return rows[0] as StatusCounts;
}

/** Source values actually present in this workspace (drives the filter UI). */
export async function distinctSources(workspaceId: string): Promise<string[]> {
  const rows = await sql()`
    SELECT DISTINCT source FROM subscribers WHERE workspace_id = ${workspaceId} ORDER BY source ASC
  `;
  return (rows as { source: string }[]).map((r) => r.source);
}

/** Rows for CSV export — honors the same filters the UI is showing. */
export async function listForExport(
  workspaceId: string,
  filters: SubscriberListFilters = {},
): Promise<Record<string, unknown>[]> {
  const { clause, params } = buildFilter(filters);
  const rows = await sql().query(
    `SELECT s.*, ${RELATIONS_SQL} FROM subscribers s
     WHERE s.workspace_id = $1${clause}
     ORDER BY s.created_at ASC, s.id ASC`,
    [workspaceId, ...params],
  );
  return rows as Record<string, unknown>[];
}

/** Emails already present in this workspace — used by CSV import dedupe. */
export async function existingEmails(workspaceId: string, emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = await sql().query(
    `SELECT email::text AS email FROM subscribers WHERE workspace_id = $1 AND email = ANY($2::citext[])`,
    [workspaceId, emails],
  );
  return new Set((rows as { email: string }[]).map((r) => r.email.toLowerCase()));
}
