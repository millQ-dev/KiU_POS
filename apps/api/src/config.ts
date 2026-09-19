import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z
      .string()
      .url()
      .default('postgresql://millq:millq@localhost:5432/millq_dev'),
    /** Server-side PIN pepper — outside DB. Required in production (min 32 chars). */
    IDENTITY_PIN_PEPPER: z.string().min(32).optional(),
    /** Comma-separated browser origins allowed for CSRF Origin checks. */
    CORS_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
  })
  .superRefine((val, ctx) => {
    if (val.NODE_ENV === 'production' && !val.IDENTITY_PIN_PEPPER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['IDENTITY_PIN_PEPPER'],
        message: 'IDENTITY_PIN_PEPPER is required in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  return envSchema.parse(process.env);
}

export function resolvePinPepper(env: Env): string {
  if (env.IDENTITY_PIN_PEPPER) return env.IDENTITY_PIN_PEPPER;
  if (env.NODE_ENV === 'test' || env.NODE_ENV === 'development') {
    return 'millq-dev-test-pin-pepper-not-for-production-use!!';
  }
  throw new Error('IDENTITY_PIN_PEPPER is required');
}

export function resolveCookieSecure(env: Env): boolean {
  if (env.COOKIE_SECURE !== undefined) return env.COOKIE_SECURE;
  return env.NODE_ENV === 'production';
}

export function resolveAllowedOrigins(env: Env): string[] {
  return env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
