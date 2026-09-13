interface ConfidentialityToggleProps {
  hideConfidential: boolean;
  onToggle: (value: boolean) => void;
  hasConfidential: boolean;
}

/**
 * Purely presentational -- the hide/show state is owned once per page
 * via useHideConfidential() and passed down as props. This component
 * must NOT call useHideConfidential() itself: doing so previously gave
 * the button its own independent copy of the state, separate from the
 * page's copy that actually drives the filtering, so clicking it
 * updated its own label but not the page underneath it.
 *
 * The badge indicates whether the CURRENT page's data has at least
 * one confidential item, regardless of whether it's currently hidden
 * or shown -- so even while hidden, there's still an honest signal
 * that something is being suppressed here.
 */
export function ConfidentialityToggle({ hideConfidential, onToggle, hasConfidential }: ConfidentialityToggleProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <button
        type="button"
        onClick={() => onToggle(!hideConfidential)}
        className="toggle-pill"
        aria-pressed={hideConfidential}
        title={
          hideConfidential
            ? 'Confidential demand is hidden on every page -- safe to screen share'
            : 'Confidential demand is currently visible on this page'
        }
      >
        {hideConfidential ? 'Confidential hidden' : 'Confidential shown'}
      </button>
      {hasConfidential && (
        <span
          title="This view currently contains at least one confidential item"
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 5px',
            borderRadius: 4, background: 'rgba(91,95,239,0.12)', color: 'var(--indigo)',
          }}
        >
          CONFIDENTIAL
        </span>
      )}
    </div>
  );
}