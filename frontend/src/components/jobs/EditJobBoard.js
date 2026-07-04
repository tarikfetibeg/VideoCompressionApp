import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Pagination,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import axiosInstance from '../../axiosConfig';
import {
  ConfirmDialog,
  EmptyState,
  FilterBar,
  KpiStrip,
  StatusChip,
} from '../common/WorkspaceChrome';
import {
  formatDateTimeBs,
  jobStatusLabels,
  priorityLabels,
} from '../../utils/uiLabels';
import { getSearchParam } from '../../utils/searchParams';

const defaultFilters = {
  q: '',
  status: 'all',
  workspaceState: 'active',
};

const workspaceStateLabels = {
  active: 'Aktivan',
  expired: 'Istekao',
  closed: 'Zatvoren',
  cancelled: 'Otkazan',
};

const deadlineStateLabels = {
  no_deadline: 'Bez roka',
  on_time: 'U roku',
  due_soon: 'Rok uskoro',
  overdue: 'Kasni',
  expired: 'Istekao',
};

const formatDate = (value) => {
  if (!value) return 'Bez roka';
  return formatDateTimeBs(value);
};

const EditJobBoard = ({ refreshToken = 0 }) => {
  const [jobs, setJobs] = useState([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [debouncedFilters, setDebouncedFilters] = useState(defaultFilters);
  const [page, setPage] = useState(1);
  const [workspaceMeta, setWorkspaceMeta] = useState({ total: 0, totalPages: 1, summary: {} });
  const [loading, setLoading] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [jobToDelete, setJobToDelete] = useState(null);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedFilters(filters), 250);
    return () => window.clearTimeout(timeoutId);
  }, [filters]);

  const fetchJobs = useCallback(() => {
    setLoading(true);
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .get('/edit-jobs/workspace', {
        params: {
          q: getSearchParam(debouncedFilters.q),
          status: debouncedFilters.status !== 'all' ? debouncedFilters.status : undefined,
          workspaceState: debouncedFilters.workspaceState,
          includeClosed: debouncedFilters.workspaceState === 'all' ? 'true' : undefined,
          page,
          limit: 50,
        },
      })
      .then((response) => {
        const data = Array.isArray(response.data)
          ? response.data
          : Array.isArray(response.data?.items)
            ? response.data.items
            : [];
        setJobs(data);
        setWorkspaceMeta(Array.isArray(response.data) ? { total: data.length, totalPages: 1, summary: {} } : response.data || {});
      })
      .catch((error) => {
        console.error('Error fetching edit jobs:', error);
        setErrorMessage('Edit jobovi se ne mogu učitati.');
      })
      .finally(() => setLoading(false));
  }, [debouncedFilters, page]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs, refreshToken]);

  const handleDeleteJob = () => {
    if (!jobToDelete) return;

    setDeleteBusy(true);
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .delete(`/edit-jobs/${jobToDelete._id}`)
      .then(() => {
        setJobs((current) => current.filter((job) => job._id !== jobToDelete._id));
        setMessage(`Job "${jobToDelete.title}" je obrisan.`);
        setJobToDelete(null);
        fetchJobs();
      })
      .catch((error) => {
        console.error('Error deleting edit job:', error);
        setErrorMessage(error.response?.data?.message || 'Job could not be deleted.');
      })
      .finally(() => setDeleteBusy(false));
  };

  const stats = useMemo(
    () => ({
      total: workspaceMeta.summary?.total ?? workspaceMeta.total ?? jobs.length,
      submitted: workspaceMeta.summary?.submitted ?? jobs.filter((job) => ['submitted', 'draft'].includes(job.status)).length,
      inEdit: workspaceMeta.summary?.inEdit ?? jobs.filter((job) => ['claimed', 'in_edit'].includes(job.status)).length,
      needsInfo: workspaceMeta.summary?.needsInfo ?? jobs.filter((job) => job.status === 'needs_info').length,
      ready: workspaceMeta.summary?.ready ?? jobs.filter((job) => ['ready_for_qc', 'approved'].includes(job.status)).length,
      updates: workspaceMeta.summary?.unreadUpdates ?? jobs.filter((job) => job.viewerMeta?.hasUnreadChanges).length,
      newFiles: workspaceMeta.summary?.missingFiles ?? jobs.filter((job) => job.downloadMeta?.hasMissingFiles).length,
      corrections: workspaceMeta.summary?.corrections ?? jobs.filter((job) => job.jobKind === 'correction').length,
    }),
    [jobs, workspaceMeta]
  );

  return (
    <Box>
      <FilterBar
        title="Edit jobovi"
        summary="Briefovi reportera, OFF fajlovi, odabrani klipovi i status montaže."
        actions={(
          <Button startIcon={<RefreshIcon />} variant="outlined" onClick={fetchJobs} disabled={loading}>
            Osvježi jobove
          </Button>
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
          />
          <FormControl sx={{ minWidth: { xs: '100%', md: 220 } }}>
            <InputLabel>Status</InputLabel>
            <Select
              value={filters.status}
              label="Status"
              onChange={(event) => {
                setFilters((current) => ({ ...current, status: event.target.value }));
                setPage(1);
              }}
            >
              <MenuItem value="all">Svi statusi</MenuItem>
              {Object.entries(jobStatusLabels).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl sx={{ minWidth: { xs: '100%', md: 200 } }}>
            <InputLabel>Radni prostor</InputLabel>
            <Select
              value={filters.workspaceState}
              label="Radni prostor"
              onChange={(event) => {
                setFilters((current) => ({ ...current, workspaceState: event.target.value }));
                setPage(1);
              }}
            >
              <MenuItem value="active">Aktivni jobovi</MenuItem>
              <MenuItem value="history">Historija</MenuItem>
              <MenuItem value="all">Sve</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </FilterBar>

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <KpiStrip
        dense
        items={[
          { label: 'Ukupno', value: stats.total },
          { label: 'Novo', value: stats.submitted, color: 'primary.main' },
          { label: 'U montaži', value: stats.inEdit, color: 'warning.main' },
          { label: 'Treba dopuna', value: stats.needsInfo, color: 'error.main' },
          { label: 'Spremno', value: stats.ready, color: 'success.main' },
          { label: 'Izmjene/fajlovi', value: `${stats.updates}/${stats.newFiles}`, color: 'warning.main' },
          { label: 'Ispravke', value: stats.corrections, color: 'error.main' },
        ]}
      />

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && jobs.length === 0 ? (
        <EmptyState
          icon={<AssignmentTurnedInIcon color="disabled" />}
          title="Nema edit jobova"
          description="Reporter može kreirati job iz Event Workspacea ili iz Video Details markera."
        />
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Job</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Reporter</TableCell>
                <TableCell>Montaža</TableCell>
                <TableCell>Klipovi</TableCell>
                <TableCell>Rok</TableCell>
                <TableCell align="right">Akcije</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job._id} hover>
                  <TableCell sx={{ minWidth: 260 }}>
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>
                      {job.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {job.program || 'Bez programa'} / {job.description || 'Bez briefa'}
                    </Typography>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                      {job.viewerMeta?.hasUnreadChanges && (
                        <StatusChip label={`${job.viewerMeta.unreadChangeCount} izmjena`} tone="warning" />
                      )}
                      {job.downloadMeta?.hasMissingFiles && (
                        <StatusChip
                          label={`${job.downloadMeta.missingSegmentCount + job.downloadMeta.missingOffFileCount} novi fajl`}
                          tone="warning"
                          variant="outlined"
                        />
                      )}
                      {job.scriptText && <StatusChip label="Brief tekst" variant="outlined" />}
                      {(job.offFiles?.length || 0) > 0 && (
                        <StatusChip label={`${job.offFiles.length} OFF`} variant="outlined" />
                      )}
                      {job.jobKind === 'correction' && (
                        <StatusChip label="Correction job" tone="error" />
                      )}
                      {job.contentType?.name && (
                        <StatusChip label={job.contentType.name} variant="outlined" />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      <StatusChip value={job.status} maps={jobStatusLabels} />
                      <StatusChip value={job.priority} maps={priorityLabels} variant="outlined" />
                      <StatusChip
                        value={job.workspaceState || 'active'}
                        maps={workspaceStateLabels}
                        variant="outlined"
                      />
                    </Stack>
                  </TableCell>
                  <TableCell>{job.reporter?.username || 'Nepoznato'}</TableCell>
                  <TableCell>{job.assignedEditor?.username || 'Nije dodijeljeno'}</TableCell>
                  <TableCell>{job.segments?.length || 0}</TableCell>
                  <TableCell>
                    <Stack spacing={0.5}>
                      <Typography variant="body2">{formatDate(job.deadline)}</Typography>
                      <StatusChip
                        value={job.deadlineState || 'no_deadline'}
                        maps={deadlineStateLabels}
                        tone={['overdue', 'expired'].includes(job.deadlineState) ? 'error' : job.deadlineState === 'due_soon' ? 'warning' : 'default'}
                        variant="outlined"
                      />
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Tooltip title="Otvori job">
                        <IconButton component={Link} to={`/edit-jobs/${job._id}`} size="small">
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Obriši job">
                        <IconButton size="small" color="error" onClick={() => setJobToDelete(job)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {workspaceMeta.totalPages > 1 && (
        <Stack alignItems="center" sx={{ mt: 2 }}>
          <Pagination
            page={page}
            count={workspaceMeta.totalPages}
            onChange={(event, value) => setPage(value)}
            color="primary"
          />
        </Stack>
      )}

      <ConfirmDialog
        open={Boolean(jobToDelete)}
        title="Obriši edit job"
        description={`Da li si siguran da želiš obrisati job "${jobToDelete?.title || ''}"? Ova akcija briše job, pripadajuće OFF fajlove i komunikaciju vezanu za taj job.`}
        confirmLabel="Obriši"
        confirmColor="error"
        busy={deleteBusy}
        onClose={() => setJobToDelete(null)}
        onConfirm={handleDeleteJob}
      />
    </Box>
  );
};

export default EditJobBoard;
