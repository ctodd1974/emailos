/**
 * Users repository — typed functions over the Neon HTTP `sql()` driver.
 * Workspace scoping: users are global (auth identity), but every tenant-owned
 * query goes through workspaces.ts which filters by workspace_id.
 */
import { sql } from "../client.ts";

export interface User {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
}

export async function findByEmail(email: string): Promise<User | null> {
  const rows = await sql()`SELECT * FROM users WHERE email = ${email} LIMIT 1`;
  return (rows[0] as User | undefined) ?? null;
}

export async function findById(id: string): Promise<User | null> {
  const rows = await sql()`SELECT * FROM users WHERE id = ${id} LIMIT 1`;
  return (rows[0] as User | undefined) ?? null;
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  name?: string | null;
}): Promise<User> {
  const rows = await sql()`
    INSERT INTO users (email, password_hash, name)
    VALUES (${input.email}, ${input.passwordHash}, ${input.name ?? null})
    RETURNING *
  `;
  return rows[0] as User;
}

export async function touchLastLogin(id: string): Promise<void> {
  await sql()`UPDATE users SET last_login_at = now() WHERE id = ${id}`;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    created_at: u.created_at.toISOString(),
  };
}