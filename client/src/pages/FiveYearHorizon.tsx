import { useEffect, useMemo, useState, useRef, useCallback, useLayoutEffect } from 'react';
import { apiFetch } from '../lib/apiClient';
import { usePermissions } from '../context/PermissionsContext';
import { useHideConfidential } from '../lib/useHideConfidential';
import { ConfidentialityToggle } from '../components/ConfidentialityToggle';
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
  confidential: boolean;
}

interface Dependency {
  demand_id: string; // depends on depends_on_id
  depends_on_id: string;
}

const STATUS_LABEL: Record<string, string> = {
  raised: 'Raised',
  accepted: 'Accepted',
  assessed: 'Assessed',
  promoted: 'Promoted',
};

// ASSUMPTION: FY = calendar year of April start (UK Green Book
// convention referenced elsewhere in this project). Adjust if the
// org's actual FY boundary differs.
function currentFinancialYear(): number {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

export function FiveYearHorizon() {
  const { has } = usePermissions();
  const canReassign = has('demand.reassign_target_year');
  const canLink = has('planning.edit');

  const [demands, setDemands] = useState<HorizonDemand[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
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

  // Live preview shown during a drag/resize -- separate from
  // reassignTarget so updating it every pointermove never opens the
  // confirmation modal. Only the demand id + column span, since that's
  // all the ghost outline needs to render.
  const [dragPreview, setDragPreview] = useState<{ demandId: string; start: number; span: number } | null>(null);

  // "Link two demands" mode -- click the link icon on the PREREQUISITE
  // first, then click the link icon on the demand that depends on it.
  // Not the same interaction as drag (which moves timing); this only
  // draws a relationship, never changes either demand's dates.
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const startYear = currentFinancialYear();
  const years = useMemo(() => Array.from({ length: 5 }, (_, i) => startYear + i), [startYear]);
  const columns = quarterView
    ? years.flatMap((y) => [1, 2, 3, 4].map((q) => ({ year: y, quarter: q as Quarter })))
    : years.map((y) => ({ year: y, quarter: null as Quarter }));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/api/demands/horizon');
      setDemands(data.demands);
      setDependencies(data.dependencies ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong loading the horizon.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { hideConfidential, setHideConfidential } = useHideConfidential();
  const hasConfidential = demands.some((d) => d.confidential);

  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; items: HorizonDemand[] }>();
    for (const d of demands) {
      if (hideConfidential && d.confidential) continue;
      if (!map.has(d.portfolio_id)) map.set(d.portfolio_id, { name: d.portfolio_name, items: [] });
      map.get(d.portfolio_id)!.items.push(d);
    }
    return Array.from(map.values());
  }, [demands, hideConfidential]);

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

  const gridRef = useRef<HTMLDivElement>(null);
  const scrollBodyRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const colCount = columns.length;

  function pointerToColumn(clientX: number): number {
    const grid = gridRef.current;
    if (!grid) return 0;
    const rect = grid.getBoundingClientRect();
    const colWidth = rect.width / colCount;
    const x = clientX - rect.left;
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

    // Held in a plain variable during the drag, not React state --
    // setting state here would re-render and open the confirmation modal
    // on the very first pixel of movement, fighting the drag itself.
    // Only committed to state (which opens the modal) once released.
    let pending = {
      demand: d,
      toYear: d.target_start_year,
      toQuarter: d.target_start_quarter,
      toEndYear: d.target_end_year,
      toEndQuarter: d.target_end_quarter,
    };

    // The ghost outline IS safe to put in state every move -- it's a
    // separate piece of state from reassignTarget, so updating it can't
    // open the modal. Throttled to one update per animation frame so
    // fast pointer movement doesn't flood React with renders.
    let rafId: number | null = null;

    function publishPreview() {
      const start = columnIndex(pending.toYear, pending.toQuarter);
      const end = columnIndex(pending.toEndYear, pending.toEndQuarter ?? pending.toQuarter);
      setDragPreview({ demandId: d.id, start, span: Math.max(1, end - start + 1) });
      rafId = null;
    }

    function onMove(e: PointerEvent) {
      const col = pointerToColumn(e.clientX);
      const { year, quarter } = columnToYearQuarter(col);

      if (mode === 'move') {
        const startCol = columnIndex(d.target_start_year, d.target_start_quarter);
        const endCol = columnIndex(d.target_end_year, d.target_end_quarter ?? d.target_start_quarter);
        const span = endCol - startCol;
        const newStart = Math.min(colCount - 1 - span, col);
        const s = columnToYearQuarter(newStart);
        const e2 = columnToYearQuarter(newStart + span);
        pending = { ...pending, toYear: s.year, toQuarter: s.quarter, toEndYear: e2.year, toEndQuarter: e2.quarter };
      } else if (mode === 'resize-start') {
        pending = { ...pending, toYear: year, toQuarter: quarter };
      } else {
        pending = { ...pending, toEndYear: year, toEndQuarter: quarter };
      }

      if (rafId === null) rafId = requestAnimationFrame(publishPreview);
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (rafId !== null) cancelAnimationFrame(rafId);
      setDragPreview(null);
      // Only now, with the pointer released, does the modal open.
      setReassignTarget(pending);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  async function confirmReassign() {
    if (!reassignTarget || !reasonText.trim()) return;
    try {
      await apiFetch(`/api/demands/${reassignTarget.demand.id}/target-year/reassign`, {
        method: 'PATCH',
        body: JSON.stringify({
          toYear: reassignTarget.toYear,
          toQuarter: reassignTarget.toQuarter,
          toEndYear: reassignTarget.toEndYear,
          toEndQuarter: reassignTarget.toEndQuarter,
          reason: reasonText.trim(),
        }),
      });
      setReassignTarget(null);
      setReasonText('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not move this demand.');
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

  // ---------- Dependency linking ----------
  async function handleLinkClick(d: HorizonDemand) {
    if (!canLink) return;
    setLinkError(null);

    if (!linkingFrom) {
      setLinkingFrom(d.id);
      return;
    }
    if (linkingFrom === d.id) {
      setLinkingFrom(null); // clicked the same bar again -- cancel
      return;
    }

    const prerequisiteId = linkingFrom;
    setLinkingFrom(null);
    try {
      await apiFetch(`/api/demands/${d.id}/dependencies`, {
        method: 'POST',
        body: JSON.stringify({ dependsOnId: prerequisiteId }),
      });
      await load();
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : 'Could not link these demands.');
    }
  }

  async function removeDependency(dep: Dependency) {
    try {
      await apiFetch(`/api/demands/${dep.demand_id}/dependencies/${dep.depends_on_id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : 'Could not remove this link.');
    }
  }

  // ---------- Connector line geometry ----------
  // Measured from actual rendered bar positions (not re-derived column
  // math) so it stays correct regardless of scroll position, quarter
  // vs year view, or portfolio grouping -- one source of truth (the
  // DOM) rather than two systems that could drift apart.
  const [connectors, setConnectors] = useState<
    { key: string; path: string; dep: Dependency }[]
  >([]);

  useLayoutEffect(() => {
    const MARGIN = 4; // minimum real gap (px) before two boxes count as "clearly" left/right of each other

    function recompute() {
      const container = scrollBodyRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();

      const next = dependencies
        .map((dep) => {
          const fromEl = barRefs.current.get(dep.depends_on_id);
          const toEl = barRefs.current.get(dep.demand_id);
          if (!fromEl || !toEl) return null;

          const fromRect = fromEl.getBoundingClientRect();
          const toRect = toEl.getBoundingClientRect();
          const rel = (r: DOMRect) => ({
            left: r.left - containerRect.left + container.scrollLeft,
            right: r.right - containerRect.left + container.scrollLeft,
            top: r.top - containerRect.top + container.scrollTop,
            bottom: r.bottom - containerRect.top + container.scrollTop,
            centerX: r.left + r.width / 2 - containerRect.left + container.scrollLeft,
            centerY: r.top + r.height / 2 - containerRect.top + container.scrollTop,
          });
          const from = rel(fromRect);
          const to = rel(toRect);

          let path: string;

          if (to.left > from.right + MARGIN) {
            // Target clearly to the right -- exit source's right edge,
            // enter target's left edge. Jog at the true midpoint between
            // the two edges, not a fixed offset -- guarantees the final
            // segment always travels left-to-right into the target,
            // however close together the boxes are.
            const midX = (from.right + to.left) / 2;
            path = `M ${from.right} ${from.centerY} L ${midX} ${from.centerY} L ${midX} ${to.centerY} L ${to.left} ${to.centerY}`;
          } else if (to.right < from.left - MARGIN) {
            // Target clearly to the left -- mirror of the above.
            const midX = (from.left + to.right) / 2;
            path = `M ${from.left} ${from.centerY} L ${midX} ${from.centerY} L ${midX} ${to.centerY} L ${to.right} ${to.centerY}`;
          } else {
            // Boxes overlap horizontally -- typically two different
            // portfolio rows at the same point in time. Left/right
            // routing has no clean edges to use here (that's what was
            // producing the backwards-looking arrow), so route via
            // top/bottom instead, jogging at the true vertical midpoint.
            const targetBelow = to.centerY >= from.centerY;
            const y1 = targetBelow ? from.bottom : from.top;
            const y2 = targetBelow ? to.top : to.bottom;
            const midY = (y1 + y2) / 2;
            path = `M ${from.centerX} ${y1} L ${from.centerX} ${midY} L ${to.centerX} ${midY} L ${to.centerX} ${y2}`;
          }

          return { key: `${dep.demand_id}-${dep.depends_on_id}`, path, dep };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);

      setConnectors(next);
    }

    recompute();
    window.addEventListener('resize', recompute);
    const container = scrollBodyRef.current;
    container?.addEventListener('scroll', recompute);
    return () => {
      window.removeEventListener('resize', recompute);
      container?.removeEventListener('scroll', recompute);
    };
  }, [dependencies, demands, quarterView, grouped]);

  if (loading) return <div className="horizon-state">Loading the five-year horizon…</div>;
  if (error && demands.length === 0) return <div className="horizon-state horizon-state--error">{error}</div>;

  return (
    <div className="horizon-page">
      <div className="horizon-header">
        <h1 className="horizon-title">Five-year horizon</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ConfidentialityToggle hideConfidential={hideConfidential} onToggle={setHideConfidential} hasConfidential={hasConfidential} />
          <button className="pill pill--toggle" onClick={() => setQuarterView((v) => !v)} aria-pressed={quarterView}>
            {quarterView ? 'Year view' : 'Quarter view'}
          </button>
        </div>
      </div>

      {error && <div className="horizon-inline-error">{error}</div>}
      {linkError && <div className="horizon-inline-error">{linkError}</div>}

      {linkingFrom && (
        <div className="horizon-linking-banner">
          Click the demand that depends on this one to link them &mdash; or click the same box again to cancel.
        </div>
      )}

      <div className="horizon-grid" ref={gridRef}>
        <div className="horizon-grid__header" style={{ gridTemplateColumns: `repeat(${colCount}, 1fr)` }}>
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
          <div className="horizon-grid__subheader" style={{ gridTemplateColumns: `repeat(${colCount}, 1fr)` }}>
            {columns.map((c, i) => (
              <div key={i} className="horizon-grid__quarter-label">
                Q{c.quarter}
              </div>
            ))}
          </div>
        )}

        <div className="horizon-scroll-body" ref={scrollBodyRef} style={{ position: 'relative' }}>
          {grouped.map((group) => (
            <div key={group.name} className="horizon-group">
              <div className="horizon-group__label">{group.name}</div>
              {group.items.map((d) => {
                const { start, span } = spanColumns(d);
                const lock = lockIcon(d);
                const draggable = canReassign && !lock;
                const isLinkingSource = linkingFrom === d.id;
                return (
                  <div key={d.id} className="horizon-row" style={{ gridTemplateColumns: `repeat(${colCount}, 1fr)` }}>
                    <div
                      ref={(el) => { if (el) barRefs.current.set(d.id, el); else barRefs.current.delete(d.id); }}
                      className={`horizon-bar goal-card horizon-bar--${d.status}${lock ? ' horizon-bar--locked' : ''}${isLinkingSource ? ' horizon-bar--linking' : ''}`}
                      style={{ gridColumn: `${start + 1} / span ${span}`, gridRow: 1 }}
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
                        title={`${d.title} — ${STATUS_LABEL[d.status] ?? d.status}`}
                      >
                        {lock === 'lock' && <span className="horizon-bar__icon" aria-hidden="true">🔒</span>}
                        {lock === 'clock' && <span className="horizon-bar__icon" aria-hidden="true">🕐</span>}
                        {!lock && draggable && <span className="horizon-bar__icon" aria-hidden="true">⠿</span>}
                        <span className="horizon-bar__title">{d.title}</span>
                      </span>
                      {canLink && (
                        <button
                          type="button"
                          className="horizon-bar__link-btn"
                          onClick={(e) => { e.stopPropagation(); handleLinkClick(d); }}
                          title={isLinkingSource ? 'Cancel linking' : 'Link: this demand is needed before another'}
                          aria-label="Link to another demand"
                        >
                          🔗
                        </button>
                      )}
                      {draggable && (
                        <span
                          className="horizon-bar__handle horizon-bar__handle--end"
                          onPointerDown={() => beginDrag(d, 'resize-end')}
                          aria-label="Resize end"
                        />
                      )}
                    </div>
                    {dragPreview?.demandId === d.id && (
                      <div
                        className="horizon-ghost"
                        style={{ gridColumn: `${dragPreview.start + 1} / span ${dragPreview.span}`, gridRow: 1 }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          <svg className="horizon-connectors" aria-hidden="true">
            {connectors.map((c) => (
              <path
                key={c.key}
                d={c.path}
                className="horizon-connector-line"
                onClick={() => removeDependency(c.dep)}
              >
                <title>Click to remove this link</title>
              </path>
            ))}
          </svg>
        </div>
      </div>

      <div className="horizon-legend">
        <span>🔒 Agreed — locked, use mid-year revision to move</span>
        <span>🕐 Fixed date driver — locked</span>
        <span>⠿ Drag or resize (lead/admin)</span>
        <span>🔗 Link two demands — click one, then the one that depends on it</span>
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
