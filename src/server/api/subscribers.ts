/**
 * Subscriber API (server functions) — list/search/filter, profile, manual add,
 * profile edit, tags, audience membership, status changes, unsubscribe,
 * suppression, CSV import and CSV export.
 *
 * Everything is workspace-scoped and gated by requireAudienceContext. No
 * provider calls happen here (Slice 3 owns Resend); no metrics are invented —
 * every number returned is a real SQL count.
 */
import { createServerFn } from "@tanstack/react-start";
import { fail, ok } from "~/server/middleware.ts";
import { serializeRow } from "~/server/db/client.ts";
import { requireAudienceContext } from "~/server/audience/guard.ts";
import * as subscribersRepo from "~/server/db/repos/subscribers.ts";
import * as audiencesRepo from "~/server/db/repos/audiences.ts";
import * as tagsRepo from "~/server/db/repos/tags.ts";
import * as suppressionsRepo from "~/server/db/repos/suppressions.ts";
import {
  UNMAILABLE_STATUSES,
  ValidationError,
  isUniqueViolation,
  normalizeEmail,
  optionalDescription,
  optionalFirstName,
  optionalLastName,
  optionalUuid,
  requireEmail,
  requireSource,
  requireStatus,
  requireUuid,
} from "~/server/audience/validation.ts";
import { detectColumnMapping, looksLikeHeader, parseCsv, positionalMapping, toCsv } from "~/server/audience/csv.ts";

// ---------------------------------------------------------------------------
// Serialization helpers — Dates must never reach the React tree (see
// src/server/db/client.ts serializeRow).
// ---------------------------------------------------------------------------
function serializeSubscriber<T extends Record<string, unknown>>(row: T) {
  const s = serializeRow({ ...row });
  const status = String(s.status);
  return {
    ...s,
    statusLabel: statusLabel(status),
    mailable: !(UNMAILABLE_STATUSES as readonly string[]).includes(status),
  };
}

export function statusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "unsubscribed":
      return "Unsubscribed";
    case "suppressed":
      return "Suppressed";
    case "bounced":
      return "Bounced";
    case "complained":
      return "Complained";
    default:
      return status;
  }
}

function serializeRows(rows: Record<string, unknown>[]) {
  return rows.map((r) => serializeSubscriber(r));
}

// ---------------------------------------------------------------------------
// Forensics-free errors: duplicate email is a normal, expected outcome.
// ---------------------------------------------------------------------------
function friendlyUniqueError(err: unknown, email: string): Error {
  if (isUniqueViolation(err)) {
    return new ValidationError(`${email} is already a subscriber in this workspace.`, 409);
  }
  return err instanceof Error ? err : new Error(String(err));
}

// ---------------------------------------------------------------------------
// List / search / filter
// ---------------------------------------------------------------------------
export const listSubscribers = createServerFn({ method: "GET" })
  .validator(
    (input: {
      workspaceId: unknown;
      q?: unknown;
      status?: unknown;
      source?: unknown;
      tagId?: unknown;
      audienceId?: unknown;
      page?: unknown;
      pageSize?: unknown;
    }) => input,
  )
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const page = Math.max(1, Number(data.page ?? 1) || 1);
      const pageSize = Math.min(Math.max(Number(data.pageSize ?? 25) || 25, 5), 200);
      const status = typeof data.status === "string" && data.status !== "" ? requireStatus(data.status) : null;
      const source = typeof data.source === "string" && data.source !== "" ? requireSource(data.source) : null;
      const result = await subscribersRepo.listSubscribers(
        workspaceId,
        {
          q: typeof data.q === "string" ? data.q : null,
          status,
          source,
          tagId: optionalUuid(data.tagId, "Tag"),
          audienceId: optionalUuid(data.audienceId, "Audience"),
        },
        { limit: pageSize, offset: (page - 1) * pageSize },
      );
      const counts = await subscribersRepo.statusCounts(workspaceId);
      return ok({
        rows: serializeRows(result.rows as unknown as Record<string, unknown>[]),
        total: result.total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
        counts,
      });
    } catch (err) {
      return fail(err);
    }
  });

