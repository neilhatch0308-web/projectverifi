#!/usr/bin/env node
// load-dummy-demands.js
//
// Reads dummy-demands.json and loads it into the database. Resolves
// portfolio names -> real portfolio_id and owner slot indexes -> real
// app_user id AT LOAD TIME, by querying the live database - the JSON
// data file never hardcodes a UUID for either, so it stays valid
// however many times seed-demo-portfolios.sql or your user list
// change between generating and loading.
//
// Run seed-demo-portfolios.sql BEFORE this - it needs those "Demo
// Portfolio *" rows to already exist to resolve portfolioName against.
//
// Usage (always connects over TCP - run this from your machine against
// the Cloud SQL Auth Proxy, same as every psql command this session,
// never from inside Cloud Run itself):
//   DB_USER=postgres DB_PASSWORD=... DB_NAME=postgres node load-dummy-demands.js
// or, if you already export DATABASE_URL for local dev:
//   DATABASE_URL=postgres://... node load-dummy-demands.js
//
// Everything runs in ONE transaction - review the summary printed at
// the end, then either let it commit (default) or set DRY_RUN=1 to
// roll back automatically after showing you what would have happened.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ORG_ID = process.env.ORG_ID || '11111111-1111-1111-1111-111111111111';
const DRY_RUN = process.env.DRY_RUN === '1';

