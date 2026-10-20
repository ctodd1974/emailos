/**
 * Segment API — FOUNDATION ONLY.
 *
 * Stored rules are (field, operator, value) triples over fields that exist
 * today: status, source, tag, audience membership, date added. The preview is a
 * real SQL count of the workspace's subscribers, and the response carries a
 * plain-English explanation so nothing about the number is a mystery. Rule
 * fields the engine cannot evaluate are rejected at creation time — the UI
 * only offers what is supported, and the server enforces it.
 */
import { createServerFn } from "@tanstack/react-start";
import { fail, ok } from "~/server/middleware.ts";
import { serializeRow } from "~/server/db/client.ts";
import { requireAudienceContext } from "~/server/audience/guard.ts";
import * as segmentsRepo from "~/server/db/repos/segments.ts";
import * as tagsRepo from "~/server/db/repos/tags.ts";
import * as audiencesRepo from "~/server/db/repos/audiences.ts";
import {
  ValidationError,
  isUniqueViolation,
  optionalDescription,
  requireEntityName,
  requireUuid,
} from "~/server/audience/validation.ts";

/** Human-readable rule descriptions (tag/audience ids resolved to names). */
async function describeRules(
  workspaceId: string,
  rules: segmentsRepo.SegmentRule[],
): Promise<string[]> {
  const [tags, audiences] = await Promise.all([tagsRepo.listTags(workspaceId), audiencesRepo.listAudiences(workspaceId)]);
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const audienceName = new Map(audiences.map((a) => [a.id, a.name]));
  return rules.map((r) => {
    switch (r.field) {
      case "tag":
        return `tagged ${tagName.get(String(r.value)) ?? "(deleted tag)"}` + (r.operator === "not_has" ? " — excluded when tagged" : "");
      case "audience":
        return `${r.operator === "not_member_of" ? "not in" : "in"} audience ${audienceName.get(String(r.value)) ?? "(deleted audience)"}`;
      case "status":
        return `status ${r.operator === "equals" ? "is" : "is not"} ${r.value}`;
      case "source":
        return `source ${r.operator === "equals" ? "is" : "is not"} ${r.value}`;
      case "subscribed_at":
        if (r.operator === "within_days") return `added in the last ${r.value} days`;
        return `added ${r.operator === "after" ? "on or after" : "on or before"} ${String(r.value).slice(0, 10)}`;
      default:
        return `${r.field} ${r.operator} ${String(r.value)}`;
    }
  });
}

function parseRules(input: unknown): segmentsRepo.SegmentRule[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ValidationError("Add at least one rule.");
  }
  return input.map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      field: String(r.field ?? "") as segmentsRepo.SupportedRuleField,
      operator: String(r.operator ?? ""),
      value: (typeof r.value === "number" ? r.value : String(r.value ?? "")) as string | number,
    };
  });
}

export const listSegments = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: unknown; evaluate?: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const segments = await segmentsRepo.listSegments(workspaceId);
      const withRules = await Promise.all(
        segments.map(async (s) => {
          const full = await segmentsRepo.findSegmentById(workspaceId, s.id);
          if (!full) return null;
          const descriptions = await describeRules(workspaceId, full.rules);
          return {
            ...serializeRow({ ...full }),
            rule_count: s.rule_count,
            ruleDescriptions: descriptions,
          };
        }),
      );
      // Counts are only computed when asked for (the list page asks; other
      // pages that just need names don't pay for N evaluations).
      if (data.evaluate !== true) {
        return ok({ segments: withRules.filter(Boolean) });
      }
      const evaluated = await Promise.all(
        withRules.filter(Boolean).map(async (s) => {
          const full = await segmentsRepo.findSegmentById(workspaceId, s!.id as string);
          if (!full) return null;
          const result = await segmentsRepo.evaluateSegment(workspaceId, full);
          return { ...s, count: result.count, sample: result.sample, explained: result.explained };
        }),
      );
      return ok({ segments: evaluated.filter(Boolean) });
    } catch (err) {
      return fail(err);
    }
  });

