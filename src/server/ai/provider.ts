/**
 * AIProvider interface — designed in Slice 1, UNUSED until Slice 7.
 *
 * Shape chosen for cost-conscious production use (brief: no expensive model
 * without approval): every generation returns model + token counts + cost in
 * USD so the product can surface/audit spend deterministically.
 */
export interface AICompletionInput {
  system?: string;
  prompt: string;
  /** e.g. "campaign_subject" | "campaign_body" | "sequence" */
  feature?: string;
  maxOutputTokens?: number;
}

export interface AICompletionResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Compute-only cost estimate in USD for the chosen model/pricing. */
  costUsd: number;
}

export interface AIProvider {
  readonly id: string;
  generateCompletion(input: AICompletionInput): Promise<AICompletionResult>;
}

/**
 * Null provider: the interface in its "not configured" state. No AI calls
 * happen anywhere in Phase 1 before Slice 7 — this exists so call sites can
 * be written against the interface from day one without side effects.
 */
export class NullAIProvider implements AIProvider {
  readonly id = "null";
  generateCompletion(): Promise<AICompletionResult> {
    return Promise.reject(new Error("AI is not configured in this build (Slice 7)."));
  }
}

export function getAIProvider(): AIProvider {
  // Slice 7 will select a real provider from env. Until then: null (safe no-op).
  return new NullAIProvider();
}