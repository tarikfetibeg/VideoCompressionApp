const EditJob = require('../models/EditJob');

const HOUR_MS = 60 * 60 * 1000;

function calculateJobSchedule(contentType, {
  createdAt = new Date(),
  deadline = null,
} = {}) {
  if (!contentType || contentType.autoExpireJobs === false) {
    return {
      deadline: deadline ? new Date(deadline) : null,
      expiresAt: null,
    };
  }

  const baseDate = new Date(createdAt);
  const explicitDeadline = deadline ? new Date(deadline) : null;
  const validExplicitDeadline = explicitDeadline && !Number.isNaN(explicitDeadline.getTime())
    ? explicitDeadline
    : null;
  const slaHours = Math.max(Number(contentType.jobSlaHours) || 72, 1);
  const graceHours = Math.max(Number(contentType.jobGraceHours) || 0, 0);
  const resolvedDeadline = validExplicitDeadline || new Date(baseDate.getTime() + slaHours * HOUR_MS);

  return {
    deadline: resolvedDeadline,
    expiresAt: new Date(resolvedDeadline.getTime() + graceHours * HOUR_MS),
  };
}

function applySlaToJob(job, contentType, options = {}) {
  const schedule = calculateJobSchedule(contentType, {
    createdAt: options.createdAt || job.createdAt || new Date(),
    deadline: Object.prototype.hasOwnProperty.call(options, 'deadline')
      ? options.deadline
      : job.deadline,
  });

  job.contentType = contentType?._id || contentType || job.contentType;
  job.deadline = schedule.deadline;
  job.expiresAt = schedule.expiresAt;
  job.slaAppliedAt = new Date();
  return schedule;
}

async function expireEditJobs(now = new Date()) {
  const result = await EditJob.updateMany(
    {
      workspaceState: 'active',
      expiresAt: { $lte: now },
      status: { $nin: ['aired', 'archived'] },
    },
    {
      $set: {
        workspaceState: 'expired',
        workspaceStateChangedAt: now,
        workspaceStateReason: 'Automatski istek SLA roka.',
      },
    }
  );

  return {
    matched: result.matchedCount || 0,
    expired: result.modifiedCount || 0,
  };
}

function getDeadlineState(job, now = new Date()) {
  if (!job?.deadline) return 'no_deadline';
  if (job.workspaceState === 'expired') return 'expired';

  const deadlineTime = new Date(job.deadline).getTime();
  if (!Number.isFinite(deadlineTime)) return 'no_deadline';
  const difference = deadlineTime - now.getTime();
  if (difference < 0) return 'overdue';
  if (difference <= 2 * HOUR_MS) return 'due_soon';
  return 'on_time';
}

module.exports = {
  applySlaToJob,
  calculateJobSchedule,
  expireEditJobs,
  getDeadlineState,
};
