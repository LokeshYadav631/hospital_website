'use strict';
const path = require('path');
const fs = require('fs');
const config = require('../src/lib/config');
const { open, migrate } = require('../src/lib/db');
const { seed } = require('../src/data/seed');
const { seedVerifiedDoctors } = require('../src/data/verified-doctors');
const { createApp } = require('../src/web/app');

// Initialize database instance
let database;
function getDatabase() {
  if (database) return database;
  
  let targetPath = config.dbPath;
  try {
    database = open(targetPath);
    migrate(database);
    seed(database);
    seedVerifiedDoctors(database);
    return database;
  } catch (err) {
    // If read-only filesystem (typical on serverless AWS Lambda / Vercel), fallback to writable /tmp
    const tmpDir = '/tmp';
    const tmpPath = path.join(tmpDir, 'hospital.db');
    try {
      if (fs.existsSync(targetPath)) {
        fs.copyFileSync(targetPath, tmpPath);
      }
    } catch {
      // Ignore copy error if source not found
    }
    database = open(tmpPath);
    migrate(database);
    seed(database);
    seedVerifiedDoctors(database);
    return database;
  }
}

const db = getDatabase();
const app = createApp(db);

// Export standard Node.js (req, res) handler for Vercel Serverless
module.exports = (req, res) => {
  app.emit('request', req, res);
};
