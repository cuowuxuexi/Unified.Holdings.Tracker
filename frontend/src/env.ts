import { z } from 'zod';

const envSchema = z.object({
  VITE_API_BASE_URL: z.string().url().optional(),
});

const parsed = envSchema.parse(import.meta.env);

export const frontendEnv = {
  apiBaseUrl: parsed.VITE_API_BASE_URL ?? '/api',
};
