require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool } = require('./index');

async function seed() {
  try {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD;
    // SECURITY: require explicit password. The old fallback `'admin123'` was
    // a real risk — a fresh deployment with a missing .env would ship with
    // a publicly-known default. Fail loudly instead.
    if (!password || password.length < 8) {
      console.error('[seed] FATAL: ADMIN_PASSWORD env var must be set (min 8 chars).');
      console.error('[seed]        Set it in your .env file before running db:seed.');
      process.exit(1);
    }
    const hash = await bcrypt.hash(password, 12);

    await pool.query(
      `INSERT INTO admins (email, password_hash, role, display_name)
       VALUES ($1, $2, 'owner', $1)
       ON CONFLICT (email) DO UPDATE SET password_hash = $2, role = 'owner'`,
      [username, hash]
    );

    console.log(`Admin user "${username}" created/updated.`);
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
}

seed();
