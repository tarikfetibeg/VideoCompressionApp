const criticalPattern = /(delete|failed|reject|cleanup|remove|reset|orphan|replace)/i;
const warningPattern = /(retry|update|approve|import|download|claim|join)/i;
const entityFields = [['video', 'videoId'], ['job', 'jobId'], ['showDay', 'showDayId'], ['feedback', 'feedbackId'], ['user', 'userId']];

function classifyAuditSeverity(action = '') {
  if (criticalPattern.test(String(action))) return 'critical';
  if (warningPattern.test(String(action))) return 'warning';
  return 'info';
}
function inferAuditEntity(details = {}) {
  if (!details || typeof details !== 'object') return null;
  const match = entityFields.find(([, field]) => details[field]);
  return match ? { type: match[0], id: details[match[1]] } : null;
}
function buildAuditLogFilter(query = {}) {
  const filter = {};
  const invalid = (message) => { const error = new Error(message); error.statusCode = 400; throw error; };
  if (query.action && query.action !== 'all') filter.action = query.action;
  if (query.userId && query.userId !== 'all') {
    if (!/^[a-f\d]{24}$/i.test(String(query.userId))) invalid('Neispravan korisnik u audit filteru.');
    filter.performedBy = query.userId;
  }
  if (query.dateFrom || query.dateTo) {
    filter.timestamp = {};
    if (query.dateFrom) filter.timestamp.$gte = new Date(query.dateFrom);
    if (query.dateTo) filter.timestamp.$lte = new Date(query.dateTo);
    if (Object.values(filter.timestamp).some((date) => Number.isNaN(date.getTime()))) invalid('Neispravan datum u audit filteru.');
    if (filter.timestamp.$gte && filter.timestamp.$lte && filter.timestamp.$gte > filter.timestamp.$lte) invalid('Početni datum mora biti prije završnog.');
  }
  return filter;
}
function enhanceAuditLog(log) { return { ...log, severity: classifyAuditSeverity(log.action), entity: inferAuditEntity(log.details) }; }
function filterEnhancedAuditLogs(logs, query = {}) {
  const rawSearch = String(query.q || query.search || '').trim().toLowerCase();
  const search = rawSearch.length >= 2 ? rawSearch : '';
  return logs.filter((log) => (!query.role || query.role === 'all' || log.performedBy?.role === query.role)
    && (!query.severity || query.severity === 'all' || log.severity === query.severity)
    && (!search || [log.action, log.performedBy?.username, log.performedBy?.role, JSON.stringify(log.details || {})].filter(Boolean).some((value) => String(value).toLowerCase().includes(search))));
}
function emptyAuditSummary() { return { total: 0, critical: 0, warning: 0, info: 0, entities: {} }; }
function summarizeAuditLogs(logs) {
  return logs.reduce((summary, log) => {
    summary.total += 1;
    summary[log.severity] = (summary[log.severity] || 0) + 1;
    if (log.entity?.type) summary.entities[log.entity.type] = (summary.entities[log.entity.type] || 0) + 1;
    return summary;
  }, emptyAuditSummary());
}

module.exports = { criticalPattern, warningPattern, entityFields, classifyAuditSeverity, buildAuditLogFilter, enhanceAuditLog, filterEnhancedAuditLogs, emptyAuditSummary, summarizeAuditLogs };
