import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentSession } from "~/server/api/auth.ts";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const res = await getCurrentSession();
    if (res.ok && res.data.user) {
      throw redirect({ to: "/app/dashboard" });
    }
  },
  component: Home,
});

function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-white px-6 text-center dark:bg-neutral-950">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500 text-lg font-bold text-white">
          E
        </span>
        <span className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white">EmailOS</span>
      </div>
      <p className="max-w-md text-balance text-lg text-neutral-600 dark:text-neutral-300">
        The audience ownership, email marketing, and monetization operating system for creators and small businesses.
      </p>
      <div className="flex gap-3">
        <a
          className="rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400"
          href="/signup"
        >
          Create account
        </a>
        <a
          className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          href="/login"
        >
          Sign in
        </a>
      </div>
    </main>
  );
}