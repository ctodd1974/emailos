import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/app/_authenticated/campaigns")({
  component: CampaignsPlaceholder,
});

function CampaignsPlaceholder() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-neutral-100">Campaigns</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Campaign drafting, preview, and sending arrive in Slice 4. Until then this area is intentionally empty.
      </p>
    </div>
  );
}