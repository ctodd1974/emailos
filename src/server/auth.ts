/**
 * Auth: registration, login, logout, and DB-backed opaque sessions.
 *
 * Design (proposal §4.2):
 *   - email + password, scrypt hashing, per-user salt, constant-time verify
 *   - opaque 32-byte base64url token in an httpOnly, Secure, SameSite=Lax cookie
 *   - server stores only SHA-256(token_hash) + user_id + expires_at (30-day,
 *     sliding). No JWT, no OAuth.
 *   - APP_SECRET required: auth server functions throw a clear server-side
 *     error when it's missing (never fabricate a secret).
 *
 * Sessions are managed here (create/lookup/revoke) over sql() — kept separate
 * from the repos because sessions are auth infrastructure, not tenant data.
 */
import { randomToken, sha256Hex, hashPassword, verifyPassword } from "./crypto.ts";
import { sql, assertDbConfigured } from "./db/client.ts";
import * as usersRepo from "./db/repos/users.ts";
import * as workspacesRepo from "./db/repos/workspaces.ts";
import { getAppSecret } from "./env.ts";

const SESSION_COOKIE = "emailos_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days sliding

export { SESSION_COOKIE };

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export interface SessionRecord {
  id: string;
  token_hash: string;
  user_id: string;
  expires_at: Date;
  created_at: Date;
  last_used_at: Date | null;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number = 400,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

// ---------------------------------------------------------------------------
// Validation (server-side only; client gets generic messages)
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: unknown): string {
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    throw new AuthError("Enter a valid email address.");
  }
  return email.trim().toLowerCase();
}

export function validatePassword(password: unknown): string {
  if (typeof password !== "string" || password.length < 8) {
    throw new AuthError("Password must be at least 8 characters.");
  }
  if (password.length > 200) {
    throw new AuthError("Password is too long.");
  }
  return password;
}

export function validateName(name: unknown): string | null {
  if (name === undefined || name === null || name === "") return null;
  if (typeof name !== "string" || name.length > 120) {
    throw new AuthError("Name is too long.");
  }
  return name.trim() || null;
}

export function validateSlug(slug: unknown): string {
  if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())) {
    throw new AuthError("Workspace slug must be lowercase letters, numbers, and dashes (e.g. what-if-lab).");
  }
  return slug.trim().toLowerCase();
}

export function validateWorkspaceName(name: unknown): string {
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 120) {
    throw new AuthError("Workspace name is required (max 120 chars).");
  }
  return name.trim();
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32); // opaque 256-bit
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await sql()`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${tokenHash}, ${userId}, ${expiresAt})
  `;
  return { token, expiresAt };
}

export async function lookupSession(token: string): Promise<SessionRecord | null> {
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const rows = await sql()`
    SELECT * FROM sessions WHERE token_hash = ${tokenHash} LIMIT 1
  `;
  const session = rows[0] as SessionRecord | undefined;
  if (!session) return null;
  if (session.expires_at.getTime() < Date.now()) {
    await revokeSessionById(session.id);
    return null;
  }
  // sliding expiration
  const newExpiry = new Date(Date.now() + SESSION_TTL_MS);
  await sql()`UPDATE sessions SET expires_at = ${newExpiry}, last_used_at = now() WHERE id = ${session.id}`;
  return session;
}

export async function revokeSessionByToken(token: string): Promise<void> {
  if (!token) return;
  await sql()`DELETE FROM sessions WHERE token_hash = ${sha256Hex(token)}`;
}

export async function revokeSessionById(id: string): Promise<void> {
  await sql()`DELETE FROM sessions WHERE id = ${id}`;
}

// ---------------------------------------------------------------------------
// Auth flows
// ---------------------------------------------------------------------------
export interface RegisterInput {
  email: unknown;
  password: unknown;
  name?: unknown;
  workspaceName?: unknown;
  workspaceSlug?: unknown;
}

export interface AuthResult {
  user: usersRepo.PublicUser;
  workspace: workspacesRepo.Workspace;
  sessionToken: string;
  expiresAt: string;
}

/** Registration: create user + first workspace (owner), then log them in. */
export async function register(input: RegisterInput): Promise<AuthResult> {
  assertDbConfigured();
  getAppSecret(); // require APP_SECRET — clear server-side failure if missing
  const email = validateEmail(input.email);
  const password = validatePassword(input.password);
  const name = validateName(input.name);

  const existing = await usersRepo.findByEmail(email);
  if (existing) {
    throw new AuthError("An account with this email already exists.");
  }

  const passwordHash = await hashPassword(password);
  const user = await usersRepo.createUser({ email, passwordHash, name });

  const wsName = validateWorkspaceName(input.workspaceName ?? `${name ?? email.split("@")[0]}'s workspace`);
  const baseSlug = validateSlug(input.workspaceSlug ?? slugify(wsName));
  let slug = baseSlug;
  let n = 2;
  while (await workspacesRepo.slugExists(slug)) {
    slug = `${baseSlug}-${n++}`;
  }
  const workspace = await workspacesRepo.createWorkspace({
    name: wsName,
    slug,
    ownerUserId: user.id,
  });

  const { token, expiresAt } = await createSession(user.id);
  return { user: usersRepo.toPublicUser(user), workspace, sessionToken: token, expiresAt: expiresAt.toISOString() };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60)
      .replace(/-$/, "") || "workspace"
  );
}

export async function login(input: { email: unknown; password: unknown }): Promise<AuthResult> {
  assertDbConfigured();
  getAppSecret();
  const email = validateEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";

  const user = await usersRepo.findByEmail(email);
  // Constant-ish path: if user missing, verify against a dummy hash so timing
  // doesn't reveal account existence.
  const ok = user ? await verifyPassword(password, user.password_hash) : await verifyPassword(password, "$scrypt$deadbeef$".padEnd(password.length + 10, "0"));
  if (!user || !ok) {
    throw new AuthError("Invalid email or password.", 401);
  }

  await usersRepo.touchLastLogin(user.id);
  const { token, expiresAt } = await createSession(user.id);
  const ws = await workspacesRepo.listWorkspacesForUser(user.id);
  const workspace = ws[0];
  if (!workspace) {
    throw new AuthError("This account has no workspace. Please contact support.", 500);
  }
  return { user: usersRepo.toPublicUser(user), workspace, sessionToken: token, expiresAt: expiresAt.toISOString() };
}

export interface SessionContext {
  session: SessionRecord;
  user: SessionUser;
}

/** Resolve the current request's session + user, or null. */
export async function getSessionUser(token: string | null): Promise<SessionContext | null> {
  if (!token) return null;
  try {
    const session = await lookupSession(token);
    if (!session) return null;
    const user = await usersRepo.findById(session.user_id);
    if (!user) return null;
    return { session, user: { id: user.id, email: user.email, name: user.name } };
  } catch (err) {
    if (String(err).includes("DATABASE_URL")) return null;
    throw err;
  }
}

export async function logout(token: string | null): Promise<void> {
  if (!token) return;
  await revokeSessionByToken(token);
}