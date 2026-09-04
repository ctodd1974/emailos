import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/app/_authenticated/forms")({
  component: FormsPlaceholder,
});

function FormsPlaceholder() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-neutral-100">Forms</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Hosted signup forms arrive in Slice 5. Until then this area is intentionally empty.
      </p>
    </div>
  );
}