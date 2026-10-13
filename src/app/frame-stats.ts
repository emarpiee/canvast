/** Rolling window of render durations (ms) for diagnostics and benchmarks. */
export class FrameStats {
  private readonly samples: number[] = [];
  count = 0;

  constructor(private readonly capacity = 2048) {}

  record(ms: number): void {
    this.count++;
    this.samples.push(ms);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, i)]!;
  }

  snapshot(): number[] {
    return [...this.samples];
  }

  reset(): void {
    this.samples.length = 0;
    this.count = 0;
  }
}
