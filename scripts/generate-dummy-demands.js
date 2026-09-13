#!/usr/bin/env node
// generate-dummy-demands.js
//
// Produces dummy-demands.json - 50 realistic demand records, spread
// across the 5 "Demo Portfolio" parents + their sub-portfolios (run
// seed-demo-portfolios.sql first), with at least 7 distinct owner
// slots used.
//
// Deliberately decoupled from the database: this script has no idea
// what your real portfolio UUIDs or user IDs actually are - it writes
// PORTFOLIO NAMES (matching seed-demo-portfolios.sql's naming) and
// OWNER SLOT INDEXES (0-9), and load-dummy-demands.js resolves both
// against your live database at load time. That way this file works
// against any environment, and regenerating it doesn't require this
// script to know anything about your data.
//
// Re-run any time for a fresh random set: `node generate-dummy-demands.js`

const fs = require('fs');

const PORTFOLIOS = [];
for (let i = 1; i <= 5; i++) {
  PORTFOLIOS.push(`Demo Portfolio ${i}`);
  // Sub-portfolio counts vary per parent (2-5, set at seed time) - we
  // don't know exactly how many exist without querying, so we only
  // ever reference sub 1 and 2, which seed-demo-portfolios.sql
  // guarantees exist for every parent (minimum is 2).
  PORTFOLIOS.push(`Demo Portfolio ${i} - Sub 1`);
  PORTFOLIOS.push(`Demo Portfolio ${i} - Sub 2`);
}

// 10 owner slots, so "at least 7 distinct users" has real headroom -
// the loader maps these onto however many real test users it finds,
// modulo the actual count if fewer than 10 exist.
const OWNER_SLOTS = 10;

const TITLE_THEMES = [
  ['Migrate', ['legacy CRM', 'on-prem file storage', 'invoicing system', 'HR records', 'print workflow', 'student records system', 'ticketing platform']],
  ['Automate', ['manual reconciliation', 'onboarding checklist', 'renewal reminders', 'expense approval', 'report distribution', 'data entry from PDFs']],
  ['Consolidate', ['duplicate supplier records', 'regional intranets', 'license management', 'customer contact data', 'approval workflows']],
  ['Upgrade', ['authentication to SSO', 'network infrastructure', 'reporting dashboard', 'mobile app', 'accessibility compliance']],
  ['Launch', ['self-service portal', 'internal knowledge base', 'customer feedback loop', 'automated testing pipeline']],
  ['Retire', ['end-of-life billing platform', 'unsupported scheduling tool', 'redundant spreadsheet trackers']],
  ['Improve', ['search relevance', 'page load performance', 'data quality in the warehouse', 'incident response time']],
];

const DIMENSION_TEMPLATES = {
  delivery: { name: 'Days to go live', unit: 'days' },
  adoption: { name: 'Active user adoption rate', unit: '%' },
  business: { name: 'Process cycle time reduction', unit: '%' },
  financial: { name: 'Net cost saving realised', unit: 'GBP' },
};

