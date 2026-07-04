export const roleLabels = {
  Admin: 'Administrator',
  Reporter: 'Reporter',
  Editor: 'Montaža',
  VideoEditor: 'Video montaža',
  Producer: 'Producent',
  Realizator: 'Realizator',
  Archivist: 'Arhivist',
};

export const processingLabels = {
  uploaded: 'Uploadovano',
  queued: 'Čeka obradu',
  processing: 'Obrada u toku',
  completed: 'Spremno',
  failed: 'Greška u obradi',
};

export const materialLabels = {
  raw: 'Sirovina',
  edited: 'Final / montaža',
};

export const qcLabels = {
  pending: 'QC čeka',
  passed: 'QC prošao',
  failed: 'QC problem',
};

export const broadcastLabels = {
  not_ready: 'Nije spremno',
  qc_pending: 'Čeka QC',
  qc_failed: 'QC problem',
  ready_for_approval: 'Spremno za odobrenje',
  approved_for_air: 'Odobreno za eter',
  aired: 'Emitovano',
  archived: 'Arhivirano',
};

export const jobStatusLabels = {
  draft: 'Nacrt',
  submitted: 'Poslano montaži',
  claimed: 'Preuzeto',
  in_edit: 'U montaži',
  needs_info: 'Treba dopuna',
  ready_for_qc: 'Spremno za QC',
  approved: 'Odobreno',
  aired: 'Emitovano',
  archived: 'Arhivirano',
};

export const priorityLabels = {
  low: 'Nizak',
  normal: 'Normalan',
  high: 'Visok',
  urgent: 'Hitno',
};

export const showItemStatusLabels = {
  scheduled: 'Planirano',
  ready: 'Spremno',
  aired: 'Emitovano',
  removed: 'Uklonjeno',
};

export const archiveReviewLabels = {
  all: 'Svi statusi',
  unreviewed: 'Nije pregledano',
  reviewed: 'Pregledano',
  needs_metadata: 'Treba metadata',
  duplicate: 'Duplikat',
};

export const archiveWorkflowLabels = {
  all: 'Svi materijali',
  archive: 'Spremno za arhivu',
  aired: 'Emitovano',
  edited: 'Smontirano',
  needs_correction: 'Treba ispravka',
};

export const feedbackStatusLabels = {
  new: 'Novo',
  reviewing: 'U pregledu',
  planned: 'Planirano',
  fixed: 'Rijeseno',
  rejected: 'Odbijeno',
};

export const feedbackTypeLabels = {
  bug: 'Bug',
  suggestion: 'Sugestija',
  workflow_issue: 'Workflow problem',
  urgent_production_issue: 'Hitno za produkciju',
};

export const feedbackAreaLabels = {
  reporter: 'Reporter',
  editor: 'Montaza',
  producer: 'Producent',
  realizator: 'Realizator',
  admin: 'Admin',
  login: 'Login',
  processing: 'Obrada videa',
  archive: 'Arhiva',
  other: 'Ostalo',
};

export const auditSeverityLabels = {
  critical: 'Kriticno',
  warning: 'Upozorenje',
  info: 'Info',
};

const statusToneMap = {
  failed: 'error',
  qc_failed: 'error',
  needs_info: 'error',
  needs_correction: 'error',
  needs_metadata: 'warning',
  urgent: 'error',
  critical: 'error',
  rejected: 'error',
  queued: 'warning',
  processing: 'warning',
  pending: 'warning',
  qc_pending: 'warning',
  ready_for_approval: 'warning',
  high: 'warning',
  warning: 'warning',
  reviewing: 'warning',
  completed: 'success',
  passed: 'success',
  approved: 'success',
  approved_for_air: 'success',
  aired: 'success',
  archived: 'success',
  reviewed: 'success',
  fixed: 'success',
  ready: 'success',
  claimed: 'info',
  in_edit: 'info',
  planned: 'info',
  info: 'info',
  duplicate: 'secondary',
  submitted: 'primary',
  new: 'primary',
  raw: 'primary',
  edited: 'secondary',
};

export const formatStatusLabel = (value, maps = []) => {
  const normalizedValue = value || 'N/A';
  const mapList = Array.isArray(maps) ? maps : [maps];
  const match = mapList.find((map) => map && map[normalizedValue]);

  if (match) return match[normalizedValue];
  return String(normalizedValue).replace(/_/g, ' ');
};

export const getStatusTone = (value, fallback = 'default') =>
  statusToneMap[value] || fallback;

export const formatRole = (role) => roleLabels[role] || role || 'Korisnik';

export const formatDateTimeBs = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';

  return date.toLocaleString('bs-BA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatDateBs = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';

  return date.toLocaleDateString('bs-BA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

export const formatNumberBs = (value) => new Intl.NumberFormat('bs-BA').format(Number(value) || 0);

export const formatBytesBs = (bytes) => {
  if (!bytes && bytes !== 0) return 'N/A';
  const value = Number(bytes);
  if (!Number.isFinite(value)) return 'N/A';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};
