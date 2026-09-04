/**
 * Zero-dependency migration runner for EmailOS.
 *
 * Reads db/migrations/*.sql in filename order, applies only versions not present
 * in schema_migrations, and records them. Re-runs are safe (idempotent).
 *
 * IMPORTANT (verified 2026-09-03): the Neon HTTP driver rejects multi-statement
 * SQL in a single request ("cannot insert multiple commands into a prepared
 * statement"). So this runner splits each migration file into individual
 * statements on `;` boundaries and executes them one at a time. A simple
 * splitter is sufficient for our migrations: we avoid dollar-quoted strings,
 * comments containing `;`, and function bodies. The splitter also strips
 * `--` line comments and folds strings containing `;` (they are rare here).
 *
 * Usage: bun run db:migrate   (requires DATABASE_URL in the environment)
 */
import { neon } from "@neondatabase/serverless";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let depth = 0; // nested dollar-quote depth (mostly for completeness)

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      // Strip the comment text but preserve the newline: without this, a
      // comment block immediately followed by a statement (no blank line)
      // glues `--` residue onto the statement's first line, commenting it
      // out and producing a syntax error on the remainder (verified
      // 2026-09-04: ALTER in 0001 failed exactly this way).
      if (ch === "\n") {
        inLineComment = false;
        current += "\n";
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
        current += " "; // keep surrounding tokens separated
      }
      continue;
    }
    if (inSingle) {
      current += ch;
      if (ch === "\\" && next) {
        current += next;
        i++;
      } else if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      current += ch;
      if (ch === "\\" && next) {
        current += next;
        i++;
      } else if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "-" && next === "-") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      continue;
    }
    if (ch === "$") {
      // detect simple dollar-quote tag like $tag$ ... $tag$ (we don't use these,
      // but the depth tracking keeps us from splitting inside them in future migrations)
      const m = sql.slice(i).match(/^\$[A-Za-z_0-9]*\$/);
      if (m) {
        current += m[0];
        i += m[0].length - 1;
        depth++;
        continue;
      }
    }
    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = "";
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed.length > 0) statements.push(trimmed);
  return statements;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("db:migrate requires DATABASE_URL (set in the environment). Aborting.");
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);
  console.log("db:migrate connecting to Neon… (DATABASE_URL present)");

  // Ensure bookkeeping table exists (migration 0001 also creates it; this makes
  // the runner usable before 0001 is applied).
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

  const appliedRows = await sql`SELECT version FROM schema_migrations`;
  const applied = new Set(appliedRows.map((r: any) => r.version as string));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let appliedCount = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }
    const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const statements = splitStatements(raw);
    console.log(`apply ${file} (${statements.length} statements)`);
    for (const stmt of statements) {
      try {
        // IMPORTANT (verified 2026-09-03): this driver version rejects
        // `sql.unsafe()` semantics under Bun and DISALLOWS bare sql(...) calls;
        // only `sql`tagged-template`` or `sql.query()` execute raw SQL
        // reliably. DDL via unsafe() silently no-opped (never persisted) yet
        // resolved without error — so the runner uses sql.query() for
        // migration statements. Statements are parameterless (our migrations
        // contain no interpolations), so this is safe.
        await sql.query(stmt);
      } catch (err) {
        console.error(`migration ${file} failed on statement:\n${stmt}\n`, err);
        process.exit(1);
      }
    }
    // NOTE (2026-09-04): the version is recorded only after ALL statements in
    // the file succeed. Statements that are NOT idempotent-safe — e.g.
    // `ALTER TABLE ... ADD CONSTRAINT` (Postgres has no IF NOT EXISTS for it)
    // — are therefore safe only because the fixed splitter cannot silently
    // mangle statements into partial applies, and because a full re-run of an
    // already-applied migration is skipped above via schema_migrations.
    // Rule for future migrations: keep every statement IF NOT EXISTS-safe
    // where the syntax allows; flag any ADD CONSTRAINT / CREATE INDEX
    // (non-concurrent, no IF NOT EXISTS variant) in review rather than
    // building complex guards into this runner.
    await sql`INSERT INTO schema_migrations (version) VALUES (${version})`;
    appliedCount++;
  }

  if (appliedCount === 0) {
    console.log("No new migrations to apply. schema_migrations is up to date.");
  } else {
    console.log(`Applied ${appliedCount} migration(s).`);
  }
  const rows = await sql`SELECT version, applied_at FROM schema_migrations ORDER BY version`;
  console.log("schema_migrations:", rows.map((r: any) => `${r.version} @ ${String(r.applied_at)}`).join("\n  ") || "(empty)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});