/** Filter dropdown data + workspace audience stats (single round trip). */
export const audienceOverview = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const [counts, tags, audiences, sources, suppressionCount] = await Promise.all([
        subscribersRepo.statusCounts(workspaceId),
        tagsRepo.listTags(workspaceId),
        audiencesRepo.listAudiences(workspaceId),
        subscribersRepo.distinctSources(workspaceId),
        suppressionsRepo.countSuppressions(workspaceId),
      ]);
      return ok({
        counts,
        suppressionCount,
        sources,
        tags: tags.map((t) => serializeRow({ ...t })),
        audiences: audiences.map((a) => serializeRow({ ...a })),
      });
    } catch (err) {
      return fail(err);
    }
  });

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export const getSubscriber = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: unknown; subscriberId: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const subscriberId = requireUuid(data.subscriberId, "Subscriber");
      const subscriber = await subscribersRepo.findSubscriberWithRelations(workspaceId, subscriberId);
      if (!subscriber) throw new ValidationError("Subscriber not found in this workspace.", 404);
      const suppression = await suppressionsRepo.findSuppressionForSubscriber(workspaceId, subscriberId);
      return ok({
        subscriber: serializeSubscriber(subscriber as unknown as Record<string, unknown>),
        suppression: suppression ? serializeRow({ ...suppression }) : null,
      });
    } catch (err) {
      return fail(err);
    }
  });

// ---------------------------------------------------------------------------
// Manual add
// ---------------------------------------------------------------------------
export const createSubscriber = createServerFn({ method: "POST" })
  .validator(
    (input: {
      workspaceId: unknown;
      email: unknown;
      firstName?: unknown;
      lastName?: unknown;
      tagIds?: unknown;
      audienceId?: unknown;
    }) => input,
  )
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const email = requireEmail(data.email);
      const firstName = optionalFirstName(data.firstName);
      const lastName = optionalLastName(data.lastName);
      const tagIds = Array.isArray(data.tagIds) ? data.tagIds.map((t) => requireUuid(t, "Tag")) : [];
      const audienceId = optionalUuid(data.audienceId, "Audience");

      if (await subscribersRepo.findSubscriberByEmail(workspaceId, email)) {
        return fail(new ValidationError(`${email} is already a subscriber in this workspace.`, 409));
      }

      let created;
      try {
        created = await subscribersRepo.createSubscriber({
          workspaceId,
          email,
          firstName,
          lastName,
          source: "manual",
          sourceDetail: "Added manually in the EmailOS app",
        });
      } catch (err) {
        // Unique index is the authority; the pre-check above is only UX.
        return fail(friendlyUniqueError(err, email));
      }

      // Tag / audience targets are validated against THIS workspace before use.
      const attachedTags: string[] = [];
      for (const tagId of tagIds) {
        const tag = await tagsRepo.findTagById(workspaceId, tagId);
        if (!tag) throw new ValidationError("That tag does not exist in this workspace.");
        await tagsRepo.attachTag(workspaceId, created.id, tagId);
        attachedTags.push(tag.name);
      }
      let audienceName: string | null = null;
      if (audienceId) {
        const audience = await audiencesRepo.findAudienceById(workspaceId, audienceId);
        if (!audience) throw new ValidationError("That audience does not exist in this workspace.");
        await audiencesRepo.addMembership(workspaceId, audienceId, created.id);
        audienceName = audience.name;
      }

      const fresh = await subscribersRepo.findSubscriberWithRelations(workspaceId, created.id);
      return ok({
        subscriber: serializeSubscriber(fresh as unknown as Record<string, unknown>),
        appliedTags: attachedTags,
        appliedAudience: audienceName,
      });
    } catch (err) {
      return fail(err);
    }
  });

export const updateSubscriber = createServerFn({ method: "POST" })
  .validator(
    (input: {
      workspaceId: unknown;
      subscriberId: unknown;
      firstName?: unknown;
      lastName?: unknown;
      customFieldsJson?: unknown;
    }) => input,
  )
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const subscriberId = requireUuid(data.subscriberId, "Subscriber");
      let customFields: Record<string, unknown> | undefined;
      if (typeof data.customFieldsJson === "string" && data.customFieldsJson.trim() !== "") {
        try {
          const parsed = JSON.parse(data.customFieldsJson);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("not an object");
          }
          customFields = parsed as Record<string, unknown>;
        } catch {
          throw new ValidationError("Custom fields must be a JSON object, e.g. {\"plan\":\"pro\"}.");
        }
      }
      const updated = await subscribersRepo.updateSubscriber(workspaceId, subscriberId, {
        firstName: data.firstName === undefined ? undefined : optionalFirstName(data.firstName),
        lastName: data.lastName === undefined ? undefined : optionalLastName(data.lastName),
        customFields,
      });
      if (!updated) throw new ValidationError("Subscriber not found in this workspace.", 404);
      return ok({ subscriber: serializeSubscriber(updated as unknown as Record<string, unknown>) });
    } catch (err) {
      return fail(err);
    }
  });

