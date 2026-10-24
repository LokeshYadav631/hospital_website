'use strict';
const path = require('path');
const fs = require('fs');

let appInstance = null;
let initError = null;

function getApp() {
  if (appInstance) return appInstance;
  if (initError) throw initError;

  try {
    const config = require('../src/lib/config');
    const { open, migrate } = require('../src/lib/db');
    const { seed } = require('../src/data/seed');
    const { seedVerifiedDoctors } = require('../src/data/verified-doctors');
    const { createApp } = require('../src/web/app');

    let db;
    // On serverless Vercel / AWS Lambda, use /tmp for writeable SQLite database
    const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    const dbPath = isServerless ? path.join('/tmp', 'hospital.db') : config.dbPath;

    try {
      db = open(dbPath);
      migrate(db);
      seed(db);
      seedVerifiedDoctors(db);
    } catch (dbErr) {
      // In case opening at target failed, fallback to /tmp/hospital.db
      if (dbPath !== path.join('/tmp', 'hospital.db')) {
        const fallbackPath = path.join('/tmp', 'hospital.db');
        db = open(fallbackPath);
        migrate(db);
        seed(db);
        seedVerifiedDoctors(db);
      } else {
        throw dbErr;
      }
    }

    appInstance = createApp(db);
    return appInstance;
  } catch (err) {
    initError = err;
    throw err;
  }
}

module.exports = async (req, res) => {
  try {
    const app = getApp();
    if (typeof app.handle === 'function') {
      await app.handle(req, res);
    } else {
      app.emit('request', req, res);
    }
  } catch (err) {
    console.error('Serverless Handler Error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>500 Diagnostic Error - Sachkhand Hospital</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; background: #fafafa; color: #202124; line-height: 1.6; }
    .card { background: white; border: 1px solid #dadce0; border-radius: 8px; padding: 24px; max-width: 800px; margin: 0 auto; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1 { color: #d93025; font-size: 22px; margin-top: 0; }
    pre { background: #f1f3f4; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Hospital System Initialization Error</h1>
    <p><strong>Node.js Version:</strong> ${process.version}</p>
    <p><strong>Error Message:</strong> ${err.message}</p>
    <pre>${err.stack || err}</pre>
  </div>
</body>
</html>`);
  }
};
