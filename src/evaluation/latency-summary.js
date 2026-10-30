export const MAX_RESPONSE_TIME_MS = 10_000;

/** End-to-end time includes retrieval, generation, and any fallback. */
export function summarizeLatency(timings, targetMs = MAX_RESPONSE_TIME_MS) {
  if (!Array.isArray(timings) || timings.length === 0) {
    throw new TypeError("timings must contain evaluated cases.");
  }
  if (typeof targetMs !== "number" || !Number.isFinite(targetMs) || targetMs <= 0) {
    throw new TypeError("targetMs must be a positive finite number.");
  }
  for (const timing of timings) {
    if (timing === null || typeof timing !== "object" || Array.isArray(timing) ||
        typeof timing.duration_ms !== "number" || !Number.isFinite(timing.duration_ms) || timing.duration_ms < 0) {
      throw new TypeError("Every evaluated case needs a finite non-negative duration_ms.");
    }
  }
  const overTarget = timings.filter(({ duration_ms }) => duration_ms > targetMs);
  return {
    target_ms: targetMs,
    max_ms: Math.max(...timings.map(({ duration_ms }) => duration_ms)),
    over_target: overTarget,
    meets_target: overTarget.length === 0,
  };
}
