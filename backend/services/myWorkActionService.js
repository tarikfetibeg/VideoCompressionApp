const severityRank = { critical: 0, action_required: 1, warning: 2, info: 3 };

function idOf(value) {
  return String(value?._id || value || '');
}

function actionPath(value) {
  if (value?.deepLink) return value.deepLink;
  if (value?.jobId) return `vca://job/${value.jobId}`;
  if (value?.videoId) return `vca://video/${value.videoId}`;
  return 'vca://my-work';
}

function buildMyWorkActionQueue({ jobs = [], corrections = [], showDays = [], notifications = [] } = {}) {
  const actions = [];
  notifications.forEach((notification) => {
    if (!['critical', 'action_required'].includes(notification.severity)) return;
    actions.push({
      id: `notification:${idOf(notification)}`,
      source: 'notification',
      severity: notification.severity,
      title: notification.title,
      description: notification.bodyPreview || '',
      deepLink: actionPath(notification),
      dueAt: notification.ackDeadlineAt || notification.createdAt,
    });
  });
  corrections.forEach((correction) => {
    actions.push({
      id: `correction:${idOf(correction)}`,
      source: 'correction',
      severity: correction.status === 'reported' ? 'action_required' : 'warning',
      title: `Ispravka: ${correction.video?.finalTitle || correction.video?.originalFilename || correction.video?.filename || 'video'}`,
      description: correction.note || 'Potrebno je pregledati i usmjeriti ispravku.',
      deepLink: correction.correctionJob
        ? `vca://job/${idOf(correction.correctionJob)}`
        : correction.video ? `vca://video/${idOf(correction.video)}` : 'vca://my-work',
      dueAt: correction.updatedAt,
    });
  });
  showDays.forEach((showDay) => {
    if (!showDay.changedSinceDownload) return;
    actions.push({
      id: `show-day:${idOf(showDay)}`,
      source: 'show_day',
      severity: 'critical',
      title: 'Rundown je promijenjen nakon downloada',
      description: `${showDay.program?.name || showDay.program?.title || 'Emisija'} ima novu verziju materijala.`,
      deepLink: 'vca://my-work',
      dueAt: showDay.updatedAt || showDay.airDate,
    });
  });
  const urgencyWindow = Date.now() + 4 * 60 * 60 * 1000;
  jobs.forEach((job) => {
    const deadline = job.deadline ? new Date(job.deadline).getTime() : null;
    const urgent = job.priority === 'urgent' || job.jobKind === 'correction' || (deadline && deadline <= urgencyWindow);
    if (!urgent) return;
    actions.push({
      id: `job:${idOf(job)}`,
      source: 'edit_job',
      severity: deadline && deadline < Date.now() ? 'critical' : 'action_required',
      title: job.title,
      description: job.jobKind === 'correction'
        ? 'Hitna ispravka čeka obradu.'
        : deadline && deadline < Date.now() ? 'Rok je istekao.' : 'Rok se približava.',
      deepLink: `vca://job/${idOf(job)}`,
      dueAt: job.deadline || job.updatedAt,
    });
  });

  const unique = new Map();
  actions.forEach((action) => {
    const entityKey = action.deepLink || action.id;
    const existing = unique.get(entityKey);
    if (!existing || severityRank[action.severity] < severityRank[existing.severity]) {
      unique.set(entityKey, action);
    }
  });
  return Array.from(unique.values())
    .sort((left, right) => {
      const severity = severityRank[left.severity] - severityRank[right.severity];
      if (severity !== 0) return severity;
      return new Date(left.dueAt || 0).getTime() - new Date(right.dueAt || 0).getTime();
    })
    .slice(0, 12);
}

module.exports = { buildMyWorkActionQueue };
