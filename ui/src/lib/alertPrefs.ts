// Your alert settings: read here
// for what the pages mention (a budget you passed, how long before an agent
// counts as stuck), changed in Settings, and used by the alerts (lib/alerts.ts).

export const WAIT_MAX_MINUTES = 25;
export const STUCK_MAX_MINUTES = 40;

export type AlertPrefs = { needs: boolean; waiting: boolean; waitMinutes: number; stuck: boolean; stuckMinutes: number; limits: boolean; pace: boolean; reset: boolean; budget: boolean; budgetUsd: number; digest: boolean };

export function readAlertPrefs(): AlertPrefs {
  const prefs: AlertPrefs = { needs: false, waiting: false, waitMinutes: 10, stuck: false, stuckMinutes: 10, limits: false, pace: false, reset: false, budget: false, budgetUsd: 50, digest: false };
  try {
    prefs.needs = localStorage.getItem('overtime-alerts') === '1';
    Object.assign(prefs, JSON.parse(localStorage.getItem('overtime-alert-prefs') || '{}'), { needs: prefs.needs });
  } catch {}
  prefs.waitMinutes = Math.min(WAIT_MAX_MINUTES, Math.max(1, Math.round(prefs.waitMinutes) || 10));
  prefs.stuckMinutes = Math.min(STUCK_MAX_MINUTES, Math.max(2, Math.round(prefs.stuckMinutes) || 10));
  return prefs;
}
