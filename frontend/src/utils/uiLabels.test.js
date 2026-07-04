import {
  archiveReviewLabels,
  feedbackStatusLabels,
  formatBytesBs,
  formatNumberBs,
  formatRole,
  formatStatusLabel,
  getStatusTone,
  jobStatusLabels,
  processingLabels,
} from './uiLabels';

describe('uiLabels', () => {
  test('formats shared status labels across workspaces', () => {
    expect(formatStatusLabel('queued', processingLabels)).toBe('Čeka obradu');
    expect(formatStatusLabel('needs_metadata', archiveReviewLabels)).toBe('Treba metadata');
    expect(formatStatusLabel('reviewing', feedbackStatusLabels)).toBe('U pregledu');
    expect(formatStatusLabel('ready_for_qc', jobStatusLabels)).toBe('Spremno za QC');
  });

  test('returns stable tones for operational statuses', () => {
    expect(getStatusTone('failed')).toBe('error');
    expect(getStatusTone('needs_metadata')).toBe('warning');
    expect(getStatusTone('reviewed')).toBe('success');
    expect(getStatusTone('duplicate')).toBe('secondary');
  });

  test('formats roles and numbers for BHS UI', () => {
    expect(formatRole('Archivist')).toBe('Arhivist');
    expect(formatNumberBs(1234)).toBe('1.234');
    expect(formatBytesBs(1536)).toBe('1.5 KB');
  });
});
