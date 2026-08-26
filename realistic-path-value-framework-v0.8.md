# The Realistic Path Value Framework (RPVF)

**A demand-to-outcome success framework for multi-tenant delivery.**

Version 0.8 — implementation update
Date: 26 August 2026
Supersedes: v0.7 (direction revision)

---

## 0. What changed in v0.8, and why

v0.7 set the direction: annual planning as the primary use case, P50/P75/P100
confidence, the anchored claim. v0.8 is the report back — **the direction is
now real, working software**, not a design intent, plus two structural
decisions that emerged while building it and materially change how demand
attaches to budget.

**Built since v0.7, genuinely working:**
- Date driver capture at raise (fixed vs. discretionary)
- The P75 assessment stage, with the anchored claim visible as a
  claimed-vs-assessed comparison on every demand
- The distinct `stopped` status, separate from `rejected`
- The annual planning board itself — envelope maths, fixed/discretionary
  split, drag-and-drop placement, versioned agree/revise

**Two decisions made during the build that v0.7 didn't anticipate:**

1. **Portfolios are now two-level.** A parent portfolio (Front Office, Back
   Office, Products) holds the single budget line; sub-portfolios (ERP, HR,
   Payments, Sales, Marketing) are what demand actually tags against for
   delivery, with costs rolling up to the parent automatically. This wasn't
   in v0.7 at all — it emerged from a direct question about how real
   organisations actually structure technology spend, and it materially
   sharpens the planning board's usefulness.

2. **Delivering assignment moved out of Raise Demand entirely.** v0.7 didn't
   specify when delivery gets decided; building it surfaced that the
   conceiver genuinely doesn't know at raise which technical team will end
   up delivering the work. Assignment now happens later — typically at
   assessment, changeable up to planning — defaults to "not yet categorised"
   rather than a guess, and every change is logged.

---

## 1. Purpose

Unchanged from v0.7. The organising idea remains the **golden thread**, now
extended by the anchored claim (§2b) to cover estimates as well as success
criteria.

---

## 2a. Estimate confidence — P50 / P75 / P100

**[BUILT, unchanged from v0.7's design]** `demand.claimed_cost` and
`claimed_benefit` are captured at raise, required fields, genuinely enforced.
`demand_assessment` records P75 figures alongside the claim, never
overwriting it. The planning board consumes only `assessed` demand — the P75
stage is a hard gate before anything is plannable, not an optional refinement.

---

## 2b. The anchored claim

**[BUILT]** Every demand's detail page shows claimed vs. assessed vs.
movement, side by side, for both cost and benefit — including the case where
they're identical ("unchanged from claim," rendered as a legitimate neutral
result, not an absence of data). The principle from v0.7 holds exactly as
written: assessment tests the claim, it does not replace it.

---

## 3. The lifecycle spine

