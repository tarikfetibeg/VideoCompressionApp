import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import axiosInstance from '../../axiosConfig';

const statusColor = {
  draft: 'default',
  submitted: 'primary',
  claimed: 'info',
  in_edit: 'warning',
  needs_info: 'error',
  ready_for_qc: 'secondary',
  approved: 'success',
  aired: 'success',
  archived: 'default',
};

const priorityColor = {
  low: 'default',
  normal: 'primary',
  high: 'warning',
  urgent: 'error',
};

const formatLabel = (value) => String(value || 'N/A').replace(/_/g, ' ');

const formatDate = (value) => {
  if (!value) return 'No deadline';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No deadline';
  return date.toLocaleString();
};

const EditJobBoard = ({ refreshToken = 0 }) => {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const fetchJobs = useCallback(() => {
    setLoading(true);
    setErrorMessage('');

    axiosInstance
      .get('/edit-jobs')
      .then((response) => {
        setJobs(Array.isArray(response.data) ? response.data : []);
      })
      .catch((error) => {
        console.error('Error fetching edit jobs:', error);
        setErrorMessage('Edit jobs could not be loaded.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs, refreshToken]);

  const stats = useMemo(
    () => ({
      total: jobs.length,
      submitted: jobs.filter((job) => ['submitted', 'draft'].includes(job.status)).length,
      inEdit: jobs.filter((job) => ['claimed', 'in_edit'].includes(job.status)).length,
      needsInfo: jobs.filter((job) => job.status === 'needs_info').length,
      ready: jobs.filter((job) => ['ready_for_qc', 'approved'].includes(job.status)).length,
      updates: jobs.filter((job) => job.viewerMeta?.hasUnreadChanges).length,
    }),
    [jobs]
  );

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ xs: 'flex-start', md: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Edit Jobs
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Reporter briefs, selected clip ranges, and production status.
          </Typography>
        </Box>
        <Button startIcon={<RefreshIcon />} variant="outlined" onClick={fetchJobs} disabled={loading}>
          Refresh Jobs
        </Button>
      </Stack>

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={6} md={2}>
          <JobStat label="Total" value={stats.total} />
        </Grid>
        <Grid item xs={6} md={2}>
          <JobStat label="New" value={stats.submitted} tone="primary.main" />
        </Grid>
        <Grid item xs={6} md={2}>
          <JobStat label="In edit" value={stats.inEdit} tone="warning.main" />
        </Grid>
        <Grid item xs={6} md={2}>
          <JobStat label="Needs info" value={stats.needsInfo} tone="error.main" />
        </Grid>
        <Grid item xs={6} md={2}>
          <JobStat label="Ready" value={stats.ready} tone="success.main" />
        </Grid>
        <Grid item xs={6} md={2}>
          <JobStat label="Updates" value={stats.updates} tone="warning.main" />
        </Grid>
      </Grid>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && jobs.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, borderRadius: 2, textAlign: 'center' }}>
          <AssignmentTurnedInIcon color="disabled" />
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            No edit jobs yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Reporters can create jobs from video details after marking useful segments.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Job</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Reporter</TableCell>
                <TableCell>Editor</TableCell>
                <TableCell>Segments</TableCell>
                <TableCell>Deadline</TableCell>
                <TableCell align="right">Open</TableCell>
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
                      {job.program || 'No program'} / {job.description || 'No brief'}
                    </Typography>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                      {job.viewerMeta?.hasUnreadChanges && (
                        <Chip
                          label={`${job.viewerMeta.unreadChangeCount} update(s)`}
                          size="small"
                          color="warning"
                        />
                      )}
                      {job.scriptText && <Chip label="Brief text" size="small" variant="outlined" />}
                      {(job.offFiles?.length || 0) > 0 && (
                        <Chip label={`${job.offFiles.length} OFF`} size="small" variant="outlined" />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      <Chip label={formatLabel(job.status)} color={statusColor[job.status] || 'default'} size="small" />
                      <Chip
                        label={formatLabel(job.priority)}
                        color={priorityColor[job.priority] || 'default'}
                        size="small"
                        variant="outlined"
                      />
                    </Stack>
                  </TableCell>
                  <TableCell>{job.reporter?.username || 'Unknown'}</TableCell>
                  <TableCell>{job.assignedEditor?.username || 'Unassigned'}</TableCell>
                  <TableCell>{job.segments?.length || 0}</TableCell>
                  <TableCell>{formatDate(job.deadline)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Open job">
                      <IconButton component={Link} to={`/edit-jobs/${job._id}`} size="small">
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

const JobStat = ({ label, value, tone = 'text.primary' }) => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
      {label}
    </Typography>
    <Typography variant="h5" sx={{ fontWeight: 800, color: tone }}>
      {value}
    </Typography>
  </Paper>
);

export default EditJobBoard;
