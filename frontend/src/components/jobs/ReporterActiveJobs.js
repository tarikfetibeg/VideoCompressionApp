import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import ViewTimelineIcon from '@mui/icons-material/ViewTimeline';
import axiosInstance from '../../axiosConfig';
import { useNotifications } from '../../contexts/NotificationContext';
import {
  formatDateTimeBs,
  jobStatusLabels,
  priorityLabels,
} from '../../utils/uiLabels';
import {
  EmptyState,
  KpiStrip,
  StatusChip,
} from '../common/WorkspaceChrome';
import ReporterJobMaterialDialog from './ReporterJobMaterialDialog';

const attentionScore = (job) => {
  let score = 0;
  if (job.viewerMeta?.hasUnreadChanges) score += 100;
  if (job.status === 'needs_info') score += 80;
  if (['overdue', 'expired'].includes(job.deadlineState)) score += 60;
  if (job.deadlineState === 'due_soon') score += 40;
  if (job.priority === 'urgent') score += 30;
  if (job.priority === 'high') score += 15;
  return score;
};

const ReporterActiveJobs = ({ refreshToken = 0, onCountChange, onJobUpdated }) => {
  const { markJobRead } = useNotifications();
  const [jobs, setJobs] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedJob, setSelectedJob] = useState(null);
  const [materialJob, setMaterialJob] = useState(null);
  const [comment, setComment] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);
  const [panelMessage, setPanelMessage] = useState('');

  const fetchJobs = useCallback(({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setErrorMessage('');
    return axiosInstance
      .get('/edit-jobs/workspace', {
        params: {
          workspaceState: 'active',
          page: 1,
          limit: 50,
          sortBy: 'updatedAt',
          sortOrder: 'desc',
        },
      })
      .then((response) => {
        const items = Array.isArray(response.data?.items) ? response.data.items : [];
        setJobs(items);
        setSummary(response.data?.summary || {});
        if (onCountChange) onCountChange(items.length);
        setSelectedJob((current) => (
          current ? items.find((item) => item._id === current._id) || current : null
        ));
      })
      .catch((error) => {
        console.error('Error loading reporter jobs:', error);
        setErrorMessage(error.response?.data?.message || 'Aktivni jobovi se ne mogu učitati.');
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  }, [onCountChange]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs, refreshToken]);

  const orderedJobs = useMemo(
    () => [...jobs].sort((first, second) => {
      const scoreDifference = attentionScore(second) - attentionScore(first);
      if (scoreDifference !== 0) return scoreDifference;
      return new Date(second.updatedAt || 0) - new Date(first.updatedAt || 0);
    }),
    [jobs]
  );

  const openQuickPanel = (job) => {
    setSelectedJob(job);
    setPanelMessage('');
    markJobRead(job._id);
    axiosInstance
      .get(`/edit-jobs/${job._id}`)
      .then((response) => {
        const updatedJob = response.data;
        setSelectedJob(updatedJob);
        setJobs((current) => current.map((item) => (
          item._id === updatedJob._id ? updatedJob : item
        )));
      })
      .catch((error) => {
        console.error('Error loading quick job details:', error);
      });
  };

  const handleAddComment = () => {
    if (!selectedJob?._id || !comment.trim()) return;
    setCommentSaving(true);
    setPanelMessage('');
    axiosInstance
      .post(`/edit-jobs/${selectedJob._id}/comments`, { body: comment.trim() })
      .then((response) => {
        const updatedJob = response.data?.job;
        setSelectedJob(updatedJob || selectedJob);
        setJobs((current) => current.map((job) => (
          job._id === selectedJob._id ? (updatedJob || job) : job
        )));
        setComment('');
        setPanelMessage('Komentar je poslan montaži.');
        if (onJobUpdated) onJobUpdated(updatedJob);
      })
      .catch((error) => {
        console.error('Error adding reporter comment:', error);
        setPanelMessage(error.response?.data?.message || 'Komentar nije moguće poslati.');
      })
      .finally(() => setCommentSaving(false));
  };

  const handleMaterialUpdated = (updatedJob) => {
    if (updatedJob?._id) {
      setJobs((current) => current.map((job) => (
        job._id === updatedJob._id ? updatedJob : job
      )));
      setSelectedJob((current) => current?._id === updatedJob._id ? updatedJob : current);
      setMaterialJob((current) => current?._id === updatedJob._id ? updatedJob : current);
    }
    fetchJobs({ silent: true });
    if (onJobUpdated) onJobUpdated(updatedJob);
  };

  const stats = {
    total: summary.total ?? jobs.length,
    attention: jobs.filter((job) => (
      job.viewerMeta?.hasUnreadChanges
      || job.status === 'needs_info'
      || ['due_soon', 'overdue', 'expired'].includes(job.deadlineState)
    )).length,
    inEdit: summary.inEdit ?? jobs.filter((job) => ['claimed', 'in_edit'].includes(job.status)).length,
    ready: summary.ready ?? jobs.filter((job) => ['ready_for_qc', 'approved'].includes(job.status)).length,
  };

  return (
    <>
      <Box>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          alignItems={{ sm: 'center' }}
          justifyContent="space-between"
          sx={{ mb: 1.5 }}
        >
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 900 }}>
              Aktivni jobovi
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Dopune, komentari i status montaže dostupni su bez napuštanja početne stranice.
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => fetchJobs()}
            disabled={loading}
          >
            Osvježi
          </Button>
        </Stack>

        <KpiStrip
          dense
          items={[
            { label: 'Aktivno', value: stats.total },
            { label: 'Traži pažnju', value: stats.attention, color: stats.attention ? 'warning.main' : 'text.primary' },
            { label: 'U montaži', value: stats.inEdit, color: 'primary.main' },
            { label: 'Spremno', value: stats.ready, color: 'success.main' },
          ]}
        />

        {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {!loading && orderedJobs.length === 0 ? (
          <EmptyState
            title="Nema aktivnih jobova"
            description="Otvori sekciju Novi prilog, uploaduj materijal i pošalji ga montaži."
          />
        ) : (
          <Stack spacing={1}>
            {orderedJobs.map((job) => (
              <Paper
                key={job._id}
                variant="outlined"
                sx={{
                  p: 1.5,
                  borderRadius: 1,
                  borderColor: job.viewerMeta?.hasUnreadChanges || job.status === 'needs_info'
                    ? 'warning.main'
                    : 'divider',
                }}
              >
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={1.5}
                  alignItems={{ md: 'center' }}
                >
                  <Box
                    role="button"
                    tabIndex={0}
                    onClick={() => openQuickPanel(job)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') openQuickPanel(job);
                    }}
                    sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                  >
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
                      <StatusChip value={job.status} maps={jobStatusLabels} />
                      <StatusChip value={job.priority} maps={priorityLabels} variant="outlined" />
                      {job.viewerMeta?.hasUnreadChanges && (
                        <StatusChip
                          label={`${job.viewerMeta.unreadChangeCount} nova izmjena`}
                          tone="warning"
                        />
                      )}
                      {job.deadlineState === 'due_soon' && <StatusChip label="Rok uskoro" tone="warning" variant="outlined" />}
                      {['overdue', 'expired'].includes(job.deadlineState) && <StatusChip label="Rok istekao" tone="error" />}
                    </Stack>
                    <Typography variant="subtitle1" sx={{ fontWeight: 900 }} noWrap>
                      {job.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {job.segments?.length || 0} klipova / Montaža: {job.assignedEditor?.username || 'nije dodijeljena'}
                      {job.deadline ? ` / Rok: ${formatDateTimeBs(job.deadline)}` : ''}
                    </Typography>
                  </Box>

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75}>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<AddCircleOutlineIcon />}
                      onClick={() => setMaterialJob(job)}
                    >
                      Dodaj klipove
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<ChatBubbleOutlineIcon />}
                      onClick={() => openQuickPanel(job)}
                    >
                      Komentari
                    </Button>
                    <Tooltip title="Otvori puni pregled">
                      <IconButton component={Link} to={`/edit-jobs/${job._id}`} size="small">
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </Box>

      <Drawer
        anchor="right"
        open={Boolean(selectedJob)}
        onClose={() => setSelectedJob(null)}
        sx={(currentTheme) => ({
          zIndex: currentTheme.zIndex.modal + 1,
        })}
        PaperProps={{ sx: { width: { xs: '100%', sm: 440 }, p: 2 } }}
      >
        {selectedJob && (
          <Stack spacing={2} sx={{ height: '100%' }}>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="overline" color="text.secondary">Brzi pregled joba</Typography>
                <Typography variant="h6" sx={{ fontWeight: 900 }}>{selectedJob.title}</Typography>
              </Box>
              <IconButton onClick={() => setSelectedJob(null)} aria-label="Zatvori panel">
                <CloseIcon />
              </IconButton>
            </Stack>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <StatusChip value={selectedJob.status} maps={jobStatusLabels} />
              <StatusChip value={selectedJob.priority} maps={priorityLabels} variant="outlined" />
              <StatusChip label={`${selectedJob.segments?.length || 0} klipova`} variant="outlined" />
            </Stack>
            <Box>
              <Typography variant="caption" color="text.secondary">Montaža</Typography>
              <Typography variant="body2" sx={{ fontWeight: 750 }}>
                {selectedJob.assignedEditor?.username || 'Još nije dodijeljena'}
              </Typography>
              <Typography variant="caption" color="text.secondary">Rok</Typography>
              <Typography variant="body2" sx={{ fontWeight: 750 }}>
                {selectedJob.deadline ? formatDateTimeBs(selectedJob.deadline) : 'Bez zadanog roka'}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                startIcon={<AddCircleOutlineIcon />}
                onClick={() => setMaterialJob(selectedJob)}
              >
                Dodaj klipove
              </Button>
              <Button component={Link} to={`/edit-jobs/${selectedJob._id}`} variant="outlined">
                Puni pregled
              </Button>
            </Stack>
            <Button
              component={Link}
              to={`/edit-jobs/${selectedJob._id}/storyboard`}
              variant="outlined"
              startIcon={<ViewTimelineIcon />}
            >
              Otvori Storyboard
            </Button>
            <Divider />
            <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>Komentari</Typography>
            <Stack spacing={1} sx={{ overflowY: 'auto', flex: 1 }}>
              {(selectedJob.comments || []).length === 0 && (
                <Typography variant="body2" color="text.secondary">Još nema komentara.</Typography>
              )}
              {(selectedJob.comments || []).slice().reverse().map((item) => (
                <Box key={item._id}>
                  <Typography variant="body2">{item.body}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {item.author?.username || 'Korisnik'} / {formatDateTimeBs(item.createdAt)}
                  </Typography>
                  <Divider sx={{ mt: 1 }} />
                </Box>
              ))}
            </Stack>
            {panelMessage && <Alert severity={panelMessage.includes('nije') ? 'error' : 'success'}>{panelMessage}</Alert>}
            <TextField
              label="Novi komentar"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              multiline
              minRows={2}
              fullWidth
            />
            <Button
              variant="contained"
              onClick={handleAddComment}
              disabled={commentSaving || !comment.trim()}
            >
              {commentSaving ? 'Šaljem...' : 'Pošalji komentar'}
            </Button>
          </Stack>
        )}
      </Drawer>

      <ReporterJobMaterialDialog
        open={Boolean(materialJob)}
        job={materialJob}
        onClose={() => setMaterialJob(null)}
        onUpdated={handleMaterialUpdated}
      />
    </>
  );
};

export default ReporterActiveJobs;
