/**
 * Resend API domain types (verified against live docs 2026-09-03; proposal §3).
 * Slice 1 only defines types — no keys exist, so no requests are made until Slice 3.
 */

export interface ResendSendParams {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
  attachments?: { filename: string; content: string }[];
  scheduled_at?: string;
}

export interface ResendSendResult {
  id: string;
}

export interface ResendApiError {
  statusCode: number;
  message: string;
  name?: string;
}

export type DomainRecordType = "MX" | "TXT" | "CNAME" | "TXT_SET" | "CNAME_SET";

export interface DomainRecord {
  type: DomainRecordType;
  name: string;
  value: string;
  status?: string;
  reason?: string | null;
  priority?: number | null;
  ttl?: string | null;
}

export interface ResendDomain {
  id: string;
  name: string;
  status: string; // not_started | pending | verified | failed
  region: string;
  records: DomainRecord[];
  created_at: string;
  tracking_subdomain?: string | null;
  open_tracking?: boolean;
  click_tracking?: boolean;
}

export interface ResendSuppression {
  id: string;
  email: string;
  origin: "bounce" | "complaint" | "manual";
  source_id: string | null;
  created_at: string;
}

export interface ResendWebhook {
  id: string;
  url: string;
  events: string[];
  signing_secret?: string;
  created_at: string;
}

/** Webhook payload envelope as delivered by Resend (Svix-style headers). */
export interface ResendWebhookPayload {
  type: string; // e.g. email.delivered
  created_at: string;
  data: Record<string, unknown>;
}

/** Provider status exposed to UI (never contains key material). */
export type ProviderConnectionStatus =
  | { status: "configured" }
  | { status: "not_configured"; reason: string };

export const NOT_CONFIGURED: ProviderConnectionStatus = {
  status: "not_configured",
  reason: "Set RESEND_API_KEY to connect Resend (Slice 3).",
};