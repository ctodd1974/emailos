/**
 * Audiences — hand-curated subscriber groups.
 * Deleting an audience detaches its members but never deletes a subscriber;
 * the confirmation and the result message both say so.
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
  formatDate,
} from "~/components/ui.tsx";
import { ErrorNote, SuccessNote, pluralize } from "~/components/audience/shared.tsx";
import { createAudience, deleteAudience, listAudiences, updateAudience } from "~/server/api/audiences.ts";

interface Audience {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  created_at: string | null;
}

export const Route = createFileRoute("/app/_authenticated/audience/audiences")({
  loader: async ({ context }) => {
    const workspaceId = (context as unknown as { currentWorkspace?: { id: string } })?.currentWorkspace?.id;
    if (!workspaceId) return { workspaceId: null as string | null, audiences: [] as Audience[] };
    const res = await listAudiences({ data: { workspaceId } });
    return { workspaceId, audiences: res.ok ? (res.data.audiences as unknown as Audience[]) : [] };
  },
  component: AudiencesPage,
});

function AudiencesPage() {
  const { workspaceId } = Route.useLoaderData();
  const router = useRouter();
  const [audiences, setAudiences] = useState<Audience[]>(Route.useLoaderData().audiences);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [renaming, setRenaming] = useState<Audience | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameDescription, setRenameDescription] = useState("");

  const [deleting, setDeleting] = useState<Audience | null>(null);

  async function refresh() {
    if (!workspaceId) return;
    const res = await listAudiences({ data: { workspaceId } });
    if (res.ok) setAudiences(res.data.audiences as unknown as Audience[]);
    await router.invalidate();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await createAudience({
        data: { workspaceId, name, description: description || undefined },
      });
      if (!res.ok) {
        setError(res.error.error);
        return;
      }
      setNotice(`Audience “${(res.data.audience as unknown as Audience).name}” created.`);
      setName("");
      setDescription("");
      setCreating(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that audience.");
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
      const res = await updateAudience({
        data: {
          workspaceId,
          audienceId: renaming.id,
          name: renameName,
          description: renameDescription || undefined,
        },
      });
      if (!res.ok) {
        setError(res.error.error);
        return;
      }
      setNotice("Audience updated.");
      setRenaming(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that audience.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!workspaceId || !deleting) return;
    setBusy(true);
    setError(null);
    try {
      const res = await deleteAudience({ data: { workspaceId, audienceId: deleting.id } });
      if (!res.ok) {
        setError(res.error.error);
        return;
      }
      const data = res.data as unknown as { detachedMembers: number; subscribersRemaining: number };
      setNotice(
        `Audience deleted. ${pluralize(data.detachedMembers, "membership")} removed — ${pluralize(
          data.subscribersRemaining,
          "subscriber",
        )} kept in this workspace.`,
      );
      setDeleting(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that audience.");
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
        title="Audiences"
        description="Hand-curated groups you put people into deliberately — unlike segments, which fill themselves from rules."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            + New audience
          </Button>
        }
      />

      {notice ? <SuccessNote message={notice} /> : null}
      <ErrorNote message={error} />

      {audiences.length === 0 ? (
        <EmptyState
          title="No audiences yet"
          description="Audiences are how you separate, for example, buyers from newsletter readers. Create one and then add subscribers from their profile or on import."
          actions={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create your first audience
            </Button>
          }
        />
      ) : (
        <TableShell
          head={
            <tr>
              <th className="px-4 py-2 font-medium">Audience</th>
              <th className="px-4 py-2 font-medium">Members</th>
              <th className="px-4 py-2 font-medium">Created</th>
              <th className="px-4 py-2 font-medium text-right">Actions</th>
            </tr>
          }
        >
          {audiences.map((a) => (
            <tr key={a.id} className="hover:bg-neutral-900/60">
              <td className="px-4 py-3">
                <Link
                  to="/app/audience/subscribers"
                  search={{ audienceId: a.id }}
                  className="font-medium text-neutral-100 hover:text-indigo-300"
                >
                  {a.name}
                </Link>
                {a.description ? <p className="text-xs text-neutral-500">{a.description}</p> : null}
              </td>
              <td className="px-4 py-3 text-neutral-300">
                <Link to="/app/audience/subscribers" search={{ audienceId: a.id }} className="hover:text-indigo-300">
                  {pluralize(a.member_count, "subscriber")}
                </Link>
              </td>
              <td className="px-4 py-3 text-neutral-400">{formatDate(a.created_at)}</td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setRenaming(a);
                      setRenameName(a.name);
                      setRenameDescription(a.description ?? "");
                    }}
                  >
                    Rename
                  </Button>
                  <Button variant="danger" onClick={() => setDeleting(a)}>
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
          Audience membership is independent of status: an unsubscribed contact can still be in an audience, but they
          are never mailable. Membership never changes anyone&apos;s subscription state.
        </p>
      </Card>

      <Modal
        open={creating}
        title="New audience"
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="create-audience-form" disabled={busy}>
              {busy ? "Creating…" : "Create audience"}
            </Button>
          </>
        }
      >
        <form id="create-audience-form" onSubmit={handleCreate} className="space-y-3">
          <Field label="Name (required)">
            <TextInput required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Buyers" />
          </Field>
          <Field label="Description" hint="Optional — what this audience is for.">
            <TextInput value={description} onChange={(e) => setDescription(e.target.value)} />
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
            <Button variant="primary" type="submit" form="rename-audience-form" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <form id="rename-audience-form" onSubmit={handleRename} className="space-y-3">
          <Field label="Name">
            <TextInput required autoFocus value={renameName} onChange={(e) => setRenameName(e.target.value)} />
          </Field>
          <Field label="Description">
            <TextInput value={renameDescription} onChange={(e) => setRenameDescription(e.target.value)} />
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
              {busy ? "Deleting…" : "Delete audience"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-300">
          The audience and its {pluralize(deleting?.member_count ?? 0, "membership")} are removed. The{" "}
          {pluralize(deleting?.member_count ?? 0, "subscriber")} stay in your database with their status, tags and
          history untouched.
        </p>
      </Modal>

      {busy ? <Spinner label="Working…" /> : null}
    </div>
  );
}
