import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadEnv } from './config.js';
import { createPool } from './db/pool.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerGoodsReceiptRoutes } from './routes/goods-receipts.js';
import { registerDevCashierBootstrapRoutes, registerPosRoutes } from './routes/pos.js';

async function main() {
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      base: { service: 'millq-api' },
    },
  });
  await app.register(cors, { origin: true });

  await registerHealthRoutes(app, pool);
  await registerGoodsReceiptRoutes(app, pool);
  await registerPosRoutes(app, pool);
  if (env.APP_ENV === 'local' || (env.APP_ENV === 'preview' && env.ALLOW_DEV_CASHIER_BOOTSTRAP === '1')) {
    await registerDevCashierBootstrapRoutes(app, pool);
  }

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
