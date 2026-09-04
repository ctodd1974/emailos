/**
 * ResendProvider — the service abstraction EmailOS code talks to (proposal §4.4).
 *
 * Slice 1 ships the interface plus:
 *   - a graceful `not_configured` result when RESEND_API_KEY is absent (never
 *     throws, never calls Resend, never leaks key state),
 *   - a configured implementation over the fetch client (constructed only when
 *     a key exists; NOT exercised in Slice 1 — no Resend calls happen),
 *   - the Svix-style webhook signature verification helper (built + unit-checked
 *     now per proposal §4.6; real webhooks arrive in Slice 3).
 */
import { getResendApiKey } from "../env.ts";
import { ResendClient } from "./http.ts";
import { hmacSha256, timingSafeEqualText } from "../crypto.ts";
import {
  NOT_CONFIGURED,
  type ProviderConnectionStatus,
  type ResendDomain,
  type ResendSendParams,
  type ResendSendResult,
  type ResendSuppression,
  type ResendWebhook,
} from "./types.ts";

export interface SendParams extends ResendSendParams {
  /** Idempotency-Key request header (≤256 chars): prevents duplicate sends (proposal §3.2). */
  idempotencyKey?: string;
}

export interface CreateWebhookResult {
  id: string;
  signingSecret: string;
}

export interface ResendProvider {
  readonly configured: boolean;
  status(): ProviderConnectionStatus;

  send(params: SendParams): Promise<ResendSendResult>;
  createDomain(name: string, region: string, tracking: { open: boolean; click: boolean }): Promise<ResendDomain>;
  verifyDomain(domainId: string): Promise<void>;
  getDomain(domainId: string): Promise<ResendDomain>;
  listSuppressions(): Promise<ResendSuppression[]>;
  addSuppression(emails: string[]): Promise<void>;
  removeSuppression(emailOrId: string): Promise<void>;
  createWebhook(endpoint: string, events: string[]): Promise<CreateWebhookResult>;
  listWebhooks(): Promise<ResendWebhook[]>;
}

/** Active provider (key present) or not-configured stub — chosen by env. */
export function getResendProvider(): ResendProvider {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    return new NotConfiguredResendProvider();
  }
  return new HttpResendProvider(new ResendClient({ apiKey }));
}

/** Never touches the network; answers status() only. */
class NotConfiguredResendProvider implements ResendProvider {
  readonly configured = false;
  status(): ProviderConnectionStatus {
    return NOT_CONFIGURED;
  }
  send(): Promise<ResendSendResult> {
    return Promise.reject(new Error("Resend is not configured (RESEND_API_KEY missing)."));
  }
  createDomain(): Promise<ResendDomain> {
    return Promise.reject(new Error("Resend is not configured (RESEND_API_KEY missing)."));
  }
  verifyDomain(): Promise<void> {
    return Promise.reject(new Error("Resend is not configured (RESEND_API_KEY missing)."));
  }
  getDomain(): Promise<ResendDomain> {
    return Promise.reject(new Error("Resend is not configured (RESEND_API_KEY missing)."));
  }
  listSuppressions(): Promise<ResendSuppression[]> {
    return Promise.reject(new Error("Resend is not configured (RESEND_API_KEY missing)."));
  }
  addSuppression(): Promise<void> {
    return Promise.reject(new Error("Resend is not configured (RESEND_API_KEY missing)."));
  }
  removeSuppression(): Promise<void> {
    return Promise.reject(new Error("Resend is not configured (RESEND_API_KEY missing)."));
  }
  createWebhook(): Promise<CreateWebhookResult> {
    return Promise.reject(new Error("Resend is not configured (RESEND_API_KEY missing)."));
  }
  listWebhooks(): Promise<ResendWebhook[]> {
    return Promise.reject(new Error("Resend is not configured (RESEND_API_KEY missing)."));
  }
}

class HttpResendProvider implements ResendProvider {
  readonly configured = true;
  constructor(private readonly client: ResendClient) {}

  status(): ProviderConnectionStatus {
    return { status: "configured" };
  }

  async send(params: SendParams): Promise<ResendSendResult> {
    const { idempotencyKey, ...body } = params;
    return this.client.request<ResendSendResult>("POST", "/emails", {
      ...body,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  }

  createDomain(name: string, region: string, tracking: { open: boolean; click: boolean }): Promise<ResendDomain> {
    return this.client.request<ResendDomain>("POST", "/domains", {
      name,
      region,
      open_tracking: tracking.open,
      click_tracking: tracking.click,
    });
  }

  async verifyDomain(domainId: string): Promise<void> {
    await this.client.request<unknown>("POST", `/domains/${domainId}/verify`);
  }

  getDomain(domainId: string): Promise<ResendDomain> {
    return this.client.request<ResendDomain>("GET", `/domains/${domainId}`);
  }

  listSuppressions(): Promise<ResendSuppression[]> {
    return this.client.request<ResendSuppression[]>("GET", "/suppressions");
  }

  async addSuppression(emails: string[]): Promise<void> {
    if (emails.length === 0) return;
    for (let i = 0; i < emails.length; i += 100) {
      await this.client.request<unknown>("POST", "/suppressions/batch/add", { emails: emails.slice(i, i + 100) });
    }
  }

  removeSuppression(emailOrId: string): Promise<void> {
    return this.client.request<unknown>("DELETE", `/suppressions/${encodeURIComponent(emailOrId)}`);
  }

  async createWebhook(endpoint: string, events: string[]): Promise<CreateWebhookResult> {
    const res = await this.client.request<{ id: string; signing_secret: string }>("POST", "/webhooks", {
      url: endpoint,
      events,
    });
    return { id: res.id, signingSecret: res.signing_secret };
  }

  listWebhooks(): Promise<ResendWebhook[]> {
    return this.client.request<ResendWebhook[]>("GET", "/webhooks");
  }
}

// ---------------------------------------------------------------------------
// Svix-style webhook signature verification (proposal §4.6)
// ---------------------------------------------------------------------------
export interface SvixHeaders {
  "svix-id"?: string | null;
  "svix-timestamp"?: string | null;
  "svix-signature"?: string | null;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

/**
 * Verify a Resend webhook request per the Svix scheme:
 *   signature = HMAC_SHA256(secret, `${svix-id}.${svix-timestamp}.${rawBody}`)
 * The `svix-signature` header is a comma-separated list of `v1,<sig>` entries;
 * accept if ANY entry matches (constant-time) and the timestamp is fresh.
 */
export function verifyWebhookSignature(rawBody: string | Buffer, headers: SvixHeaders, secret: string): VerifyResult {
  const id = headers["svix-id"];
  const timestamp = headers["svix-timestamp"];
  const signatureHeader = headers["svix-signature"];
  if (!id || !timestamp || !signatureHeader) {
    return { valid: false, reason: "missing svix headers" };
  }

  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return { valid: false, reason: "invalid svix-timestamp" };
  const nowMs = Date.now();
  if (Math.abs(nowMs - ts * 1000) > MAX_TIMESTAMP_SKEW_MS) {
    return { valid: false, reason: "timestamp outside allowed skew" };
  }

  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const signedContent = `${id}.${timestamp}.${body}`;
  const expected = hmacSha256(secret, signedContent);

  const entries = signatureHeader.split(",").map((e) => e.trim());
  for (const entry of entries) {
    const [version, sig] = entry.split(/=/, 2);
    if (version !== "v1" || !sig) continue;
    if (timingSafeEqualText(sig, expected)) {
      return { valid: true };
    }
  }
  return { valid: false, reason: "no matching signature" };
}