**[BUILT, matches v0.7's design with one addition]**

```
Raise (P50: claimed cost, claimed benefit, raising PARENT portfolio)
  │  delivering sub-portfolio: NOT asked here - unknown at this point
  ▼
Triage — complexity + cost tier required, Accept/Reject
  │
  ▼
Accepted
  │
  ▼
Assessment (P75) — cost + benefit assessed, confidence stated separately
  │  delivering sub-portfolio: typically assigned HERE, but optional even now
  ├──▶ Stopped  "economics collapsed under scrutiny"
  ▼
Assessed — plannable
  │
  ▼
Annual Planning board (per PARENT portfolio, per year)
  All / In Budget / Deferred, drag-and-drop
  Only demand delivered by (or uncategorised within) this parent appears
  │
  ├──▶ Deferred  (reason required; fixed-date breach flagged, not blocked)
  ▼
Agreed plan (versioned) ──▶ RACI naming ──▶ criteria locked ──▶ Business Case
  │
  ▼
[NOT BUILT: Delivery, Adoption, Realisation, Variance, Rollup]
```

**Delivering sub-portfolio assignment is now explicitly a separate track from
status.** It can happen at assessment, later, or never (in which case the
demand's cost simply counts toward the *raising* parent portfolio's budget
indefinitely — a legitimate, non-error state, not a thing that blocks
planning).

---

## 3a. Annual planning

**[BUILT — this is the real headline of v0.8]**

Every mechanic v0.7 specified is implemented and working:

- **A plan is scoped to one parent portfolio and one year.** Corporate
  visibility across portfolios is a query over multiple plans, not a shared
  board — matching "portfolio leads plan their own slice."
- **The envelope header shows fixed / genuine choice remaining /
  discretionary committed**, exactly as designed, computed from real assessed
  figures via `annual_plan_totals`.
- **Flags, never blocks** — both overspend and a fixed-date item sitting in
  Deferred are surfaced with an explicit warning and remain agreeable.
- **Drag-and-drop**, not buttons — cards drag between columns; dropping on
  Deferred still opens a reason prompt regardless of how the move happened.
- **Versioned, agreed plans.** Agreeing locks the plan (`status = 'agreed'`,
  cards stop being draggable). A "start mid-year revision" action clones the
  agreed plan's placements into a new draft version and marks the original as
  superseded — the original stays exactly as agreed, permanently, for
  comparison. This is the preserved-original thesis, genuinely applied to
  planning, not just designed for it.
- **Only `assessed` demand appears.** This is the P75 stage's entire
  justification made concrete — nothing gets planned against a raw claim or a
  tier guess.

---

## 3b. Portfolio hierarchy [NEW IN v0.8]

Not anticipated in v0.7. Portfolios are **technology spending categories**,
not a mirror of the org chart — a parent like Back Office covers ERP, HR,
Payments, Subscriptions as sub-portfolios; Front Office covers Sales,
Marketing, eCommerce, Customer Services.

**Two levels only, enforced by a trigger.** Deliberately not arbitrary
nesting — this keeps the budget rollup a plain `SUM`, not a recursive query,
and matches every real example given during design.

**Budget lives on the parent, exclusively.** A sub-portfolio has no budget
line of its own; its costs simply roll up. This avoids a reconciliation
problem that would otherwise be constant background noise — a parent
allocation and the sum of formally-sub-allocated children silently drifting
apart. Instead, the sub-portfolio breakdown (`subportfolio_cost_breakdown`)
is **derived** from what's actually been assigned and costed, viewable at any
time, never something someone has to keep in sync by hand.

**Demand tags to a sub-portfolio for delivery, not the parent.** Raising
stays at parent level (the conceiver knows their own area). This is where
§0's second build decision lives structurally.

**Reassignment is tracked.** `demand_portfolio_assignment_history` logs every
change to a demand's delivering sub-portfolio — consistent with budget
transfers (below) being recorded events rather than silent edits, and with
the framework's standing instinct that movement is signal.

---

## 3c. Portfolio budgets and transfers [NEW IN v0.8]

**[BUILT]** Each parent portfolio has one budget line per financial year
(`portfolio_budget`). Moving funding between portfolio lines — because a
demand genuinely needs both, or priorities shifted mid-year — is a recorded
event (`portfolio_budget_transfer`): amount, reason, optional related demand,
approver, timestamp. The **effective budget** (`portfolio_effective_budget`)
is allocated plus transfers in minus transfers out, always internally
consistent by construction — total allocated and total effective across all
portfolios can never silently diverge, since a transfer both debits and
credits within the same view.

This directly answers part of v0.4's original open question #5
(strategy-to-spend attribution, applied to portfolio rather than strategic
goal) and gives §3a's "genuine choice remaining" figure a fully real, audited
basis rather than a static number someone edits by hand.

---

## 4–9

Unchanged from v0.6/v0.7's carried-forward content and implementation-status
annotations, except where superseded above.

**Data model additions in v0.8** (all built, not proposed):

| Concept | Note |
|---|---|
| `portfolio.parent_portfolio_id` | Self-referential; NULL means parent. Two-level limit enforced by trigger. |
| `portfolio_budget` | One row per parent portfolio per financial year. Trigger-enforced: parent portfolios only. |
| `portfolio_budget_transfer` | Recorded event, not a silent edit. Requires a reason. |
| `demand.delivering_sub_portfolio_id` | Nullable by design - "not yet categorised" is a legitimate, common state, not an error. Must reference a sub-portfolio (trigger-enforced). |
| `demand_portfolio_assignment_history` | Every reassignment logged: from, to, reason, who, when. |
| `annual_plan` / `annual_plan_item` | Scoped to (parent portfolio, financial year, version). `superseded_by` chains a revision back to its agreed original. |
| `annual_plan_totals` (view) | Fixed/discretionary split, avg score, fixed-breach count - computed once, not reassembled per request. |

---

## 10. Decisions

Decisions 1–39 carry forward from v0.6/v0.7. New in v0.8:

40. **Portfolios are two-level: parent holds budget, sub-portfolio is where
    demand delivers.** Deliberately not arbitrary depth.
41. **Sub-portfolio spend is derived, never formally sub-allocated.** No
    reconciliation burden between a sub-budget and its parent, because there
    is no sub-budget — only a computed breakdown of what's actually there.
42. **Delivering sub-portfolio is not asked at raise.** It's unknown at that
    point by design, not by oversight. It defaults to "not yet categorised"
    (counting toward the raising parent's budget) and is typically assigned
    at assessment, but remains changeable up to planning.
43. **Every delivering-portfolio reassignment is logged**, consistent with
    budget transfers being events, not edits.
44. **Budget transfers between portfolios are recorded events**, requiring a
    reason, optionally linked to the demand that prompted them.
45. **The planning board uses native drag-and-drop**, not move buttons -
    chosen over the buttons-are-simpler default because the interaction is
    materially better for a real planning session.
46. **A plan revision clones the agreed plan's item placements into a new
    draft version** rather than editing in place; the agreed original is
    marked superseded but never altered.

---

## 11. Open questions

**Resolved by the build:** v0.7's open question #15 (is P75 assessment a
bottleneck) remains genuinely open in practice - untested at real volume -
but the "no threshold, every accepted demand is assessed" design decision
(v0.7 §34) stands and was not weakened during the build.

**Still open, unchanged:** #6 (cost-to-benefit flag arithmetic), #10 (should
criteria re-basing be built), #11 (department-level reporting screen), #12
(per-financial-year funding breakdown vs. a single date range), #13 (who may
hold a governance seat - still a UI nudge only), #14 (automated
cost-to-benefit flag), #16 (how claimed benefit reconciles to P100), #17
(does the board need a better summary measure than average score), #18
(should assessment produce an explicit recommendation field - it does now,
proceed/stop/no_recommendation, so this is arguably answered: yes).

