import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { getCurrentSession, logout } from "~/server/api/auth.ts";
import { createWorkspace } from "~/server/api/app.ts";

export interface AppRouteContext {
  user: { id: string; email: string; name: string | null };
  workspaces: { id: string; name: string; slug: string; owner: boolean }[];
  currentWorkspace: { id: string; name: string; slug: string };
}

export const Route = createFileRoute("/app/_authenticated")({
  beforeLoad: async ({ location }) => {
    const res = await getCurrentSession();
    if (!res.ok || !res.data.user) {
      throw redirect({ to: "/login" });
    }
    // Resolve current workspace (query ?ws= or the first one). Membership is
    // re-checked server-side on EVERY data handler — this is navigation UX only.
    const workspaces = res.data.workspaces;
    if (workspaces.length === 0) {
      throw redirect({ to: "/signup" });
    }
    const params = new URLSearchParams(location.searchStr ?? "");
    const wsParam = params.get("ws");
    const currentWorkspace = workspaces.find((w) => w.id === wsParam) ?? workspaces[0];
    return {
      user: res.data.user,
      workspaces,
      currentWorkspace,
    };
  },
  component: AppShell,
});

function AppShell() {
  const { user, workspaces, currentWorkspace } = Route.useLoaderData();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      window.location.assign("/");
    }
  }

  function switchWorkspace(id: string) {
    navigate({ to: "/app/dashboard", search: { ws: id } });
  }

  // Create-workspace control (Slice 1 DoD): a signed-in user can own multiple
  // workspaces; each is kept logically separate by workspace_id scoping.
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  async function handleCreateWorkspace() {
    setCreating(true);
    setCreateError(null);
    try {
      const name = prompt("Name your new workspace", "My workspace");
      if (name === null) return; // cancelled
      if (!name.trim()) {
        setCreateError("Workspace name is required.");
        return;
      }
      const slugFromName = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "workspace";
      const slug = prompt("Workspace slug (URL identifier)", slugFromName);
      if (slug === null) return;
      const res = await createWorkspace({ data: { name, slug } });
      if (!res.ok) {
        setCreateError(res.error.error ?? "Failed to create workspace.");
        return;
      }
      navigate({ to: "/app/dashboard", search: { ws: res.data.workspace.id } });
      window.location.reload();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create workspace.");
    } finally {
      setCreating(false);
    }
  }

  // Nav order follows the proposal: Dashboard, Audience (Subscribers /
  // Audiences / Segments / Tags), Campaigns, Forms, Sequences, Settings.
  const navItems: {
    href: string;
    label: string;
    disabled?: boolean;
    children?: { href: string; label: string }[];
  }[] = [
    { href: "/app/dashboard", label: "Dashboard" },
    {
      href: "/app/audience",
      label: "Audience",
      children: [
        { href: "/app/audience/subscribers", label: "Subscribers" },
        { href: "/app/audience/audiences", label: "Audiences" },
        { href: "/app/audience/segments", label: "Segments" },
        { href: "/app/audience/tags", label: "Tags" },
      ],
    },
    { href: "/app/campaigns", label: "Campaigns", disabled: true },
    { href: "/app/forms", label: "Forms", disabled: true },
    { href: "/app/sequences", label: "Sequences", disabled: true },
    { href: "/app/settings", label: "Settings" },
  ];
  const wsSearch = { ws: currentWorkspace.id };
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-dvh bg-neutral-950 text-neutral-200">
      <aside className="hidden w-60 flex-col border-r border-neutral-800 bg-neutral-925 md:flex">
        <div className="flex items-center gap-2 border-b border-neutral-800 px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500 font-bold text-white">E</span>
          <span className="text-lg font-semibold text-neutral-100">EmailOS</span>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => (
            <div key={item.href}>
              <Link
                className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  item.disabled
                    ? "cursor-not-allowed text-neutral-600"
                    : isActive(item.href)
                      ? "bg-neutral-800 text-neutral-100"
                      : "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
                }`}
                to={item.href}
                search={wsSearch}
              >
                {item.label}
                {item.disabled ? (
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-neutral-700">soon</span>
                ) : null}
              </Link>
              {item.children ? (
                <div className="mt-1 space-y-0.5 border-l border-neutral-800 pl-3">
                  {item.children.map((child) => (
                    <Link
                      key={child.href}
                      to={child.href}
                      search={wsSearch}
                      className={`block rounded-lg px-3 py-1.5 text-sm transition-colors ${
                        isActive(child.href)
                          ? "bg-neutral-800/80 text-indigo-200"
                          : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200"
                      }`}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </nav>
        <div className="border-t border-neutral-800 px-5 py-4">
          <p className="truncate text-sm text-neutral-300">{user.email}</p>
          <button
            onClick={handleLogout}
            disabled={signingOut}
            className="mt-2 text-sm text-neutral-500 hover:text-neutral-300 disabled:opacity-60"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-neutral-800 px-5">
          <div className="text-sm text-neutral-400">
            <span className="font-semibold text-neutral-200">{currentWorkspace.name}</span>
            <span className="mx-2 text-neutral-700">/</span>
            <span className="text-neutral-500">{currentWorkspace.slug}</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Switch workspace"
              className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 outline-none focus:border-indigo-500"
              value={currentWorkspace.id}
              onChange={(e) => switchWorkspace(e.target.value)}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleCreateWorkspace}
              disabled={creating}
              className="rounded-lg border border-indigo-600 bg-indigo-500/20 px-3 py-1.5 text-sm font-medium text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-60"
            >
              {creating ? "Creating…" : "+ Create workspace"}
            </button>
          </div>
          {createError ? <p className="mr-2 text-xs text-red-400">{createError}</p> : null}
        </header>
        <nav
          aria-label="Primary"
          className="flex gap-1 overflow-x-auto border-b border-neutral-800 px-3 py-2 md:hidden"
        >
          {navItems.flatMap((item) =>
            item.children
              ? item.children.map((child) => ({ href: child.href, label: child.label, disabled: false }))
              : [{ href: item.href, label: item.label, disabled: !!item.disabled }],
          ).map((item) => (
            <Link
              key={item.href}
              to={item.href}
              search={wsSearch}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                item.disabled
                  ? "text-neutral-600"
                  : isActive(item.href)
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}