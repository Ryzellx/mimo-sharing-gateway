/**
 * Fallback token estimation used only when the upstream does not report usage.
 * Heuristic: ~4 chars per token for latin text, ~2 for CJK-heavy text.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (
      (cp >= 0x3000 && cp <= 0x9fff) ||
      (cp >= 0xac00 && cp <= 0xd7af) ||
      (cp >= 0xf900 && cp <= 0xfaff)
    ) {
      cjk++;
    }
  }
  const latin = text.length - cjk;
  return Math.max(1, Math.ceil(latin / 4) + cjk);
}

export function estimateMessageTokens(content: unknown): number {
  if (typeof content === 'string') return estimateTokens(content);
  if (Array.isArray(content)) {
    return content.reduce((acc: number, part: any) => {
      if (part && typeof part === 'object' && typeof part.text === 'string') {
        return acc + estimateTokens(part.text);
      }
      return acc + 16;
    }, 0);
  }
  return 8;
}

export interface UsageTotals {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export function buildUsage(promptTokens: number, completionTokens: number): UsageTotals {
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}
