import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/app/_authenticated/audience")({
  component: AudiencePlaceholder,
});

function AudiencePlaceholder() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-neutral-100">Audience</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Subscribers, tags, and segments arrive in Slice 2. Until then this area is intentionally empty — no placeholder
        numbers are shown.
      </p>
    </div>
  );
}