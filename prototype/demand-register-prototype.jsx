import React, { useState, useMemo } from "react";
import { X, Check, Clock, XCircle, ArrowRight, Plus, Trash2, FileText, LayoutGrid, ListChecks, UserPlus } from "lucide-react";

// ---------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------
const CRITERIA = [
  { key: "regulatory", label: "Regulatory", max: 20, fixed: true, color: "#8a3b2e" },
  { key: "revenueGrowth", label: "Revenue Growth", max: 20, color: "#2f6d5e" },
  { key: "costReduction", label: "Cost Reduction", max: 20, color: "#2f6d5e" },
  { key: "effortReduction", label: "Effort Reduction", max: 15, color: "#4d6a8a" },
  { key: "businessGrowth", label: "Business Growth", max: 15, color: "#4d6a8a" },
  { key: "maintain", label: "Maintain", max: 5, color: "#8a7a3b" },
  { key: "other", label: "Other", max: 5, color: "#7a7a7a" },
];
const MAX_TOTAL = CRITERIA.reduce((s, c) => s + c.max, 0);

const STRATEGY_TAGS = [
  "Web platform replacement",
  "Salesforce consolidation",
  "Marketing CDP / identity",
  "Customer service replatform",
];

const STATUS_META = {
  raised: { label: "Raised", color: "#7a7a7a" },
  triaged: { label: "Triaged", color: "#4d6a8a" },
  backlog: { label: "Backlog", color: "#4d6a8a" },
  parked: { label: "Parked", color: "#8a7a3b" },
  promoted: { label: "Promoted", color: "#2f6d5e" },
  rejected: { label: "Rejected", color: "#8a3b2e" },
  actioned: { label: "Actioned", color: "#2f6d5e" },
};

const DEFER_REASONS = [
  "Budget unavailable this cycle",
  "Timing not right",
  "Awaiting related initiative",
  "Insufficient information",
];
const REJECT_REASONS = [
  "Not aligned to strategy",
  "Duplicate of existing initiative",
  "Cost/effort disproportionate",
  "Superseded by alternative",
];

const CHANNELS = ["B2B", "B2C", "E-commerce", "Third-party / Affiliate", "Other / Internal"];
const FIN_TYPES = ["Revenue Growth", "Operating Saving", "Cost Increase / Change", "Effort Reduction"];

const MOCK_COLLEAGUES = ["R. Khan", "J. Whitfield", "S. Patel", "M. Novak", "D. Osei", "A. Ferreira"];
const VOTE_META = {
  support: { label: "Support", color: "#2f6d5e" },
  oppose: { label: "Oppose", color: "#8a3b2e" },
  abstain: { label: "Abstain", color: "#7a7a7a" },
};

const seedScore = (regulatory, revenueGrowth, costReduction, effortReduction, businessGrowth, maintain, other) => ({
  regulatory, revenueGrowth, costReduction, effortReduction, businessGrowth, maintain, other,
});

