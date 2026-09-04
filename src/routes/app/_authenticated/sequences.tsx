import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/app/_authenticated/sequences")({
  component: SequencesPlaceholder,
});

function SequencesPlaceholder() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-neutral-100">Sequences</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Simple ordered sequences arrive in Slice 6. Until then this area is intentionally empty.
      </p>
    </div>
  );
}