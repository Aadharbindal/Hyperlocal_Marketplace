import { buildApp } from './app';

const app = await buildApp();
const { env, adapters } = app.ctx;

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  const mocked = Object.values(adapters).filter((a) => a.isMock).map((a) => a.name);
  app.log.info({ dataMode: app.ctx.store.mode, mocked }, `${env.BRAND_NAME} API listening on http://${env.API_HOST}:${env.API_PORT}`);
  if (mocked.length) app.log.warn(`Mocked adapters (not live): ${mocked.join(', ')}`);
  if (adapters.sms.isMock) app.log.warn(`Mock SMS: use OTP ${env.OTP_DEMO_CODE} for any phone number`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