async function main() {
  const dataPath = path.join(__dirname, 'dummy-demands.json');
  const demands = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  console.log(`Loaded ${demands.length} demand records from ${dataPath}`);

  // Fail with a clear, actionable message here rather than letting an
  // undefined password reach pg's SASL auth code, which throws a cryptic
  // "client password must be a string" several layers down with no hint
  // about what's actually missing.
  if (!process.env.DATABASE_URL && !process.env.DB_PASSWORD) {
    console.error(
      '\nDB_PASSWORD is not set (and DATABASE_URL is not set either).\n' +
      'In PowerShell, set it for this session before running the script:\n' +
      '  $env:DB_PASSWORD = "your-postgres-password"\n' +
      'then run this script again in the same terminal window.\n'
    );
    process.exitCode = 1;
    return;
  }

  // This is a standalone local tool, run from your machine against the
  // Cloud SQL Auth Proxy - it never runs inside Cloud Run itself, unlike
  // the real app (server/src/db/pool.ts), which is where that Unix-socket
  // convention actually belongs. Borrowing that same INSTANCE_CONNECTION_
  // NAME check here was the bug: set-env.ps1 sets that variable locally
  // too (for other scripts' benefit), so the check couldn't tell "in
  // Cloud Run" apart from "on Windows, with that variable merely set" -
  // and /cloudsql/... Unix sockets don't exist on Windows at all regardless.
  //
  // Always connects over TCP now. DATABASE_URL wins if set; otherwise
  // falls back to the same localhost:5432 + DB_USER/DB_PASSWORD/DB_NAME
  // convention every psql command this session has used against the
  // Cloud SQL Auth Proxy.
  const client = process.env.DATABASE_URL
    ? new Client({ connectionString: process.env.DATABASE_URL })
    : new Client({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 5432,
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'postgres',
      });

  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_org', $1, true)`, [ORG_ID]);

    // ---------- Resolve portfolios by name ----------
    const portfolioRows = (await client.query(
      `SELECT id, name, parent_portfolio_id FROM portfolio WHERE organization_id = $1 AND name LIKE 'Demo Portfolio%'`,
      [ORG_ID]
    )).rows;
    // demand.portfolio_id must ALWAYS be a PARENT portfolio (raising
    // portfolio) - a sub-portfolio categorization is a SEPARATE column
    // (delivering_sub_portfolio_id). The bug this replaces: treating
    // "Demo Portfolio 1" and "Demo Portfolio 1 - Sub 1" as
    // interchangeable and writing whichever one the JSON named straight
    // into portfolio_id. All Demand's portfolio filter only lists and
    // matches against parent IDs, so any demand that ended up with a
    // sub-portfolio's ID in portfolio_id could never match any filter
    // selection - it was invisible the moment you filtered by portfolio,
    // present only under "All portfolios". Resolving name -> {parentId,
    // subId} here, once, is what fixes that for every demand at once.
    const portfolioByName = new Map(portfolioRows.map((r) => [r.name, r]));
    if (portfolioByName.size === 0) {
      throw new Error('No "Demo Portfolio*" rows found - run seed-demo-portfolios.sql first');
    }
    console.log(`Resolved ${portfolioByName.size} demo portfolios`);

    // ---------- Resolve owner users ----------
    const userRows = (await client.query(
      `SELECT id, display_name FROM app_user WHERE organization_id = $1 AND is_active = true ORDER BY created_at LIMIT 20`,
      [ORG_ID]
    )).rows;
    if (userRows.length < 7) {
      console.warn(`WARNING: only ${userRows.length} active users found - requested "at least 7 distinct owners" cannot be fully met`);
    }
    console.log(`Resolved ${userRows.length} candidate owner(s): ${userRows.map((u) => u.display_name).join(', ')}`);

    // ---------- Resolve active scoring criteria (for realistic priority scores) ----------
    const criteriaRows = (await client.query(
      `SELECT id, name, max_points, is_fixed FROM scoring_criterion WHERE organization_id = $1 AND active = true`,
      [ORG_ID]
    )).rows;
    console.log(`Resolved ${criteriaRows.length} active scoring criteria`);
    const financialTrigger = criteriaRows.find((c) => /financial|revenue/i.test(c.name));

    const FIXED_LEVELS = [0, 5, 10, 15, 20];
    function randomScoreFor(criterion) {
      if (criterion.is_fixed) return FIXED_LEVELS[Math.floor(Math.random() * FIXED_LEVELS.length)];
      return Math.round(Math.random() * Number(criterion.max_points));
    }

    let inserted = 0;
    let skipped = 0;

    for (const d of demands) {
      const p = portfolioByName.get(d.portfolioName);
      if (!p) {
        console.warn(`Skipping "${d.title}" - portfolio "${d.portfolioName}" not found`);
        skipped++;
        continue;
      }
      // If the named portfolio IS a sub (has a parent), the raising
      // portfolio is its PARENT and the sub itself becomes the
      // delivering_sub_portfolio_id. If it's already a parent, there's
      // no sub-portfolio categorization for this demand.
      const portfolioId = p.parent_portfolio_id ?? p.id;
      const subPortfolioId = p.parent_portfolio_id ? p.id : null;

      const owner = userRows.length > 0 ? userRows[d.ownerIndex % userRows.length] : null;
      if (!owner) {
        console.warn(`Skipping "${d.title}" - no users available to own it`);
        skipped++;
        continue;
      }

      const demandId = (await client.query(
        `INSERT INTO demand
           (id, organization_id, portfolio_id, delivering_sub_portfolio_id, title, description, raised_by, status,
            complexity_tier, cost_tier, claimed_cost, claimed_benefit, confidential,
            triaged_by, triaged_at, accepted_at, stopped_by, stopped_at, stop_reason)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::uuid, $7, $8, $9, $10, $11, $12,
            CASE WHEN $7 IN ('accepted','assessed','promoted','stopped') THEN $6::uuid END,
            CASE WHEN $7 IN ('accepted','assessed','promoted','stopped') THEN now() - (random() * interval '60 days') END,
            CASE WHEN $7 = 'promoted' THEN now() - (random() * interval '20 days') END,
            CASE WHEN $7 = 'stopped' THEN $6::uuid END,
            CASE WHEN $7 = 'stopped' THEN now() - (random() * interval '30 days') END,
            $13)
         RETURNING id`,
        [ORG_ID, portfolioId, subPortfolioId, d.title, d.description, owner.id, d.status,
         d.complexityTier, d.costTier, d.claimedCost, d.claimedBenefit, d.confidential,
         d.stopReason ?? null]
      )).rows[0].id;

      // Success measures - at least one, always. Mirrors the server's
      // own financial-trigger rule (POST /demands) for realistic data:
      // if this demand's random scoring pushes the Financial/Revenue
      // Impact criterion to 15+, make sure a 'financial' measure
      // exists even if the static data file didn't already include one.
      const measures = [...d.successMeasures];

      // Priority scoring - every active criterion gets a score, same
      // as a real raise would require (IncompleteScoring rule).
      const scores = {};
      for (const c of criteriaRows) {
        scores[c.id] = randomScoreFor(c);
      }
      if (financialTrigger && scores[financialTrigger.id] >= 15 && !measures.some((m) => m.dimension === 'financial')) {
        measures.push({ dimension: 'financial', name: 'Net cost saving realised', unit: 'GBP', baselineValue: 0, targetValue: randInt(5000, 50000) });
      }
      for (const c of criteriaRows) {
        await client.query(
          `INSERT INTO demand_score (id, demand_id, criterion_id, score_awarded, rationale, scored_by)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
          [demandId, c.id, scores[c.id], 'Dummy test data', owner.id]
        );
      }

      for (const m of measures) {
        await client.query(
          `INSERT INTO kpi_definition (id, organization_id, demand_id, name, dimension, unit, baseline_value, target_value, is_original)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, true)`,
          [ORG_ID, demandId, m.name, m.dimension, m.unit, m.baselineValue, m.targetValue]
        );
      }

      // Assessment, for anything assessed/promoted/stopped-after-assessment.
      // No organization_id column on this table - it scopes purely
      // through demand_id, unlike the newer audit tables added this
      // session. Confirmed against the real schema dump, not assumed.
      if (d.assessedCost !== undefined) {
        await client.query(
          `INSERT INTO demand_assessment (id, demand_id, assessed_cost, assessed_benefit, assessed_by, assessed_at, recommendation)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, now() - (random() * interval '15 days'), $5)`,
          [demandId, d.assessedCost, d.assessedBenefit, owner.id, d.recommendation ?? 'no_recommendation']
        );
      }

      // Business case - REQUIRED for any 'promoted' demand. The real
      // app's promote action (POST /demands/:id/accept) creates this
      // row atomically together with setting status='promoted' - they
      // can never exist apart in the live system. An earlier version
      // of this loader set status='promoted' without ever creating
      // this row, producing "impossible" data: no "View business case"
      // link (gated on businessCaseId existing), Delivery Tracking
      // showing anyway (that panel never checked for a business case
      // at all - see the DemandDetail.tsx fix alongside this one), and
      // permanent invisibility on Active Initiatives (that route inner-
      // joins business_case, so a promoted demand with none is
      // silently excluded, always).
      //
      // Decision is randomized with real spread so the Approve/Decline
      // workflow and Active Initiatives both have something to test
      // against, not just a pile of eternally-pending cases.
      if (d.status === 'promoted') {
        const decisionRoll = Math.random();
        const decision = decisionRoll < 0.55 ? 'approved' : decisionRoll < 0.75 ? 'declined' : 'pending';
        const requestedSpend = d.assessedCost ?? d.claimedCost;

        const businessCaseId = (await client.query(
          `INSERT INTO business_case
             (id, organization_id, portfolio_id, demand_id, title, submitted_by, requested_spend,
              decision, decision_date, executive_summary)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7,
              CASE WHEN $7 != 'pending' THEN (now() - (random() * interval '10 days'))::date END,
              $8)
           RETURNING id`,
          [ORG_ID, portfolioId, demandId, d.title, owner.id, requestedSpend, decision,
           'Dummy test data - business case summary for demo/testing purposes.']
        )).rows[0].id;

        if (decision === 'approved') {
          await client.query(
            `INSERT INTO investment (id, business_case_id, approved_amount, actual_spend_to_date)
             VALUES (gen_random_uuid(), $1, $2, $3)`,
            [businessCaseId, requestedSpend, Math.round(Number(requestedSpend) * Math.random() * 0.6)]
          );
        }
      }

      if (d.confidential && d.confidentialViewerIndex !== undefined && userRows.length > 0) {
        const viewer = userRows[d.confidentialViewerIndex % userRows.length];
        if (viewer.id !== owner.id) {
          await client.query(
            `INSERT INTO demand_confidential_viewer (id, organization_id, demand_id, user_id, added_by)
             VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
            [ORG_ID, demandId, viewer.id, owner.id]
          );
        }
      }

      inserted++;
    }

    console.log(`\nInserted ${inserted} demand(s), skipped ${skipped}`);

    if (DRY_RUN) {
      console.log('DRY_RUN=1 set - rolling back, nothing was actually saved.');
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
      console.log('Committed.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

main();