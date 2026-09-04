import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { getCurrentSession, logout } from "~/server/api/auth.ts";

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

  const navItems = [
    { href: "/app/dashboard", label: "Dashboard", active: true },
    { href: "/app/audience", label: "Audience", active: false, disabled: true },
    { href: "/app/campaigns", label: "Campaigns", active: false, disabled: true },
    { href: "/app/forms", label: "Forms", active: false, disabled: true },
    { href: "/app/sequences", label: "Sequences", active: false, disabled: true },
    { href: "/app/settings", label: "Settings", active: false },
  ];

  return (
    <div className="flex min-h-dvh bg-neutral-950 text-neutral-200">
      <aside className="hidden w-60 flex-col border-r border-neutral-800 bg-neutral-925 md:flex">
        <div className="flex items-center gap-2 border-b border-neutral-800 px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500 font-bold text-white">E</span>
          <span className="text-lg font-semibold text-neutral-100">EmailOS</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => (
            <Link
              key={item.href}
              className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                item.disabled
                  ? "cursor-not-allowed text-neutral-600"
                  : "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
              }`}
              to={item.href}
            >
              {item.label}
              {item.disabled ? <span className="ml-2 text-[10px] uppercase tracking-wide text-neutral-700">soon</span> : null}
            </Link>
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
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}