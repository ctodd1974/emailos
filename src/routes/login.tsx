import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentSession } from "~/server/api/auth.ts";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const res = await getCurrentSession();
    if (res.ok && res.data.user) {
      throw redirect({ to: "/app/dashboard" });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500 font-bold text-white">E</span>
          <span className="text-lg font-semibold text-neutral-100">EmailOS</span>
        </div>
        <h1 className="text-xl font-semibold text-neutral-100">Sign in</h1>
        <p className="mt-1 text-sm text-neutral-400">Access your workspaces.</p>
        <LoginForm />
        <p className="mt-6 text-center text-sm text-neutral-500">
          Don&apos;t have an account?{" "}
          <a className="text-indigo-400 hover:text-indigo-300" href="/signup">
            Create one
          </a>
        </p>
      </div>
    </div>
  );
}

import { useState } from "react";
import { login } from "~/server/api/auth.ts";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await login({ data: { email, password } });
      if (res.ok) {
        window.location.assign("/app/dashboard");
        return;
      }
      setError(res.error.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-300">Email</label>
        <input
          autoComplete="email"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-indigo-500"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-300">Password</label>
        <input
          autoComplete="current-password"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-indigo-500"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <button
        disabled={busy}
        className="w-full rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-60"
        type="submit"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}