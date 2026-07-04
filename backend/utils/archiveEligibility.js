function appendAndCondition(filter, condition) {
  if (!condition) return false;
  if (!Array.isArray(filter.$and)) {
    filter.$and = filter.$and ? [filter.$and] : [];
  }
  filter.$and.push(condition);
  return true;
}

function buildApprovedArchiveEligibilityCondition() {
  return {
    status: 'edited',
    processingStatus: 'completed',
    broadcastStatus: { $in: ['approved_for_air', 'aired', 'archived'] },
    $or: [
      { finalApprovalStatus: 'approved' },
      { qcStatus: 'passed' },
      { broadcastStatus: { $in: ['aired', 'archived'] } },
    ],
  };
}

function applyApprovedArchiveEligibility(filter) {
  const eligibility = buildApprovedArchiveEligibilityCondition();
  filter.status = 'edited';
  filter.processingStatus = 'completed';
  filter.broadcastStatus = { $in: ['approved_for_air', 'aired', 'archived'] };

  appendAndCondition(filter, { $or: eligibility.$or });

  return filter;
}

module.exports = {
  applyApprovedArchiveEligibility,
  buildApprovedArchiveEligibilityCondition,
};
