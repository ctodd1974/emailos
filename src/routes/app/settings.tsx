import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { getSettings, updateWorkspaceSettings } from "~/server/api/app.ts";

export const Route = createFileRoute("/app/settings")({
  loader: async ({ context }) => {
    const ctx = context as unknown as { currentWorkspace?: { id: string } };
    const workspaceId = ctx?.currentWorkspace?.id;
    if (!workspaceId) {
      return { workspace: null, role: "member", providerStatus: "not_configured" as const };
    }
    const res = await getSettings({ data: { workspaceId } });
    if (res.ok) return res.data;
    return { workspace: null, role: "member", providerStatus: "not_configured" as const };
  },
  component: Settings,
});

function Settings() {
  const data = Route.useLoaderData();
  const workspace = data.workspace;

  const [name, setName] = useState(workspace?.name ?? "");
  const [slug, setSlug] = useState(workspace?.slug ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!workspace) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await updateWorkspaceSettings({ data: { workspaceId: workspace.id, name, slug } });
      if (!res.ok) {
        setError(res.error.error ?? "Failed to save.");
        return;
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const providerConfigured = data.providerStatus === "configured";

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-100">Settings</h1>
        <p className="mt-1 text-sm text-neutral-400">Workspace details and integrations.</p>
      </div>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
        <h2 className="font-medium text-neutral-100">Workspace</h2>
        <form onSubmit={save} className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-300">Name</label>
            <input
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-indigo-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-300">Slug</label>
            <input
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-indigo-500"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            />
            <p className="mt-1 text-xs text-neutral-500">Lowercase letters, numbers, and dashes — used in form URLs.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              disabled={saving || !workspace}
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-60"
              type="submit"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            {saved ? <span className="text-sm text-emerald-400">Saved.</span> : null}
            {error ? <span className="text-sm text-red-400">{error}</span> : null}
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
        <h2 className="font-medium text-neutral-100">Email provider</h2>
        {providerConfigured ? (
          <p className="mt-2 text-sm text-emerald-400">Resend is connected and ready to send.</p>
        ) : (
          <p className="mt-2 text-sm text-neutral-400">
            Not configured — add <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">RESEND_API_KEY</code> when
            you reach Slice 3. EmailOS never reads or exposes key values to the browser.
          </p>
        )}
      </section>
    </div>
  );
}