// ---------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------
const initialDemands = [
  {
    id: "d1", ref: "D-2026-041", title: "Automate exam certificate generation pipeline",
    raisedBy: "N. Hatch", sizeTier: "needs_case", status: "triaged",
    strategyTags: ["Marketing CDP / identity"],
    scores: seedScore(0, 8, 16, 12, 6, 2, 0),
    history: [{ actor: "PMO", action: "Scored at triage", note: "Reduces manual ops cost, no regulatory driver." }],
    reviewers: [
      { id: "r1", name: "R. Khan", status: "voted", vote: "support", comment: "Aligns with the certificate work we scoped last quarter." },
      { id: "r2", name: "S. Patel", status: "voted", vote: "support", comment: "" },
      { id: "r3", name: "M. Novak", status: "invited", vote: null, comment: "" },
    ],
  },
  {
    id: "d2", ref: "D-2026-038", title: "Colorado / EU AI Act readiness for ADMT use in credentialing",
    raisedBy: "Compliance", sizeTier: "needs_case", status: "triaged",
    strategyTags: ["Marketing CDP / identity"],
    scores: seedScore(20, 4, 2, 4, 4, 0, 0),
    history: [{ actor: "PMO", action: "Scored at triage", note: "Regulatory fixed 20 — deadline June 2026." }],
    reviewers: [],
  },
  {
    id: "d3", ref: "D-2026-033", title: "Third-party affiliate commission reconciliation tool",
    raisedBy: "Finance Ops", sizeTier: "needs_case", status: "promoted",
    strategyTags: ["Salesforce consolidation"],
    scores: seedScore(0, 6, 18, 10, 8, 2, 0),
    history: [
      { actor: "PMO", action: "Scored at triage" },
      { actor: "Sponsor (D. Osei)", action: "Accepted", note: "Strong cost case, affiliate spend has grown 30% YoY." },
    ],
    reviewers: [
      { id: "r4", name: "J. Whitfield", status: "voted", vote: "support", comment: "Affiliate spend growth backs this up." },
      { id: "r5", name: "A. Ferreira", status: "voted", vote: "oppose", comment: "Worried about integration effort with existing Finance stack." },
    ],
  },
  {
    id: "d4", ref: "D-2026-029", title: "Self-serve returns flow for e-commerce storefront",
    raisedBy: "Web Ops", sizeTier: "needs_case", status: "parked",
    strategyTags: ["Web platform replacement"],
    scores: seedScore(0, 10, 8, 6, 12, 0, 0),
    history: [
      { actor: "PMO", action: "Scored at triage" },
      { actor: "Sponsor (R. Khan)", action: "Deferred", reasons: ["Budget unavailable this cycle"], note: "Revisit at FY27 web platform budget round." },
    ],
    reviewers: [],
  },
  {
    id: "d5", ref: "D-2026-052", title: "Fix broken postcode lookup on ELT checkout",
    raisedBy: "Support Desk", sizeTier: "quick_win", status: "actioned",
    strategyTags: [],
    scores: seedScore(0, 2, 1, 2, 0, 3, 0),
    history: [{ actor: "PMO", action: "Actioned directly", note: "Quick win — no business case required." }],
    reviewers: [],
  },
  {
    id: "d6", ref: "D-2026-055", title: "Regional bulk-pricing rules for B2B academic orders",
    raisedBy: "Sales", sizeTier: "needs_case", status: "rejected",
    strategyTags: [],
    scores: seedScore(0, 14, 2, 2, 10, 0, 0),
    history: [
      { actor: "PMO", action: "Scored at triage" },
      { actor: "Sponsor (D. Osei)", action: "Rejected", reasons: ["Duplicate of existing initiative"], note: "Overlaps with existing Salesforce CPQ rollout." },
    ],
    reviewers: [],
  },
  {
    id: "d7", ref: "D-2026-058", title: "Consolidate marketing automation for ELT division",
    raisedBy: "Marketing", sizeTier: "needs_case", status: "raised",
    strategyTags: ["Marketing CDP / identity"],
    scores: seedScore(0, 0, 0, 0, 0, 0, 0),
    history: [],
    reviewers: [],
  },
];

const initialBusinessCases = [
  {
    id: "bc1", ref: "BC-2026-011", demandRef: "D-2026-033",
    title: "Third-party affiliate commission reconciliation tool",
    sponsor: "D. Osei", requestedSpend: 85000,
    lines: [
      { id: "l1", type: "Operating Saving", channel: "Third-party / Affiliate", value: 62000, notes: "Manual reconciliation FTE time reclaimed" },
      { id: "l2", type: "Cost Increase / Change", channel: "Third-party / Affiliate", value: -18000, notes: "New platform licensing" },
      { id: "l3", type: "Revenue Growth", channel: "B2B", value: 24000, notes: "Faster affiliate onboarding, more active partners" },
    ],
  },
];

// ---------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------
function TallyBar({ segments, max, height = 10 }) {
  return (
    <div className="tally-bar" style={{ height }}>
      {segments.map((s, i) => (
        <div
          key={i}
          className="tally-seg"
          style={{ width: `${(s.value / max) * 100}%`, background: s.color }}
          title={`${s.label}: ${s.value}`}
        />
      ))}
    </div>
  );
}

function ImpactBar({ value, maxAbs }) {
  const pct = maxAbs === 0 ? 0 : Math.min(100, (Math.abs(value) / maxAbs) * 100);
  const positive = value >= 0;
  return (
    <div className="impact-track">
      <div className="impact-mid" />
      <div
        className={`impact-fill ${positive ? "pos" : "neg"}`}
        style={{ width: `${pct / 2}%`, [positive ? "left" : "right"]: "50%" }}
      />
    </div>
  );
}

