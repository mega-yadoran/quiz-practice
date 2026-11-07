import { z } from 'zod';

export const speechRequestSchema = z.object({ attemptId: z.string().min(1).max(100) });
export interface SpeechConfig { provider: 'browser' | 'google'; configured: boolean; voice: string }

// Normalize only the spoken copy. Keep the stored/displayed question unchanged.
export function spokenText(text: string): string {
  let depth = 0;
  let result = '';
  for (const char of text) {
    if (char === '（' || char === '(') { depth++; continue; }
    if ((char === '）' || char === ')') && depth > 0) { depth--; continue; }
    if (depth === 0) result += char;
  }
  return result.trim();
}
