const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const {
  compareVersions,
  updatePolicyFor,
} = require('../services/desktopVersionService');
const { buildMyWorkActionQueue } = require('../services/myWorkActionService');
const { parseTechnicalQcOutput } = require('../services/technicalQcService');
const {
  recordOperation,
  resetRuntimeMetricsForTests,
  snapshotRuntimeMetrics,
} = require('../services/runtimeMetricsService');
const {
  buildArchiveAssignmentCondition,
  getArchiveReviewWarnings,
  isClaimOwner,
} = require('../services/archiveWorkflowService');
const {
  applyIssuesToRequest,
  getRequestIssues,
} = require('../services/correctionWorkflowService');
const {
  buildEditionKey,
  buildProgramFinalSearch,
  parseWatchedFinalFilename,
  programFinalAirDateTime,
  resolveSafeRelativePath,
} = require('../utils/programFinals');
const {
  canEditProgramFinal,
  canViewProgramFinal,
  getArchiveWarnings,
} = require('../services/programFinalService');
const { signEdgeTransfer } = require('../services/edgeTransferService');

test('desktop version policy razlikuje update i obavezni minimum', () => {
  const previous = {
    stable: process.env.DESKTOP_STABLE_VERSION,
    minimum: process.env.DESKTOP_MINIMUM_VERSION,
  };
  process.env.DESKTOP_STABLE_VERSION = '2.3.0';
  process.env.DESKTOP_MINIMUM_VERSION = '2.1.0';
  assert.equal(compareVersions('2.2.9', '2.3.0'), -1);
  const policy = updatePolicyFor({ currentVersion: '2.0.9', updateChannel: 'stable' });
  assert.equal(policy.updateAvailable, true);
  assert.equal(policy.updateRequired, true);
  assert.equal(policy.targetVersion, '2.3.0');
  if (previous.stable === undefined) delete process.env.DESKTOP_STABLE_VERSION;
  else process.env.DESKTOP_STABLE_VERSION = previous.stable;
  if (previous.minimum === undefined) delete process.env.DESKTOP_MINIMUM_VERSION;
  else process.env.DESKTOP_MINIMUM_VERSION = previous.minimum;
});

test('Moj rad daje kritičnoj notifikaciji prednost nad običnim rokom', () => {
  const queue = buildMyWorkActionQueue({
    notifications: [{
      _id: 'notification-1',
      severity: 'critical',
      title: 'Rundown promijenjen',
      bodyPreview: 'Preuzmi novu verziju.',
      deepLink: 'vca://my-work',
      createdAt: new Date(),
    }],
    jobs: [{
      _id: 'job-1',
      title: 'Prilog',
      priority: 'urgent',
      deadline: new Date(Date.now() + 60_000),
    }],
  });
  assert.equal(queue[0].severity, 'critical');
  assert.equal(queue[0].title, 'Rundown promijenjen');
});

test('technical QC parser izdvaja crni kadar, tišinu i LUFS upozorenje', () => {
  const stderr = [
    '[blackdetect] black_start:1.0 black_end:3.5 black_duration:2.5',
    '[silencedetect] silence_end: 9.0 | silence_duration: 4.0',
    '[Parsed_ebur128] I: -30.0 LUFS',
    '[Parsed_ebur128] Peak: -0.4 dBFS',
  ].join('\n');
  const result = parseTechnicalQcOutput(stderr, { hasAudio: true, duration: 20 }, 20);
  assert.equal(result.metrics.blackSeconds, 2.5);
  assert.equal(result.metrics.silenceSeconds, 4);
  assert.ok(result.findings.some((item) => item.code === 'loudness_outside_review_range'));
  assert.ok(result.findings.some((item) => item.code === 'true_peak_high'));
});

