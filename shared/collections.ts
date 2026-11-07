import { z } from 'zod';

export const collectionNameSchema = z.string().trim().min(1, '問題集名を入力してください').max(100);
export const renameCollectionSchema = z.object({ name: collectionNameSchema, newName: collectionNameSchema });
export const deleteCollectionSchema = z.object({ name: collectionNameSchema, confirmation: z.string(), total: z.number().int().nonnegative() })
  .refine(value => value.confirmation === value.name, { message: '確認欄に問題集名を入力してください', path: ['confirmation'] });
export interface CollectionSummary { name: string; total: number }
