// client/src/pages/FiveYearHorizon.tsx
//
// Reads existing design tokens (graphite/teal/indigo/cloud/hairline,
// goal-card, pill classes) -- adjust class names below if the actual
// token/class names in the codebase differ from what's in memory.
//
// ASSUMPTION: an authenticated fetch helper `apiFetch` exists
// elsewhere in client/src (used by other pages for /api calls with
// the Firebase auth token attached). Swap for the real import.

import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { apiFetch } from '../lib/apiFetch';
import './FiveYearHorizon.css';

type Quarter = 1 | 2 | 3 | 4 | null;

interface HorizonDemand {
  id: string;
  title: string;
  status: string;
  date_driver_type: string | null;
  target_start_year: number;
  target_start_quarter: Quarter;
  target_end_year: number;
  target_end_quarter: Quarter;
  portfolio_id: string;
  portfolio_name: string;
  is_agreed_locked: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  raised: 'Raised',
  accepted: 'Accepted',
  assessed: 'Assessed',
  promoted: 'Promoted',
};

function currentFinancialYear(): number {
  // ASSUMPTION: FY = calendar year of April start, matching UK Green
  // Book convention referenced elsewhere in this project. Adjust if
  // the org's actual FY boundary differs.
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

export default function FiveYearHorizon({ canReassign }: { canReassign: boolean }) {
  const [demands, setDemands] = useState<HorizonDemand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quarterView, setQuarterView] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<{
    demand: HorizonDemand;
    toYear: number;
    toQuarter: Quarter;
    toEndYear: number;
    toEndQuarter: Quarter;
  } | null>(null);
  const [reasonText, setReasonText] = useState('');

  const startYear = currentFinancialYear();
  const years = useMemo(() => Array.from({ length: 5 }, (_, i) => startYear + i), [startYear]);
  const columns = quarterView ? years.flatMap((y) => [1, 2, 3, 4].map((q) => ({ year: y, quarter: q as Quarter }))) : years.map((y) => ({ year: y, quarter: null as Quarter }));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/demands/horizon');
      if (!res.ok) throw new Error('Could not load the five-year horizon.');
      const data = await res.json();
      setDemands(data.demands);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong loading the horizon.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; items: HorizonDemand[] }>();
    for (const d of demands) {
      if (!map.has(d.portfolio_id)) map.set(d.portfolio_id, { name: d.portfolio_name, items: [] });
      map.get(d.portfolio_id)!.items.push(d);
    }
    return Array.from(map.values());
  }, [demands]);

  function columnIndex(year: number, quarter: Quarter) {
    if (quarterView) {
      const yIdx = years.indexOf(year);
      return yIdx * 4 + ((quarter ?? 1) - 1);
    }
    return years.indexOf(year);
  }

  function spanColumns(d: HorizonDemand) {
    const start = columnIndex(d.target_start_year, d.target_start_quarter);
    const end = columnIndex(d.target_end_year, d.target_end_quarter ?? d.target_start_quarter);
    return { start, span: Math.max(1, end - start + 1) };
  }

  // ── drag/resize interaction ──────────────────────────────────────
  // Column width and grid ref used to translate pointer position into
  // a target column index while dragging.
  const gridRef = useRef<HTMLDivElement>(null);
  const colCount = columns.length;

  function pointerToColumn(clientX: number): number {
    const grid = gridRef.current;
    if (!grid) return 0;
    const rect = grid.getBoundingClientRect();
    const labelWidth = 110;
    const usable = rect.width - labelWidth;
    const colWidth = usable / colCount;
    const x = clientX - rect.left - labelWidth;
    return Math.min(colCount - 1, Math.max(0, Math.floor(x / colWidth)));
  }

  function columnToYearQuarter(col: number): { year: number; quarter: Quarter } {
    if (quarterView) {
      const yIdx = Math.floor(col / 4);
      const q = (col % 4) + 1;
      return { year: years[yIdx], quarter: q as Quarter };
    }
    return { year: years[col], quarter: null };
  }

  function beginDrag(d: HorizonDemand, mode: 'move' | 'resize-start' | 'resize-end') {
    if (!canReassign || d.is_agreed_locked || (d.date_driver_type && d.date_driver_type !== 'none')) return;

    function onMove(e: PointerEvent) {
      const col = pointerToColumn(e.clientX);
      const { year, quarter } = columnToYearQuarter(col);
      setReassignTarget((prev) => {
        const base = prev ?? {
          demand: d,
          toYear: d.target_start_year,
          toQuarter: d.target_start_quarter,
          toEndYear: d.target_end_year,
          toEndQuarter: d.target_end_quarter,
        };
        if (mode === 'move') {
          const startCol = columnIndex(d.target_start_year, d.target_start_quarter);
          const endCol = columnIndex(d.target_end_year, d.target_end_quarter ?? d.target_start_quarter);
          const span = endCol - startCol;
          const newStart = Math.min(colCount - 1 - span, col);
          const s = columnToYearQuarter(newStart);
          const e2 = columnToYearQuarter(newStart + span);
          return { ...base, toYear: s.year, toQuarter: s.quarter, toEndYear: e2.year, toEndQuarter: e2.quarter };
        }
        if (mode === 'resize-start') {
          return { ...base, toYear: year, toQuarter: quarter };
        }
        return { ...base, toEndYear: year, toEndQuarter: quarter };
      });
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // Leave reassignTarget set -- opens the reason modal (rendered
      // below) rather than committing immediately.
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  async function confirmReassign() {
    if (!reassignTarget) return;
    if (!reasonText.trim()) return;
    try {
      const res = await apiFetch(`/api/demands/${reassignTarget.demand.id}/target-year/reassign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_year: reassignTarget.toYear,
          to_quarter: reassignTarget.toQuarter,
          to_end_year: reassignTarget.toEndYear,
          to_end_quarter: reassignTarget.toEndQuarter,
          reason: reasonText.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Could not move this demand.');
        return;
      }
      setReassignTarget(null);
      setReasonText('');
      await load();
    } catch {
      setError('Could not reach the server. Try again.');
    }
  }

  function cancelReassign() {
    setReassignTarget(null);
    setReasonText('');
  }

  function lockIcon(d: HorizonDemand): 'lock' | 'clock' | null {
    if (d.is_agreed_locked) return 'lock';
    if (d.date_driver_type && d.date_driver_type !== 'none') return 'clock';
    return null;
  }

  if (loading) return <div className="horizon-state">Loading the five-year horizon…</div>;
  if (error && demands.length === 0) return <div className="horizon-state horizon-state--error">{error}</div>;

  return (
    <div className="horizon-page">
      <div className="horizon-header">
        <h1 className="horizon-title">Five-year horizon</h1>
        <button
          className="pill pill--toggle"
          onClick={() => setQuarterView((v) => !v)}
          aria-pressed={quarterView}
        >
          {quarterView ? 'Year view' : 'Quarter view'}
        </button>
      </div>

      {error && <div className="horizon-inline-error">{error}</div>}

      <div className="horizon-grid" ref={gridRef}>
        <div className="horizon-grid__header" style={{ gridTemplateColumns: `110px repeat(${colCount}, 1fr)` }}>
          <div />
          {quarterView
            ? years.map((y) => (
                <div key={y} className="horizon-grid__year-label" style={{ gridColumn: 'span 4' }}>
                  FY{String(y).slice(-2)}
                </div>
              ))
            : years.map((y) => (
                <div key={y} className="horizon-grid__year-label">
                  FY{String(y).slice(-2)}
                </div>
              ))}
        </div>
        {quarterView && (
          <div className="horizon-grid__subheader" style={{ gridTemplateColumns: `110px repeat(${colCount}, 1fr)` }}>
            <div />
            {columns.map((c, i) => (
              <div key={i} className="horizon-grid__quarter-label">
                Q{c.quarter}
              </div>
            ))}
          </div>
        )}

        {grouped.map((group) => (
          <div key={group.name} className="horizon-group">
            <div className="horizon-group__label">{group.name}</div>
            {group.items.map((d) => {
              const { start, span } = spanColumns(d);
              const lock = lockIcon(d);
              const draggable = canReassign && !lock;
              return (
                <div
                  key={d.id}
                  className="horizon-row"
                  style={{ gridTemplateColumns: `110px repeat(${colCount}, 1fr)` }}
                >
                  <div className="horizon-row__label">{d.title}</div>
                  <div
                    className={`horizon-bar goal-card horizon-bar--${d.status}${lock ? ' horizon-bar--locked' : ''}`}
                    style={{ gridColumn: `${start + 2} / span ${span}` }}
                  >
                    {draggable && (
                      <span
                        className="horizon-bar__handle horizon-bar__handle--start"
                        onPointerDown={() => beginDrag(d, 'resize-start')}
                        aria-label="Resize start"
                      />
                    )}
                    <span
                      className="horizon-bar__body"
                      onPointerDown={() => draggable && beginDrag(d, 'move')}
                    >
                      {lock === 'lock' && <span className="horizon-bar__icon" aria-hidden="true">🔒</span>}
                      {lock === 'clock' && <span className="horizon-bar__icon" aria-hidden="true">🕐</span>}
                      {!lock && draggable && <span className="horizon-bar__icon" aria-hidden="true">⠿</span>}
                      {STATUS_LABEL[d.status] ?? d.status}
                    </span>
                    {draggable && (
                      <span
                        className="horizon-bar__handle horizon-bar__handle--end"
                        onPointerDown={() => beginDrag(d, 'resize-end')}
                        aria-label="Resize end"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="horizon-legend">
        <span>🔒 Agreed — locked, use mid-year revision to move</span>
        <span>🕐 Fixed date driver — locked</span>
        <span>⠿ Drag or resize (lead/admin)</span>
      </div>

      {reassignTarget && (
        <div className="horizon-modal-overlay" role="dialog" aria-modal="true">
          <div className="horizon-modal">
            <h2 className="horizon-modal__title">Move "{reassignTarget.demand.title}"?</h2>
            <p className="horizon-modal__body">
              Moving to FY{String(reassignTarget.toYear).slice(-2)}
              {reassignTarget.toQuarter ? ` Q${reassignTarget.toQuarter}` : ''}
              {' – '}
              FY{String(reassignTarget.toEndYear).slice(-2)}
              {reassignTarget.toEndQuarter ? ` Q${reassignTarget.toEndQuarter}` : ''}.
              This is logged with your name and the reason below.
            </p>
            <label className="horizon-modal__label" htmlFor="reassign-reason">
              Reason
            </label>
            <textarea
              id="reassign-reason"
              className="horizon-modal__textarea"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="Why is this moving?"
              rows={3}
            />
            <div className="horizon-modal__actions">
              <button className="pill pill--ghost" onClick={cancelReassign}>
                Cancel
              </button>
              <button className="pill pill--primary" onClick={confirmReassign} disabled={!reasonText.trim()}>
                Confirm move
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
