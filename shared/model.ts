import { z } from 'zod';

export const questionSchema = z.object({
  id: z.string().trim().min(1).max(100).regex(/^[\p{L}\p{N}_.-]+$/u, 'IDは文字・数字・ハイフン・アンダースコアで指定してください'),
  text: z.string().trim().min(1, '問題文がありません').max(4000),
  answer: z.string().trim().min(1, '正解がありません').max(300),
  aliases: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  reading: z.string().trim().max(4000).default(''),
  category: z.string().trim().max(100).default(''),
  source: z.string().trim().max(1000).default(''),
  note: z.string().trim().max(4000).default(''),
});
export type Question = z.infer<typeof questionSchema>;
export type QuestionRow = Question & { favorite: boolean; created_at: string; updated_at: string };

// Preserve internal spaces, punctuation and kana differences unless explicitly registered.
export function normalizeAnswer(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}
export function isCorrect(value: string, question: Pick<Question, 'answer' | 'aliases'>): boolean {
  const normalized = normalizeAnswer(value);
  return normalized.length > 0 && [question.answer, ...question.aliases].some(a => normalizeAnswer(a) === normalized);
}

export interface PracticeAttempt {
  id: string;
  questionId: string;
  text: string;
  reading: string;
  category: string;
  answered: boolean;
  favorite: boolean;
  answer?: string;
  aliases?: string[];
  note?: string;
  source?: string;
  submittedAnswer?: string;
  correct?: boolean;
  overridden?: boolean;
  skipped?: boolean;
}
export interface PracticeState {
  attempt: PracticeAttempt | null;
  round: number;
  total: number;
  seen: number;
  completed: boolean;
}
export interface Stats { total: number; favorites: number; answered: number; correct: number; today: number; skipped: number }
export interface Settings { rate: number; showQuestion: boolean }