test('runtime metrics drži agregate bez vanjskog collectora', () => {
  resetRuntimeMetricsForTests();
  recordOperation('hls_build', 1200, 'completed');
  recordOperation('hls_build', 800, 'failed');
  const snapshot = snapshotRuntimeMetrics();
  const metric = snapshot.operations.find((item) => item.name === 'hls_build');
  assert.equal(metric.count, 2);
  assert.equal(metric.failed, 1);
  assert.equal(metric.averageMs, 1000);
});

test('archive claim razlikuje vlasnika, aktivni lease i istekli nepreuzeti materijal', () => {
  const now = new Date('2026-07-21T10:00:00.000Z');
  const activeVideo = {
    archiveAssignedTo: 'user-1',
    archiveAssignmentExpiresAt: new Date('2026-07-21T11:00:00.000Z'),
  };
  assert.equal(isClaimOwner(activeVideo, { id: 'user-1' }, now), true);
  assert.equal(isClaimOwner(activeVideo, { id: 'user-2' }, now), false);
  const unassigned = buildArchiveAssignmentCondition('unassigned', null, now);
  assert.ok(unassigned.$or.some((condition) => condition.archiveAssignmentExpiresAt?.$lte));
});

test('archive review upozorenja prijavljuju nepotpunu metadata i otvorenu ispravku', () => {
  const warnings = getArchiveReviewWarnings({
    finalTitle: '',
    tagDate: null,
    contentType: null,
    finalCategory: '',
    event: '',
    reporter: null,
    uploader: null,
    keywords: [],
    correctionStatus: 'needs_correction',
  });
  assert.deepEqual(
    warnings.map((warning) => warning.code),
    ['missing_title', 'missing_date', 'missing_category', 'missing_event', 'missing_author', 'missing_tags', 'open_correction']
  );
});

test('legacy correction postaje virtualni issue, a grupa računa najvišu ozbiljnost', () => {
  const legacy = { note: 'Stari problem', timestamp: 12, reportedBy: 'user-1' };
  assert.equal(getRequestIssues(legacy)[0].legacy, true);
  const request = {
    note: 'Privremeni sažetak',
    timestamp: 0,
    issues: [
      { type: 'audio', severity: 'minor', startSeconds: 4, note: 'Tihi šum' },
      { type: 'picture', severity: 'blocking', startSeconds: 18, note: 'Crna slika' },
    ],
  };
  applyIssuesToRequest(request);
  assert.equal(request.highestSeverity, 'blocking');
  assert.equal(request.timestamp, 4);
  assert.match(request.note, /2 prijavljenih/);
});

test('watched-folder ime razlikuje program, datum, termin i naslov finala', () => {
  const parsed = parseWatchedFinalFilename('dnevnik__2026-07-21__18-30__Vecernje-izdanje.mxf');
  assert.deepEqual(parsed, {
    programSlug: 'dnevnik',
    airDate: '2026-07-21',
    airTime: '18:30',
    title: 'Vecernje izdanje',
    editionLabel: '',
  });
  assert.equal(parseWatchedFinalFilename('neispravno-ime.mp4'), null);
});

test('Program Final search prefiksi normalizuju BHS dijakritiku', () => {
  const search = buildProgramFinalSearch({
    title: 'Večernji Dnevnik',
    programName: 'Dnevnik',
    credits: [{ personNameSnapshot: 'Đenan Šabić', roleNameSnapshot: 'Montaža' }],
  });
  assert.ok(search.searchPrefixes.includes('vec'));
  assert.ok(search.searchPrefixes.includes('den'));
  assert.ok(search.searchPrefixes.includes('sab'));
  assert.equal(buildEditionKey('Večernje izdanje'), 'vecernje-izdanje');
});

