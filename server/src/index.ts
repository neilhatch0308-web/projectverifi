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

dotenv.config();
console.log('DATABASE_URL is:', JSON.stringify(process.env.DATABASE_URL));

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use('/api', demandRouter);
app.use('/api', strategicGoalsRouter);
app.use('/api', portfolioRouter);
app.use('/api', usersRouter);
app.use('/api', scoringCriteriaRouter);

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
