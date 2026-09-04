import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './apiClient';

type Stage = 'raise' | 'triage' | 'assess' | 'accept';

interface DraftRecord<T> {
  id: string;
  stage: Stage;
  demand_id: string | null;
  data: T;
  updated_at: string;
  updated_by_name?: string;
}

/**
 * Generic save-draft/resume-draft hook, shared by every stage that has
 * a submit-to-advance action (Raise, Triage, Assess, RACI+promote).
 *
 * - demandId: pass null for 'raise' (no demand exists yet); pass the
 *   real id for the other three stages.
 * - On mount, silently checks for an existing draft and exposes it via
 *   `loadedDraft` once found -- the calling form decides how/whether
 *   to prefill from it (e.g. only if the form is still empty).
 * - `saveDraft(data)` creates the draft on first save, then updates
 *   the same row on every save after that.
 * - `discardDraft()` should be called right after a real submit
 *   succeeds -- a draft that outlives its own submission is stale
 *   clutter, not a useful record.
 */
export function useDraft<T extends Record<string, any>>(stage: Stage, demandId: string | null) {
  const [loadedDraft, setLoadedDraft] = useState<DraftRecord<T> | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const checkedOnce = useRef(false);

  useEffect(() => {
    if (checkedOnce.current) return;
    checkedOnce.current = true;

    const params = new URLSearchParams({ stage });
    if (demandId) params.set('demandId', demandId);

    apiFetch(`/api/drafts?${params.toString()}`)
      .then((drafts: DraftRecord<T>[]) => {
        if (drafts.length > 0) {
          setLoadedDraft(drafts[0]);
          setDraftId(drafts[0].id);
        }
      })
      .catch(() => {
        // Silent -- a failed draft lookup shouldn't block using the form fresh.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveDraft(data: T) {
    setSaving(true);
    setSaveError(null);
    try {
      if (draftId) {
        await apiFetch(`/api/drafts/${draftId}`, {
          method: 'PATCH',
          body: JSON.stringify({ data }),
        });
      } else {
        const created: DraftRecord<T> = await apiFetch('/api/drafts', {
          method: 'POST',
          body: JSON.stringify({ stage, demandId: demandId ?? undefined, data }),
        });
        setDraftId(created.id);
      }
      setSavedAt(new Date());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save draft.');
    } finally {
      setSaving(false);
    }
  }

  async function discardDraft() {
    if (!draftId) return;
    try {
      await apiFetch(`/api/drafts/${draftId}`, { method: 'DELETE' });
    } catch {
      // If this fails the draft just lingers harmlessly until next save
      // overwrites or a future cleanup removes it -- not worth surfacing.
    }
    setDraftId(null);
    setLoadedDraft(null);
  }

  return { loadedDraft, draftId, saving, savedAt, saveError, saveDraft, discardDraft };
}
