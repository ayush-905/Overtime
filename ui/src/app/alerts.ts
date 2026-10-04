// Saying the alerts: a chime, then a note on the page while you're looking at
// it, or a notification while it's in the background. Only the dashboard proper
// (not the popover or /mini) runs the checks, so an alert never comes twice. They
// run with every message from the server (its heartbeat too, which is what keeps
// them going in a window you can't see), and every 15 seconds while you can, for
// what passes with no new data (a reset, a wait, a budget). They follow the
// stores rather than drawing anything, so the page isn't drawn again for them.

import { useEffect } from 'react';
import { useLive } from '@/data/live';
import { useLimits } from '@/data/limits';
import { demo } from '@/data/api';
import { env } from '@/lib/env';
import { quotaItems, type LimitsInput } from '@/lib/limits';
import { checkDigest, checkLimits, checkNeeds, checkStuck, checkWaiting, readAlertPrefs, type Alert } from '@/lib/alerts';
import type { LiveAgent } from '@/lib/agents';
import { alertNote } from './toasts';

let audio: AudioContext | null = null;

export function chime(notes = [880, 1318.5]) {
  try {
    audio ||= new AudioContext();
    const t0 = audio.currentTime;
    notes.forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.12 + 0.35);
      osc.connect(gain).connect(audio!.destination);
      osc.start(t0 + i * 0.12);
      osc.stop(t0 + i * 0.12 + 0.4);
    });
  } catch {}
}

const TONES: Record<Alert['level'], number[]> = { info: [880, 1318.5], warn: [660, 880], crit: [523.25, 659.25, 523.25], good: [880, 1318.5] };

/** Chime, then a note on the page if you're looking at it, or a notification if you're not. */
export function deliver({ title, body = '', tag, level = 'info' }: Alert) {
  chime(TONES[level] || TONES.info);
  if (!document.hidden) alertNote(title, body, level === 'info' ? 'alert' : level);
  else if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, tag, silent: true });
    } catch {}
  }
}

/** Ask to show notifications, the first time an alert is switched on. */
export async function askPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch {}
  }
}

function inputNow(): LimitsInput {
  const snap = useLive.getState().snap;
  const l = useLimits.getState();
  return { now: Date.now() - env.timeOffset, limits: (snap?.limits || null) as LimitsInput['limits'], exactOn: l.exactOn, exact: l.exact as LimitsInput['exact'], codexRecorded: (snap?.codexLimits || null) as LimitsInput['codexRecorded'], codexExactOn: l.codexExactOn, codexExact: l.codexExact as LimitsInput['codexExact'] };
}

/** Run the checks now (after a switch is turned on, or a threshold changes). */
export function checkAll() {
  if (demo) return;
  const snap = useLive.getState().snap;
  if (!snap) return;
  const prefs = readAlertPrefs();
  const agents = snap.agents as unknown as LiveAgent[];
  const inp = inputNow();
  const list = [
    ...checkLimits(prefs, quotaItems(inp, 'all'), snap.analytics?.all?.spend?.today?.cost, inp.now),
    ...checkWaiting(prefs, agents, inp.now),
    ...checkStuck(prefs, agents, inp.now),
    ...checkDigest(prefs, Date.now()),
  ];
  for (const a of list) deliver(a);
}

/** The dashboard proper's alerts: on each message from the server, and every 15 seconds. */
export function useAlerts(on: boolean) {
  useEffect(() => {
    if (!on || demo) return;
    let prev: Map<string, LiveAgent> | null = null;
    let seen: unknown = null;
    let agents: unknown = null;
    let at = 0;
    const check = () => {
      const snap = useLive.getState().snap;
      // Each message, the heartbeat too (the same snapshot, with only its time moved on), but not the store's other changes.
      if (!snap || (snap === seen && snap.now === at)) return;
      seen = snap;
      at = snap.now;
      if (snap.agents !== agents) {
        agents = snap.agents;
        const list = snap.agents as unknown as LiveAgent[];
        if (prev) for (const a of checkNeeds(readAlertPrefs(), prev, list)) deliver(a);
        prev = new Map(list.map((a) => [a.id, a]));
      }
      checkAll();
    };
    check();
    const stop = useLive.subscribe(check);
    const t = setInterval(() => {
      if (!document.hidden) checkAll();
    }, 15_000);
    return () => {
      stop();
      clearInterval(t);
    };
  }, [on]);
}
