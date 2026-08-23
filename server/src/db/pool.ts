import dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

// Runs fn inside a transaction with app.current_org set for the duration,
// so every query issued via 'client' is subject to RLS for that tenant.
// set_config(..., true) is transaction-local - it can never leak across
// pooled connections between requests.
export async function withTenantContext<T>(
  organizationId: string,
  fn: (client: import('pg').PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_org', $1, true)`, [organizationId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}