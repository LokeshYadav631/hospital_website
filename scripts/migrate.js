'use strict';
const config = require('../src/lib/config');
const { open, migrate } = require('../src/lib/db');
const { seed } = require('../src/data/seed');
const { seedVerifiedDoctors } = require('../src/data/verified-doctors');
const db = open(config.dbPath);
const applied = migrate(db);
seed(db);
if (process.env.NODE_ENV !== 'test') {
  seedVerifiedDoctors(db);
}
console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database already up to date.');
console.log(`Database: ${config.dbPath}`);
