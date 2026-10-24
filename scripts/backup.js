'use strict';
// Consistent online backup of the SQLite database (safe while the site is running).
//   npm run backup            -> backups/hospital-YYYYMMDD-HHMMSS.db
const fs = require('fs');
const path = require('path');
const { backup } = require('node:sqlite');
const config = require('../src/lib/config');
const { open } = require('../src/lib/db');
(async () => {
  const dir = path.join(config.ROOT, 'backups'); fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/^(\d{8})(\d{6})$/, '$1-$2');
  const out = path.join(dir, `hospital-${stamp}.db`);
  const db = open(config.dbPath);
  await backup(db, out);
  fs.chmodSync(out, 0o600);
  console.log(`Backup written: ${out}`);
})();
