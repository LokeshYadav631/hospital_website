'use strict';
const config = require('./lib/config');
const { open, migrate } = require('./lib/db');
const { seed } = require('./data/seed');
const { seedVerifiedDoctors } = require('./data/verified-doctors');
const { seedAdmin } = require('./data/seed-admin');
const { createApp } = require('./web/app');
const { getProvider } = require('./services/sms-providers');
const { getProvider: getEmailProvider } = require('./services/email-providers');

const db = open(config.dbPath);
const applied = migrate(db);
seed(db);
if (process.env.NODE_ENV !== 'test') {
  seedVerifiedDoctors(db);
  seedAdmin(db);
}
if (applied.length) console.log('Applied migrations:', applied.join(', '));

const server = createApp(db);

if (config.isServerless || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
  module.exports = (req, res) => {
    if (typeof server.handle === 'function') {
      server.handle(req, res);
    } else {
      server.emit('request', req, res);
    }
  };
} else {
  server.listen(config.port, () => {
    server.startBackground();
    console.log(`SACHKHAND HOSPITAL site listening on ${config.baseUrl} (port ${config.port})`);
    console.log(`SMS provider: ${getProvider() ? getProvider().name : 'not configured (no SMS will be sent)'}`);
    console.log(`Email provider: ${getEmailProvider() ? getEmailProvider().name : 'not configured (no email will be sent)'}`);
    const n = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    if (!n) console.log('No admin user yet. Run:  npm run create-admin');
  });
  const stop = () => { server.stopBackground(); server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('unhandledRejection', (reason) => {
    console.error('[Process] Unhandled Promise Rejection:', reason && reason.message ? reason.message : reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[Process] Uncaught Exception:', err && err.message ? err.message : err);
    stop();
  });
}
