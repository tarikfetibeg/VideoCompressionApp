const DEFAULT_VERSION = '2.0.0';

function versionParts(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function releaseConfiguration() {
  const stableVersion = process.env.DESKTOP_STABLE_VERSION
    || process.env.DESKTOP_CURRENT_VERSION
    || DEFAULT_VERSION;
  const pilotVersion = process.env.DESKTOP_PILOT_VERSION || stableVersion;
  const minimumVersion = process.env.DESKTOP_MINIMUM_VERSION || stableVersion;
  return {
    stableVersion,
    pilotVersion,
    minimumVersion,
    updaterConfigured: Boolean(
      process.env.TAURI_UPDATER_ENDPOINT
      && process.env.TAURI_UPDATER_PUBLIC_KEY
    ),
  };
}

function updatePolicyFor({ currentVersion, updateChannel = 'stable' } = {}) {
  const config = releaseConfiguration();
  const normalizedChannel = updateChannel === 'pilot' ? 'pilot' : 'stable';
  const targetVersion = normalizedChannel === 'pilot' ? config.pilotVersion : config.stableVersion;
  const installedVersion = currentVersion || DEFAULT_VERSION;
  return {
    channel: normalizedChannel,
    currentVersion: installedVersion,
    targetVersion,
    minimumVersion: config.minimumVersion,
    updateAvailable: compareVersions(installedVersion, targetVersion) < 0,
    updateRequired: compareVersions(installedVersion, config.minimumVersion) < 0,
    updaterConfigured: config.updaterConfigured,
  };
}

module.exports = {
  compareVersions,
  releaseConfiguration,
  updatePolicyFor,
  versionParts,
};
