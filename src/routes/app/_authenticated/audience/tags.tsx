/**
 * Tags — reusable labels across the workspace.
 * Deleting a tag only detaches it; subscribers are never deleted.
 */
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Spinner,
  TableShell,
  TextInput,
} from "~/components/ui.tsx";
import { ErrorNote, SuccessNote, TagPill, pluralize } from "~/components/audience/shared.tsx";
import { createTag, deleteTag, listTags, renameTag } from "~/server/api/tags.ts";

interface Tag {
  id: string;
  name: string;
  color: string | null;
  subscriber_count: number;
}

export const Route = createFileRoute("/app/_authenticated/audience/tags")({
  loader: async ({ context }) => {
    const workspaceId = (context as unknown as { currentWorkspace?: { id: string } })?.currentWorkspace?.id;
    if (!workspaceId) return { workspaceId: null as string | null, tags: [] as Tag[] };
    const res = await listTags({ data: { workspaceId } });
    return { workspaceId, tags: res.ok ? (res.data.tags as unknown as Tag[]) : [] };
  },
  component: TagsPage,
});

function TagsPage() {
  const { workspaceId, tags: initialTags } = Route.useLoaderData();
  const router = useRouter();
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");

  const [renaming, setRenaming] = useState<Tag | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleting, setDeleting] = useState<Tag | null>(null);

  async function refresh() {
    if (!workspaceId) return;
    const res = await listTags({ data: { workspaceId } });
    if (res.ok) setTags(res.data.tags as unknown as Tag[]);
    await router.invalidate();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await createTag({ data: { workspaceId, name, color } });
      if (!res.ok) {
        setError(res.error.error);
        return;
      }
      setNotice(`Tag “${(res.data.tag as unknown as Tag).name}” created.`);
      setName("");
      setCreating(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that tag.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !renaming) return;
    setBusy(true);
    setError(null);
    try {
      const res = await renameTag({ data: { workspaceId, tagId: renaming.id, name: renameName } });
      if (!res.ok) {
        setError(res.error.error);
        return;
      }
      setNotice("Tag renamed.");
      setRenaming(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename that tag.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!workspaceId || !deleting) return;
    setBusy(true);
    setError(null);
    try {
      const res = await deleteTag({ data: { workspaceId, tagId: deleting.id } });
      if (!res.ok) {
        setError(res.error.error);
        return;
      }
      const data = res.data as unknown as { detachedSubscribers: number };
      setNotice(
        `Tag deleted. It was detached from ${pluralize(data.detachedSubscribers, "subscriber")} — no subscriber was removed.`,
      );
      setDeleting(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that tag.");
    } finally {
      setBusy(false);
    }
  }

  if (!workspaceId) {
    return <EmptyState title="No workspace selected" description="Pick a workspace from the switcher above." />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tags"
        description="Free-form labels for filtering and segments. A tag can be attached to any subscriber in this workspace."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            + New tag
          </Button>
        }
      />

      {notice ? <SuccessNote message={notice} /> : null}
      <ErrorNote message={error} />

      {tags.length === 0 ? (
        <EmptyState
          title="No tags yet"
          description="Tags let you slice the audience by what you know about people — interests, product, source campaign. Create one to start labelling."
          actions={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create your first tag
            </Button>
          }
        />
      ) : (
        <TableShell
          head={
            <tr>
              <th className="px-4 py-2 font-medium">Tag</th>
              <th className="px-4 py-2 font-medium">Tagged subscribers</th>
              <th className="px-4 py-2 font-medium text-right">Actions</th>
            </tr>
          }
        >
          {tags.map((t) => (
            <tr key={t.id} className="hover:bg-neutral-900/60">
              <td className="px-4 py-3">
                <TagPill tag={t} />
              </td>
              <td className="px-4 py-3 text-neutral-300">
                {t.subscriber_count === 0 ? (
                  <span className="text-neutral-600">Not used yet</span>
                ) : (
                  <Link to="/app/audience/subscribers" search={{ tagId: t.id }} className="hover:text-indigo-300">
                    {pluralize(t.subscriber_count, "subscriber")}
                  </Link>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setRenaming(t);
                      setRenameName(t.name);
                    }}
                  >
                    Rename
                  </Button>
                  <Button variant="danger" onClick={() => setDeleting(t)}>
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <Card className="p-4">
        <p className="text-xs text-neutral-500">
          Tags are workspace-scoped: a tag created in this workspace is invisible to every other workspace.
        </p>
      </Card>

      <Modal
        open={creating}
        title="New tag"
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="create-tag-form" disabled={busy}>
              {busy ? "Creating…" : "Create tag"}
            </Button>
          </>
        }
      >
        <form id="create-tag-form" onSubmit={handleCreate} className="space-y-3">
          <Field label="Name (required)">
            <TextInput required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="buyer" />
          </Field>
          <Field label="Colour" hint="Optional — used for the tag dot in lists.">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-20 rounded-lg border border-neutral-700 bg-neutral-900 p-1"
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={renaming !== null}
        title={`Rename “${renaming?.name ?? ""}”`}
        onClose={() => setRenaming(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="rename-tag-form" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <form id="rename-tag-form" onSubmit={handleRename} className="space-y-3">
          <Field label="Name">
            <TextInput required autoFocus value={renameName} onChange={(e) => setRenameName(e.target.value)} />
          </Field>
        </form>
      </Modal>

      <Modal
        open={deleting !== null}
        title={`Delete “${deleting?.name ?? ""}”?`}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy} onClick={handleDelete}>
              {busy ? "Deleting…" : "Delete tag"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-300">
          The tag is detached from {pluralize(deleting?.subscriber_count ?? 0, "subscriber")}. Subscribers keep their
          status, audiences and history — only the label goes away.
        </p>
      </Modal>

      {busy ? <Spinner label="Working…" /> : null}
    </div>
  );
}