export const createSegment = createServerFn({ method: "POST" })
  .validator(
    (input: { workspaceId: unknown; name: unknown; description?: unknown; matchType?: unknown; rules: unknown }) =>
      input,
  )
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const name = requireEntityName(data.name, "Segment name");
      const description = optionalDescription(data.description);
      const matchType = data.matchType === "any" ? "any" : "all";
      const rules = parseRules(data.rules);
      let segment;
      try {
        segment = await segmentsRepo.createSegment({ workspaceId, name, description, matchType, rules });
      } catch (err) {
        if (isUniqueViolation(err)) {
          return fail(new ValidationError(`A segment named “${name}” already exists in this workspace.`, 409));
        }
        return fail(err);
      }
      const evaluation = await segmentsRepo.evaluateSegment(workspaceId, segment);
      return ok({
        segment: { ...serializeRow({ ...segment }), ruleDescriptions: await describeRules(workspaceId, rules) },
        count: evaluation.count,
        explained: evaluation.explained,
      });
    } catch (err) {
      return fail(err);
    }
  });

export const previewSegment = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: unknown; segmentId: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const segmentId = requireUuid(data.segmentId, "Segment");
      const segment = await segmentsRepo.findSegmentById(workspaceId, segmentId);
      if (!segment) throw new ValidationError("Segment not found in this workspace.", 404);
      const evaluation = await segmentsRepo.evaluateSegment(workspaceId, segment);
      return ok({
        segment: { ...serializeRow({ ...segment }), ruleDescriptions: await describeRules(workspaceId, segment.rules) },
        count: evaluation.count,
        sample: evaluation.sample,
        explained: evaluation.explained,
      });
    } catch (err) {
      return fail(err);
    }
  });

export const deleteSegment = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: unknown; segmentId: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const segmentId = requireUuid(data.segmentId, "Segment");
      const deleted = await segmentsRepo.deleteSegment(workspaceId, segmentId);
      if (!deleted) throw new ValidationError("Segment not found in this workspace.", 404);
      return ok({ deleted });
    } catch (err) {
      return fail(err);
    }
  });

/** The rule vocabulary the engine actually supports — the UI renders exactly this. */
export const segmentCapabilities = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const [tags, audiences] = await Promise.all([tagsRepo.listTags(workspaceId), audiencesRepo.listAudiences(workspaceId)]);
      return ok({
        fields: [
          {
            field: "tag",
            label: "Tag",
            operators: [
              { value: "has", label: "has tag" },
              { value: "not_has", label: "does not have tag" },
            ],
            valueKind: "tag" as const,
            options: tags.map((t) => ({ value: t.id, label: t.name })),
          },
          {
            field: "audience",
            label: "Audience",
            operators: [
              { value: "member_of", label: "is in audience" },
              { value: "not_member_of", label: "is not in audience" },
            ],
            valueKind: "audience" as const,
            options: audiences.map((a) => ({ value: a.id, label: a.name })),
          },
          {
            field: "status",
            label: "Status",
            operators: [
              { value: "equals", label: "is" },
              { value: "not_equals", label: "is not" },
            ],
            valueKind: "status" as const,
            options: [
              { value: "active", label: "Active" },
              { value: "unsubscribed", label: "Unsubscribed" },
              { value: "suppressed", label: "Suppressed" },
              { value: "bounced", label: "Bounced" },
              { value: "complained", label: "Complained" },
            ],
          },
          {
            field: "source",
            label: "Source",
            operators: [
              { value: "equals", label: "is" },
              { value: "not_equals", label: "is not" },
            ],
            valueKind: "source" as const,
            options: [
              { value: "manual", label: "Manual" },
              { value: "csv", label: "CSV import" },
              { value: "form", label: "Form" },
              { value: "api", label: "API" },
              { value: "import", label: "Import" },
              { value: "test", label: "Test" },
            ],
          },
          {
            field: "subscribed_at",
            label: "Date added",
            operators: [
              { value: "within_days", label: "in the last N days" },
              { value: "after", label: "on or after" },
              { value: "before", label: "on or before" },
            ],
            valueKind: "date" as const,
            options: [],
          },
        ],
        // Honest note for the UI: behavioural fields are deliberately absent.
        notes: "Behavioural fields (engagement, opens, clicks, purchases) arrive in a later slice once real event data exists.",
      });
    } catch (err) {
      return fail(err);
    }
  });
