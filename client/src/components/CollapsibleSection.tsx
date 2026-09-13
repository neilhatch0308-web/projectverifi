import { useState, type ReactNode } from 'react';

// Chevron-toggle pattern shared across the sidebar nav (AppShell.tsx),
// My Home, and All Demand - anywhere a list or group of lists can get
// long enough that being able to collapse it matters. 'section' is the
// more prominent heading weight (My Actions, My Demand, a board
// column's own label); 'subsection' is the smaller muted-label weight
// (My Home's "Needs..." groupings).
export function CollapsibleSection({
  title, count, defaultOpen = true, variant = 'subsection', children,
}: { title: string; count?: number; defaultOpen?: boolean; variant?: 'section' | 'subsection'; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const isSection = variant === 'section';
  return (
    <div style={{ marginBottom: isSection ? 10 : 12 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'baseline', gap: isSection ? 8 : 6, width: '100%',
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          textAlign: 'left', color: 'inherit', font: 'inherit',
        }}
        aria-expanded={open}
      >
        <svg
          width={isSection ? 13 : 12} height={isSection ? 13 : 12} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
          style={{
            flexShrink: 0, color: 'var(--muted)', position: 'relative', top: isSection ? 2 : 1,
            transition: 'transform 0.15s ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
        {isSection ? (
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 }}>{title}</span>
        ) : (
          <span className="goal-card__meta" style={{ margin: 0 }}>{title}</span>
        )}
        {count !== undefined && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{count}</span>
        )}
      </button>
      {open && <div style={{ marginTop: isSection ? 10 : 6 }}>{children}</div>}
    </div>
  );
}