// ---------------------------------------------------------------------------
// Status / suppression state model
// ---------------------------------------------------------------------------
export const setSubscriberStatus = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: unknown; subscriberId: unknown; status: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const subscriberId = requireUuid(data.subscriberId, "Subscriber");
      const status = requireStatus(data.status);
      const subscriber = await subscribersRepo.findSubscriber(workspaceId, subscriberId);
      if (!subscriber) throw new ValidationError("Subscriber not found in this workspace.", 404);

      await subscribersRepo.setStatus(workspaceId, subscriberId, status);

      // Moving into an unmailable state also records a suppression row so the
      // send pipeline has one place to check (proposal §4.5). Moving back to
      // `active` deliberately does NOT delete that record — removing a
      // suppression is an explicit compliance action, so the API says so.
      let warning: string | null = null;
      if (status === "unsubscribed") {
        await suppressionsRepo.upsertSuppression({
          workspaceId,
          email: subscriber.email,
          reason: "unsubscribe",
          subscriberId,
        });
      } else if (status === "suppressed") {
        await suppressionsRepo.upsertSuppression({
          workspaceId,
          email: subscriber.email,
          reason: "manual",
          subscriberId,
        });
      } else if (status === "bounced") {
        await suppressionsRepo.upsertSuppression({
          workspaceId,
          email: subscriber.email,
          reason: "bounce",
          subscriberId,
        });
      } else if (status === "complained") {
        await suppressionsRepo.upsertSuppression({
          workspaceId,
          email: subscriber.email,
          reason: "complaint",
          subscriberId,
        });
      } else if (status === "active") {
        const existing = await suppressionsRepo.findSuppressionForSubscriber(workspaceId, subscriberId);
        if (existing) {
          warning = `Status set to active, but this subscriber still has a suppression record (reason: ${existing.reason}). They stay unmailAble until that record is explicitly removed.`;
        }
      }

      const fresh = await subscribersRepo.findSubscriberWithRelations(workspaceId, subscriberId);
      const suppression = await suppressionsRepo.findSuppressionForSubscriber(workspaceId, subscriberId);
      return ok({
        subscriber: serializeSubscriber(fresh as unknown as Record<string, unknown>),
        suppression: suppression ? serializeRow({ ...suppression }) : null,
        warning,
      });
    } catch (err) {
      return fail(err);
    }
  });

export const unsubscribeSubscriber = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: unknown; subscriberId: unknown; detail?: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const subscriberId = requireUuid(data.subscriberId, "Subscriber");
      const subscriber = await subscribersRepo.findSubscriber(workspaceId, subscriberId);
      if (!subscriber) throw new ValidationError("Subscriber not found in this workspace.", 404);
      await subscribersRepo.setStatus(workspaceId, subscriberId, "unsubscribed");
      const suppression = await suppressionsRepo.upsertSuppression({
        workspaceId,
        email: subscriber.email,
        reason: "unsubscribe",
        subscriberId,
      });
      const fresh = await subscribersRepo.findSubscriberWithRelations(workspaceId, subscriberId);
      return ok({
        subscriber: serializeSubscriber(fresh as unknown as Record<string, unknown>),
        suppression: serializeRow({ ...suppression }),
        detail: optionalDescription(data.detail),
      });
    } catch (err) {
      return fail(err);
    }
  });

