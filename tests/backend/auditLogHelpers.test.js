const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyAuditSeverity, enhanceAuditLog, filterEnhancedAuditLogs, summarizeAuditLogs, buildAuditLogFilter } = require('../../backend/utils/auditLogHelpers');

test('audit severity keeps destructive precedence and summary totals', () => {
  const logs = ['Delete Video', 'Download Failed', 'Claim Job', 'Login'].map((action) => enhanceAuditLog({ action, details: { videoId: 'v1' } }));
  assert.equal(classifyAuditSeverity('Download Failed'), 'critical');
  assert.deepEqual(summarizeAuditLogs(logs), { total: 4, critical: 2, warning: 1, info: 1, entities: { video: 4 } });
});

test('legacy nested JSON search and actor/role/severity filters remain compatible', () => {
  const logs = [enhanceAuditLog({ action: 'Update Job', performedBy: { username: 'montazer', role: 'Editor' }, details: { jobId: 'j1', nested: { note: 'Špica pregled' } } })];
  assert.equal(filterEnhancedAuditLogs(logs, { q: 'špica', role: 'Editor', severity: 'warning' }).length, 1);
  assert.equal(filterEnhancedAuditLogs(logs, { role: 'Reporter' }).length, 0);
  assert.equal(filterEnhancedAuditLogs(logs, { q: 'x' }).length, 1);
  assert.deepEqual(buildAuditLogFilter({ action: 'all', userId: 'all' }), {});
});

test('invalid actor, dates and reversed ranges are explicit validation errors', () => {
  for (const query of [{ userId: 'bad-id' }, { dateFrom: 'bad-date' }, { dateTo: 'bad-date' }, { dateFrom: '2030-01-01', dateTo: '2020-01-01' }]) {
    assert.throws(() => buildAuditLogFilter(query), (error) => error.statusCode === 400);
  }
  assert.equal(buildAuditLogFilter({ userId: '000000000000000000000001' }).performedBy, '000000000000000000000001');
});
