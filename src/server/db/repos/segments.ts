/**
 * Segments repository — FOUNDATION ONLY (proposal §5, Slice 2 scope).
 *
 * Rules are stored as (field, operator, value) rows and evaluated with plain
 * deterministic SQL over fields that actually exist today: status, source, tag,
 * audience membership, and date added. Anything else is REJECTED rather than
 * approximated — no pretend intelligence, no fabricated behavioural data.
 * Behavioural fields (engaged_days, custom.*, purchase history) arrive in later
 * slices once real events exist.
 */
import { sql } from "../client.ts";
import { ValidationError, requireUuid } from "../../audience/validation.ts";

export const SEGMENT_MATCH_TYPES = ["all", "any"] as const;
export type SegmentMatchType = (typeof SEGMENT_MATCH_TYPES)[number];

export const SUPPORTED_RULE_FIELDS = ["status", "source", "tag", "audience", "subscribed_at"] as const;
export type SupportedRuleField = (typeof SUPPORTED_RULE_FIELDS)[number];

export const RULE_OPERATORS: Record<SupportedRuleField, readonly string[]> = {
  status: ["equals", "not_equals"],
  source: ["equals", "not_equals"],
  tag: ["has", "not_has"],
  audience: ["member_of", "not_member_of"],
  subscribed_at: ["after", "before", "within_days"],
};

export interface SegmentRule {
  field: SupportedRuleField;
  operator: string;
  value: string | number;
}

