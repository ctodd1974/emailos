/**
 * Minimal fetch-based Resend HTTP client (no SDK — zero deps).
 *
 * Slice 1: the client exists and is typed, but is NEVER constructed without a
 * key. Provider code returns status "not_configured" when RESEND_API_KEY is
 * absent, so no API call happens in this slice.
 *
 * Rate-limit behavior (proposal §3.7): 10 req/s per team; the send pipeline in
 * Slice 3 will pace calls + honor `ratelimit-*`/`retry-after` on 429.
 */
import type { ResendApiError } from "./types.ts";

export const RESEND_BASE_URL = "https://api.resend.com";

export class ResendHttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ResendHttpError";
  }
}

export interface ResendClientOptions {
  apiKey: string;
  baseUrl?: string; // allow override in tests
}

export class ResendClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: ResendClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? RESEND_BASE_URL;
  }

  async request<T>(method: "GET" | "POST" | "DELETE" | "PATCH", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(body && typeof body === "object" && "idempotencyKey" in (body as any)
          ? { "Idempotency-Key": (body as any).idempotencyKey }
          : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }

    if (!res.ok) {
      let message = `Resend ${res.status}`;
      const apiErr = json as ResendApiError | null;
      if (apiErr?.message) message = apiErr.message;
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "", 10);
      throw new ResendHttpError(res.status, message, Number.isFinite(retryAfter) ? retryAfter : undefined);
    }
    return json as T;
  }
}