import { z } from 'zod';

export const visibilitySchema = z.object({ hidden: z.boolean() });
