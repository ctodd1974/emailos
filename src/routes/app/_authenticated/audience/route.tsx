/**
 * Audience area layout — one place for the four audience surfaces the proposal
 * lists, in the proposal's order: Subscribers / Audiences / Segments / Tags.
 *
 * The workspace comes from the parent `_authenticated` route context (?ws= or
 * the first workspace). Every page below re-checks membership server-side, so
 * this is navigation only, never authorization.
 */
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";

export const Route = createFileRoute("/app/_authenticated/audience")({
  component: AudienceLayout,
});

const TABS = [
  { to: "/app/audience/subscribers", label: "Subscribers", blurb: "Everyone you own" },
  { to: "/app/audience/audiences", label: "Audiences", blurb: "Hand-curated groups" },
  { to: "/app/audience/segments", label: "Segments", blurb: "Rule-based groups" },
  { to: "/app/audience/tags", label: "Tags", blurb: "Reusable labels" },
] as const;

function AudienceLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { currentWorkspace } = Route.useRouteContext() as unknown as {
    currentWorkspace?: { id: string; name: string };
  };
  const wsSearch = currentWorkspace?.id ? { ws: currentWorkspace.id } : undefined;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-neutral-100 sm:text-2xl">Audience</h1>
        <p className="max-w-3xl text-sm text-neutral-400">
          Your owned subscriber database{currentWorkspace ? ` for ${currentWorkspace.name}` : ""}. Quality over size:
          every number here is a real count from your workspace, and unsubscribed or suppressed contacts are never
          mailable.
        </p>
      </div>

      <nav
        aria-label="Audience sections"
        className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900/40 p-1"
      >
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.to);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              search={wsSearch}
              className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors ${
                active
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <Outlet />
    </div>
  );
}