test('arhiviranje finala blokira master bez checksum/proxyja i upozorava na šablon ekipe', () => {
  const warnings = getArchiveWarnings({
    programType: 'type-1',
    title: 'Dnevnik',
    airDate: new Date(),
    airTime: '18:30',
    airedAt: new Date(),
    credits: [{ role: 'role-present' }],
  }, {
    status: 'ready',
    sha256: 'abc',
  }, {
    recommendedRoles: [
      { _id: 'role-present', name: 'Voditelj' },
      { _id: 'role-missing', name: 'Ton' },
    ],
  });
  assert.equal(warnings.some((warning) => warning.blocking), false);
  assert.match(warnings.find((warning) => warning.code === 'missing_recommended_roles').label, /Ton/);
  const blocked = getArchiveWarnings({ credits: [] }, null, null);
  assert.ok(blocked.filter((warning) => warning.blocking).length >= 2);
  const notAired = getArchiveWarnings({
    programType: 'type-1',
    title: 'Dnevnik',
    airDate: new Date(),
    airTime: '18:30',
    credits: [{ role: 'role-present' }],
  }, { status: 'ready', sha256: 'abc' }, { recommendedRoles: [] });
  assert.equal(notAired.find((warning) => warning.code === 'not_aired')?.blocking, true);
});

test('Program Final proxy putanja ne može izaći iz zasebnog root foldera', () => {
  const root = process.platform === 'win32' ? 'C:\\storage\\program-final-previews' : '/storage/program-final-previews';
  assert.equal(resolveSafeRelativePath(root, '../masters/final.mxf'), null);
  assert.ok(resolveSafeRelativePath(root, 'final-1/v1/hls/master.m3u8'));
});

test('Program Final dozvole odvajaju javnu arhivu od pending izdanja', () => {
  const assignedPending = {
    status: 'processing',
    activeVersion: null,
    showDay: { producers: [{ _id: 'producer-1' }] },
  };
  assert.equal(canViewProgramFinal(assignedPending, { id: 'producer-1', role: 'Producer' }), true);
  assert.equal(canViewProgramFinal(assignedPending, { id: 'producer-2', role: 'Producer' }), false);
  assert.equal(canViewProgramFinal(assignedPending, { id: 'reporter-1', role: 'Reporter' }), false);
  assert.equal(canEditProgramFinal(assignedPending, { id: 'producer-1', role: 'Producer' }), true);
  assert.equal(canEditProgramFinal({ ...assignedPending, status: 'archived' }, { id: 'producer-1', role: 'Producer' }), false);
  assert.equal(canViewProgramFinal({ status: 'archived', activeVersion: 'version-1' }, { id: 'reporter-1', role: 'Reporter' }), true);
});

test('Program Final termin čuva lokalni datum i vrijeme emitovanja', () => {
  const scheduledAt = programFinalAirDateTime('2026-07-21', '18:30');
  assert.equal(scheduledAt.getFullYear(), 2026);
  assert.equal(scheduledAt.getMonth(), 6);
  assert.equal(scheduledAt.getDate(), 21);
  assert.equal(scheduledAt.getHours(), 18);
  assert.equal(scheduledAt.getMinutes(), 30);
});

test('Program Final Edge token je vezan za čvor, korisnika i izdanje', () => {
  const previousSecret = process.env.EDGE_TRANSFER_SECRET;
  process.env.EDGE_TRANSFER_SECRET = 'test-edge-secret-that-is-long-enough';
  const token = signEdgeTransfer({
    transferId: 'transfer-1',
    user: 'user-1',
    direction: 'upload',
    entityType: 'program_final',
    entityId: 'final-1',
  }, { nodeId: 'edge-1' });
  const payload = jwt.verify(token, process.env.EDGE_TRANSFER_SECRET);
  assert.equal(payload.tokenType, 'edge-transfer');
  assert.equal(payload.nodeId, 'edge-1');
  assert.equal(payload.userId, 'user-1');
  assert.equal(payload.entityType, 'program_final');
  assert.equal(payload.entityId, 'final-1');
  if (previousSecret === undefined) delete process.env.EDGE_TRANSFER_SECRET;
  else process.env.EDGE_TRANSFER_SECRET = previousSecret;
});
