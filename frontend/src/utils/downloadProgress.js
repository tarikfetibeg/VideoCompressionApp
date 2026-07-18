const clampNumber = (value, minimum, maximum) => (
  Math.min(maximum, Math.max(minimum, Number(value) || 0))
);

export const formatBytes = (value) => {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = bytes / 1024;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  const decimals = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(decimals)} ${units[unitIndex]}`;
};

export const formatTransferRate = (bytesPerSecond) => (
  Number(bytesPerSecond) > 0 ? `${formatBytes(bytesPerSecond)}/s` : 'Mjeri se...'
);

export const formatEta = (seconds) => {
  const remaining = Math.max(0, Math.ceil(Number(seconds) || 0));
  if (!remaining) return 'Pri kraju';
  if (remaining < 60) return `oko ${remaining} s`;

  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const trailingSeconds = remaining % 60;
  if (hours > 0) return `oko ${hours} h ${minutes} min`;
  return `oko ${minutes} min ${trailingSeconds} s`;
};

export const formatProgressPercent = (value) => {
  if (value == null || !Number.isFinite(Number(value))) return '';
  const percent = clampNumber(value, 0, 100);
  return `${percent.toFixed(percent >= 99.95 || Number.isInteger(percent) ? 0 : 1)}%`;
};

export const calculateTransferMetrics = (previousSample, progress, now = Date.now()) => {
  const transferredBytes = Math.max(0, Number(progress?.transferredBytes) || 0);
  const totalBytes = Math.max(0, Number(progress?.totalBytes) || 0);
  let speedBytesPerSecond = Math.max(0, Number(previousSample?.speedBytesPerSecond) || 0);

  if (previousSample && transferredBytes >= previousSample.transferredBytes) {
    const elapsedSeconds = Math.max(0, (now - previousSample.timestamp) / 1000);
    const byteDelta = transferredBytes - previousSample.transferredBytes;
    if (elapsedSeconds >= 0.1 && byteDelta > 0) {
      const instantSpeed = byteDelta / elapsedSeconds;
      speedBytesPerSecond = speedBytesPerSecond > 0
        ? (speedBytesPerSecond * 0.65) + (instantSpeed * 0.35)
        : instantSpeed;
    }
  }

  const progressPercent = totalBytes > 0
    ? clampNumber((transferredBytes / totalBytes) * 100, 0, 100)
    : null;
  const etaSeconds = totalBytes > transferredBytes && speedBytesPerSecond > 0
    ? (totalBytes - transferredBytes) / speedBytesPerSecond
    : null;

  return {
    sample: {
      transferredBytes,
      timestamp: now,
      startedAt: previousSample?.startedAt || now,
      speedBytesPerSecond,
    },
    transferredBytes,
    totalBytes,
    progressPercent,
    speedBytesPerSecond,
    etaSeconds,
  };
};

export const getTransferSizeLabel = ({ transferredBytes = 0, totalBytes = 0 } = {}) => (
  Number(totalBytes) > 0
    ? `${formatBytes(transferredBytes)} od ${formatBytes(totalBytes)}`
    : `${formatBytes(transferredBytes)} preuzeto`
);
