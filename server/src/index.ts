import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { pool } from './db/pool';
import demandRouter from './routes/demand';
import strategicGoalsRouter from './routes/strategicGoals';
import portfolioRouter from './routes/portfolio';
import usersRouter from './routes/users';
import scoringCriteriaRouter from './routes/scoringCriteria';
import businessCaseRouter from './routes/businessCase';
import changeControlRouter from './routes/changeControl';
import changeResponsesRouter from './routes/changeResponses';
import portfolioBudgetRouter from './routes/portfolioBudget';
import annualPlanRouter from './routes/annualPlan';
import governanceRouter from './routes/governance';
import targetYearRouter from './routes/target-year-routes';
import draftsRouter from './routes/drafts';
import deliveryRouter from './routes/delivery';
import passwordResetRouter from './routes/passwordReset';
import reportingRouter from './routes/reporting';

dotenv.config();
// NEVER log DATABASE_URL (or any other connection string) - it can carry
// a plaintext password (local dev / non-Cloud-Run environments) and this
// ran on every boot, landing that credential in Cloud Logging. Removed
// outright rather than redacted - nothing downstream actually needs this
// printed, and a partially-redacted version is one refactor away from
// becoming a full leak again.

const app = express();
app.use(helmet());

// Wide-open cors() was fine while this only ran locally; now it's reachable
// over the public web it should only answer preflight/CORS checks for the
// real frontend origin(s). ALLOWED_ORIGINS is a comma-separated list (e.g.
// "https://ledger-rpvf-prod.web.app,https://we-verifi.co.uk") set in the
// Cloud Run env config - not hardcoded here since the exact domain(s) are
// deployment config, not application logic. Falls back to no origins
// (same-origin-only) rather than wide-open if the env var is unset, so a
// missed config step fails closed, not open.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // No Origin header = same-origin request (e.g. curl, server-to-server) - allow.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not permitted by CORS policy`));
    }
  },
}));
app.use(express.json());
app.use('/api', targetYearRouter); // must come before demandRouter -- /demands/horizon would otherwise be caught by demand.ts's /demands/:id and treated as an invalid demand id
app.use('/api', deliveryRouter); // same reason -- /demands/active-initiatives would otherwise be caught by /demands/:id
app.use('/api', demandRouter);
app.use('/api', strategicGoalsRouter);
app.use('/api', portfolioRouter);
app.use('/api', usersRouter);
app.use('/api', scoringCriteriaRouter);
app.use('/api', businessCaseRouter);
app.use('/api', changeControlRouter);
app.use('/api', changeResponsesRouter);
app.use('/api', portfolioBudgetRouter);
app.use('/api', annualPlanRouter);
app.use('/api', governanceRouter);
app.use('/api', draftsRouter);
app.use('/api', reportingRouter);
app.use(passwordResetRouter); // routes already declare their own /api/auth/... prefix internally

// Reuse the same pool everything else uses (server/src/db/pool.ts) rather
// than opening a second, untracked one here - a second pool for a health
// check is a harmless-looking pattern that's also the easiest thing to
// copy-paste the day someone extends /health to query real, tenant-scoped
// data and forgets withTenantContext exists.
app.get('/health', async (_req, res) => {
  try {
    const result = await pool.query('SELECT now()');
    res.json({ status: 'ok', db_time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ status: 'error', message: (err as Error).message });
  }
});

const port = process.env.PORT || 8080;

// Cloud Run's own health check is a plain TCP probe on this port - it
// does not wait for the app to be "ready", it just needs something
// listening. Gating app.listen() behind ANY async work (a DB round
// trip, in particular) is the exact anti-pattern that causes a
// container to be killed as "failed to start and listen on port
// within timeout" if that async work is ever slow, or hangs outright
// on a connection that never resolves (pg's default pool has NO
// connection timeout - see db/pool.ts). Bind the port first, always,
// then do readiness checks after.
app.listen(port, () => console.log(`Ledger API listening on ${port}`));

// Boot-time RLS self-test (12_row_level_security.sql) - runs AFTER the
// port is already open, with its own hard timeout, so a slow or hung
// DB connection can never block Cloud Run's startup probe.
//
// DELIBERATELY NON-FATAL. An earlier version of this called
// process.exit(1) on failure and took production down in a crash
// loop: migration 12 enabled RLS by scanning the schema ONCE, so six
// organization_id tables created after it (portfolio_budget,
// portfolio_budget_transfer, annual_plan, governance_tier,
// portfolio_budget_adjustment, role - migrations 27-34) never got a
// policy, and the check correctly failed every single boot.
//
// The lesson isn't "don't check" - the check found a real gap. It's
// that a startup assertion about a PRE-EXISTING condition must not be
// fatal: the gap it detects has been true for months, and refusing to
// serve traffic today doesn't close it, it just removes the service.
// Log it loudly, keep serving, fix the schema in a migration.
// Migration 56 closes the specific gap above; this stays non-fatal
// regardless, so the next time a new table misses a policy the result
// is a screaming log line, not an outage.
const RLS_CHECK_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

withTimeout(pool.query('SELECT assert_rls_coverage()'), RLS_CHECK_TIMEOUT_MS, 'RLS coverage check')
  .then(() => console.log('RLS coverage check passed.'))
  .catch((err) => {
    console.error(
      '*** RLS COVERAGE CHECK FAILED - SERVING ANYWAY, FIX THIS ***\n' +
      (err as Error).message
    );
  });