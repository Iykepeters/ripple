import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const schemaPath = path.resolve(__dirname, 'schema.sql');
const schemaSql = fs.readFileSync(schemaPath, 'utf8');

try {
  console.log('Running schema.sql against DATABASE_URL...');
  await pool.query(schemaSql);
  console.log('✅ Schema applied successfully.');

  const { rows } = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `);
  console.log('Tables now in database:', rows.map(r => r.table_name));
} catch (err) {
  console.error('❌ Migration failed');
  console.error('Message:', err.message);
  console.error('Full error:', err);
} finally {
  await pool.end();
}