const COMPLEXITY = ['low', 'medium', 'high'];
const COST_TIER = ['low', 'medium', 'high'];
const RECOMMENDATIONS = ['proceed', 'proceed', 'proceed', 'no_recommendation', 'stop'];
const STOP_REASONS = [
  'Not the right time - deprioritised against higher-value work this year',
  'Doesn\'t stack up financially once assessed',
  'Superseded by a related initiative already in flight',
  'Dependency (platform migration) not yet ready',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
function randFloat(min, max, decimals = 2) { return Number((min + Math.random() * (max - min)).toFixed(decimals)); }

function makeTitle() {
  const [verb, objects] = pick(TITLE_THEMES);
  return `${verb} ${pick(objects)}`;
}

function makeSuccessMeasures() {
  // Every demand needs at least one (enforced server-side too - see
  // POST /demands). Real variety: 1-3 dimensions per demand, never
  // duplicating a dimension on the same demand.
  //
  // Baseline/target shape genuinely differs by dimension - not a
  // single "higher/lower" rule:
  //   delivery: days currently taking (high) -> fewer days (low)
  //   adoption / business (rate-type, %): starts low -> grows higher
  //   financial (a saving, GBP): starts at/near zero -> grows higher
  const dims = Object.keys(DIMENSION_TEMPLATES);
  const count = randInt(1, 3);
  const chosen = [...dims].sort(() => Math.random() - 0.5).slice(0, count);
  return chosen.map((dim) => {
    const t = DIMENSION_TEMPLATES[dim];
    let baseline;
    let target;
    if (dim === 'delivery') {
      baseline = randInt(60, 180); // days currently taking
      target = randInt(5, 30);     // fewer days after improvement
    } else if (dim === 'financial') {
      baseline = 0;                // no saving realised yet
      target = randInt(5, 100) * 1000; // GBP saving target
    } else {
      // adoption, business - both rate/percentage metrics that grow
      baseline = randInt(0, 20);
      target = randInt(60, 95);
    }
    return { dimension: dim, name: t.name, unit: t.unit, baselineValue: baseline, targetValue: target };
  });
}

const demands = [];

for (let n = 1; n <= 50; n++) {
  const portfolioName = pick(PORTFOLIOS);
  const ownerIndex = randInt(0, OWNER_SLOTS - 1);
  const claimedCost = randInt(3, 250) * 1000;
  const claimedBenefit = Math.round(claimedCost * randFloat(0.8, 3.5, 2));

  // Realistic status spread, roughly matching how a real pipeline
  // looks: most things still early, fewer further along, a handful
  // stopped.
  const statusRoll = Math.random();
  let status;
  if (statusRoll < 0.30) status = 'raised';
  else if (statusRoll < 0.50) status = 'accepted';
  else if (statusRoll < 0.72) status = 'assessed';
  else if (statusRoll < 0.90) status = 'promoted';
  else status = 'stopped';

  const demand = {
    title: makeTitle(),
    description: 'Dummy test data generated for demo/testing purposes.',
    portfolioName,
    ownerIndex,
    status,
    complexityTier: pick(COMPLEXITY),
    costTier: pick(COST_TIER),
    claimedCost,
    claimedBenefit,
    confidential: n % 11 === 0, // roughly 4-5 of the 50
    successMeasures: makeSuccessMeasures(),
  };

  // Stopped demands can be stopped from raised/accepted/assessed -
  // reason always required, matching the real Stop action.
  if (status === 'stopped') {
    demand.stopReason = pick(STOP_REASONS);
    // Give some stopped demands an assessment first (stopped after
    // being assessed), and some not (stopped earlier) - real variety.
    if (Math.random() < 0.5) {
      demand.assessedCost = Math.round(claimedCost * randFloat(0.9, 1.4, 2));
      demand.assessedBenefit = Math.round(claimedBenefit * randFloat(0.6, 1.1, 2));
      demand.recommendation = 'stop';
    }
  }

  if (status === 'assessed' || status === 'promoted') {
    demand.assessedCost = Math.round(claimedCost * randFloat(0.9, 1.5, 2));
    demand.assessedBenefit = Math.round(claimedBenefit * randFloat(0.6, 1.2, 2));
    demand.recommendation = pick(RECOMMENDATIONS);
  }

  // A handful of confidential demands get one named viewer, by owner
  // slot - the loader resolves this the same way as ownerIndex.
  if (demand.confidential) {
    demand.confidentialViewerIndex = randInt(0, OWNER_SLOTS - 1);
  }

  demands.push(demand);
}

const distinctOwners = new Set(demands.map((d) => d.ownerIndex)).size;

fs.writeFileSync('dummy-demands.json', JSON.stringify(demands, null, 2));

console.log(`Wrote ${demands.length} demands to dummy-demands.json`);
console.log(`Distinct owner slots used: ${distinctOwners} (need >= 7)`);
console.log('Status spread:', demands.reduce((acc, d) => { acc[d.status] = (acc[d.status] || 0) + 1; return acc; }, {}));
