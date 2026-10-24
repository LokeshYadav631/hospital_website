'use strict';
// Secure initial administrator setup.
//   Interactive:      npm run create-admin
//   Non-interactive:  ADMIN_EMAIL=... ADMIN_NAME=... ADMIN_PASSWORD=... npm run create-admin
const readline = require('readline');
const config = require('../src/lib/config');
const { open, migrate, get, run } = require('../src/lib/db');
const { seed } = require('../src/data/seed');
const sec = require('../src/lib/security');
const { EMAIL } = require('../src/lib/validation');

function ask(rl, q, hidden) {
  return new Promise((res) => {
    if (hidden) { rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); else if (s === '\r\n' || s === '\n') process.stdout.write(s); }; }
    rl.question(q, (a) => { rl._writeToOutput = (s) => process.stdout.write(s); res(a); });
  });
}
(async () => {
  const db = open(config.dbPath); migrate(db); seed(db);
  const existing = get(db, "SELECT COUNT(*) c FROM users WHERE role='super_admin'").c;
  let email = process.env.ADMIN_EMAIL, name = process.env.ADMIN_NAME, password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (existing) console.log(`Note: ${existing} super administrator(s) already exist. Creating another one.`);
    email = await ask(rl, 'Admin email: '); name = await ask(rl, 'Full name: ');
    password = await ask(rl, 'Password (min 12 chars, letters + a digit): ', true); rl.close();
  }
  email = String(email).trim().toLowerCase(); name = String(name || 'Administrator').trim();
  const problem = sec.passwordProblem(password);
  if (!EMAIL.test(email)) { console.error('Invalid email.'); process.exit(1); }
  if (problem) { console.error(problem); process.exit(1); }
  if (get(db, 'SELECT 1 FROM users WHERE email=?', email)) { console.error('A user with that email already exists.'); process.exit(1); }
  run(db, "INSERT INTO users(email,name,password_hash,role) VALUES (?,?,?, 'super_admin')", email, name, await sec.hashPassword(password));
  console.log(`Super administrator created: ${email}\nSign in at ${config.baseUrl}/admin/login`);
})();
