import { useEffect, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';
import { usePermissions } from '../context/PermissionsContext';
import { useHideConfidential } from '../lib/useHideConfidential';
import { ConfidentialityToggle } from '../components/ConfidentialityToggle';

interface Portfolio { id: string; name: string; }

interface DemandCard {
  id: string; title: string; date_driver_type: string | null; date_driver_detail: string | null;
  complexity_tier: string | null; cost: number | null; weighted_score: number;
  column_placement: string | null; deferred_reason: string | null; sub_portfolio_name: string | null;
  confidential: boolean;
}

interface Board {
  plan: {
    id: string; portfolio_id: string; portfolio_name: string; financial_year: number; version: number;
    status: string; agreed_at: string | null; locked_at: string | null; unlocked_at: string | null;
    created_by_name: string | null; agreed_by_name: string | null;
    locked_by_name: string | null; unlocked_by_name: string | null;
  };
  totals: { budget_item_count: number; deferred_item_count: number; discretionary_committed: number; fixed_committed: number; avg_weighted_score: number; deferred_fixed_breach_count: number };
  envelope: { allocated_amount: number; effective_amount: number };
  columns: { all: DemandCard[]; budget: DemandCard[]; deferred: DemandCard[] };
}

interface AllPortfoliosBoard {
  year: number;
  boards: Board[];
}

type ColumnKey = 'all' | 'budget' | 'deferred';

const DATE_DRIVER_SHORT: Record<string, string> = {
  regulatory: 'Regulatory', audit_finding: 'Audit finding', contractual: 'Contractual', product_launch: 'Product launch',
};

export function AnnualPlanningBoard() {
  const navigate = useNavigate();
  const { has } = usePermissions();
  const canEdit = has('planning.edit');
  const currentYear = new Date().getFullYear();
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [portfolioId, setPortfolioId] = useState('all');
  const [defaultApplied, setDefaultApplied] = useState(false);
  const [year, setYear] = useState(currentYear);
  const [board, setBoard] = useState<Board | null>(null);
  const [allBoards, setAllBoards] = useState<AllPortfoliosBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [deferReasonFor, setDeferReasonFor] = useState<string | null>(null);
  const [deferReasonText, setDeferReasonText] = useState('');

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnKey | null>(null);

  // Must be called unconditionally, before any of the early returns
  // below -- this was previously called further down, only reached on
  // the single-portfolio/board-loaded render path, which meant the
  // hooks it calls internally (useState, useEffect) ran on some
  // renders and not others. That's a Rules-of-Hooks violation (React
  // error #310): the number of hooks called must be identical on
  // every render of this component, regardless of which branch
  // eventually returns.
  const { hideConfidential, setHideConfidential } = useHideConfidential();

  useEffect(() => {
    apiFetch('/api/portfolios').then((p: Portfolio[]) => {
      setPortfolios(p);
    }).catch((err) => setError(err.message));
  }, []);

  // Apply the user's default portfolio once, on first load only -- if
  // they've already picked something manually (defaultApplied guards
  // against a slow response landing after that), don't override it.
  // "All portfolios" remains selectable regardless either way.
  useEffect(() => {
    apiFetch('/api/me')
      .then((me: { defaultPortfolioId: string | null }) => {
        if (!defaultApplied && me.defaultPortfolioId) {
          setPortfolioId(me.defaultPortfolioId);
        }
        setDefaultApplied(true);
      })
      .catch(() => setDefaultApplied(true));
  }, []);

  function selectPortfolio(id: string) {
    setDefaultApplied(true); // a manual pick always wins from here on
    setPortfolioId(id);
  }

  function loadBoard() {
    if (!portfolioId) return;
    setLoading(true);
    setBoard(null);
    setAllBoards(null);

    if (portfolioId === 'all') {
      // Load boards for all parent portfolios
      Promise.all(
        portfolios.map((p) =>
          apiFetch(`/api/annual-plans/current?portfolioId=${p.id}&year=${year}`)
            .then((plan) => apiFetch(`/api/annual-plans/${plan.id}/board`))
        )
      )
        .then((boards) => setAllBoards({ year, boards }))
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    } else {
      apiFetch(`/api/annual-plans/current?portfolioId=${portfolioId}&year=${year}`)
        .then((plan) => apiFetch(`/api/annual-plans/${plan.id}/board`))
        .then(setBoard)
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }

  useEffect(loadBoard, [portfolioId, year, portfolios]);

  async function placeInBudget(demandId: string) {
    if (!board) return;
    try {
      await apiFetch(`/api/annual-plans/${board.plan.id}/items`, {
        method: 'POST', body: JSON.stringify({ demandId, columnPlacement: 'budget' }),
      });
      loadBoard();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to move'); }
  }

  async function removeFromPlan(demandId: string) {
    if (!board) return;
    try {
      await apiFetch(`/api/annual-plans/${board.plan.id}/items/${demandId}`, { method: 'DELETE' });
      loadBoard();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to move'); }
  }

  async function confirmDefer() {
    if (!board || !deferReasonFor || !deferReasonText.trim()) return;
    try {
      await apiFetch(`/api/annual-plans/${board.plan.id}/items`, {
        method: 'POST',
        body: JSON.stringify({ demandId: deferReasonFor, columnPlacement: 'deferred', reason: deferReasonText }),
      });
      setDeferReasonFor(null);
      setDeferReasonText('');
      loadBoard();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to defer'); }
  }

  const [showLockConfirm, setShowLockConfirm] = useState(false);
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  const [showAgreeConfirm, setShowAgreeConfirm] = useState(false);

  async function lockPlan() {
    if (!board) return;
    try {
      await apiFetch(`/api/annual-plans/${board.plan.id}/lock`, { method: 'POST' });
      setShowLockConfirm(false);
      loadBoard();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to lock plan'); }
  }

  async function unlockPlan() {
    if (!board) return;
    try {
      await apiFetch(`/api/annual-plans/${board.plan.id}/unlock`, { method: 'POST' });
      setShowUnlockConfirm(false);
      loadBoard();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to unlock plan'); }
  }

  async function agreePlan() {
    if (!board) return;
    try {
      await apiFetch(`/api/annual-plans/${board.plan.id}/agree`, { method: 'POST' });
      setShowAgreeConfirm(false);
      loadBoard();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to agree plan'); }
  }

  async function revisePlan() {
    if (!board) return;
    try {
      await apiFetch(`/api/annual-plans/${board.plan.id}/revise`, { method: 'POST' });
      loadBoard();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to create revision'); }
  }

  // ---------- Drag and drop ----------

  function handleDragStart(e: DragEvent<HTMLDivElement>, demandId: string) {
    if (isLocked) { e.preventDefault(); return; }
    setDraggedId(demandId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', demandId);
  }

  function handleDragEnd() {
    setDraggedId(null);
    setDragOverColumn(null);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, column: ColumnKey) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumn !== column) setDragOverColumn(column);
  }

  function handleDragLeave(column: ColumnKey) {
    if (dragOverColumn === column) setDragOverColumn(null);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, column: ColumnKey) {
    e.preventDefault();
    const demandId = e.dataTransfer.getData('text/plain') || draggedId;
    setDragOverColumn(null);
    setDraggedId(null);
    if (!demandId) return;

    if (column === 'deferred') {
      setDeferReasonFor(demandId);
      setDeferReasonText('');
    } else if (column === 'budget') {
      placeInBudget(demandId);
    } else {
      removeFromPlan(demandId);
    }
  }

  // Show loading state for both single and all boards
  if (loading) {
    return (
      <div>
        <h1 className="page-title">Annual Planning</h1>
        <p>Loading plans...</p>
      </div>
    );
  }

  // If "All" is selected but no boards loaded yet, show message
  if (portfolioId === 'all' && !allBoards) {
    return (
      <div>
        <h1 className="page-title">Annual Planning</h1>
        {error && <p className="login-error">{error}</p>}
        {!error && <p>No plans found.</p>}
      </div>
    );
  }

  // If single portfolio is selected but no board loaded yet, show message
  if (portfolioId !== 'all' && !board) {
    return (
      <div>
        <h1 className="page-title">Annual Planning</h1>
        {error && <p className="login-error">{error}</p>}
        {!error && <p>No plan found.</p>}
      </div>
    );
  }

  // Render all-portfolios view (read-only summary across all parent portfolios)
  if (portfolioId === 'all' && allBoards) {
    return (
      <div style={{ maxWidth: 1100 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 className="page-title">Annual Planning</h1>
            <p className="page-subtitle">Corporate view: all parent portfolios for {allBoards.year}.</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <select value={portfolioId} onChange={(e) => selectPortfolio(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 13 }}>
            <option value="all">All portfolios</option>
            {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            style={{ padding: '6px 10px', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 13 }}>
            {[currentYear - 1, currentYear, currentYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {error && <p className="login-error">{error}</p>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }}>
          {allBoards.boards.map((b) => {
            const allocated = Number(b.envelope.allocated_amount);
            const fixed = Number(b.totals.fixed_committed);
            const discretionary = Number(b.totals.discretionary_committed);
            const genuineChoice = allocated - fixed;
            const isOver = discretionary > genuineChoice;
            // Total assessed demand eligible for this portfolio's plan -
            // unplaced + in budget + deferred. Already fetched as part of
            // the board's columns, no extra request needed.
            const totalDemand = b.columns.all.length + b.columns.budget.length + b.columns.deferred.length;

            return (
              <div key={b.plan.id} style={{ border: '1px solid var(--hairline)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                <div style={{ background: 'var(--cloud)', padding: '12px 16px', borderBottom: '1px solid var(--hairline)' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, marginBottom: 2 }}>
                    {b.plan.portfolio_name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    v{b.plan.version} · {b.plan.status === 'locked' ? 'Locked' : b.plan.status === 'agreed' ? 'Agreed' : 'Draft'}
                    {b.plan.agreed_by_name && ` · agreed by ${b.plan.agreed_by_name}`}
                  </div>
                </div>

                <div style={{ padding: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
                    <div>
                      <div className="goal-card__meta">Envelope</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                        {allocated > 0 ? `GBP ${allocated.toLocaleString()}` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="goal-card__meta">Fixed</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: '#8a6100' }}>
                        {fixed > 0 ? `GBP ${fixed.toLocaleString()}` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="goal-card__meta">Discretionary</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: isOver ? '#C23' : '#0e8f82' }}>
                        {discretionary > 0 ? `GBP ${discretionary.toLocaleString()}` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="goal-card__meta">Demand</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                        {totalDemand}
                      </div>
                    </div>
                    <div>
                      <div className="goal-card__meta">In Budget</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                        {b.totals.budget_item_count}
                      </div>
                    </div>
                    <div>
                      <div className="goal-card__meta">Deferred</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                        {b.totals.deferred_item_count}
                      </div>
                    </div>
                  </div>

                  {isOver && (
                    <div style={{ fontSize: 12.5, color: '#C23', fontWeight: 500, marginBottom: 12 }}>
                      &#9888; Discretionary spend exceeds genuine choice by GBP {(discretionary - genuineChoice).toLocaleString()}.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Single portfolio view (with drag-and-drop)
  // Cards stop being draggable from Locked onward - Locked is a low-
  // friction checkpoint (freely reversible via Unlock), Agreed is the
  // genuinely final commitment reachable only from Locked.
  const planStatus = board!.plan.status; // 'draft' | 'locked' | 'agreed'
  const isLocked = planStatus !== 'draft';
  const allocated = Number(board!.envelope.allocated_amount);
  const fixed = Number(board!.totals.fixed_committed);
  const discretionary = Number(board!.totals.discretionary_committed);
  const genuineChoice = allocated - fixed;
  const isOver = discretionary > genuineChoice;

  const fixedPct = allocated > 0 ? (fixed / allocated) * 100 : 0;
  const discPct = allocated > 0 ? (Math.min(discretionary, genuineChoice) / allocated) * 100 : 0;
  const overPct = allocated > 0 && isOver ? ((discretionary - genuineChoice) / allocated) * 100 : 0;

  const hasConfidential = [...board!.columns.all, ...board!.columns.budget, ...board!.columns.deferred].some((d) => d.confidential);
  const visibleAll = board!.columns.all.filter((d) => !hideConfidential || !d.confidential);
  const visibleBudget = board!.columns.budget.filter((d) => !hideConfidential || !d.confidential);
  const visibleDeferred = board!.columns.deferred.filter((d) => !hideConfidential || !d.confidential);

  function renderCard(d: DemandCard) {
    const hasDriver = d.date_driver_type && d.date_driver_type !== 'none';
    const isDragging = draggedId === d.id;
    return (
      <div
        key={d.id}
        draggable={!isLocked && canEdit}
        onDragStart={(e) => handleDragStart(e, d.id)}
        onDragEnd={handleDragEnd}
        onClick={() => navigate(`/demand/${d.id}`)}
        className="goal-card"
        style={{
          marginBottom: 8,
          borderLeft: hasDriver ? '3px solid #E8A317' : undefined,
          background: hasDriver ? 'rgba(232,163,23,0.03)' : undefined,
          opacity: isDragging ? 0.35 : 1,
          cursor: isLocked || !canEdit ? 'pointer' : 'grab',
          transition: 'opacity 0.12s ease',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>{d.title}</div>
        {d.sub_portfolio_name && (
          <div className="goal-card__meta" style={{ marginTop: 2 }}>{d.sub_portfolio_name}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13 }}>
            {d.cost !== null ? `GBP ${Number(d.cost).toLocaleString()}` : 'no estimate'}
          </span>
          <span className="pill pill--indigo">score {Number(d.weighted_score).toFixed(1)}</span>
        </div>
        {hasDriver && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, marginTop: 6, color: '#8a6100' }}>
            {DATE_DRIVER_SHORT[d.date_driver_type!]}{d.date_driver_detail ? ` - ${d.date_driver_detail}` : ''}
          </div>
        )}
        {d.deferred_reason && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
            {d.deferred_reason}
          </div>
        )}
      </div>
    );
  }

  function columnStyle(column: ColumnKey, base: React.CSSProperties): React.CSSProperties {
    const isOverThis = dragOverColumn === column;
    return {
      ...base,
      outline: isOverThis ? '2px dashed var(--teal)' : '2px dashed transparent',
      outlineOffset: -4,
      transition: 'outline-color 0.1s ease',
    };
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Annual Planning</h1>
          <p className="page-subtitle">
            Drag demand between columns to plan against assessed (P75) figures.
            {!isLocked && ' Fixed-date work is committed before discretionary choices begin.'}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select value={portfolioId} onChange={(e) => selectPortfolio(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 13 }}>
          <option value="all">All portfolios</option>
          {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
          style={{ padding: '6px 10px', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 13 }}>
          {[currentYear - 1, currentYear, currentYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <span className={`pill ${planStatus === 'agreed' ? 'pill--teal' : planStatus === 'locked' ? 'pill--indigo' : 'pill--muted'}`}>
          {planStatus === 'agreed' ? `Agreed - v${board!.plan.version}` : planStatus === 'locked' ? `Locked - v${board!.plan.version}` : `Draft - v${board!.plan.version}`}
        </span>
        {board!.plan.locked_by_name && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            locked by {board!.plan.locked_by_name} on {board!.plan.locked_at && new Date(board!.plan.locked_at).toLocaleDateString()}
          </span>
        )}
        {board!.plan.agreed_by_name && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            &middot; agreed by {board!.plan.agreed_by_name} on {board!.plan.agreed_at && new Date(board!.plan.agreed_at).toLocaleDateString()}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <ConfidentialityToggle hideConfidential={hideConfidential} onToggle={setHideConfidential} hasConfidential={hasConfidential} />
          {canEdit && planStatus === 'draft' && <button onClick={() => setShowLockConfirm(true)} className="btn btn--project">Lock Plan</button>}
          {canEdit && planStatus === 'locked' && <button onClick={() => setShowAgreeConfirm(true)} className="btn btn--project">Agree Plan</button>}
          {canEdit && planStatus === 'locked' && <button onClick={() => setShowUnlockConfirm(true)} className="btn btn--outline">Unlock Plan</button>}
          {canEdit && planStatus === 'agreed' && <button onClick={revisePlan} className="btn btn--outline">Start Mid Year</button>}
        </div>
      </div>

      {error && <p className="login-error">{error}</p>}
      {planStatus === 'locked' && (
        <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -6, marginBottom: 14 }}>
          This plan is locked - cards are not draggable. Unlock it freely to keep adjusting, or agree it to make it final.
        </p>
      )}
      {planStatus === 'agreed' && (
        <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -6, marginBottom: 14 }}>
          This plan is agreed and final - cards are not draggable and there's no unlock from here. Start a mid-year review to make changes, fully tracked.
        </p>
      )}

      {showLockConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(20,22,28,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: 'var(--radius)', padding: '1.75rem',
            maxWidth: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
              Lock this plan?
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 18 }}>
              Cards stop being draggable while it's locked, but you can freely unlock it again to keep
              adjusting - this isn't final.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={lockPlan} className="btn btn--project">Yes, lock it</button>
              <button onClick={() => setShowLockConfirm(false)} className="btn btn--outline">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showUnlockConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(20,22,28,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: 'var(--radius)', padding: '1.75rem',
            maxWidth: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
              Unlock this plan?
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 18 }}>
              It will become fully editable again, back to draft.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={unlockPlan} className="btn btn--project">Yes, unlock it</button>
              <button onClick={() => setShowUnlockConfirm(false)} className="btn btn--outline">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showAgreeConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(20,22,28,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: 'var(--radius)', padding: '1.75rem',
            maxWidth: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
              Agree this plan?
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 18 }}>
              Once you agree this plan, it's final - there's no unlock from here. Further changes can
              only be made by starting a mid-year review, which is fully tracked. Make sure the
              placements are right first.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={agreePlan} className="btn btn--project">Yes, agree it</button>
              <button onClick={() => setShowAgreeConfirm(false)} className="btn btn--outline">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="goal-card" style={{
        marginBottom: '1.5rem',
        border: isOver ? '2px solid #C23' : '2px solid var(--hairline)',
      }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div className="goal-card__meta">Envelope</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20 }}>
              GBP {allocated.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="goal-card__meta">Fixed - already spoken for</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: '#8a6100' }}>
              GBP {fixed.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="goal-card__meta">Genuine choice remaining</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: '#0e8f82' }}>
              GBP {genuineChoice.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="goal-card__meta">Discretionary committed</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: isOver ? '#C23' : undefined }}>
              GBP {discretionary.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="goal-card__meta">Avg score in Budget</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20 }}>
              {Number(board!.totals.avg_weighted_score).toFixed(1)}
            </div>
          </div>
        </div>

        <div style={{ height: 12, background: 'var(--cloud)', borderRadius: 999, marginTop: 14, overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${fixedPct}%`, background: '#E8A317' }} />
          <div style={{ width: `${discPct}%`, background: '#17C3B2' }} />
          {isOver && <div style={{ width: `${overPct}%`, background: '#C23' }} />}
        </div>

        {(isOver || board!.totals.deferred_fixed_breach_count > 0) && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: '#C23', fontWeight: 500 }}>
            {isOver && <div>&#9888; Discretionary spend exceeds the genuine choice remaining by GBP {(discretionary - genuineChoice).toLocaleString()}.</div>}
            {board!.totals.deferred_fixed_breach_count > 0 && (
              <div>&#9888; {board!.totals.deferred_fixed_breach_count} fixed-date item(s) sitting in Deferred - recorded as accepted risk.</div>
            )}
            <div style={{ color: 'var(--muted)', fontWeight: 400, marginTop: 2 }}>Both are flags, not blocks - you can still agree this plan.</div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, alignItems: 'start' }}>
        <div
          onDragOver={(e) => handleDragOver(e, 'all')}
          onDragLeave={() => handleDragLeave('all')}
          onDrop={(e) => handleDrop(e, 'all')}
          style={columnStyle('all', { background: 'var(--cloud)', borderRadius: 'var(--radius)', padding: 12, minHeight: 200 })}
        >
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
            All demand <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 400, fontSize: 11, color: 'var(--muted)' }}>({visibleAll.length})</span>
          </div>
          {visibleAll.map(renderCard)}
          {visibleAll.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>No unplaced assessed demand.</p>}
        </div>

        <div
          onDragOver={(e) => handleDragOver(e, 'budget')}
          onDragLeave={() => handleDragLeave('budget')}
          onDrop={(e) => handleDrop(e, 'budget')}
          style={columnStyle('budget', { background: 'rgba(23,195,178,0.06)', border: '1.5px solid var(--teal)', borderRadius: 'var(--radius)', padding: 12, minHeight: 200 })}
        >
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
            In budget <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 400, fontSize: 11, color: 'var(--muted)' }}>({visibleBudget.length})</span>
          </div>
          {visibleBudget.map(renderCard)}
          {visibleBudget.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>Drag demand here to commit it.</p>}
        </div>

        <div
          onDragOver={(e) => handleDragOver(e, 'deferred')}
          onDragLeave={() => handleDragLeave('deferred')}
          onDrop={(e) => handleDrop(e, 'deferred')}
          style={columnStyle('deferred', { background: 'rgba(96,102,119,0.05)', borderRadius: 'var(--radius)', padding: 12, minHeight: 200 })}
        >
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
            Deferred <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 400, fontSize: 11, color: 'var(--muted)' }}>({visibleDeferred.length})</span>
          </div>
          {visibleDeferred.map(renderCard)}
          {visibleDeferred.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>Drag here to defer - a reason will be asked for.</p>}
        </div>
      </div>

      {deferReasonFor && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }}>
          <div className="goal-card" style={{ background: '#fff', maxWidth: 420, width: '90%' }}>
            <div className="goal-card__name" style={{ marginBottom: 10 }}>Why is this being deferred?</div>
            <textarea
              value={deferReasonText}
              onChange={(e) => setDeferReasonText(e.target.value)}
              rows={3}
              placeholder="e.g. no capacity this year, low benefit, dependent on another initiative"
              style={{ width: '100%', padding: 10, border: '1px solid var(--hairline)', borderRadius: 9, fontFamily: 'var(--font-body)', fontSize: 13 }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={confirmDefer} className="btn btn--project">Defer</button>
              <button onClick={() => { setDeferReasonFor(null); setDeferReasonText(''); }} className="btn btn--outline">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}