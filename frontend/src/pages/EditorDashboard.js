import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import axiosInstance from '../axiosConfig';
import SearchAndFilterComponent from '../components/editor/SearchAndFilterComponent';
import VideoListComponent from '../components/editor/VideoListComponent';
import VideoUploadComponent from '../components/editor/VideoUploadComponent';
import BulkActionsComponent from '../components/editor/BulkActionsComponent';
import EditJobBoard from '../components/jobs/EditJobBoard';
import { UserContext } from '../contexts/UserContext';
import {
  ACTIVE_PROCESSING_REFRESH_MS,
  IDLE_REFRESH_MS,
  hasActiveVideoProcessing,
} from '../utils/videoProcessing';

const defaultFilters = {
  search: '',
  event: '',
  location: '',
  date: '',
  uploader: '',
  status: 'all',
  processingStatus: 'all',
  qcStatus: 'all',
  broadcastStatus: 'all',
};

const normalizeDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const getUploaderName = (video) => video.uploader?.username || 'Unknown';

const matchesText = (video, search) => {
  if (!search) return true;

  const target = search.toLowerCase().trim();
  return [
    video.originalFilename,
    video.filename,
    video.event,
    video.location,
    video.status,
    video.processingStatus,
    video.qcStatus,
    video.broadcastStatus,
    getUploaderName(video),
    video.reporter?.username,
    video.editor?.username,
    video.qaResponsible?.username,
    video.program?.name,
    video.contentType?.name,
    ...(video.keywords || []),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(target));
};

const filterVideos = (videos, filters) =>
  videos.filter((video) => {
    const eventMatch = filters.event
      ? (video.event || '').toLowerCase().includes(filters.event.toLowerCase())
      : true;
    const locationMatch = filters.location
      ? (video.location || '').toLowerCase().includes(filters.location.toLowerCase())
      : true;
    const uploaderMatch = filters.uploader
      ? getUploaderName(video).toLowerCase().includes(filters.uploader.toLowerCase())
      : true;
    const dateMatch = filters.date
      ? normalizeDate(video.tagDate || video.uploadDate) === filters.date
      : true;
    const statusMatch = filters.status === 'all' || video.status === filters.status;
    const processingMatch =
      filters.processingStatus === 'all' ||
      video.processingStatus === filters.processingStatus;
    const qcMatch = filters.qcStatus === 'all' || (video.qcStatus || 'pending') === filters.qcStatus;
    const broadcastMatch =
      filters.broadcastStatus === 'all' ||
      (video.broadcastStatus || 'not_ready') === filters.broadcastStatus;

    return (
      matchesText(video, filters.search) &&
      eventMatch &&
      locationMatch &&
      uploaderMatch &&
      dateMatch &&
      statusMatch &&
      processingMatch &&
      qcMatch &&
      broadcastMatch
    );
  });

const buildOptions = (videos, getter) =>
  Array.from(new Set(videos.map(getter).filter(Boolean))).sort((a, b) =>
    String(a).localeCompare(String(b))
  );

const SummaryTile = ({ label, value, tone = 'default' }) => {
  const colorMap = {
    default: 'text.primary',
    active: 'primary.main',
    warning: 'warning.main',
    error: 'error.main',
    success: 'success.main',
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
        {label}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 800, color: colorMap[tone] }}>
        {value}
      </Typography>
    </Paper>
  );
};