export const suppressSubscriber = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: unknown; subscriberId: unknown; detail?: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const subscriberId = requireUuid(data.subscriberId, "Subscriber");
      const subscriber = await subscribersRepo.findSubscriber(workspaceId, subscriberId);
      if (!subscriber) throw new ValidationError("Subscriber not found in this workspace.", 404);
      await subscribersRepo.setStatus(workspaceId, subscriberId, "suppressed");
      const suppression = await suppressionsRepo.upsertSuppression({
        workspaceId,
        email: subscriber.email,
        reason: "manual",
        subscriberId,
      });
      const fresh = await subscribersRepo.findSubscriberWithRelations(workspaceId, subscriberId);
      return ok({
        subscriber: serializeSubscriber(fresh as unknown as Record<string, unknown>),
        suppression: serializeRow({ ...suppression }),
        detail: optionalDescription(data.detail),
      });
    } catch (err) {
      return fail(err);
    }
  });

// ---------------------------------------------------------------------------
// Tags + audience membership on one subscriber
// ---------------------------------------------------------------------------
export const addSubscriberTag = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: unknown; subscriberId: unknown; tagId: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const subscriberId = requireUuid(data.subscriberId, "Subscriber");
      const tagId = requireUuid(data.tagId, "Tag");
      const subscriber = await subscribersRepo.findSubscriber(workspaceId, subscriberId);
      if (!subscriber) throw new ValidationError("Subscriber not found in this workspace.", 404);
      const tag = await tagsRepo.findTagById(workspaceId, tagId);
      if (!tag) throw new ValidationError("That tag does not exist in this workspace.", 404);
      await tagsRepo.attachTag(workspaceId, subscriberId, tagId);
      const fresh = await subscribersRepo.findSubscriberWithRelations(workspaceId, subscriberId);
      return ok({ subscriber: serializeSubscriber(fresh as unknown as Record<string, unknown>) });
    } catch (err) {
      return fail(err);
    }
  });

export const removeSubscriberTag = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: unknown; subscriberId: unknown; tagId: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const subscriberId = requireUuid(data.subscriberId, "Subscriber");
      const tagId = requireUuid(data.tagId, "Tag");
      await tagsRepo.detachTag(workspaceId, subscriberId, tagId);
      const fresh = await subscribersRepo.findSubscriberWithRelations(workspaceId, subscriberId);
      if (!fresh) throw new ValidationError("Subscriber not found in this workspace.", 404);
      return ok({ subscriber: serializeSubscriber(fresh as unknown as Record<string, unknown>) });
    } catch (err) {
      return fail(err);
    }
  });

export const addSubscriberAudience = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: unknown; subscriberId: unknown; audienceId: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const subscriberId = requireUuid(data.subscriberId, "Subscriber");
      const audienceId = requireUuid(data.audienceId, "Audience");
      const subscriber = await subscribersRepo.findSubscriber(workspaceId, subscriberId);
      if (!subscriber) throw new ValidationError("Subscriber not found in this workspace.", 404);
      const audience = await audiencesRepo.findAudienceById(workspaceId, audienceId);
      if (!audience) throw new ValidationError("That audience does not exist in this workspace.", 404);
      await audiencesRepo.addMembership(workspaceId, audienceId, subscriberId);
      const fresh = await subscribersRepo.findSubscriberWithRelations(workspaceId, subscriberId);
      return ok({ subscriber: serializeSubscriber(fresh as unknown as Record<string, unknown>) });
    } catch (err) {
      return fail(err);
    }
  });

export const removeSubscriberAudience = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: unknown; subscriberId: unknown; audienceId: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const subscriberId = requireUuid(data.subscriberId, "Subscriber");
      const audienceId = requireUuid(data.audienceId, "Audience");
      await audiencesRepo.removeMembership(workspaceId, audienceId, subscriberId);
      const fresh = await subscribersRepo.findSubscriberWithRelations(workspaceId, subscriberId);
      if (!fresh) throw new ValidationError("Subscriber not found in this workspace.", 404);
      return ok({ subscriber: serializeSubscriber(fresh as unknown as Record<string, unknown>) });
    } catch (err) {
      return fail(err);
    }
  });

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------
export interface ImportRowFailure {
  row: number;
  email: string;
  reason: string;
}
export interface ImportSummary {
  fileName: string | null;
  delimiter: string;
  columns: string[];
  hasHeader: boolean;
  mapping: { email: number | null; firstName: number | null; lastName: number | null; name: number | null };
  totalRows: number;
  imported: number;
  skippedDuplicate: number;
  failed: number;
  duplicates: { row: number; email: string }[];
  failures: ImportRowFailure[];
  appliedTag: string | null;
  appliedAudience: string | null;
  importedSample: string[];
}

