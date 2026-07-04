import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Tab,
  Tabs,
  TextField,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import axiosInstance from '../axiosConfig';
import SearchAndFilterComponent from '../components/editor/SearchAndFilterComponent';
import VideoListComponent from '../components/editor/VideoListComponent';
import VideoUploadComponent from '../components/editor/VideoUploadComponent';
import BulkActionsComponent from '../components/editor/BulkActionsComponent';
import EditJobBoard from '../components/jobs/EditJobBoard';
import CorrectionQueue from '../components/jobs/CorrectionQueue';
import { UserContext } from '../contexts/UserContext';
import {
  ACTIVE_PROCESSING_REFRESH_MS,
  IDLE_REFRESH_MS,
  hasActiveVideoProcessing,
} from '../utils/videoProcessing';
import { KpiStrip, WorkspaceHeader } from '../components/common/WorkspaceChrome';
import { formatDateTimeBs, formatRole } from '../utils/uiLabels';
import { getSearchParam } from '../utils/searchParams';

const defaultFilters = {
  search: '',
  event: '',
  location: '',
  date: '',
  uploader: '',
  contentTypeId: 'all',
  status: 'all',
  processingStatus: 'all',
  qcStatus: 'all',
  broadcastStatus: 'all',
};

const defaultCategoryReviewDialog = {
  open: false,
  video: null,
  notes: '',
  busy: false,
};

const getUploaderName = (video) => video.uploader?.username || 'Unknown';

const buildOptions = (videos, getter) =>
  Array.from(new Set(videos.map(getter).filter(Boolean))).sort((a, b) =>
    String(a).localeCompare(String(b))
  );