export interface Segment {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  match_type: SegmentMatchType;
  is_dynamic: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface SegmentWithRules extends Segment {
  rules: SegmentRule[];
}

function assertRule(rule: SegmentRule): void {
  if (!(SUPPORTED_RULE_FIELDS as readonly string[]).includes(rule.field)) {
    throw new ValidationError(
      `Unsupported segment field "${rule.field}". Supported today: ${SUPPORTED_RULE_FIELDS.join(", ")}.`,
    );
  }
  const allowed = RULE_OPERATORS[rule.field];
  if (!allowed.includes(rule.operator)) {
    throw new ValidationError(
      `Operator "${rule.operator}" is not supported for "${rule.field}" (allowed: ${allowed.join(", ")}).`,
    );
  }
  if (rule.field === "tag" || rule.field === "audience") {
    requireUuid(rule.value, rule.field === "tag" ? "Tag" : "Audience");
  }
  if (rule.field === "subscribed_at") {
    if (rule.operator === "within_days") {
      const n = Number(rule.value);
      if (!Number.isFinite(n) || n <= 0 || n > 3650) {
        throw new ValidationError("Days must be a number between 1 and 3650.");
      }
    } else if (typeof rule.value !== "string" || Number.isNaN(Date.parse(rule.value))) {
      throw new ValidationError("Date rules need a valid date.");
    }
  }
}

/** Translate one rule into SQL against alias `s` (subscribers). */
function ruleToSql(rule: SegmentRule, params: unknown[]): string {
  switch (rule.field) {
    case "status":
    case "source": {
      params.push(String(rule.value));
      return `s.${rule.field} ${rule.operator === "equals" ? "=" : "<>"} $${params.length}`;
    }
    case "tag": {
      params.push(String(rule.value));
      const exists = `EXISTS (SELECT 1 FROM subscriber_tags stq WHERE stq.subscriber_id = s.id AND stq.tag_id = $${params.length}::uuid)`;
      return rule.operator === "not_has" ? `NOT ${exists}` : exists;
    }
    case "audience": {
      params.push(String(rule.value));
      const exists = `EXISTS (SELECT 1 FROM audience_memberships amq WHERE amq.subscriber_id = s.id AND amq.audience_id = $${params.length}::uuid)`;
      return rule.operator === "not_member_of" ? `NOT ${exists}` : exists;
    }
    case "subscribed_at": {
      if (rule.operator === "within_days") {
        params.push(String(Number(rule.value)));
        return `s.subscribed_at >= now() - ($${params.length} || ' days')::interval`;
      }
      params.push(String(rule.value));
      return `s.subscribed_at ${rule.operator === "after" ? ">=" : "<="} $${params.length}::timestamptz`;
    }
    /* istanbul ignore next — guarded by assertRule */
    default:
      throw new ValidationError(`Unsupported segment field "${rule.field}".`);
  }
}

export async function listSegments(workspaceId: string): Promise<(Segment & { rule_count: number })[]> {
  const rows = await sql()`
    SELECT seg.*, (
      SELECT count(*)::int FROM segment_rules sr WHERE sr.segment_id = seg.id
    ) AS rule_count
    FROM segments seg
    WHERE seg.workspace_id = ${workspaceId}
    ORDER BY lower(seg.name) ASC
  `;
  return rows as (Segment & { rule_count: number })[];
}

export async function findSegmentById(workspaceId: string, segmentId: string): Promise<SegmentWithRules | null> {
  const rows = await sql()`
    SELECT * FROM segments WHERE workspace_id = ${workspaceId} AND id = ${segmentId} LIMIT 1
  `;
  const segment = rows[0] as Segment | undefined;
  if (!segment) return null;
  const ruleRows = await sql()`
    SELECT field, operator, value FROM segment_rules
    WHERE workspace_id = ${workspaceId} AND segment_id = ${segmentId}
    ORDER BY position ASC
  `;
  return {
    ...segment,
    rules: (ruleRows as { field: SupportedRuleField; operator: string; value: unknown }[]).map((r) => ({
      field: r.field,
      operator: r.operator,
      value: (r.value ?? "") as string | number,
    })),
  };
}

export async function createSegment(input: {
  workspaceId: string;
  name: string;
  description?: string | null;
  matchType?: SegmentMatchType;
  rules: SegmentRule[];
}): Promise<SegmentWithRules> {
  if (input.rules.length === 0) {
    throw new ValidationError("A segment needs at least one rule.");
  }
  if (input.rules.length > 12) {
    throw new ValidationError("A segment can have at most 12 rules in Phase 1.");
  }
  input.rules.forEach(assertRule);

  const rows = await sql()`
    INSERT INTO segments (workspace_id, name, description, match_type)
    VALUES (${input.workspaceId}, ${input.name}, ${input.description ?? null}, ${input.matchType ?? "all"})
    RETURNING *
  `;
  const segment = rows[0] as Segment;

  // No multi-statement transactions over the HTTP driver; rules are inserted
  // one at a time. A partial failure removes the segment so no half-built
  // segment can be evaluated later.
  try {
    let position = 0;
    for (const rule of input.rules) {
      await sql()`
        INSERT INTO segment_rules (segment_id, workspace_id, position, field, operator, value)
        VALUES (
          ${segment.id}, ${input.workspaceId}, ${position++}, ${rule.field}, ${rule.operator},
          ${JSON.stringify(rule.value)}::jsonb
        )
      `;
    }
  } catch (err) {
    await sql()`DELETE FROM segments WHERE id = ${segment.id} AND workspace_id = ${input.workspaceId}`;
    throw err;
  }
  return { ...segment, rules: input.rules };
}

export async function deleteSegment(workspaceId: string, segmentId: string): Promise<boolean> {
  const rows = await sql()`
    DELETE FROM segments WHERE workspace_id = ${workspaceId} AND id = ${segmentId} RETURNING id
  `;
  return rows.length > 0;
}

export interface SegmentEvaluation {
  count: number;
  sample: { id: string; email: string; status: string }[];
  explained: string;
}

function explainRule(rule: SegmentRule): string {
  const op = rule.operator.replace(/_/g, " ");
  return `${rule.field.replace(/_/g, " ")} ${op} ${String(rule.value)}`;
}

/**
 * Deterministic evaluation: the count is a real SQL count of this workspace's
 * subscribers matching the stored rules. `sample` is capped at 10 rows so the
 * user can see WHO matched, not just how many.
 */
export async function evaluateSegment(workspaceId: string, segment: SegmentWithRules): Promise<SegmentEvaluation> {
  const params: unknown[] = [workspaceId];
  const clauses = segment.rules.map((r) => ruleToSql(r, params));
  const joiner = segment.match_type === "any" ? " OR " : " AND ";
  const where = `s.workspace_id = $1 AND (${clauses.map((c) => `(${c})`).join(joiner)})`;

  const totals = await sql().query(`SELECT count(*)::int AS n FROM subscribers s WHERE ${where}`, params);
  const sample = await sql().query(
    `SELECT s.id, s.email::text AS email, s.status FROM subscribers s WHERE ${where}
     ORDER BY s.created_at DESC LIMIT 10`,
    params,
  );
  return {
    count: (totals[0] as { n: number }).n,
    sample: sample as { id: string; email: string; status: string }[],
    explained: `${segment.match_type === "all" ? "Matches all" : "Matches any"} of: ${segment.rules
      .map(explainRule)
      .join(segment.match_type === "any" ? " OR " : " AND ")}`,
  };
}