const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_BYTES = 3_000_000;

export const importSubscribersCsv = createServerFn({ method: "POST" })
  .validator(
    (input: {
      workspaceId: unknown;
      csvText: unknown;
      fileName?: unknown;
      hasHeader?: unknown;
      mapping?: unknown;
      tagId?: unknown;
      audienceId?: unknown;
    }) => input,
  )
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      if (typeof data.csvText !== "string" || data.csvText.trim() === "") {
        throw new ValidationError("Choose a CSV file that contains at least one row.");
      }
      if (data.csvText.length > MAX_IMPORT_BYTES) {
        throw new ValidationError("That file is too large for Phase 1 imports (3 MB limit).");
      }

      // Optional destinations, validated against THIS workspace up front so a
      // failure can't leave half the file imported against a foreign id.
      const tagId = optionalUuid(data.tagId, "Tag");
      const audienceId = optionalUuid(data.audienceId, "Audience");
      const tag = tagId ? await tagsRepo.findTagById(workspaceId, tagId) : null;
      if (tagId && !tag) throw new ValidationError("That tag does not exist in this workspace.");
      const audience = audienceId ? await audiencesRepo.findAudienceById(workspaceId, audienceId) : null;
      if (audienceId && !audience) throw new ValidationError("That audience does not exist in this workspace.");

      const parsed = parseCsv(data.csvText);
      if (parsed.rows.length === 0) throw new ValidationError("That file has no data rows.");
      const firstRow = parsed.rows[0];
      const hasHeader = typeof data.hasHeader === "boolean" ? data.hasHeader : looksLikeHeader(firstRow);
      const columns = hasHeader ? firstRow.map((c) => c.trim()) : firstRow.map((_, i) => `Column ${i + 1}`);

      // Explicit mapping from the UI wins; otherwise auto-detect.
      let mapping = hasHeader ? detectColumnMapping(firstRow) : positionalMapping(firstRow.length);
      if (data.mapping && typeof data.mapping === "object") {
        const m = data.mapping as Record<string, unknown>;
        const asIndex = (v: unknown): number | null => {
          if (v === null || v === undefined || v === "") return null;
          const n = Number(v);
          return Number.isInteger(n) && n >= 0 && n < firstRow.length ? n : null;
        };
        mapping = {
          email: asIndex(m.email),
          firstName: asIndex(m.firstName),
          lastName: asIndex(m.lastName),
          name: asIndex(m.name),
        };
      }
      if (mapping.email === null) {
        throw new ValidationError("Map a column to Email before importing.");
      }

      const dataRows = hasHeader ? parsed.rows.slice(1) : parsed.rows;
      if (dataRows.length > MAX_IMPORT_ROWS) {
        throw new ValidationError(`That file has ${dataRows.length} rows; Phase 1 imports are limited to ${MAX_IMPORT_ROWS}.`);
      }

      const summary: ImportSummary = {
        fileName: typeof data.fileName === "string" && data.fileName.trim() !== "" ? data.fileName.trim() : null,
        delimiter: parsed.delimiter,
        columns,
        hasHeader,
        mapping,
        totalRows: dataRows.length,
        imported: 0,
        skippedDuplicate: 0,
        failed: 0,
        duplicates: [],
        failures: [],
        appliedTag: tag?.name ?? null,
        appliedAudience: audience?.name ?? null,
        importedSample: [],
      };

      // Pre-load existing emails for this workspace in one query; the unique
      // index remains the final authority (and its violation is reported as a
      // duplicate, never as a crash).
      const candidateEmails: string[] = [];
      const parsedRows: { rowNumber: number; email: string | null; rawEmail: string; firstName: string | null; lastName: string | null }[] = [];
      dataRows.forEach((cells, i) => {
        const rowNumber = i + (hasHeader ? 2 : 1); // 1-based file row number, header counted
        const rawEmail = (cells[mapping.email!] ?? "").trim();
        const email = normalizeEmail(rawEmail);
        let firstName = mapping.firstName !== null ? (cells[mapping.firstName] ?? "").trim() : "";
        let lastName = mapping.lastName !== null ? (cells[mapping.lastName] ?? "").trim() : "";
        if (mapping.name !== null && (mapping.firstName === null || mapping.lastName === null)) {
          const full = (cells[mapping.name] ?? "").trim();
          if (full !== "") {
            const [first, ...rest] = full.split(/\s+/);
            if (mapping.firstName === null) firstName = first;
            if (mapping.lastName === null) lastName = rest.join(" ");
          }
        }
        if (email) candidateEmails.push(email);
        parsedRows.push({
          rowNumber,
          email,
          rawEmail,
          firstName: firstName || null,
          lastName: lastName || null,
        });
      });

      const existing = await subscribersRepo.existingEmails(workspaceId, candidateEmails);
      const seenInFile = new Set<string>();

      for (const row of parsedRows) {
        if (!row.email) {
          summary.failed++;
          if (summary.failures.length < 50) {
            summary.failures.push({
              row: row.rowNumber,
              email: row.rawEmail,
              reason: row.rawEmail === "" ? "Missing email" : "Not a valid email address",
            });
          }
          continue;
        }
        if (existing.has(row.email) || seenInFile.has(row.email)) {
          summary.skippedDuplicate++;
          if (summary.duplicates.length < 50) summary.duplicates.push({ row: row.rowNumber, email: row.email });
          continue;
        }
        try {
          const created = await subscribersRepo.createSubscriber({
            workspaceId,
            email: row.email,
            firstName: row.firstName,
            lastName: row.lastName,
            source: "csv",
            sourceDetail: summary.fileName ?? "CSV import",
            consentMetadata: { imported_from: summary.fileName ?? "csv", imported_at: new Date().toISOString() },
          });
          seenInFile.add(row.email);
          if (tagId) await tagsRepo.attachTag(workspaceId, created.id, tagId);
          if (audienceId) await audiencesRepo.addMembership(workspaceId, audienceId, created.id);
          summary.imported++;
          if (summary.importedSample.length < 10) summary.importedSample.push(row.email);
        } catch (err) {
          if (isUniqueViolation(err)) {
            summary.skippedDuplicate++;
            if (summary.duplicates.length < 50) summary.duplicates.push({ row: row.rowNumber, email: row.email });
          } else {
            summary.failed++;
            if (summary.failures.length < 50) {
              summary.failures.push({ row: row.rowNumber, email: row.email, reason: "Database error while inserting" });
            }
          }
        }
      }
      return ok(summary);
    } catch (err) {
      return fail(err);
    }
  });

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------
export const exportSubscribersCsv = createServerFn({ method: "POST" })
  .validator(
    (input: {
      workspaceId: unknown;
      q?: unknown;
      status?: unknown;
      source?: unknown;
      tagId?: unknown;
      audienceId?: unknown;
    }) => input,
  )
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const rows = await subscribersRepo.listForExport(workspaceId, {
        q: typeof data.q === "string" ? data.q : null,
        status: typeof data.status === "string" && data.status !== "" ? requireStatus(data.status) : null,
        source: typeof data.source === "string" && data.source !== "" ? requireSource(data.source) : null,
        tagId: optionalUuid(data.tagId, "Tag"),
        audienceId: optionalUuid(data.audienceId, "Audience"),
      });
      const csv = toCsv(
        [
          "email",
          "first_name",
          "last_name",
          "status",
          "source",
          "source_detail",
          "tags",
          "audiences",
          "subscribed_at",
          "engaged_at",
          "created_at",
          "updated_at",
        ],
        rows.map((r) => {
          const tags = (r.tags as { name: string }[] | null) ?? [];
          const audiences = (r.audiences as { name: string }[] | null) ?? [];
          return {
            email: r.email,
            first_name: r.first_name,
            last_name: r.last_name,
            status: r.status,
            source: r.source,
            source_detail: r.source_detail,
            tags: tags.map((t) => t.name).join("; "),
            audiences: audiences.map((a) => a.name).join("; "),
            subscribed_at: r.subscribed_at,
            engaged_at: r.engaged_at ?? "",
            created_at: r.created_at,
            updated_at: r.updated_at,
          };
        }),
      );
      return ok({ filename: `emailos-subscribers-${new Date().toISOString().slice(0, 10)}.csv`, csv, rowCount: rows.length });
    } catch (err) {
      return fail(err);
    }
  });