function StatusPill({ status }) {
  const meta = STATUS_META[status];
  return (
    <span className="pill" style={{ "--pill-color": meta.color }}>
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------
// Peer Review section — advisory, sits alongside the sponsor decision
// ---------------------------------------------------------------
function ReviewSection({ demand, onInvite, onVote }) {
  const [picking, setPicking] = useState(false);
  const reviewers = demand.reviewers || [];
  const available = MOCK_COLLEAGUES.filter((c) => !reviewers.some((r) => r.name === c));

  const counts = { support: 0, oppose: 0, abstain: 0 };
  reviewers.forEach((r) => { if (r.vote) counts[r.vote]++; });
  const totalInvited = reviewers.length;

  return (
    <section className="drawer-section">
      <div className="section-label">Peer review — advisory, not gating</div>

      {totalInvited > 0 && (
        <>
          <TallyBar
            segments={[
              { value: counts.support, color: VOTE_META.support.color, label: "Support" },
              { value: counts.oppose, color: VOTE_META.oppose.color, label: "Oppose" },
              { value: counts.abstain, color: VOTE_META.abstain.color, label: "Abstain" },
            ]}
            max={totalInvited}
            height={8}
          />
          <div className="muted" style={{ marginTop: 6, marginBottom: 14 }}>
            {counts.support} support · {counts.oppose} oppose · {counts.abstain} abstain
            {totalInvited > counts.support + counts.oppose + counts.abstain && (
              <> · {totalInvited - counts.support - counts.oppose - counts.abstain} pending</>
            )}
          </div>
        </>
      )}

      <div className="reviewer-list">
        {reviewers.map((r) => (
          <div key={r.id} className="reviewer-row">
            <div className="reviewer-name">{r.name}</div>
            {r.vote ? (
              <div className="reviewer-vote-block">
                <span className="pill" style={{ "--pill-color": VOTE_META[r.vote].color }}>
                  {VOTE_META[r.vote].label}
                </span>
                {r.comment && <div className="reviewer-comment">"{r.comment}"</div>}
              </div>
            ) : (
              <div className="vote-sim-row">
                <span className="muted" style={{ fontSize: 11.5 }}>Awaiting response —</span>
                {Object.keys(VOTE_META).map((v) => (
                  <button key={v} className="chip chip-small" onClick={() => onVote(demand.id, r.id, v)}>
                    {VOTE_META[v].label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {reviewers.length === 0 && <div className="muted">No reviewers invited yet.</div>}
      </div>

      {picking ? (
        <div className="invite-picker">
          {available.map((name) => (
            <button key={name} className="chip" onClick={() => { onInvite(demand.id, name); setPicking(false); }}>
              {name}
            </button>
          ))}
          <button className="icon-btn" onClick={() => setPicking(false)}><X size={14} /></button>
        </div>
      ) : (
        <button className="btn" onClick={() => setPicking(true)} disabled={available.length === 0}>
          <UserPlus size={14} /> Invite reviewer
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------
// Demand Drawer
// ---------------------------------------------------------------
function DemandDrawer({ demand, onClose, onDecision, onCreateCase, onInvite, onVote }) {
  const [action, setAction] = useState(null); // 'accept' | 'defer' | 'reject'
  const [reasons, setReasons] = useState([]);
  const [note, setNote] = useState("");

  const total = CRITERIA.reduce((s, c) => s + (demand.scores[c.key] || 0), 0);
  const reasonOptions = action === "defer" ? DEFER_REASONS : action === "reject" ? REJECT_REASONS : [];

  const submit = () => {
    onDecision(demand.id, action, reasons, note);
    setAction(null); setReasons([]); setNote("");
  };

  const toggleReason = (r) =>
    setReasons((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="eyebrow">{demand.ref}</div>
            <h2 className="drawer-title">{demand.title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="drawer-meta">
          <span>Raised by {demand.raisedBy}</span>
          <span className="dot">·</span>
          <span>{demand.sizeTier === "quick_win" ? "Quick win" : "Needs business case"}</span>
          <span className="dot">·</span>
          <StatusPill status={demand.status} />
        </div>

        {demand.strategyTags.length > 0 && (
          <div className="tag-row">
            {demand.strategyTags.map((t) => <span key={t} className="strategy-tag">{t}</span>)}
          </div>
        )}

        <section className="drawer-section">
          <div className="section-label">Scoring matrix — {total} / {MAX_TOTAL}</div>
          <div className="criteria-list">
            {CRITERIA.map((c) => (
              <div key={c.key} className="criterion-row">
                <div className="criterion-name">
                  {c.label}{c.fixed && <span className="fixed-tag">fixed</span>}
                </div>
                <TallyBar segments={[{ value: demand.scores[c.key] || 0, color: c.color, label: c.label }]} max={c.max} />
                <div className="criterion-val">{demand.scores[c.key] || 0}/{c.max}</div>
              </div>
            ))}
          </div>
        </section>

        <ReviewSection demand={demand} onInvite={onInvite} onVote={onVote} />

        <section className="drawer-section">
          <div className="section-label">History</div>
          <div className="history-list">
            {demand.history.length === 0 && <div className="muted">No decisions recorded yet.</div>}
            {demand.history.map((h, i) => (
              <div key={i} className="history-item">
                <div className="history-actor">{h.actor} — {h.action}</div>
                {h.reasons && <div className="history-reasons">{h.reasons.join(", ")}</div>}
                {h.note && <div className="history-note">"{h.note}"</div>}
              </div>
            ))}
          </div>
        </section>

        {demand.status === "promoted" ? (
          <button className="btn primary full" onClick={() => onCreateCase(demand)}>
            View business case <ArrowRight size={16} />
          </button>
        ) : (
          <section className="drawer-section decision-section">
            <div className="section-label">Sponsor decision</div>
            <div className="action-row">
              <button className={`btn ${action === "accept" ? "primary" : ""}`} onClick={() => setAction("accept")}>
                <Check size={15} /> Accept
              </button>
              <button className={`btn ${action === "defer" ? "warn" : ""}`} onClick={() => setAction("defer")}>
                <Clock size={15} /> Defer
              </button>
              <button className={`btn ${action === "reject" ? "danger" : ""}`} onClick={() => setAction("reject")}>
                <XCircle size={15} /> Reject
              </button>
            </div>

            {action && (
              <div className="decision-form">
                {reasonOptions.length > 0 && (
                  <div className="chip-row">
                    {reasonOptions.map((r) => (
                      <button
                        key={r}
                        className={`chip ${reasons.includes(r) ? "chip-active" : ""}`}
                        onClick={() => toggleReason(r)}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  className="note-input"
                  placeholder="Notes (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button
                  className="btn primary full"
                  disabled={action !== "accept" && reasons.length === 0}
                  onClick={submit}
                >
                  Confirm {action}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Demand Register (table)
// ---------------------------------------------------------------
function DemandRegister({ demands, onOpen }) {
  return (
    <div className="register">
      <table>
        <thead>
          <tr>
            <th>Ref</th><th>Demand</th><th>Raised by</th><th>Score</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {demands.map((d) => {
            const total = CRITERIA.reduce((s, c) => s + (d.scores[c.key] || 0), 0);
            return (
              <tr key={d.id} onClick={() => onOpen(d.id)}>
                <td className="mono">{d.ref}</td>
                <td>{d.title}</td>
                <td className="muted">{d.raisedBy}</td>
                <td style={{ width: 160 }}>
                  <div className="score-cell">
                    <TallyBar
                      segments={CRITERIA.map((c) => ({ value: d.scores[c.key] || 0, color: c.color, label: c.label }))}
                      max={MAX_TOTAL}
                      height={8}
                    />
                    <span className="mono score-num">{total}</span>
                  </div>
                </td>
                <td><StatusPill status={d.status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------
// Business Case screen
// ---------------------------------------------------------------
function BusinessCaseScreen({ businessCases, onUpdate }) {
  const [openId, setOpenId] = useState(businessCases[0]?.id || null);
  const openCase = businessCases.find((c) => c.id === openId);

  const addLine = () => {
    const newLine = { id: `l${Date.now()}`, type: FIN_TYPES[0], channel: CHANNELS[0], value: 0, notes: "" };
    onUpdate(openId, { ...openCase, lines: [...openCase.lines, newLine] });
  };
  const updateLine = (lineId, patch) => {
    onUpdate(openId, {
      ...openCase,
      lines: openCase.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)),
    });
  };
  const removeLine = (lineId) => {
    onUpdate(openId, { ...openCase, lines: openCase.lines.filter((l) => l.id !== lineId) });
  };

  const byChannel = useMemo(() => {
    if (!openCase) return [];
    return CHANNELS.map((ch) => ({
      channel: ch,
      total: openCase.lines.filter((l) => l.channel === ch).reduce((s, l) => s + Number(l.value || 0), 0),
    })).filter((r) => r.total !== 0);
  }, [openCase]);

  const maxAbs = Math.max(1, ...byChannel.map((r) => Math.abs(r.total)));
  const netTotal = openCase ? openCase.lines.reduce((s, l) => s + Number(l.value || 0), 0) : 0;

  if (!openCase) {
    return <div className="empty-state">No business cases yet. Accept a demand to record one.</div>;
  }

  return (
    <div className="case-layout">
      <aside className="case-list">
        {businessCases.map((c) => (
          <button key={c.id} className={`case-list-item ${c.id === openId ? "active" : ""}`} onClick={() => setOpenId(c.id)}>
            <div className="mono eyebrow">{c.ref}</div>
            <div>{c.title}</div>
          </button>
        ))}
      </aside>

      <div className="case-detail">
        <div className="eyebrow">{openCase.ref} · from {openCase.demandRef}</div>
        <h2 className="drawer-title">{openCase.title}</h2>
        <div className="drawer-meta">
          <span>Sponsor: {openCase.sponsor}</span>
          <span className="dot">·</span>
          <span>Requested spend: £{openCase.requestedSpend.toLocaleString()}</span>
        </div>

        <section className="drawer-section">
          <div className="section-label">Financial assessment</div>
          <table className="fin-table">
            <thead>
              <tr><th>Type</th><th>Channel / dimension</th><th>Value (£)</th><th>Notes</th><th /></tr>
            </thead>
            <tbody>
              {openCase.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <select value={l.type} onChange={(e) => updateLine(l.id, { type: e.target.value })}>
                      {FIN_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={l.channel} onChange={(e) => updateLine(l.id, { channel: e.target.value })}>
                      {CHANNELS.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      className="mono num-input"
                      type="number"
                      value={l.value}
                      onChange={(e) => updateLine(l.id, { value: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      className="notes-input"
                      value={l.notes}
                      onChange={(e) => updateLine(l.id, { notes: e.target.value })}
                    />
                  </td>
                  <td>
                    <button className="icon-btn" onClick={() => removeLine(l.id)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn" onClick={addLine}><Plus size={14} /> Add line</button>
        </section>

        <section className="drawer-section">
          <div className="section-label">Net impact by channel</div>
          <div className="channel-breakdown">
            {byChannel.map((r) => (
              <div key={r.channel} className="channel-row">
                <div className="channel-label">{r.channel}</div>
                <ImpactBar value={r.total} maxAbs={maxAbs} />
                <div className={`mono channel-val ${r.total >= 0 ? "pos" : "neg"}`}>
                  {r.total >= 0 ? "+" : "−"}£{Math.abs(r.total).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
          <div className="net-total">
            Net position: <span className={`mono ${netTotal >= 0 ? "pos" : "neg"}`}>
              {netTotal >= 0 ? "+" : "−"}£{Math.abs(netTotal).toLocaleString()}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------
function Dashboard({ demands, businessCases }) {
  const counts = {};
  demands.forEach((d) => { counts[d.status] = (counts[d.status] || 0) + 1; });

  const allChannelTotals = CHANNELS.map((ch) => ({
    channel: ch,
    total: businessCases.flatMap((c) => c.lines).filter((l) => l.channel === ch).reduce((s, l) => s + Number(l.value || 0), 0),
  })).filter((r) => r.total !== 0);
  const maxAbs = Math.max(1, ...allChannelTotals.map((r) => Math.abs(r.total)));

  return (
    <div className="dashboard">
      <section className="drawer-section">
        <div className="section-label">Demand register — by status</div>
        <div className="stat-row">
          {Object.entries(STATUS_META).map(([key, meta]) => (
            <div key={key} className="stat-card">
              <div className="stat-num" style={{ color: meta.color }}>{counts[key] || 0}</div>
              <div className="stat-label">{meta.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="drawer-section">
        <div className="section-label">Business case portfolio — net impact by channel</div>
        <div className="channel-breakdown">
          {allChannelTotals.length === 0 && <div className="muted">No financial assessments recorded yet.</div>}
          {allChannelTotals.map((r) => (
            <div key={r.channel} className="channel-row">
              <div className="channel-label">{r.channel}</div>
              <ImpactBar value={r.total} maxAbs={maxAbs} />
              <div className={`mono channel-val ${r.total >= 0 ? "pos" : "neg"}`}>
                {r.total >= 0 ? "+" : "−"}£{Math.abs(r.total).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------
// Root
// ---------------------------------------------------------------
export default function App() {
  const [tab, setTab] = useState("register");
  const [demands, setDemands] = useState(initialDemands);
  const [businessCases, setBusinessCases] = useState(initialBusinessCases);
  const [openDemandId, setOpenDemandId] = useState(null);

  const openDemand = demands.find((d) => d.id === openDemandId);

  const handleDecision = (id, action, reasons, note) => {
    setDemands((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d;
        const nextStatus = action === "accept" ? "promoted" : action === "defer" ? "parked" : "rejected";
        const entry = {
          actor: "Sponsor",
          action: action === "accept" ? "Accepted" : action === "defer" ? "Deferred" : "Rejected",
          reasons: reasons.length ? reasons : undefined,
          note: note || undefined,
        };
        return { ...d, status: nextStatus, history: [...d.history, entry] };
      })
    );
    if (action === "accept") {
      const d = demands.find((x) => x.id === id);
      const newCase = {
        id: `bc-${Date.now()}`,
        ref: `BC-2026-0${businessCases.length + 20}`,
        demandRef: d.ref,
        title: d.title,
        sponsor: "Sponsor",
        requestedSpend: 0,
        lines: [],
      };
      setBusinessCases((prev) => [...prev, newCase]);
      setTab("cases");
    }
    setOpenDemandId(null);
  };

  const updateCase = (id, patch) => {
    setBusinessCases((prev) => prev.map((c) => (c.id === id ? patch : c)));
  };

  const handleInvite = (demandId, name) => {
    setDemands((prev) =>
      prev.map((d) =>
        d.id !== demandId
          ? d
          : {
              ...d,
              reviewers: [...(d.reviewers || []), { id: `r-${Date.now()}`, name, status: "invited", vote: null, comment: "" }],
            }
      )
    );
  };

  const handleVote = (demandId, reviewerId, vote) => {
    setDemands((prev) =>
      prev.map((d) =>
        d.id !== demandId
          ? d
          : {
              ...d,
              reviewers: d.reviewers.map((r) => (r.id === reviewerId ? { ...r, status: "voted", vote } : r)),
            }
      )
    );
  };

  return (
    <div className="app-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

        :root {
          --ink: #1c2130;
          --paper: #f4f3ef;
          --paper-raised: #ffffff;
          --line: #d9d6cd;
          --muted: #6b6a63;
          --accent: #2f6d5e;
          --danger: #8a3b2e;
          --warn: #8a7a3b;
        }
        * { box-sizing: border-box; }
        .app-root {
          font-family: 'IBM Plex Sans', sans-serif;
          background: var(--paper);
          color: var(--ink);
          min-height: 100vh;
          font-size: 14px;
        }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .muted { color: var(--muted); font-size: 13px; }

        .topbar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 18px 28px; border-bottom: 1px solid var(--line);
          background: var(--paper-raised);
        }
        .brand { display: flex; align-items: baseline; gap: 10px; }
        .brand-mark {
          font-family: 'Fraunces', serif; font-weight: 600; font-size: 20px; letter-spacing: -0.01em;
        }
        .brand-sub { font-size: 12px; color: var(--muted); letter-spacing: 0.04em; text-transform: uppercase; }
        .nav { display: flex; gap: 4px; }
        .nav-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 14px; border-radius: 6px; border: 1px solid transparent;
          background: transparent; color: var(--muted); font-size: 13px; cursor: pointer;
          font-family: inherit;
        }
        .nav-btn.active { background: var(--ink); color: var(--paper-raised); }

        .content { padding: 28px; max-width: 1100px; margin: 0 auto; }

        .eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); letter-spacing: 0.05em; text-transform: uppercase; }
        .section-label { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; font-weight: 500; }
        .drawer-section { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--line); }

        /* Register table */
        .register { background: var(--paper-raised); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
        table { width: 100%; border-collapse: collapse; }
        thead th {
          text-align: left; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase;
          color: var(--muted); font-weight: 500; padding: 10px 16px; border-bottom: 1px solid var(--line);
        }
        tbody tr { cursor: pointer; border-bottom: 1px solid var(--line); }
        tbody tr:last-child { border-bottom: none; }
        tbody tr:hover { background: #eceae2; }
        tbody td { padding: 12px 16px; vertical-align: middle; }

        .score-cell { display: flex; align-items: center; gap: 8px; }
        .score-num { font-size: 12px; color: var(--muted); min-width: 24px; }

        /* Tally bar signature element */
        .tally-bar { display: flex; width: 100%; background: #e4e1d6; border-radius: 3px; overflow: hidden; }
        .tally-seg { height: 100%; }

        /* Pills */
        .pill {
          display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px;
          font-weight: 500; color: var(--pill-color); background: color-mix(in srgb, var(--pill-color) 12%, white);
          border: 1px solid color-mix(in srgb, var(--pill-color) 35%, white);
        }

        /* Drawer */
        .drawer-backdrop {
          position: fixed; inset: 0; background: rgba(28,33,48,0.35); display: flex; justify-content: flex-end; z-index: 50;
        }
        .drawer {
          width: 460px; max-width: 90vw; height: 100%; background: var(--paper-raised);
          padding: 24px; overflow-y: auto; box-shadow: -8px 0 24px rgba(0,0,0,0.08);
        }
        .drawer-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
        .drawer-title { font-family: 'Fraunces', serif; font-size: 21px; font-weight: 600; margin: 4px 0 0; line-height: 1.25; }
        .drawer-meta { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12.5px; margin-top: 10px; flex-wrap: wrap; }
        .dot { opacity: 0.5; }

        .tag-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
        .strategy-tag {
          font-size: 11px; padding: 3px 9px; border-radius: 4px; background: #e4e1d6; color: var(--ink);
          border: 1px solid var(--line);
        }

        .criteria-list { display: flex; flex-direction: column; gap: 10px; }
        .criterion-row { display: grid; grid-template-columns: 130px 1fr 44px; align-items: center; gap: 10px; }
        .criterion-name { font-size: 12.5px; }
        .fixed-tag { font-size: 9px; color: var(--muted); margin-left: 4px; text-transform: uppercase; }
        .criterion-val { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; color: var(--muted); text-align: right; }

        .history-list { display: flex; flex-direction: column; gap: 10px; }
        .history-item { font-size: 12.5px; padding-bottom: 8px; border-bottom: 1px dashed var(--line); }
        .history-item:last-child { border-bottom: none; }
        .history-actor { font-weight: 500; }
        .history-reasons { color: var(--warn); font-size: 11.5px; margin-top: 2px; }
        .history-note { color: var(--muted); font-style: italic; margin-top: 2px; }

        .action-row { display: flex; gap: 8px; }
        .btn {
          display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 6px;
          border: 1px solid var(--line); background: var(--paper-raised); font-family: inherit; font-size: 13px;
          cursor: pointer; color: var(--ink);
        }
        .btn.full { width: 100%; justify-content: center; margin-top: 12px; }
        .btn.primary { background: var(--accent); color: white; border-color: var(--accent); }
        .btn.warn { background: var(--warn); color: white; border-color: var(--warn); }
        .btn.danger { background: var(--danger); color: white; border-color: var(--danger); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .icon-btn { background: none; border: none; cursor: pointer; color: var(--muted); padding: 4px; }
        .icon-btn:hover { color: var(--ink); }

        .reviewer-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
        .reviewer-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; padding-bottom: 8px; border-bottom: 1px dashed var(--line); }
        .reviewer-row:last-child { border-bottom: none; padding-bottom: 0; }
        .reviewer-name { font-size: 12.5px; font-weight: 500; white-space: nowrap; }
        .reviewer-vote-block { text-align: right; }
        .reviewer-comment { font-size: 11.5px; color: var(--muted); font-style: italic; margin-top: 3px; max-width: 260px; }
        .vote-sim-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; justify-content: flex-end; }
        .chip-small { padding: 3px 9px; font-size: 11px; }
        .invite-picker { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

        .decision-form { margin-top: 14px; }
        .chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
        .chip {
          font-size: 12px; padding: 5px 11px; border-radius: 20px; border: 1px solid var(--line);
          background: var(--paper-raised); cursor: pointer; font-family: inherit;
        }
        .chip-active { background: var(--ink); color: var(--paper-raised); border-color: var(--ink); }
        .note-input {
          width: 100%; min-height: 60px; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px;
          font-family: inherit; font-size: 13px; resize: vertical; margin-bottom: 10px;
        }

        /* Business case screen */
        .case-layout { display: grid; grid-template-columns: 220px 1fr; gap: 24px; }
        .case-list { display: flex; flex-direction: column; gap: 8px; }
        .case-list-item {
          text-align: left; border: 1px solid var(--line); background: var(--paper-raised); border-radius: 8px;
          padding: 10px 12px; cursor: pointer; font-family: inherit; font-size: 13px;
        }
        .case-list-item.active { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
        .case-detail { background: var(--paper-raised); border: 1px solid var(--line); border-radius: 8px; padding: 24px; }

        .fin-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
        .fin-table th { text-align: left; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; padding: 6px 8px; }
        .fin-table td { padding: 6px 8px; }
        .fin-table select, .num-input, .notes-input {
          border: 1px solid var(--line); border-radius: 5px; padding: 5px 8px; font-family: inherit; font-size: 12.5px; width: 100%;
        }
        .num-input { width: 110px; }

        .channel-breakdown { display: flex; flex-direction: column; gap: 10px; }
        .channel-row { display: grid; grid-template-columns: 150px 1fr 90px; align-items: center; gap: 10px; }
        .channel-label { font-size: 12.5px; }
        .channel-val { font-size: 12.5px; text-align: right; }
        .channel-val.pos, .impact-fill.pos { color: var(--accent); }
        .channel-val.neg, .impact-fill.neg { color: var(--danger); }

        .impact-track { position: relative; height: 8px; background: #e4e1d6; border-radius: 3px; overflow: hidden; }
        .impact-mid { position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: var(--muted); opacity: 0.4; }
        .impact-fill { position: absolute; top: 0; bottom: 0; }
        .impact-fill.pos { background: var(--accent); }
        .impact-fill.neg { background: var(--danger); }

        .net-total { margin-top: 12px; font-size: 13px; }
        .net-total .pos { color: var(--accent); }
        .net-total .neg { color: var(--danger); }

        .empty-state { padding: 60px 20px; text-align: center; color: var(--muted); }

        .dashboard { display: flex; flex-direction: column; gap: 8px; }
        .stat-row { display: flex; gap: 10px; flex-wrap: wrap; }
        .stat-card { background: var(--paper-raised); border: 1px solid var(--line); border-radius: 8px; padding: 14px 18px; min-width: 90px; }
        .stat-num { font-family: 'Fraunces', serif; font-size: 26px; font-weight: 600; }
        .stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px; }
      `}</style>

      <div className="topbar">
        <div className="brand">
          <span className="brand-mark">Ledger</span>
          <span className="brand-sub">Demand &amp; Benefits Register</span>
        </div>
        <div className="nav">
          <button className={`nav-btn ${tab === "register" ? "active" : ""}`} onClick={() => setTab("register")}>
            <ListChecks size={15} /> Demand Register
          </button>
          <button className={`nav-btn ${tab === "cases" ? "active" : ""}`} onClick={() => setTab("cases")}>
            <FileText size={15} /> Business Cases
          </button>
          <button className={`nav-btn ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}>
            <LayoutGrid size={15} /> Dashboard
          </button>
        </div>
      </div>

      <div className="content">
        {tab === "register" && <DemandRegister demands={demands} onOpen={setOpenDemandId} />}
        {tab === "cases" && <BusinessCaseScreen businessCases={businessCases} onUpdate={updateCase} />}
        {tab === "dashboard" && <Dashboard demands={demands} businessCases={businessCases} />}
      </div>

      {openDemand && (
        <DemandDrawer
          demand={openDemand}
          onClose={() => setOpenDemandId(null)}
          onDecision={handleDecision}
          onCreateCase={() => { setTab("cases"); setOpenDemandId(null); }}
          onInvite={handleInvite}
          onVote={handleVote}
        />
      )}
    </div>
  );
}