const EditorDashboard = () => {
  const { user } = useContext(UserContext);
  const [videos, setVideos] = useState([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [debouncedFilters, setDebouncedFilters] = useState(defaultFilters);
  const [workspaceMeta, setWorkspaceMeta] = useState({ total: 0, summary: {} });
  const [contentTypes, setContentTypes] = useState([]);
  const [selectedVideos, setSelectedVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [activeView, setActiveView] = useState('jobs');
  const [categoryReviewDialog, setCategoryReviewDialog] = useState(defaultCategoryReviewDialog);

  const canUploadFinal = ['Editor', 'VideoEditor', 'Admin'].includes(user?.role);
  const canRequestCategoryReview = ['Editor', 'VideoEditor', 'Admin'].includes(user?.role);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedFilters(filters), 300);
    return () => window.clearTimeout(timeoutId);
  }, [filters]);

  useEffect(() => {
    axiosInstance
      .get('/broadcast/content-types')
      .then((response) => {
        setContentTypes(Array.isArray(response.data) ? response.data : []);
      })
      .catch((error) => {
        console.error('Error loading content types:', error);
      });
  }, []);

  const fetchVideos = useCallback((optionsArg = {}) => {
    const silent = Boolean(optionsArg?.silent);
    if (!silent) {
      setLoading(true);
      setErrorMessage('');
    }

    const params = {
      q: getSearchParam(debouncedFilters.search),
      event: debouncedFilters.event || undefined,
      location: debouncedFilters.location || undefined,
      date: debouncedFilters.date || undefined,
      contentTypeId: debouncedFilters.contentTypeId !== 'all' ? debouncedFilters.contentTypeId : undefined,
      status: debouncedFilters.status !== 'all' ? debouncedFilters.status : undefined,
      processingStatus: debouncedFilters.processingStatus !== 'all' ? debouncedFilters.processingStatus : undefined,
      qcStatus: debouncedFilters.qcStatus !== 'all' ? debouncedFilters.qcStatus : undefined,
      broadcastStatus: debouncedFilters.broadcastStatus !== 'all' ? debouncedFilters.broadcastStatus : undefined,
      limit: 150,
      sortBy: 'uploadDate',
      sortOrder: 'desc',
    };

    axiosInstance
      .get('/videos/workspace', {
        params,
        headers: { Accept: 'application/json' },
      })
      .then((response) => {
        const data = Array.isArray(response.data)
          ? response.data
          : Array.isArray(response.data?.items)
            ? response.data.items
            : [];
        setVideos(data);
        setWorkspaceMeta(Array.isArray(response.data) ? { total: data.length, summary: {} } : response.data || {});
        setLastRefresh(new Date());
      })
      .catch((err) => {
        console.error('Error fetching videos:', err);
        if (!silent) {
          setErrorMessage('Lista materijala se ne može učitati.');
        }
      })
      .finally(() => {
        if (!silent) {
          setLoading(false);
        }
      });
  }, [debouncedFilters]);

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

  const filteredVideos = videos;

  const selectedVideoObjects = useMemo(
    () => videos.filter((video) => selectedVideos.includes(video._id)),
    [videos, selectedVideos]
  );

  const options = useMemo(
    () => ({
      events: buildOptions(videos, (video) => video.event),
      locations: buildOptions(videos, (video) => video.location),
      reporters: buildOptions(videos, getUploaderName),
      contentTypes: contentTypes.filter((type) => type.active !== false),
    }),
    [contentTypes, videos]
  );

  const stats = useMemo(
    () => ({
      total: workspaceMeta.summary?.total ?? workspaceMeta.total ?? videos.length,
      raw: workspaceMeta.summary?.raw ?? videos.filter((video) => video.status === 'raw').length,
      processing: (workspaceMeta.summary?.queued ?? 0) + (workspaceMeta.summary?.processing ?? 0)
        || videos.filter((video) => ['queued', 'processing'].includes(video.processingStatus)).length,
      qcPending: workspaceMeta.summary?.qcPending ?? videos.filter((video) => (video.qcStatus || 'pending') === 'pending').length,
      approved: workspaceMeta.summary?.approved ?? videos.filter((video) => video.broadcastStatus === 'approved_for_air').length,
      failed: workspaceMeta.summary?.failed ?? videos.filter(
        (video) => video.processingStatus === 'failed' || video.qcStatus === 'failed'
      ).length,
    }),
    [videos, workspaceMeta]
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
        setMessage(response.data?.message || 'Obrada videa je ponovo stavljena u red.');
        fetchVideos();
      })
      .catch((error) => {
        console.error('Error retrying video processing:', error);
        setErrorMessage(error.response?.data?.message || 'Obrada videa se ne može ponovo pokrenuti.');
      });
  };

  const openCategoryReviewDialog = (video) => {
    setMessage('');
    setErrorMessage('');
    setCategoryReviewDialog({
      open: true,
      video,
      notes: `Trenutna kategorija: ${video.contentType?.name || video.finalCategory || 'bez kategorije'}.`,
      busy: false,
    });
  };

  const closeCategoryReviewDialog = () => {
    if (categoryReviewDialog.busy) return;
    setCategoryReviewDialog(defaultCategoryReviewDialog);
  };

  const submitCategoryReviewRequest = () => {
    const video = categoryReviewDialog.video;
    if (!video) return;

    setCategoryReviewDialog((current) => ({ ...current, busy: true }));
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .patch(`/videos/${video._id}/archive-review-request`, {
        notes: categoryReviewDialog.notes,
      })
      .then((response) => {
        const updatedVideo = response.data?.video;
        if (updatedVideo?._id) {
          setVideos((currentVideos) =>
            currentVideos.map((currentVideo) =>
              currentVideo._id === updatedVideo._id ? updatedVideo : currentVideo
            )
          );
        }
        setCategoryReviewDialog(defaultCategoryReviewDialog);
        setMessage(response.data?.message || 'Materijal je poslan arhivi na provjeru kategorije.');
      })
      .catch((error) => {
        console.error('Error requesting archive category review:', error);
        setCategoryReviewDialog((current) => ({ ...current, busy: false }));
        setErrorMessage(error.response?.data?.message || 'Provjera kategorije se ne moze poslati arhivi.');
      });
  };

  const resetFilters = () => setFilters(defaultFilters);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: 'background.default', minHeight: '100vh' }}>
      <WorkspaceHeader
        eyebrow="Dnevna produkcija"
        title="Production Desk"
        subtitle={lastRefresh ? `Zadnje osvježenje: ${formatDateTimeBs(lastRefresh)}` : 'Učitavanje materijala i jobova'}
        chips={[
          { label: formatRole(user?.role), color: 'primary' },
          { label: `${workspaceMeta.total ?? videos.length} materijala`, variant: 'outlined' },
        ]}
        actions={(
          <>
          {loading && <CircularProgress size={22} />}
          <Button startIcon={<RefreshIcon />} variant="outlined" onClick={fetchVideos} disabled={loading}>
            Osvježi
          </Button>
          {canUploadFinal && (
            <Button
              startIcon={<UploadFileIcon />}
              variant="contained"
              onClick={() => setUploadOpen((open) => !open)}
            >
              Direktni final
            </Button>
          )}
          </>
        )}
      />

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

      <KpiStrip
        items={[
          { label: 'Ukupno', value: stats.total },
          { label: 'Sirovina', value: stats.raw, color: 'primary.main' },
          { label: 'Obrada', value: stats.processing, color: 'warning.main' },
          { label: 'QC čeka', value: stats.qcPending, color: 'warning.main' },
          { label: 'Odobreno', value: stats.approved, color: 'success.main' },
          { label: 'Problemi', value: stats.failed, color: 'error.main' },
        ]}
      />

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
          <Tab value="corrections" label="Ispravke" />
          <Tab value="material" label="Materijal" />
        </Tabs>
      </Paper>

      {activeView === 'jobs' ? (
        <EditJobBoard />
      ) : activeView === 'corrections' ? (
        <CorrectionQueue role={user?.role} userId={user?.id} />
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
            onRequestCategoryReview={canRequestCategoryReview ? openCategoryReviewDialog : undefined}
          />
        </>
      )}

      <Dialog open={categoryReviewDialog.open} onClose={closeCategoryReviewDialog} fullWidth maxWidth="sm">
        <DialogTitle>Provjera kategorije</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Posalji materijal arhiveru ako kategorija nije ispravna ili treba dodatnu metadata provjeru.
          </DialogContentText>
          <TextField
            label="Napomena za arhivu"
            value={categoryReviewDialog.notes}
            onChange={(event) =>
              setCategoryReviewDialog((current) => ({ ...current, notes: event.target.value }))
            }
            minRows={3}
            multiline
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCategoryReviewDialog} disabled={categoryReviewDialog.busy}>
            Odustani
          </Button>
          <Button variant="contained" onClick={submitCategoryReviewRequest} disabled={categoryReviewDialog.busy}>
            {categoryReviewDialog.busy ? 'Saljem...' : 'Posalji arhivi'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default EditorDashboard;
