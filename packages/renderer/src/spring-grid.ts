// B43 R6: secondary motion steps on a fixed grid in session time. Step k is at k × 1000/60 ms; the frame tick is the last step at or before the frame time.
export const SPRING_STEP_SECONDS = 1 / 60;
export const SPRING_MAX_STEPS = 15;
export type SpringClock = { sessionId: string; tick: number; elapsedMs: number; resets: number };
export type SpringPlan = { reset: boolean; fractions: number[] };

export function planSpringSteps(previous: SpringClock | null, current: SpringClock): SpringPlan {
    if (!previous || previous.sessionId !== current.sessionId || current.tick < previous.tick || current.tick - previous.tick > SPRING_MAX_STEPS) return { reset: true, fractions: [] };
    const due = Array.from({ length: current.tick - previous.tick }, (_, index) => previous.tick + 1 + index);
    // B43 R7: never interpolate across a teleport.
    if (current.resets !== previous.resets) return { reset: true, fractions: due.map(() => 1) };
    const span = current.elapsedMs - previous.elapsedMs;
    return { reset: false, fractions: due.map(step => span > 0 ? Math.min(1, Math.max(0, (step * 1000 / 60 - previous.elapsedMs) / span)) : 1) };
}
