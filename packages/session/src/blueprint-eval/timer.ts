import type { EvaluatorTable } from './types';
import './requests';

export const MIN_TIMER_SECONDS = 0.01, MAX_TIMER_SECONDS = 3600;
export const TIMER_EVALUATORS = {
 'timer.start': { flow: (node, c) => {
  const seconds = Number(c.read('seconds'));
  if (!Number.isFinite(seconds)) throw new RangeError('Timer seconds are not finite');
  c.request({ kind: 'startTimer', name: node.settings.name, seconds: Math.min(Math.max(seconds, MIN_TIMER_SECONDS), MAX_TIMER_SECONDS), repeat: node.settings.repeat });
  c.follow('exit');
 } },
 'timer.stop': { flow: (node, c) => { c.request({ kind: 'stopTimer', name: node.settings.name }); c.follow('exit'); } },
 'timer.on': {},
 'timer.sessionTime': { data: (_n, _o, _r, _s, env) => (env.nowMs ?? 0) / 1000 },
} satisfies Partial<EvaluatorTable>;
