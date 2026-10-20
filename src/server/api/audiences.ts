/**
 * Audience (list) API — CRUD over hand-curated subscriber groups.
 * Deleting an audience never deletes subscribers (see repos/audiences.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { fail, ok } from "~/server/middleware.ts";
import { serializeRow } from "~/server/db/client.ts";
import { requireAudienceContext } from "~/server/audience/guard.ts";
import * as audiencesRepo from "~/server/db/repos/audiences.ts";
import * as subscribersRepo from "~/server/db/repos/subscribers.ts";
import {
  ValidationError,
  isUniqueViolation,
  optionalDescription,
  requireEntityName,
  requireUuid,
} from "~/server/audience/validation.ts";

function friendlyNameError(err: unknown, name: string): Error {
  if (isUniqueViolation(err)) {
    return new ValidationError(`An audience named “${name}” already exists in this workspace.`, 409);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export const listAudiences = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const audiences = await audiencesRepo.listAudiences(workspaceId);
      return ok({ audiences: audiences.map((a) => serializeRow({ ...a })) });
    } catch (err) {
      return fail(err);
    }
  });

export const createAudience = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: unknown; name: unknown; description?: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const name = requireEntityName(data.name, "Audience name");
      const description = optionalDescription(data.description);
      try {
        const audience = await audiencesRepo.createAudience(workspaceId, name, description);
        return ok({ audience: serializeRow({ ...audience }) });
      } catch (err) {
        return fail(friendlyNameError(err, name));
      }
    } catch (err) {
      return fail(err);
    }
  });

export const updateAudience = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: unknown; audienceId: unknown; name: unknown; description?: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const audienceId = requireUuid(data.audienceId, "Audience");
      const name = requireEntityName(data.name, "Audience name");
      const description = optionalDescription(data.description);
      try {
        const audience = await audiencesRepo.updateAudience(workspaceId, audienceId, { name, description });
        if (!audience) throw new ValidationError("Audience not found in this workspace.", 404);
        return ok({ audience: serializeRow({ ...audience }) });
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        return fail(friendlyNameError(err, name));
      }
    } catch (err) {
      return fail(err);
    }
  });

export const deleteAudience = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: unknown; audienceId: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const audienceId = requireUuid(data.audienceId, "Audience");
      const memberCount = await audiencesRepo.countMembers(workspaceId, audienceId);
      const deleted = await audiencesRepo.deleteAudience(workspaceId, audienceId);
      if (!deleted) throw new ValidationError("Audience not found in this workspace.", 404);
      // Subscribers are untouched — say so explicitly so the UI can reassure.
      const remaining = await subscribersRepo.statusCounts(workspaceId);
      return ok({ deleted: true, detachedMembers: memberCount, subscribersRemaining: remaining.total });
    } catch (err) {
      return fail(err);
    }
  });

export const listAudienceMembers = createServerFn({ method: "GET" })
  .validator(
    (input: { workspaceId: unknown; audienceId: unknown; page?: unknown; pageSize?: unknown }) => input,
  )
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const audienceId = requireUuid(data.audienceId, "Audience");
      const audience = await audiencesRepo.findAudienceById(workspaceId, audienceId);
      if (!audience) throw new ValidationError("Audience not found in this workspace.", 404);
      const page = Math.max(1, Number(data.page ?? 1) || 1);
      const pageSize = Math.min(Math.max(Number(data.pageSize ?? 25) || 25, 5), 200);
      const [members, total] = await Promise.all([
        audiencesRepo.listMembers(workspaceId, audienceId, { limit: pageSize, offset: (page - 1) * pageSize }),
        audiencesRepo.countMembers(workspaceId, audienceId),
      ]);
      return ok({
        audience: serializeRow({ ...audience }),
        members: members.map((m) => serializeRow({ ...m })),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (err) {
      return fail(err);
    }
  });
