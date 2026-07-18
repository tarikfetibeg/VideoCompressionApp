import { describe, expect, it } from 'vitest';
import {
  calculateTransferMetrics,
  formatBytes,
  formatEta,
  formatProgressPercent,
  formatTransferRate,
  getTransferSizeLabel,
} from './downloadProgress';

describe('download progress helpers', () => {
  it('formats byte counts, rates, percentages and ETA', () => {
    expect(formatBytes(1_572_864)).toBe('1.50 MB');
    expect(formatTransferRate(2_097_152)).toBe('2.00 MB/s');
    expect(formatProgressPercent(42.34)).toBe('42.3%');
    expect(formatEta(82)).toBe('oko 1 min 22 s');
    expect(getTransferSizeLabel({ transferredBytes: 512, totalBytes: 1024 })).toBe('512 B od 1.00 KB');
  });

  it('calculates a smoothed speed and remaining time from native samples', () => {
    const first = calculateTransferMetrics(null, {
      transferredBytes: 1_000,
      totalBytes: 5_000,
    }, 1_000);
    const second = calculateTransferMetrics(first.sample, {
      transferredBytes: 2_000,
      totalBytes: 5_000,
    }, 2_000);

    expect(second.progressPercent).toBe(40);
    expect(second.speedBytesPerSecond).toBe(1_000);
    expect(second.etaSeconds).toBe(3);
  });

  it('keeps useful byte progress when a streamed ZIP has no known total', () => {
    const metrics = calculateTransferMetrics(null, {
      transferredBytes: 10_000,
      totalBytes: 0,
    }, 1_000);

    expect(metrics.progressPercent).toBeNull();
    expect(metrics.etaSeconds).toBeNull();
    expect(getTransferSizeLabel(metrics)).toBe('9.77 KB preuzeto');
  });
});
