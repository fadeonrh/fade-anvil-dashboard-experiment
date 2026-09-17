/**
 * Night event state machine — pure time-based detection for Nightshades
 * "The Night" mechanic. No I/O, no blockchain reads.
 *
 * Timing (EDT):
 *   10:00–11:00  NIGHT_LOCKED — all faction trading paused
 *   11:00–12:00  DECAY        — anti-snipe tax decays 99% → 0%
 *   12:00–13:00  RECOVERY     — normal trading resumes, recovery window
 *   All other    NORMAL       — standard trading
 */

export type NightState = "normal" | "night_locked" | "decay" | "recovery";

export interface NightTiming {
  lockStartMinutes: number;
  lockEndMinutes: number;
  recoveryEndMinutes: number;
}

const EDT_OFFSET = -4; // UTC-4 (EDT); switch to -5 for EST if needed

function toEDT(date: Date): { h: number; m: number; s: number } {
  const edtMs = date.getTime() + EDT_OFFSET * 3_600_000;
  const d = new Date(edtMs);
  return { h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds() };
}

/**
 * Returns the current Night state based on EDT time.
 */
export function getCurrentNightState(
  now: Date = new Date(),
  timing: NightTiming,
  decayDurationSeconds: number = 3600,
): NightState {
  return getNightStateWithTiming(now, timing, decayDurationSeconds);
}

/**
 * Anti-snipe tax decay progress within the DECAY window.
 * Returns 0.0 at lockEnd (99% tax), 1.0 at lockEnd+decayDuration (0% tax).
 * Returns null when not in DECAY.
 */
export function getDecayProgress(
  now: Date = new Date(),
  timing: NightTiming,
  decayDurationSeconds: number,
): number | null {
  const { h, m, s } = toEDT(now);
  const minutes = h * 60 + m;
  const decayStart = timing.lockEndMinutes;
  const decayDurationMinutes = Math.ceil(decayDurationSeconds / 60);
  const decayEnd = timing.lockEndMinutes + decayDurationMinutes;
  if (minutes < decayStart || minutes >= decayEnd) return null;
  const elapsed = (minutes - decayStart) * 60 + s;
  return Math.min(1, Math.max(0, elapsed / decayDurationSeconds));
}

/**
 * Current anti-snipe tax rate as a fraction (0.99 → 0.00) based on decay progress.
 * Linear:      tax = maxTaxRate * (1 - progress)
 * Exponential: tax = maxTaxRate * (1 - progress)^2
 * Returns null when not in DECAY.
 */
export function getCurrentTaxRate(
  now: Date = new Date(),
  timing: NightTiming,
  decayDurationSeconds: number,
  maxTaxRate: number,
  decayCurve: string,
): number | null {
  const progress = getDecayProgress(now, timing, decayDurationSeconds);
  if (progress === null) return null;
  if (decayCurve === "exponential") {
    return maxTaxRate * (1 - progress) * (1 - progress);
  }
  return maxTaxRate * (1 - progress);
}

/**
 * Current anti-snipe tax in bps (9900 → 0) based on decay progress.
 * Returns null when not in DECAY.
 */
export function getCurrentTaxBps(
  now: Date = new Date(),
  timing: NightTiming,
  decayDurationSeconds: number,
  maxTaxRate: number,
  decayCurve: string,
): number | null {
  const rate = getCurrentTaxRate(now, timing, decayDurationSeconds, maxTaxRate, decayCurve);
  if (rate === null) return null;
  return Math.round(rate * 10_000);
}

/**
 * Milliseconds until the next NIGHT_LOCKED window begins.
 * If currently in NIGHT_LOCKED/DECAY/RECOVERY, returns 0.
 */
export function getTimeUntilNextNight(now: Date = new Date(), timing: NightTiming): number {
  const state = getCurrentNightState(now, timing);
  if (state !== "normal") return 0;

  const { h, m, s } = toEDT(now);
  const minutes = h * 60 + m;
  let deltaMinutes = timing.lockStartMinutes - minutes;
  if (deltaMinutes <= 0) deltaMinutes += 24 * 60;

  return (deltaMinutes * 60 - s) * 1000;
}

/**
 * Human-readable label for the current state.
 */
export function nightStateLabel(state: NightState): string {
  switch (state) {
    case "night_locked": return "Night";
    case "decay":        return "Sunrise";
    case "recovery":     return "Day";
    case "normal":       return "Day";
  }
}

/**
 * State machine with custom timing (useful for tests).
 */
export function getNightStateWithTiming(
  now: Date,
  timing: NightTiming,
  decayDurationSeconds: number = 3600,
): NightState {
  const { h, m } = toEDT(now);
  const minutes = h * 60 + m;
  const decayDurationMinutes = Math.ceil(decayDurationSeconds / 60);

  if (minutes >= timing.lockStartMinutes && minutes < timing.lockEndMinutes)
    return "night_locked";
  if (minutes >= timing.lockEndMinutes && minutes < timing.lockEndMinutes + decayDurationMinutes)
    return "decay";
  if (minutes >= timing.lockEndMinutes + decayDurationMinutes && minutes < timing.recoveryEndMinutes)
    return "recovery";
  return "normal";
}
