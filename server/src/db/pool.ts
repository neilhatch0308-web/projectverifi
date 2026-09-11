import dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';

// Two connection modes, chosen by environment, not by editing this file
// per-deploy:
//
// - LOCAL DEV (unchanged): DATABASE_URL, talking to the Cloud SQL Auth
//   Proxy on localhost, exactly as it always has.
// - CLOUD RUN: no Auth Proxy process to run alongside it there - Cloud
//   Run's native Cloud SQL support is a Unix socket at
//   /cloudsql/PROJECT:REGION:INSTANCE instead. Selected automatically
//   when INSTANCE_CONNECTION_NAME is set (only set in the Cloud Run
//   service config, never locally), so this file doesn't need touching
//   between environments - only the deploy config does.
const isCloudRun = !!process.env.INSTANCE_CONNECTION_NAME;

export const pool = isCloudRun
  ? new Pool({
      host: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      max: 10,
      idleTimeoutMillis: 30000,
      // pg's default is NO connection timeout at all - a slow or wedged
      // Cloud SQL socket would otherwise hang any caller (including the
      // boot-time RLS check) indefinitely rather than failing loudly.
      connectionTimeoutMillis: 10000,
    })
  : new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
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