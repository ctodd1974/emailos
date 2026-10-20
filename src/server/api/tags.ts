/**
 * Tag API — CRUD over workspace tags. Deleting a tag detaches it from
 * subscribers but never deletes a subscriber.
 */
import { createServerFn } from "@tanstack/react-start";
import { fail, ok } from "~/server/middleware.ts";
import { serializeRow } from "~/server/db/client.ts";
import { requireAudienceContext } from "~/server/audience/guard.ts";
import * as tagsRepo from "~/server/db/repos/tags.ts";
import { ValidationError, isUniqueViolation, requireEntityName, requireUuid } from "~/server/audience/validation.ts";

function friendlyTagError(err: unknown, name: string): Error {
  if (isUniqueViolation(err)) {
    return new ValidationError(`A tag named “${name}” already exists in this workspace.`, 409);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export const listTags = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const tags = await tagsRepo.listTags(workspaceId);
      return ok({ tags: tags.map((t) => serializeRow({ ...t })) });
    } catch (err) {
      return fail(err);
    }
  });

export const createTag = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: unknown; name: unknown; color?: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const name = requireEntityName(data.name, "Tag name");
      const color = typeof data.color === "string" && /^#[0-9a-fA-F]{6}$/.test(data.color) ? data.color : null;
      try {
        const tag = await tagsRepo.createTag(workspaceId, name, color);
        return ok({ tag: serializeRow({ ...tag }) });
      } catch (err) {
        return fail(friendlyTagError(err, name));
      }
    } catch (err) {
      return fail(err);
    }
  });

export const renameTag = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: unknown; tagId: unknown; name: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const tagId = requireUuid(data.tagId, "Tag");
      const name = requireEntityName(data.name, "Tag name");
      try {
        const tag = await tagsRepo.renameTag(workspaceId, tagId, name);
        if (!tag) throw new ValidationError("Tag not found in this workspace.", 404);
        return ok({ tag: serializeRow({ ...tag }) });
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        return fail(friendlyTagError(err, name));
      }
    } catch (err) {
      return fail(err);
    }
  });

export const deleteTag = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: unknown; tagId: unknown }) => input)
  .handler(async ({ data }) => {
    try {
      const { workspaceId } = await requireAudienceContext(data.workspaceId);
      const tagId = requireUuid(data.tagId, "Tag");
      const existing = await tagsRepo.findTagById(workspaceId, tagId);
      if (!existing) throw new ValidationError("Tag not found in this workspace.", 404);
      const withCount = (await tagsRepo.listTags(workspaceId)).find((t) => t.id === tagId);
      const deleted = await tagsRepo.deleteTag(workspaceId, tagId);
      return ok({ deleted, detachedSubscribers: withCount?.subscriber_count ?? 0 });
    } catch (err) {
      return fail(err);
    }
  });