const EditorDashboard = () => {
  const { user } = useContext(UserContext);
  const [videos, setVideos] = useState([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [selectedVideos, setSelectedVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [activeView, setActiveView] = useState('jobs');

  const canUploadFinal = ['Editor', 'VideoEditor', 'Admin'].includes(user?.role);

  const fetchVideos = useCallback(({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setErrorMessage('');
    }

    axiosInstance
      .get('/videos?all=true', { headers: { Accept: 'application/json' } })
      .then((response) => {
        const data = Array.isArray(response.data) ? response.data : [];
        setVideos(data);
        setLastRefresh(new Date());
      })
      .catch((err) => {
        console.error('Error fetching videos:', err);
        if (!silent) {
          setErrorMessage('Video list could not be loaded.');
        }
      })
      .finally(() => {
        if (!silent) {
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  const hasActiveProcessing = useMemo(() => hasActiveVideoProcessing(videos), [videos]);

  useEffect(() => {
    const intervalId = window.setInterval(
      () => fetchVideos({ silent: true }),
      hasActiveProcessing ? ACTIVE_PROCESSING_REFRESH_MS : IDLE_REFRESH_MS
    );
    return () => window.clearInterval(intervalId);
  }, [fetchVideos, hasActiveProcessing]);

  const filteredVideos = useMemo(() => filterVideos(videos, filters), [videos, filters]);

  const selectedVideoObjects = useMemo(
    () => videos.filter((video) => selectedVideos.includes(video._id)),
    [videos, selectedVideos]
  );

  const options = useMemo(
    () => ({
      events: buildOptions(videos, (video) => video.event),
      locations: buildOptions(videos, (video) => video.location),
      reporters: buildOptions(videos, getUploaderName),
    }),
    [videos]
  );

  const stats = useMemo(
    () => ({
      total: videos.length,
      raw: videos.filter((video) => video.status === 'raw').length,
      processing: videos.filter((video) => ['queued', 'processing'].includes(video.processingStatus)).length,
      qcPending: videos.filter((video) => (video.qcStatus || 'pending') === 'pending').length,
      approved: videos.filter((video) => video.broadcastStatus === 'approved_for_air').length,
      failed: videos.filter(
        (video) => video.processingStatus === 'failed' || video.qcStatus === 'failed'
      ).length,
    }),
    [videos]
  );

  const clearSelection = () => setSelectedVideos([]);

  const handleSelectVideo = (id) => {
    setSelectedVideos((prev) =>
      prev.includes(id) ? prev.filter((selectedId) => selectedId !== id) : [...prev, id]
    );
  };

  const handleSelectAllVisible = () => {
    const visibleIds = filteredVideos.map((video) => video._id);
    const allVisibleSelected =
      visibleIds.length > 0 && visibleIds.every((id) => selectedVideos.includes(id));

    if (allVisibleSelected) {
      setSelectedVideos((prev) => prev.filter((id) => !visibleIds.includes(id)));
      return;
    }

    setSelectedVideos((prev) => Array.from(new Set([...prev, ...visibleIds])));
  };

  const handleRetryProcessing = (video) => {
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .post(`/videos/${video._id}/requeue-processing`)
      .then((response) => {
        setMessage(response.data?.message || 'Video processing has been queued again.');
        fetchVideos();
      })
      .catch((error) => {
        console.error('Error retrying video processing:', error);
        setErrorMessage(error.response?.data?.message || 'Video processing could not be retried.');
      });
  };

  const resetFilters = () => setFilters(defaultFilters);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>
              Production Desk
            </Typography>
            <Chip label={user?.role || 'User'} size="small" color="primary" />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {lastRefresh ? `Last refresh ${lastRefresh.toLocaleTimeString()}` : 'Loading material'}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} alignItems="center">
          {loading && <CircularProgress size={22} />}
          <Button startIcon={<RefreshIcon />} variant="outlined" onClick={fetchVideos} disabled={loading}>
            Refresh
          </Button>
          {canUploadFinal && (
            <Button
              startIcon={<UploadFileIcon />}
              variant="contained"
              onClick={() => setUploadOpen((open) => !open)}
            >
              Direct Final
            </Button>
          )}
        </Stack>
      </Stack>

      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage}
        </Alert>
      )}
      {message && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {message}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={2}>
          <SummaryTile label="Total" value={stats.total} />
        </Grid>
        <Grid item xs={6} md={2}>
          <SummaryTile label="Raw" value={stats.raw} tone="active" />
        </Grid>
        <Grid item xs={6} md={2}>
          <SummaryTile label="Processing" value={stats.processing} tone="warning" />
        </Grid>
        <Grid item xs={6} md={2}>
          <SummaryTile label="QC Pending" value={stats.qcPending} tone="warning" />
        </Grid>
        <Grid item xs={6} md={2}>
          <SummaryTile label="Approved" value={stats.approved} tone="success" />
        </Grid>
        <Grid item xs={6} md={2}>
          <SummaryTile label="Issues" value={stats.failed} tone="error" />
        </Grid>
      </Grid>

      {canUploadFinal && uploadOpen && (
        <VideoUploadComponent
          onUploadComplete={() => {
            fetchVideos();
            setUploadOpen(false);
          }}
        />
      )}

      <Paper variant="outlined" sx={{ mb: 2, borderRadius: 2 }}>
        <Tabs
          value={activeView}
          onChange={(event, value) => setActiveView(value)}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab value="jobs" label="Jobs" />
          <Tab value="material" label="Material" />
        </Tabs>
      </Paper>

      {activeView === 'jobs' ? (
        <EditJobBoard />
      ) : (
        <>
          <SearchAndFilterComponent
            filters={filters}
            setFilters={setFilters}
            resetFilters={resetFilters}
            options={options}
            resultCount={filteredVideos.length}
          />

          <BulkActionsComponent
            selectedVideos={selectedVideos}
            selectedVideoObjects={selectedVideoObjects}
            clearSelection={clearSelection}
            refreshVideos={fetchVideos}
          />

          <VideoListComponent
            videos={filteredVideos}
            selectedVideos={selectedVideos}
            onSelectVideo={handleSelectVideo}
            onSelectAllVisible={handleSelectAllVisible}
            onRetryProcessing={handleRetryProcessing}
          />
        </>
      )}
    </Box>
  );
};

export default EditorDashboard;
