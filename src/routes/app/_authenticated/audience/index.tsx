import { createFileRoute, redirect } from "@tanstack/react-router";

/** /app/audience → /app/audience/subscribers (the first tab, per the proposal). */
export const Route = createFileRoute("/app/_authenticated/audience/")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/app/audience/subscribers", search: search as Record<string, unknown> });
  },
  component: () => null,
});
