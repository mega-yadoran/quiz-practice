import { z } from 'zod';

// null is all collections; the empty string is the unclassified collection.
export const practiceScopeSchema = z.string().trim().max(100).nullable().default(null);
export const practiceNextSchema = z.object({ collection: practiceScopeSchema, favoriteOnly: z.boolean().default(false), newRound: z.boolean().default(false) });
export interface PracticeOptions {
  last: { favoriteOnly: boolean; collection: string | null; total: number; progress: number } | null;
  collections: { name: string; total: number; progress: number }[];
  total: number;
}
export function practiceLabel(collection: string | null) { return collection === null ? '全ての問題集' : collection || '未分類'; }
