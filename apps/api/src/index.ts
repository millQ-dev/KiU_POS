import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import {
  loadEnv,
  resolveAllowedOrigins,
  resolveCookieSecure,
  resolvePinPepper,
} from './config.js';
import { createPool } from './db/pool.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerGoodsReceiptRoutes } from './routes/goods-receipts.js';
import { registerGuestMenuRoutes, registerDevGuestMenuAdminRoutes } from './routes/guest-menu.js';
import { registerDevCashierBootstrapRoutes, registerPosRoutes } from './routes/pos.js';
import { registerCompanyIdentityRoutes, registerIdentityRoutes } from './routes/identity.js';

async function main() {
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);
  const allowedOrigins = resolveAllowedOrigins(env);
  const cookieSecure = resolveCookieSecure(env);
  const pepper = resolvePinPepper(env);

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      base: { service: 'millq-api' },
      redact: {
        paths: [
          'req.params.opaqueToken',
          'req.headers.cookie',
          'req.headers.authorization',
          'req.body.pin',
          'req.body.qrToken',
          'req.body.sessionToken',
        ],
        censor: '[REDACTED]',
      },
      serializers: {
        req(request) {
          const url =
            typeof request.url === 'string'
              ? request.url.replace(
                  /(\/api\/v1\/public\/guest-menu\/)[^/?]+/g,
                  '$1[REDACTED]',
                )
              : request.url;
          return {
            method: request.method,
            url,
            hostname: request.hostname,
            remoteAddress: request.ip,
          };
        },
      },
    },
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
  });
  await app.register(cookie);

  await registerHealthRoutes(app, pool);
  await registerGoodsReceiptRoutes(app, pool);
  await registerPosRoutes(app, pool, {
    pepper,
    allowedOrigins,
    isProduction: env.NODE_ENV === 'production',
  });
  await registerGuestMenuRoutes(app, pool);
  await registerCompanyIdentityRoutes(app, pool);
  await registerIdentityRoutes(app, pool, {
    pepper,
    cookieSecure,
    allowedOrigins,
    isProduction: env.NODE_ENV === 'production',
  });
  // Dev admin: never register under NODE_ENV=production (no env override).
  await registerDevGuestMenuAdminRoutes(app, pool);
  await registerDevCashierBootstrapRoutes(app, pool);

  app.get('/', async () => ({
    name: 'MillQ API',
    layer: 'operational-core',
    version: '0.1.0-p1.2',
  }));

  const shutdown = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info({ port: env.PORT }, 'MillQ API listening');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
