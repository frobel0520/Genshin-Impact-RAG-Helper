/**
 * Compare complete evaluation runs. A single template count describes one
 * sample, not the behaviour of a nondeterministic local model (T44).
 */
export function summarizeRepeatedRuns(runs) {
  if (!Array.isArray(runs) || runs.length < 2) {
    throw new TypeError("At least two complete evaluation runs are required.");
  }
  const firstIds = runs[0].results.map((result) => result.case_id);
  if (runs.some(({ results }) =>
    results.length !== firstIds.length ||
    results.some((result, index) => result.case_id !== firstIds[index]))) {
    throw new Error("All runs must contain the same cases in the same order.");
  }

  const templateCounts = runs.map(({ cases }) => cases.answered_with_template);
  const changedAnswerCases = firstIds.filter((_, index) =>
    new Set(runs.map(({ results }) => results[index].answer.answer_text)).size > 1);
  const metricScores = Object.fromEntries(
    Object.keys(runs[0].metrics).map((key) => {
      const values = runs.map(({ metrics }) => metrics[key].score);
      const scored = values.filter((value) => typeof value === "number");
      return [key, {
        values,
        min: scored.length === 0 ? null : Math.min(...scored),
        max: scored.length === 0 ? null : Math.max(...scored),
      }];
    }),
  );
  const statusDistributions = runs.map(({ results }) =>
    results.reduce((counts, result) => {
      const status = result.answer.answer_status;
      counts[status] = (counts[status] ?? 0) + 1;
      return counts;
    }, {}));

  return {
    repeats: runs.length,
    evaluated_cases: firstIds.length,
    answered_with_template: {
      values: templateCounts,
      min: Math.min(...templateCounts),
      max: Math.max(...templateCounts),
    },
    changed_answer_cases: changedAnswerCases,
    metric_scores: metricScores,
    status_distributions: statusDistributions,
  };
}
