/** W65 (D65-8): nearest-rank summary statistics for the perf spec. */
export interface Summary {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

function nearestRank(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

export function summarize(samples: readonly number[]): Summary {
  if (samples.length === 0) throw new RangeError("summarize: no samples");
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.reduce((acc, v) => acc + v, 0) / sorted.length;
  return {
    n: sorted.length,
    mean,
    p50: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
}
