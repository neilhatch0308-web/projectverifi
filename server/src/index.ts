import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import demandRouter from './routes/demand';
import strategicGoalsRouter from './routes/strategicGoals';
import portfolioRouter from './routes/portfolio';
import usersRouter from './routes/users';
import scoringCriteriaRouter from './routes/scoringCriteria';
import businessCaseRouter from './routes/businessCase';
import portfolioBudgetRouter from './routes/portfolioBudget';
import annualPlanRouter from './routes/annualPlan';
import governanceRouter from './routes/governance';
import targetYearRouter from './routes/target-year-routes';
import draftsRouter from './routes/drafts';
import passwordResetRouter from './routes/passwordReset';

dotenv.config();
console.log('DATABASE_URL is:', JSON.stringify(process.env.DATABASE_URL));

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
app.use('/api', demandRouter);
app.use('/api', strategicGoalsRouter);
app.use('/api', portfolioRouter);
app.use('/api', usersRouter);
app.use('/api', scoringCriteriaRouter);
app.use('/api', businessCaseRouter);
app.use('/api', portfolioBudgetRouter);
app.use('/api', annualPlanRouter);
app.use('/api', governanceRouter);
app.use('/api', draftsRouter);
app.use(passwordResetRouter); // routes already declare their own /api/auth/... prefix internally


const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get('/health', async (_req, res) => {
  try {
    const result = await pool.query('SELECT now()');
    res.json({ status: 'ok', db_time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ status: 'error', message: (err as Error).message });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Ledger API listening on ${port}`));