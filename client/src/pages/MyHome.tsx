import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import { useHideConfidential } from '../lib/useHideConfidential';
import { ConfidentialityToggle } from '../components/ConfidentialityToggle';
import { promotedDemandLabel } from '../lib/promotedDemandLabel';

interface Demand {
  id: string;
  title: string;
  status: string;
  raised_date: string;
  raised_by: string;
  portfolio_name: string;
  business_case_id: string | null;
  business_case_decision: string | null;
  delivery_stage: 'delivery_started' | 'delivery_completed' | 'adoption_measured' | 'benefit_realized' | null;
  confidential: boolean;
}

interface ActionItem {
  id: string;
  title: string;
  raised_date: string;
  portfolio_name: string;
  confidential: boolean;
}

interface BusinessCaseActionItem extends ActionItem {
  business_case_id: string;
}

interface Actions {
  triageNeeded: ActionItem[];
  assessmentNeeded: ActionItem[];
  businessCaseNeeded: BusinessCaseActionItem[];
}

const STATUS_LABELS: Record<string, string> = {
  raised: 'Raised', accepted: 'Accepted', assessed: 'Assessed', promoted: 'Business Case', stopped: 'Stopped',
};

function DemandRow({ d }: { d: Demand }) {
  const linkTo = d.status === 'promoted' && d.business_case_id ? `/business-case/${d.business_case_id}` : `/demand/${d.id}`;
  return (
    <Link to={linkTo} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10, marginBottom: 8, fontSize: 13,
      }}>
        <div>
          <div style={{ fontWeight: 600 }}>{d.title}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{d.portfolio_name}</div>
        </div>
        <span className="pill pill--muted" style={{ fontSize: 9.5, padding: '2px 6px', textTransform: 'capitalize' }}>
          {d.status === 'promoted' ? promotedDemandLabel(d) : (STATUS_LABELS[d.status] ?? d.status)}
        </span>
      </div>
    </Link>
  );
}

function ActionRow({ item, actionLabel, to }: { item: ActionItem; actionLabel: string; to: string }) {
  return (
    <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10, marginBottom: 8, fontSize: 13,
      }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {item.title}
            {item.confidential && (
              <span
                title="Confidential -- you're seeing this because you're the raiser, a named viewer, or currently assigned to it"
                style={{
                  display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
                  background: '#c22', marginLeft: 7, verticalAlign: 'middle',
                }}
              />
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {item.portfolio_name} &middot; raised {new Date(item.raised_date).toLocaleDateString()}
          </div>
        </div>
        <span className="pill pill--indigo" style={{ fontSize: 9.5, padding: '2px 6px' }}>{actionLabel}</span>
      </div>
    </Link>
  );
}

export function MyHome() {
  const { user } = useAuth();
  const [myDemand, setMyDemand] = useState<Demand[]>([]);
  const [actions, setActions] = useState<Actions>({ triageNeeded: [], assessmentNeeded: [], businessCaseNeeded: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch('/api/me'),
      apiFetch('/api/demands'),
      apiFetch('/api/me/actions'),
    ])
      .then(([me, demands, myActions]: [{ userId: string }, Demand[], Actions]) => {
        setMyDemand(demands.filter((d) => d.raised_by === me.userId));
        setActions(myActions);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const { hideConfidential, setHideConfidential } = useHideConfidential();
  const hasConfidential =
    myDemand.some((d) => d.confidential) ||
    actions.triageNeeded.some((a) => a.confidential) ||
    actions.assessmentNeeded.some((a) => a.confidential) ||
    actions.businessCaseNeeded.some((a) => a.confidential);

  const visibleTriage = actions.triageNeeded.filter((a) => !hideConfidential || !a.confidential);
  const visibleAssessment = actions.assessmentNeeded.filter((a) => !hideConfidential || !a.confidential);
  const visibleBusinessCase = actions.businessCaseNeeded.filter((a) => !hideConfidential || !a.confidential);
  const visibleMyDemand = myDemand.filter((d) => !hideConfidential || !d.confidential);
  const totalActions = visibleTriage.length + visibleAssessment.length + visibleBusinessCase.length;

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">{user?.email ? 'Welcome back' : 'My Home'}</h1>
          <p className="page-subtitle">What's yours to raise, watch, and action.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ConfidentialityToggle hideConfidential={hideConfidential} onToggle={setHideConfidential} hasConfidential={hasConfidential} />
          <Link to="/demand/raise" className="btn btn--project" style={{ textDecoration: 'none' }}>
            + Raise demand
          </Link>
        </div>
      </div>

      {loading && <p>Loading...</p>}
      {error && <p className="login-error">{error}</p>}

      {!loading && !error && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* ---------- My Actions ---------- */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, margin: 0 }}>My Actions</h2>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{totalActions}</span>
            </div>

            {visibleTriage.length > 0 && (
              <>
                <div className="goal-card__meta" style={{ marginBottom: 6 }}>Needs triage</div>
                {visibleTriage.map((item) => (
                  <ActionRow key={item.id} item={item} actionLabel="Triage" to={`/demand/${item.id}`} />
                ))}
              </>
            )}

            {visibleAssessment.length > 0 && (
              <>
                <div className="goal-card__meta" style={{ marginTop: 12, marginBottom: 6 }}>Needs P75 assessment</div>
                {visibleAssessment.map((item) => (
                  <ActionRow key={item.id} item={item} actionLabel="Assess" to={`/demand/${item.id}/assess`} />
                ))}
              </>
            )}

            {visibleBusinessCase.length > 0 && (
              <>
                <div className="goal-card__meta" style={{ marginTop: 12, marginBottom: 6 }}>Needs business case</div>
                {visibleBusinessCase.map((item) => (
                  <ActionRow key={item.id} item={item} actionLabel="Write" to={`/business-case/${item.business_case_id}`} />
                ))}
              </>
            )}

            {totalActions === 0 && (
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>Nothing needs your action right now.</p>
            )}
          </div>

          {/* ---------- My Demand ---------- */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, margin: 0 }}>My Demand</h2>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{visibleMyDemand.length}</span>
            </div>

            {visibleMyDemand.length > 0 ? (
              visibleMyDemand.map((d) => <DemandRow key={d.id} d={d} />)
            ) : (
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                You haven't raised any demand yet.{' '}
                <Link to="/demand/raise">Raise your first.</Link>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}