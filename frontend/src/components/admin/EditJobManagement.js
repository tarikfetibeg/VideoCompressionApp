import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Pagination,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import RuleIcon from '@mui/icons-material/Rule';
import axiosInstance from '../../axiosConfig';
import {
  ConfirmDialog,
  EmptyState,
  FilterBar,
  KpiStrip,
  StatusChip,
} from '../common/WorkspaceChrome';
import { jobStatusLabels, priorityLabels } from '../../utils/uiLabels';
import { getSearchParam } from '../../utils/searchParams';

const workspaceLabels = {
  active: 'Aktivan',
  expired: 'Istekao',
  closed: 'Zatvoren',
  cancelled: 'Otkazan',
};

const toDateTimeInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

const EditJobManagement = () => {
  const [workspace, setWorkspace] = useState({ items: [], summary: {}, totalPages: 1, page: 1 });
  const [users, setUsers] = useState([]);
  const [contentTypes, setContentTypes] = useState([]);
  const [filters, setFilters] = useState({ q: '', status: 'all', workspaceState: 'all' });
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [editJob, setEditJob] = useState(null);
  const [draft, setDraft] = useState({});
  const [deleteJob, setDeleteJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedQuery(filters.q), 300);
    return () => window.clearTimeout(timeoutId);
  }, [filters.q]);

  const loadReferenceData = useCallback(() => {
    Promise.all([
      axiosInstance.get('/admin/users'),
      axiosInstance.get('/admin/broadcast-content-types'),
    ])
      .then(([userResponse, typeResponse]) => {
        setUsers(Array.isArray(userResponse.data) ? userResponse.data : []);
        setContentTypes(Array.isArray(typeResponse.data) ? typeResponse.data : []);
      })
      .catch((error) => console.error('Error loading job admin references:', error));
  }, []);

  const loadJobs = useCallback(() => {
    setLoading(true);
    setErrorMessage('');
    axiosInstance
      .get('/edit-jobs/workspace', {
        params: {
          q: getSearchParam(debouncedQuery),
          status: filters.status !== 'all' ? filters.status : undefined,
          workspaceState: filters.workspaceState,
          includeClosed: 'true',
          page,
          limit: 50,
          sortBy: 'updatedAt',
          sortOrder: 'desc',
        },
      })
      .then((response) => setWorkspace({
        items: [],
        summary: {},
        totalPages: 1,
        page: 1,
        ...(response.data || {}),
      }))
      .catch((error) => setErrorMessage(error.response?.data?.message || 'Admin job pregled nije moguće učitati.'))
      .finally(() => setLoading(false));
  }, [debouncedQuery, filters.status, filters.workspaceState, page]);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const editors = useMemo(
    () => users.filter((user) => ['Editor', 'VideoEditor'].includes(user.role)),
    [users]
  );
  const summary = workspace.summary || {};

  const openEdit = (job) => {
    setEditJob(job);
    setDraft({
      status: job.status,
      workspaceState: job.workspaceState || 'active',
      priority: job.priority,
      assignedEditorId: job.assignedEditor?._id || '',
      contentTypeId: job.contentType?._id || '',
      deadline: toDateTimeInput(job.deadline),
      workspaceStateReason: '',
    });
  };

  const save = () => {
    if (!editJob) return;
    setBusy(true);
    setMessage('');
    setErrorMessage('');
    axiosInstance
      .patch(`/edit-jobs/${editJob._id}/admin`, draft)
      .then((response) => {
        setMessage(response.data?.message || 'Job je ažuriran.');
        setEditJob(null);
        loadJobs();
      })
      .catch((error) => setErrorMessage(error.response?.data?.message || 'Job nije moguće ažurirati.'))
      .finally(() => setBusy(false));
  };

  const applySla = () => {
    setBusy(true);
    axiosInstance
      .post('/edit-jobs/admin/apply-sla', {})
      .then((response) => {
        setMessage(`${response.data?.message || 'SLA primijenjen'} Primijenjeno: ${response.data?.applied || 0}.`);
        loadJobs();
      })
      .catch((error) => setErrorMessage(error.response?.data?.message || 'SLA nije moguće primijeniti.'))
      .finally(() => setBusy(false));
  };

  const confirmDelete = () => {
    if (!deleteJob) return;
    setBusy(true);
    axiosInstance
      .delete(`/edit-jobs/${deleteJob._id}`)
      .then((response) => {
        setMessage(response.data?.message || 'Job je obrisan.');
        setDeleteJob(null);
        loadJobs();
      })
      .catch((error) => setErrorMessage(error.response?.data?.message || 'Job se ne može sigurno obrisati.'))
      .finally(() => setBusy(false));
  };

  return (
    <Box>
      {message && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMessage('')}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage('')}>{errorMessage}</Alert>}
      <KpiStrip
        items={[
          { label: 'Ukupno', value: summary.total || workspace.total || 0 },
          { label: 'U montaži', value: summary.inEdit || 0, color: 'warning.main' },
          { label: 'Kasni', value: summary.overdue || 0, color: 'error.main' },
          { label: 'Ističe uskoro', value: summary.dueSoon || 0, color: 'warning.main' },
          { label: 'Correction', value: summary.corrections || 0, color: 'error.main' },
        ]}
      />
      <FilterBar
        title="Upravljanje edit jobovima"
        summary="Administrativni lifecycle je odvojen od workflow/QC statusa. Hard delete je dozvoljen samo bez finalnih i rundown veza."
        actions={(
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<RuleIcon />} onClick={applySla} disabled={busy}>
              Primijeni SLA
            </Button>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadJobs} disabled={loading}>
              Osvježi
            </Button>
          </Stack>
        )}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          <TextField
            label="Pretraga"
            value={filters.q}
            onChange={(event) => {
              setFilters((current) => ({ ...current, q: event.target.value }));
              setPage(1);
            }}
            fullWidth
            size="small"
          />
          <FormControl size="small" sx={{ minWidth: 190 }}>
            <InputLabel>Workflow status</InputLabel>
            <Select
              value={filters.status}
              label="Workflow status"
              onChange={(event) => {
                setFilters((current) => ({ ...current, status: event.target.value }));
                setPage(1);
              }}
            >
              <MenuItem value="all">Svi statusi</MenuItem>
              {Object.entries(jobStatusLabels).map(([value, label]) => (
                <MenuItem key={value} value={value}>{label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 170 }}>
            <InputLabel>Lifecycle</InputLabel>
            <Select
              value={filters.workspaceState}
              label="Lifecycle"
              onChange={(event) => {
                setFilters((current) => ({ ...current, workspaceState: event.target.value }));
                setPage(1);
              }}
            >
              <MenuItem value="all">Svi</MenuItem>
              {Object.entries(workspaceLabels).map(([value, label]) => (
                <MenuItem key={value} value={value}>{label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </FilterBar>

      {workspace.items.length === 0 && !loading ? (
        <EmptyState title="Nema jobova" description="Promijeni filtere ili osvježi podatke." />
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Job</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Montažer</TableCell>
                <TableCell>Kategorija</TableCell>
                <TableCell>Rok</TableCell>
                <TableCell align="right">Akcije</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {workspace.items.map((job) => (
                <TableRow key={job._id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>{job.title}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {job.reporter?.username || 'N/A'} {job.jobKind === 'correction' ? '/ Correction' : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      <StatusChip value={job.status} maps={jobStatusLabels} />
                      <StatusChip value={job.workspaceState || 'active'} maps={workspaceLabels} variant="outlined" />
                    </Stack>
                  </TableCell>
                  <TableCell>{job.assignedEditor?.username || 'Nije dodijeljeno'}</TableCell>
                  <TableCell>{job.contentType?.name || 'Bez kategorije'}</TableCell>
                  <TableCell>{job.deadline ? new Date(job.deadline).toLocaleString('bs-BA') : 'Bez roka'}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Button size="small" startIcon={<EditIcon />} onClick={() => openEdit(job)}>Uredi</Button>
                      <Button
                        size="small"
                        color="error"
                        startIcon={<DeleteOutlineIcon />}
                        onClick={() => setDeleteJob(job)}
                      >
                        Obriši
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {(workspace.totalPages || 1) > 1 && (
        <Stack alignItems="center" sx={{ mt: 2 }}>
          <Pagination page={page} count={workspace.totalPages} onChange={(event, value) => setPage(value)} />
        </Stack>
      )}

      <Dialog open={Boolean(editJob)} onClose={() => !busy && setEditJob(null)} fullWidth maxWidth="md">
        <DialogTitle>Uredi job: {editJob?.title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <FormControl fullWidth size="small">
                <InputLabel>Workflow status</InputLabel>
                <Select value={draft.status || ''} label="Workflow status" onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}>
                  {Object.entries(jobStatusLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Lifecycle</InputLabel>
                <Select value={draft.workspaceState || 'active'} label="Lifecycle" onChange={(event) => setDraft((current) => ({ ...current, workspaceState: event.target.value }))}>
                  {Object.entries(workspaceLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Prioritet</InputLabel>
                <Select value={draft.priority || 'normal'} label="Prioritet" onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))}>
                  {Object.entries(priorityLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                </Select>
              </FormControl>
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <FormControl fullWidth size="small">
                <InputLabel>Montažer</InputLabel>
                <Select value={draft.assignedEditorId || ''} label="Montažer" onChange={(event) => setDraft((current) => ({ ...current, assignedEditorId: event.target.value }))}>
                  <MenuItem value="">Nije dodijeljeno</MenuItem>
                  {editors.map((editor) => <MenuItem key={editor._id} value={editor._id}>{editor.username}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Kategorija</InputLabel>
                <Select value={draft.contentTypeId || ''} label="Kategorija" onChange={(event) => setDraft((current) => ({ ...current, contentTypeId: event.target.value }))}>
                  {contentTypes.filter((item) => item.active !== false).map((type) => <MenuItem key={type._id} value={type._id}>{type.name}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField
                fullWidth
                size="small"
                type="datetime-local"
                label="Rok"
                value={draft.deadline || ''}
                onChange={(event) => setDraft((current) => ({ ...current, deadline: event.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Stack>
            <TextField
              label="Razlog lifecycle promjene"
              value={draft.workspaceStateReason || ''}
              onChange={(event) => setDraft((current) => ({ ...current, workspaceStateReason: event.target.value }))}
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditJob(null)} disabled={busy}>Odustani</Button>
          <Button variant="contained" onClick={save} disabled={busy}>Spremi</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteJob)}
        title="Sigurno brisanje joba"
        description={`Job "${deleteJob?.title || ''}" bit će obrisan samo ako nema finalni video niti rundown vezu. U suprotnom koristi Zatvori ili Otkaži.`}
        confirmLabel="Obriši"
        confirmColor="error"
        busy={busy}
        onClose={() => setDeleteJob(null)}
        onConfirm={confirmDelete}
      />
    </Box>
  );
};

export default EditJobManagement;
