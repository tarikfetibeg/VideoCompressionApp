const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const { criticalPattern, warningPattern, entityFields, classifyAuditSeverity, buildAuditLogFilter, enhanceAuditLog, filterEnhancedAuditLogs, emptyAuditSummary } = require('../utils/auditLogHelpers');

async function getAuditWorkspace(query, { page, limit, skip }) {
  const filter = buildAuditLogFilter(query);
  if (filter.performedBy) filter.performedBy = new mongoose.Types.ObjectId(filter.performedBy);
  const conditions = [];
  if (query.role && query.role !== 'all') {
    const actors = await User.find({ role: query.role }).select('_id').lean();
    conditions.push({ performedBy: { $in: actors.map((user) => user._id) } });
  }
  if (query.severity === 'critical') conditions.push({ action: criticalPattern });
  else if (query.severity === 'warning') conditions.push({ action: { $regex: warningPattern, $not: criticalPattern } });
  else if (query.severity === 'info') conditions.push({ action: { $not: new RegExp(`${criticalPattern.source}|${warningPattern.source}`, 'i') } });
  if (conditions.length) filter.$and = conditions;
  const search = String(query.q || query.search || '').trim();
  const summary = emptyAuditSummary();
  let items;
  let scanned = 0;
  if (search.length >= 2) {
    // Legacy search includes arbitrary nested JSON details. Stream rather than truncate or load the full history.
    const actors = new Map((await User.find({}).select('_id username role').lean()).map((user) => [String(user._id), user]));
    items = [];
    const cursor = AuditLog.find(filter).sort({ timestamp: -1, _id: -1 }).lean().cursor({ batchSize: 500 });
    try {
      for await (const raw of cursor) {
        scanned += 1;
        const log = enhanceAuditLog({ ...raw, performedBy: actors.get(String(raw.performedBy)) || null });
        if (!filterEnhancedAuditLogs([log], query).length) continue;
        if (summary.total >= skip && items.length < limit) items.push(log);
        summary.total += 1; summary[log.severity] += 1;
        if (log.entity?.type) summary.entities[log.entity.type] = (summary.entities[log.entity.type] || 0) + 1;
      }
    } finally { await cursor.close(); }
  } else {
    const [pageItems, grouped] = await Promise.all([
      AuditLog.find(filter).populate('performedBy', 'username role').sort({ timestamp: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.aggregate([
        { $match: filter },
        { $group: { _id: { action: '$action', entity: { $switch: { branches: entityFields.map(([type, field]) => ({ case: { $ifNull: [`$details.${field}`, false] }, then: type })), default: null } } }, count: { $sum: 1 } } },
      ]),
    ]);
    items = pageItems.map(enhanceAuditLog);
    for (const group of grouped) {
      summary.total += group.count;
      summary[classifyAuditSeverity(group._id.action)] += group.count;
      if (group._id.entity) summary.entities[group._id.entity] = (summary.entities[group._id.entity] || 0) + group.count;
    }
    scanned = summary.total;
  }
  return { items, total: summary.total, page, limit, totalPages: Math.max(Math.ceil(summary.total / limit), 1), summary, facets: { scanned, maxScan: null, searchMode: search.length >= 2 ? 'streamed-legacy-json' : 'server-pagination' } };
}

module.exports = { getAuditWorkspace };
