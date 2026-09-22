/* eslint-disable no-console -- CLI output */
import { loadEnv } from '../config/env';
import { createDataStore } from './index';
import { DEMO_ACCOUNTS, seedDemo } from './seed';

const env = loadEnv();
const store = createDataStore(env);
await seedDemo(store, env);
console.log(`Seeded ${DEMO_ACCOUNTS.length} demo accounts into ${store.mode} store.`);
for (const a of DEMO_ACCOUNTS) console.log(`  ${a.phone}  ${a.roles.join('+').padEnd(20)} ${a.name}`);
console.log(`Login OTP (mock SMS): ${env.OTP_DEMO_CODE}`);
if (store.mode === 'memory') console.log('Note: memory mode seeds automatically on API boot; this run does not persist.');
await store.close();
