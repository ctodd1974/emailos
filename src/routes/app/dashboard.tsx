import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { getDashboard } from "~/server/api/app.ts";

export const Route = createFileRoute("/app/dashboard")({
  loader: async ({ context }) => {
    const ctx = context as unknown as { currentWorkspace?: { id: string } };
    const workspaceId = ctx?.currentWorkspace?.id;
    if (!workspaceId) return { workspace: null, providerStatus: "not_configured", hasSubscribers: false, hasCampaigns: false, hasForms: false };
    const res = await getDashboard({ data: { workspaceId } });
    if (res.ok) return res.data;
    return { workspace: null, providerStatus: "not_configured", hasSubscribers: false, hasCampaigns: false, hasForms: false };
  },
  component: Dashboard,
});

function Dashboard() {
  const data = Route.useLoaderData();
  const workspaceName = data.workspace?.name ?? "your workspace";

  const steps = [
    {
      title: "Connect your sending domain",
      detail: "Add a Resend API key and verify a sending domain (Slice 3).",
      done: data.providerStatus === "configured",
      href: "/app/settings",
      cta: data.providerStatus === "configured" ? "Configured" : "Open settings",
    },
    {
      title: "Import your first audience",
      detail: "Manually add subscribers or CSV-import them (Slice 2).",
      done: data.hasSubscribers,
      href: "/app/audience",
      cta: data.hasSubscribers ? "Manage audience" : "View audience",
    },
    {
      title: "Create your first campaign",
      detail: "Write, preview, and send a campaign (Slice 4).",
      done: data.hasCampaigns,
      href: "/app/campaigns",
      cta: data.hasCampaigns ? "Open campaigns" : "Start a campaign",
    },
    {
      title: "Embed a signup form",
      detail: "Let your audience subscribe from your site (Slice 5).",
      done: data.hasForms,
      href: "/app/forms",
      cta: data.hasForms ? "Open forms" : "Create a form",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-neutral-100">Welcome to {workspaceName}</h1>
      <p className="mt-2 text-sm text-neutral-400">
        EmailOS is being built in slices. Here is where your workspace stands today — nothing here is fabricated; next
        steps appear as features ship.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {steps.map((step, i) => (
          <div
            key={step.title}
            className={`rounded-2xl border p-5 ${
              step.done ? "border-emerald-800/60 bg-emerald-950/20" : "border-neutral-800 bg-neutral-900/40"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-800 text-xs font-semibold text-neutral-300">
                {i + 1}
              </span>
              <h2 className="font-medium text-neutral-100">{step.title}</h2>
            </div>
            <p className="mt-2 text-sm text-neutral-400">{step.detail}</p>
            <Link
              to={step.href}
              className={`mt-4 inline-block rounded-lg px-3 py-1.5 text-sm font-medium ${
                step.done
                  ? "border border-emerald-700 bg-transparent text-emerald-300"
                  : "bg-indigo-500 text-white hover:bg-indigo-400"
              }`}
            >
              {step.cta}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}