**New in v0.8:**

19. **Should a sub-portfolio ever get its own budget line?** Locked as "no,
    derived only" (decision 41) for simplicity - revisit if a real
    organisation needs to cap spend within a parent (e.g. "ERP gets at most
    £150k of Back Office's £400k," formally, not just observationally).
20. **What happens to a demand's plan placement if it's deferred, then its
    delivering sub-portfolio is reassigned to a different parent?** The
    `annual_plan_item` row stays tied to the original plan; the demand may
    now be eligible for a *different* portfolio's board too. Not yet tested
    or resolved - a demand could theoretically appear placed in one
    portfolio's old plan while newly eligible for another's current one.
21. **Should agreeing a plan do anything to the demand records themselves**
    (e.g. stamp a "committed" marker), or does the plan's own `agreed` status
    remain the sole source of truth for what was committed? Currently the
    latter - nothing on `demand` itself changes when a plan is agreed.

---

*RPVF v0.8 confirms the annual planning direction set in v0.7 as real,
working software - envelope maths, fixed/discretionary split, drag-and-drop,
and versioned agree/revise all built and functioning - and adds the portfolio
hierarchy and deferred-delivery-assignment model that emerged from testing
the design against how real organisations actually structure technology
spend and actually know (or don't yet know) who delivers a piece of work.*
