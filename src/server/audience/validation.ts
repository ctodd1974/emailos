/**
 * Audience-side validation (server-only).
 *
 * Every value that reaches a repo function passes through here first. The
 * vocabularies mirror db/migrations/0002_audience.sql and proposal §5; keeping
 * them in one place means the UI can offer exactly what the server accepts and
 * nothing more.
 */

export class ValidationError extends Error {
  constructor(
    message: string,
    public status: number = 400,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export const SUBSCRIBER_STATUSES = [
  "active",
  "unsubscribed",
  "suppressed",
  "bounced",
  "complained",
] as const;
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];

export const SUBSCRIBER_SOURCES = ["manual", "csv", "form", "api", "test", "import"] as const;
export type SubscriberSource = (typeof SUBSCRIBER_SOURCES)[number];

export const SUPPRESSION_REASONS = ["unsubscribe", "bounce", "complaint", "manual"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

/** Statuses that must never receive a marketing send (proposal §4.5). */
export const UNMAILABLE_STATUSES: readonly SubscriberStatus[] = [
  "unsubscribed",
  "suppressed",
  "bounced",
  "complained",
];

export function isMailableStatus(status: string): boolean {
  return !(UNMAILABLE_STATUSES as readonly string[]).includes(status);
}

// A deliberately conservative email shape check — used for both manual entry and
// CSV import. It rejects the obvious junk (missing @, missing domain, spaces)
// and nothing more; deliverability is Resend's job, not ours.
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}$/;

/** Normalized (lowercased, trimmed) email or null when invalid. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  if (email.startsWith(".") || email.includes("..")) return null;
  if (!EMAIL_RE.test(email)) return null;
  const [, domain] = email.split("@");
  if (!domain || domain.startsWith("-") || domain.endsWith("-")) return null;
  return email;
}

export function requireEmail(input: unknown): string {
  const email = normalizeEmail(input);
  if (!email) throw new ValidationError("Enter a valid email address.");
  return email;
}

function optionalText(value: unknown, label: string, max = 200): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ValidationError(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > max) throw new ValidationError(`${label} is too long (max ${max} characters).`);
  return trimmed;
}

export function optionalFirstName(value: unknown): string | null {
  return optionalText(value, "First name", 120);
}
export function optionalLastName(value: unknown): string | null {
  return optionalText(value, "Last name", 120);
}

export function requireEntityName(value: unknown, label = "Name"): string {
  if (typeof value !== "string") throw new ValidationError(`${label} is required.`);
  const trimmed = value.trim();
  if (trimmed.length < 1) throw new ValidationError(`${label} is required.`);
  if (trimmed.length > 120) throw new ValidationError(`${label} is too long (max 120 characters).`);
  return trimmed;
}

export function optionalDescription(value: unknown): string | null {
  return optionalText(value, "Description", 500);
}

export function requireStatus(value: unknown): SubscriberStatus {
  if (typeof value !== "string" || !(SUBSCRIBER_STATUSES as readonly string[]).includes(value)) {
    throw new ValidationError(`Status must be one of: ${SUBSCRIBER_STATUSES.join(", ")}.`);
  }
  return value as SubscriberStatus;
}

export function requireSource(value: unknown): SubscriberSource {
  if (typeof value !== "string" || !(SUBSCRIBER_SOURCES as readonly string[]).includes(value)) {
    throw new ValidationError(`Source must be one of: ${SUBSCRIBER_SOURCES.join(", ")}.`);
  }
  return value as SubscriberSource;
}

export function requireSuppressionReason(value: unknown): SuppressionReason {
  if (typeof value !== "string" || !(SUPPRESSION_REASONS as readonly string[]).includes(value)) {
    throw new ValidationError(`Suppression reason must be one of: ${SUPPRESSION_REASONS.join(", ")}.`);
  }
  return value as SuppressionReason;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, label = "Id"): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new ValidationError(`${label} is invalid.`);
  }
  return value;
}

export function optionalUuid(value: unknown, label = "Id"): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireUuid(value, label);
}

/**
 * Postgres unique-violation detection. The Neon HTTP driver surfaces the
 * SQLSTATE on `code`; we also match the message so the check survives a driver
 * change (the message never contains user data we care about).
 */
export function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === "23505") return true;
  return /duplicate key value violates unique constraint/i.test(String(err));
}

export function uniqueViolationHint(err: unknown): string {
  const msg = String(err);
  if (msg.includes("uq_subscribers_workspace_email")) return "email";
  if (msg.includes("uq_tags_workspace_name")) return "tag name";
  if (msg.includes("uq_audiences_workspace_name")) return "audience name";
  if (msg.includes("uq_segments_workspace_name")) return "segment name";
  return "value";
}
