export const MAX_RESPONSE_TIME_MS = 10_000;

/** End-to-end time includes retrieval, generation, and any fallback. */
export function summarizeLatency(timings, targetMs = MAX_RESPONSE_TIME_MS) {
  if (!Array.isArray(timings) || timings.length === 0) {
    throw new TypeError("timings must contain evaluated cases.");
  }
  const overTarget = timings.filter(({ duration_ms }) => duration_ms > targetMs);
  return {
    target_ms: targetMs,
    max_ms: Math.max(...timings.map(({ duration_ms }) => duration_ms)),
    over_target: overTarget,
    meets_target: overTarget.length === 0,
  };
}
