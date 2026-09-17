import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.preprocess(
    (value) => value ?? (process.env.NODE_ENV === 'production' ? 'production' : 'local'),
    z.enum(['local', 'preview', 'staging', 'production']),
  ),
  ALLOW_DEV_CASHIER_BOOTSTRAP: z.enum(['0', '1']).default('0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://millq:millq@localhost:5432/millq_dev'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  return envSchema.parse(process.env);
}
