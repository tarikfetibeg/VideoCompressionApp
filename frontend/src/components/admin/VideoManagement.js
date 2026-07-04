import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CardMedia,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
  MenuItem,
  Pagination,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import DeselectIcon from '@mui/icons-material/Deselect';
import EventIcon from '@mui/icons-material/Event';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ReplayIcon from '@mui/icons-material/Replay';
import SelectAllIcon from '@mui/icons-material/SelectAll';
import axiosInstance from '../../axiosConfig';
import { useBackgroundDownloads } from '../../contexts/BackgroundDownloadContext';
import {
  ACTIVE_PROCESSING_REFRESH_MS,
  hasActiveVideoProcessing,
} from '../../utils/videoProcessing';
import { getSearchParam } from '../../utils/searchParams';

const formatBytes = (bytes) => {
  if (!bytes || Number.isNaN(Number(bytes))) return 'N/A';

  const value = Number(bytes);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDate = (value) => {
  if (!value) return 'N/A';
  return new Date(value).toLocaleDateString();
};

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString();
};

const getUploaderName = (video) => video.uploader?.username || 'Unknown uploader';
const getPersonName = (person) => person?.username || 'N/A';
const getContentTypeId = (video) => video.contentType?._id || '';
const getContentTypeName = (video) => video.contentType?.name || video.finalCategory || 'Uncategorized';
const getContentTypeSlug = (video) => video.contentType?.slug || video.finalCategory || '';
const contentTypeAliasBySlug = {
  prilog: ['prilog', 'video-report'],
  insert: ['insert'],
  spica: ['spica'],
  promo: ['promo'],
  marketing: ['marketing'],
  grafika: ['grafika'],
  ostalo: ['ostalo'],
};
const getContentTypeSlugAliases = (contentType) => {
  const slug = String(contentType?.slug || '').trim().toLowerCase();
  return contentTypeAliasBySlug[slug] || (slug ? [slug] : []);
};

const isArchiveVideo = (video) => ['aired', 'archived'].includes(video.broadcastStatus);
const isFinalVideo = (video) =>
  video.status === 'edited' && (
    video.processingMode === 'finalize' ||
    video.finalApprovalStatus === 'approved' ||
    Boolean(video.contentType) ||
    isArchiveVideo(video)
  );

const getWorkflowStage = (video) => {
  if (isArchiveVideo(video)) {
    return { label: 'Arhiva / aired', color: 'info', priority: 3 };
  }

  if (isFinalVideo(video)) {
    return { label: 'Smontiran final', color: 'success', priority: 2 };
  }

  if (video.status === 'edited') {
    return { label: 'Smontiran materijal', color: 'primary', priority: 1 };
  }

  return { label: 'Sirovina / ingest', color: 'warning', priority: 0 };
};

const matchesWorkflowFilter = (video, workflowFilter) => {
  if (workflowFilter === 'all') return true;
  if (workflowFilter === 'raw') return video.status === 'raw';
  if (workflowFilter === 'edited') return video.status === 'edited' && !isFinalVideo(video);
  if (workflowFilter === 'final') return isFinalVideo(video) && !isArchiveVideo(video);
  if (workflowFilter === 'archive') return isArchiveVideo(video);
  if (workflowFilter === 'uncategorized') return !getContentTypeId(video) && !video.finalCategory;
  return true;
};

const shouldShowProcessingProgress = (video) =>
  ['queued', 'processing'].includes(video.processingStatus);

const getEventName = (video) => video.event || 'No event';
const videoWorkspacePageSize = 60;

const getVideoTimestamp = (video) => {
  const value = video.tagDate || video.uploadDate || video.processingStartedAt || video.processingCompletedAt;
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const sortVideosForAdmin = (a, b) => {
  const eventCompare = getEventName(a).localeCompare(getEventName(b));
  if (eventCompare !== 0) return eventCompare;

  const dateCompare = getVideoTimestamp(b) - getVideoTimestamp(a);
  if (dateCompare !== 0) return dateCompare;

  return String(a.originalFilename || a.filename || '').localeCompare(
    String(b.originalFilename || b.filename || '')
  );
};

const buildEventGroups = (videos) => {
  const groups = new Map();

  [...videos].sort(sortVideosForAdmin).forEach((video) => {
    const eventName = getEventName(video);

    if (!groups.has(eventName)) {
      groups.set(eventName, {
        event: eventName,
        videos: [],
        latestTimestamp: 0,
        completed: 0,
        processing: 0,
        failed: 0,
        raw: 0,
        edited: 0,
        final: 0,
        archive: 0,
        uncategorized: 0,
      });
    }

    const group = groups.get(eventName);
    group.videos.push(video);
    group.latestTimestamp = Math.max(group.latestTimestamp, getVideoTimestamp(video));

    if (video.processingStatus === 'completed') group.completed += 1;
    if (shouldShowProcessingProgress(video)) group.processing += 1;
    if (video.processingStatus === 'failed') group.failed += 1;
    if (video.status === 'raw') group.raw += 1;
    if (video.status === 'edited') group.edited += 1;
    if (isFinalVideo(video)) group.final += 1;
    if (isArchiveVideo(video)) group.archive += 1;
    if (!getContentTypeId(video) && !video.finalCategory) group.uncategorized += 1;
  });

  return Array.from(groups.values()).sort((a, b) => {
    if (a.event === 'No event') return 1;
    if (b.event === 'No event') return -1;
    return b.latestTimestamp - a.latestTimestamp || a.event.localeCompare(b.event);
  });
};

const VideoThumbnail = ({ videoId, title }) => {
  const containerRef = useRef(null);
  const [src, setSrc] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '180px' }
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    let objectUrl = '';

    axiosInstance
      .get(`/videos/thumbnail/${videoId}`, { responseType: 'blob' })
      .then((response) => {
        objectUrl = URL.createObjectURL(response.data);
        setSrc(objectUrl);
      })
      .catch(() => {
        setSrc('');
      });

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [videoId, visible]);

  if (!src) {
    return (
      <Box
        ref={containerRef}
        sx={{
          height: 130,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'grey.100',
          color: 'text.secondary',
        }}
      >
        <Typography variant="body2">No thumbnail</Typography>
      </Box>
    );
  }

  return (
    <CardMedia
      ref={containerRef}
      component="img"
      height="130"
      image={src}
      alt={title}
      sx={{ objectFit: 'cover' }}
    />
  );
};

const VideoManagement = () => {
  const { startDownload } = useBackgroundDownloads();
  const [videos, setVideos] = useState([]);
  const [users, setUsers] = useState([]);
  const [contentTypes, setContentTypes] = useState([]);
  const [selectedVideos, setSelectedVideos] = useState([]);
  const [rawOrphanCount, setRawOrphanCount] = useState(0);
  const [recoveryOwnerId, setRecoveryOwnerId] = useState('');
  const [recoveringRaw, setRecoveringRaw] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [workflowFilter, setWorkflowFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [uploaderFilter, setUploaderFilter] = useState('all');
  const [workspacePage, setWorkspacePage] = useState(1);
  const [workspaceMeta, setWorkspaceMeta] = useState({
    total: 0,
    totalPages: 1,
    summary: {},
  });
  const [videosLoading, setVideosLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState({});

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  const fetchVideos = useCallback(({ silent = false } = {}) => {
    if (!silent) {
      setMessage('');
      setErrorMessage('');
      setVideosLoading(true);
    }

    const workspaceParams = {
      page: workspacePage,
      limit: videoWorkspacePageSize,
      q: getSearchParam(debouncedSearchTerm),
      processingStatus: statusFilter !== 'all' ? statusFilter : undefined,
      contentTypeId: categoryFilter !== 'all' && categoryFilter !== 'uncategorized' ? categoryFilter : undefined,
      status: workflowFilter === 'raw' ? 'raw' : ['edited', 'final'].includes(workflowFilter) ? 'edited' : undefined,
      library: workflowFilter === 'archive' ? 'archive' : undefined,
    };

    axiosInstance
      .get('/videos/workspace', {
        headers: { Accept: 'application/json' },
        params: workspaceParams,
      })
      .then((response) => {
        setVideos(Array.isArray(response.data?.items) ? response.data.items : []);
        setWorkspaceMeta({
          total: Number(response.data?.total) || 0,
          totalPages: Number(response.data?.totalPages) || 1,
          summary: response.data?.summary || {},
        });
      })
      .catch((err) => {
        console.error('Error fetching videos:', err);
        if (!silent) {
          setErrorMessage('Greska pri ucitavanju videa.');
        }
      })
      .finally(() => {
        if (!silent) {
          setVideosLoading(false);
        }
      });
  }, [categoryFilter, debouncedSearchTerm, statusFilter, workflowFilter, workspacePage]);

  useEffect(() => {
    fetchVideos();
    fetchRawOrphans();
    fetchUsers();
    fetchContentTypes();
  }, [fetchVideos]);

  useEffect(() => {
    setWorkspacePage(1);
    setSelectedVideos([]);
  }, [categoryFilter, debouncedSearchTerm, statusFilter, uploaderFilter, workflowFilter]);

  const hasActiveProcessing = useMemo(() => hasActiveVideoProcessing(videos), [videos]);

  useEffect(() => {
    if (!hasActiveProcessing) return undefined;

    const intervalId = window.setInterval(() => {
      fetchVideos({ silent: true });
    }, ACTIVE_PROCESSING_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [fetchVideos, hasActiveProcessing]);

  const uploaderOptions = useMemo(() => {
    const uploaders = [
      ...users.map((appUser) => appUser.username),
      ...videos.map(getUploaderName),
    ];
    return Array.from(new Set(uploaders)).sort();
  }, [users, videos]);

  const contentTypeById = useMemo(() => {
    const entries = contentTypes.map((type) => [type._id, type]);
    return new Map(entries);
  }, [contentTypes]);

  const activeContentTypes = useMemo(
    () => contentTypes.filter((type) => type.active !== false),
    [contentTypes]
  );

  const filteredVideos = useMemo(() => {
    const search = searchTerm.toLowerCase().trim();

    return videos.filter((video) => {
      const matchesSearch =
        !search ||
        [
          video.originalFilename,
          video.filename,
          video.event,
          video.location,
          video.status,
          video.processingStatus,
          video.broadcastStatus,
          video.finalApprovalStatus,
          video.processingMode,
          video.correctionStatus,
          video.correctionNote,
          video.correctionReportedBy?.username,
          getContentTypeName(video),
          getContentTypeSlug(video),
          getUploaderName(video),
          getPersonName(video.reporter),
          getPersonName(video.editor),
          getPersonName(video.qaResponsible),
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));

      const matchesStatus =
        statusFilter === 'all' ||
        video.processingStatus === statusFilter;

      const matchesWorkflow = matchesWorkflowFilter(video, workflowFilter);

      const selectedContentType = contentTypeById.get(categoryFilter);
      const selectedContentTypeAliases = getContentTypeSlugAliases(selectedContentType);
      const matchesCategory =
        categoryFilter === 'all' ||
        (categoryFilter === 'uncategorized' && !getContentTypeId(video) && !video.finalCategory) ||
        getContentTypeId(video) === categoryFilter ||
        selectedContentTypeAliases.includes(getContentTypeSlug(video));

      const matchesUploader =
        uploaderFilter === 'all' || getUploaderName(video) === uploaderFilter;

      return matchesSearch && matchesStatus && matchesWorkflow && matchesCategory && matchesUploader;
    });
  }, [videos, searchTerm, statusFilter, workflowFilter, categoryFilter, uploaderFilter, contentTypeById]);

  const eventGroups = useMemo(() => buildEventGroups(filteredVideos), [filteredVideos]);

  useEffect(() => {
    setExpandedEvents((current) => {
      const next = {};
      let changed = false;

      eventGroups.forEach((group, index) => {
        const previousValue = current[group.event];
        next[group.event] = previousValue ?? index === 0;

        if (current[group.event] !== next[group.event]) {
          changed = true;
        }
      });

      if (Object.keys(current).length !== Object.keys(next).length) {
        changed = true;
      }

      return changed ? next : current;
    });
  }, [eventGroups]);

  const stats = useMemo(() => {
    const summary = workspaceMeta.summary || {};
    const total = workspaceMeta.total || videos.length;
    const raw = summary.raw ?? videos.filter((video) => video.status === 'raw').length;
    const edited = summary.edited ?? videos.filter((video) => video.status === 'edited').length;
    const archive = (summary.aired ?? 0) + (summary.archived ?? 0) || videos.filter(isArchiveVideo).length;
    const uncategorized = videos.filter((video) => !getContentTypeId(video) && !video.finalCategory).length;
    const processing = (summary.queued ?? 0) + (summary.processing ?? 0) || videos.filter(shouldShowProcessingProgress).length;
    const failed = summary.failed ?? videos.filter((video) => video.processingStatus === 'failed').length;

    return {
      total,
      raw,
      edited,
      archive,
      uncategorized,
      processing,
      failed,
    };
  }, [videos, workspaceMeta]);

  const handleSelectVideo = (videoId) => {
    setSelectedVideos((prev) =>
      prev.includes(videoId)
        ? prev.filter((id) => id !== videoId)
        : [...prev, videoId]
    );
  };

  const handleSelectAllFiltered = () => {
    const filteredIds = filteredVideos.map((video) => video._id);
    const allSelected = filteredIds.every((id) => selectedVideos.includes(id));

    if (allSelected) {
      setSelectedVideos((prev) => prev.filter((id) => !filteredIds.includes(id)));
    } else {
      setSelectedVideos((prev) => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

  const handleClearSelection = () => {
    setSelectedVideos([]);
  };

  const handleToggleEvent = (eventName) => (event, isExpanded) => {
    setExpandedEvents((current) => ({
      ...current,
      [eventName]: isExpanded,
    }));
  };

  const getGroupVideoIds = (group) => group.videos.map((video) => video._id);

  const isGroupFullySelected = (group) => {
    const groupIds = getGroupVideoIds(group);
    return groupIds.length > 0 && groupIds.every((id) => selectedVideos.includes(id));
  };

  const isGroupPartiallySelected = (group) => {
    const groupIds = getGroupVideoIds(group);
    return (
      groupIds.some((id) => selectedVideos.includes(id)) &&
      !groupIds.every((id) => selectedVideos.includes(id))
    );
  };

  const handleToggleEventSelection = (group) => {
    const groupIds = getGroupVideoIds(group);
    if (groupIds.length === 0) return;

    const allSelected = groupIds.every((id) => selectedVideos.includes(id));

    if (allSelected) {
      setSelectedVideos((prev) => prev.filter((id) => !groupIds.includes(id)));
      return;
    }

    setSelectedVideos((prev) => Array.from(new Set([...prev, ...groupIds])));
  };

  const handleDelete = (videoId) => {
    axiosInstance
      .delete(`/admin/videos/${videoId}`)
      .then(() => {
        setVideos((prev) => prev.filter((video) => video._id !== videoId));
        setSelectedVideos((prev) => prev.filter((id) => id !== videoId));
        setMessage('Video je uspjeÅ¡no obrisan.');
        setErrorMessage('');
      })
      .catch((err) => {
        console.error('Error deleting video:', err);
        setErrorMessage('GreÅ¡ka pri brisanju videa.');
      });
  };

  const handleBulkDelete = () => {
    Promise.all(selectedVideos.map((id) => axiosInstance.delete(`/admin/videos/${id}`)))
      .then(() => {
        setVideos((prev) => prev.filter((video) => !selectedVideos.includes(video._id)));
        setSelectedVideos([]);
        setMessage('Odabrani video materijali su obrisani.');
        setErrorMessage('');
        setConfirmOpen(false);
      })
      .catch((err) => {
        console.error('Error deleting videos:', err);
        setErrorMessage('GreÅ¡ka pri brisanju odabranih videa.');
      });
  };

  const handleDownloadSingle = (video) => {
    startDownload({
      kind: 'video-single',
      payload: { videoId: video._id },
      label: video.originalFilename || video.filename || `Video ${video._id}`,
    })
      .catch((error) => {
        console.error('Error downloading video:', error);
        setErrorMessage(error.response?.data?.message || 'Greska pri skidanju videa.');
      });
  };

  const handleDownloadSelected = () => {
    startDownload({
      kind: 'video-bulk',
      payload: { videoIds: selectedVideos },
      label: `Admin video ZIP (${selectedVideos.length})`,
    })
      .catch((error) => {
        console.error('Error downloading selected videos:', error);
        setErrorMessage(error.response?.data?.message || 'Greska pri skidanju odabranih videa.');
      });
  };

  const fetchRawOrphans = () => {
    axiosInstance
      .get('/admin/raw-orphans')
      .then((response) => {
        setRawOrphanCount(Number(response.data?.count) || 0);
      })
      .catch((err) => {
        console.error('Error scanning raw orphan files:', err);
      });
  };

  const handleRebuildSelected = () => {
    setMessage('');
    setErrorMessage('');
    axiosInstance
      .post('/admin/media-previews/rebuild', {
        scope: 'selected',
        videoIds: selectedVideos,
        assetTypes: ['mp4', 'hls', 'thumbnail', 'scrub'],
        limit: Math.min(selectedVideos.length, 50),
      })
      .then((response) => {
        setMessage(response.data?.message || 'Odabrani previewi su poslani u rebuild.');
        setRebuildOpen(false);
      })
      .catch((error) => {
        setErrorMessage(error.response?.data?.message || 'Preview rebuild nije moguće pokrenuti.');
      });
  };

  const fetchUsers = () => {
    axiosInstance
      .get('/admin/users')
      .then((response) => {
        const data = Array.isArray(response.data) ? response.data : [];
        setUsers(data);
      })
      .catch((err) => {
        console.error('Error fetching users:', err);
      });
  };

  const fetchContentTypes = () => {
    axiosInstance
      .get('/admin/broadcast-content-types')
      .then((response) => {
        setContentTypes(Array.isArray(response.data) ? response.data : []);
      })
      .catch((err) => {
        console.error('Error fetching content types:', err);
      });
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
        setErrorMessage(error.response?.data?.message || 'Greska pri ponovnom pokretanju obrade.');
      });
  };

  const handleRecoverRawOrphans = () => {
    setRecoveringRaw(true);
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .post('/admin/raw-orphans/import', recoveryOwnerId ? { uploaderId: recoveryOwnerId } : {})
      .then((response) => {
        const result = response.data?.result || {};
        const importedCount = result.imported?.length || 0;
        const skippedCount = result.skipped?.length || 0;

        setMessage(
          skippedCount > 0
            ? `Recovered ${importedCount} raw file(s). ${skippedCount} file(s) were skipped.`
            : `Recovered ${importedCount} raw file(s).`
        );
        fetchVideos();
        fetchRawOrphans();
      })
      .catch((error) => {
        console.error('Error recovering raw orphan files:', error);
        setErrorMessage(error.response?.data?.message || 'Raw file recovery failed.');
      })
      .finally(() => setRecoveringRaw(false));
  };

  const handleUpdateOwner = (videoId, uploaderId) => {
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .patch(`/admin/videos/${videoId}/owner`, { uploaderId })
      .then((response) => {
        setVideos((prev) =>
          prev.map((video) => (video._id === videoId ? response.data.video : video))
        );
        setMessage('Video owner updated.');
      })
      .catch((error) => {
        console.error('Error updating video owner:', error);
        setErrorMessage(error.response?.data?.message || 'Video owner could not be updated.');
      });
  };

  const handleUpdateContentType = (videoId, contentTypeId) => {
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .patch(`/admin/videos/${videoId}/content-type`, { contentTypeId })
      .then((response) => {
        setVideos((prev) =>
          prev.map((video) => (video._id === videoId ? response.data.video : video))
        );
        setMessage('Video category updated.');
      })
      .catch((error) => {
        console.error('Error updating video category:', error);
        setErrorMessage(error.response?.data?.message || 'Video category could not be updated.');
      });
  };

  const renderVideoCard = (video) => {
    const selected = selectedVideos.includes(video._id);
    const workflowStage = getWorkflowStage(video);
    const currentContentTypeId = getContentTypeId(video);
    const currentContentType = contentTypeById.get(currentContentTypeId);
    const categoryOptions = activeContentTypes.some((type) => type._id === currentContentTypeId) || !currentContentType
      ? activeContentTypes
      : [currentContentType, ...activeContentTypes];

    return (
      <Grid item xs={12} md={6} xl={4} key={video._id}>
        <Card
          variant="outlined"
          sx={{
            borderRadius: 2,
            overflow: 'hidden',
            height: '100%',
            borderColor: selected ? 'primary.main' : 'divider',
            boxShadow: selected ? 2 : 0,
          }}
        >
          <Box sx={{ position: 'relative' }}>
            <VideoThumbnail
              videoId={video._id}
              title={video.originalFilename || video.filename}
            />
            <Checkbox
              checked={selected}
              onChange={() => handleSelectVideo(video._id)}
              sx={{
                position: 'absolute',
                top: 8,
                left: 8,
                bgcolor: 'background.paper',
                borderRadius: 1,
              }}
            />
          </Box>

          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>
              {video.originalFilename || video.filename}
            </Typography>

            <Typography variant="body2" color="text.secondary" noWrap>
              {[video.location, formatDate(video.tagDate || video.uploadDate)].filter(Boolean).join(' / ')}
            </Typography>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              <Chip label={workflowStage.label} size="small" color={workflowStage.color} />
              <Chip label={`Category: ${getContentTypeName(video)}`} size="small" variant="outlined" />
              {video.correctionStatus === 'needs_correction' && (
                <Chip label="Potrebna ispravka" size="small" color="error" />
              )}
              {video.broadcastStatus && (
                <Chip label={`Broadcast: ${video.broadcastStatus}`} size="small" variant="outlined" />
              )}
              <Chip
                label={video.processingStatus || 'N/A'}
                size="small"
                color={
                  video.processingStatus === 'completed'
                    ? 'success'
                    : video.processingStatus === 'failed'
                      ? 'error'
                      : shouldShowProcessingProgress(video)
                        ? 'warning'
                        : 'default'
                }
              />
              {video.previewPath && <Chip label="Preview" size="small" color="primary" />}
              {video.thumbnailPath && <Chip label="Thumb" size="small" />}
            </Stack>

            {shouldShowProcessingProgress(video) && (
              <Box sx={{ mt: 1.5 }}>
                <LinearProgress
                  variant="determinate"
                  value={Number(video.processingProgress) || 0}
                />
                <Typography variant="caption" color="text.secondary">
                  Processing: {Number(video.processingProgress) || 0}%
                </Typography>
              </Box>
            )}

            {video.processingStatus === 'failed' && video.processingError && (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
                {video.processingError}
              </Typography>
            )}

            <Divider sx={{ my: 2 }} />

            <Grid container spacing={1}>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">Uploader</Typography>
                <Typography variant="body2" noWrap>{getUploaderName(video)}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">Reporter / Editor</Typography>
                <Typography variant="body2" noWrap>
                  {getPersonName(video.reporter)} / {getPersonName(video.editor)}
                </Typography>
              </Grid>
              <Grid item xs={12}>
                <FormControl fullWidth size="small">
                  <InputLabel>Owner</InputLabel>
                  <Select
                    value={video.uploader?._id || ''}
                    label="Owner"
                    onChange={(event) => handleUpdateOwner(video._id, event.target.value)}
                  >
                    {users.map((appUser) => (
                      <MenuItem key={appUser._id} value={appUser._id}>
                        {appUser.username} / {appUser.role}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <FormControl fullWidth size="small">
                  <InputLabel>Video category</InputLabel>
                  <Select
                    value={currentContentTypeId}
                    label="Video category"
                    onChange={(event) => handleUpdateContentType(video._id, event.target.value)}
                  >
                    <MenuItem value="" disabled>
                      Uncategorized
                    </MenuItem>
                    {categoryOptions.map((type) => (
                      <MenuItem key={type._id} value={type._id} disabled={type.active === false}>
                        {type.name}{type.active === false ? ' (inactive)' : ''}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">Master</Typography>
                <Typography variant="body2">{formatBytes(video.sizeCompressed)}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">Preview</Typography>
                <Typography variant="body2">{formatBytes(video.sizePreview)}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">Codec</Typography>
                <Typography variant="body2" noWrap>{video.codec || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">Resolution</Typography>
                <Typography variant="body2">{video.resolution || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="caption" color="text.secondary">Raw retention</Typography>
                <Typography variant="body2">
                  {video.rawRetentionDays || 0} days / Raw deleted: {video.rawDeleted ? 'Yes' : 'No'}
                </Typography>
                {video.rawExpiresAt && (
                  <Typography variant="caption" color="text.secondary">
                    Expires: {formatDateTime(video.rawExpiresAt)}
                  </Typography>
                )}
              </Grid>
            </Grid>
          </CardContent>

          <CardActions sx={{ px: 2, pb: 2 }}>
            <Button
              size="small"
              variant="contained"
              href={`/video-details/${video._id}`}
            >
              Preview
            </Button>
            <Button size="small" variant="outlined" onClick={() => handleDownloadSingle(video)}>
              Download
            </Button>
            {video.processingStatus === 'failed' && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<ReplayIcon />}
                onClick={() => handleRetryProcessing(video)}
              >
                Retry
              </Button>
            )}
            <Button size="small" color="error" onClick={() => handleDelete(video._id)}>
              Delete
            </Button>
          </CardActions>
        </Card>
      </Grid>
    );
  };

  const allFilteredSelected =
    filteredVideos.length > 0 &&
    filteredVideos.every((video) => selectedVideos.includes(video._id));

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Video Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Paginirani pregled sirovine, smontiranog materijala, arhive, kategorija i storage stanja.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Ucitano {filteredVideos.length} od {workspaceMeta.total} rezultata.
          </Typography>
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Recovery owner</InputLabel>
            <Select
              value={recoveryOwnerId}
              label="Recovery owner"
              onChange={(event) => setRecoveryOwnerId(event.target.value)}
            >
              <MenuItem value="">Auto / current admin</MenuItem>
              {users.map((appUser) => (
                <MenuItem key={appUser._id} value={appUser._id}>
                  {appUser.username} / {appUser.role}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button variant="outlined" onClick={fetchRawOrphans}>
            Scan Raw
          </Button>
          <Button
            variant="contained"
            color={rawOrphanCount > 0 ? 'warning' : 'primary'}
            onClick={handleRecoverRawOrphans}
            disabled={recoveringRaw || rawOrphanCount === 0}
          >
            {recoveringRaw ? 'Recovering...' : `Recover Raw (${rawOrphanCount})`}
          </Button>
          <Button variant="outlined" onClick={fetchVideos}>
            Refresh
          </Button>
        </Stack>
      </Stack>

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}
      {videosLoading && <LinearProgress sx={{ mb: 2 }} />}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={2}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Typography variant="overline" color="text.secondary">Total</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.total}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={2}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Typography variant="overline" color="text.secondary">Sirovina</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.raw}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={2}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Typography variant="overline" color="text.secondary">Smontirano</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.edited}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={2}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Typography variant="overline" color="text.secondary">Arhiva</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.archive}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={2}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Typography variant="overline" color="text.secondary">Bez kategorije</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats.uncategorized}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} md={2}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Typography variant="overline" color="text.secondary">Processing / failed</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              {stats.processing} / {stats.failed}
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={3}>
            <TextField
              label="Search videos"
              fullWidth
              value={searchTerm}
              onChange={(e) => {
                setWorkspacePage(1);
                setSearchTerm(e.target.value);
              }}
              placeholder="Filename, event, location, uploader..."
            />
          </Grid>

          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Workflow</InputLabel>
              <Select
                value={workflowFilter}
                label="Workflow"
                onChange={(e) => {
                  setWorkspacePage(1);
                  setWorkflowFilter(e.target.value);
                }}
              >
                <MenuItem value="all">All workflow</MenuItem>
                <MenuItem value="raw">Sirovina / ingest</MenuItem>
                <MenuItem value="edited">Smontiran materijal</MenuItem>
                <MenuItem value="final">Smontiran final</MenuItem>
                <MenuItem value="archive">Arhiva / aired</MenuItem>
                <MenuItem value="uncategorized">Bez kategorije</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Processing</InputLabel>
              <Select
                value={statusFilter}
                label="Processing"
                onChange={(e) => {
                  setWorkspacePage(1);
                  setStatusFilter(e.target.value);
                }}
              >
                <MenuItem value="all">All processing</MenuItem>
                <MenuItem value="uploaded">Uploaded</MenuItem>
                <MenuItem value="queued">Queued</MenuItem>
                <MenuItem value="completed">Completed</MenuItem>
                <MenuItem value="processing">Processing</MenuItem>
                <MenuItem value="failed">Failed</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select
                value={categoryFilter}
                label="Category"
                onChange={(e) => {
                  setWorkspacePage(1);
                  setCategoryFilter(e.target.value);
                }}
              >
                <MenuItem value="all">All categories</MenuItem>
                <MenuItem value="uncategorized">Uncategorized</MenuItem>
                {contentTypes.map((type) => (
                  <MenuItem key={type._id} value={type._id}>
                    {type.name}{type.active === false ? ' (inactive)' : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Uploader</InputLabel>
              <Select
                value={uploaderFilter}
                label="Uploader"
                onChange={(e) => {
                  setWorkspacePage(1);
                  setUploaderFilter(e.target.value);
                }}
              >
                <MenuItem value="all">All uploaders</MenuItem>
                {uploaderOptions.map((uploader) => (
                  <MenuItem key={uploader} value={uploader}>{uploader}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={1}>
            <Button
              fullWidth
              variant="outlined"
              startIcon={allFilteredSelected ? <DeselectIcon /> : <SelectAllIcon />}
              onClick={handleSelectAllFiltered}
              disabled={filteredVideos.length === 0}
            >
              {allFilteredSelected ? 'Clear' : 'Select'}
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {selectedVideos.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 3 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
            <Typography sx={{ fontWeight: 700 }}>
              Selected: {selectedVideos.length}
            </Typography>
            <Button variant="contained" onClick={handleDownloadSelected}>
              Download Selected
            </Button>
            <Button
              variant="outlined"
              startIcon={<ReplayIcon />}
              onClick={() => setRebuildOpen(true)}
            >
              Rebuild previewa
            </Button>
            <Button
              variant="outlined"
              startIcon={<DeselectIcon />}
              onClick={handleClearSelection}
            >
              Clear selection
            </Button>
            <Button variant="outlined" color="error" onClick={() => setConfirmOpen(true)}>
              Delete Selected
            </Button>
          </Stack>
        </Paper>
      )}

      {filteredVideos.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, textAlign: 'center' }}>
          <Typography variant="h6">No videos found</Typography>
          <Typography variant="body2" color="text.secondary">
            Nema video materijala koji odgovaraju trenutnom filteru.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1.5}>
          {eventGroups.map((group) => (
            <Accordion
              key={group.event}
              expanded={Boolean(expandedEvents[group.event])}
              onChange={handleToggleEvent(group.event)}
              disableGutters
              variant="outlined"
              sx={{
                borderRadius: 2,
                overflow: 'hidden',
                '&:before': { display: 'none' },
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                sx={{
                  minHeight: 68,
                  bgcolor: 'background.paper',
                  '& .MuiAccordionSummary-content': {
                    my: 1,
                    minWidth: 0,
                  },
                }}
              >
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={1.5}
                  justifyContent="space-between"
                  alignItems={{ xs: 'flex-start', md: 'center' }}
                  sx={{ width: '100%', minWidth: 0, pr: 1 }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                    <Checkbox
                      checked={isGroupFullySelected(group)}
                      indeterminate={isGroupPartiallySelected(group)}
                      onClick={(event) => event.stopPropagation()}
                      onFocus={(event) => event.stopPropagation()}
                      onChange={() => handleToggleEventSelection(group)}
                      inputProps={{ 'aria-label': `Select ${group.event}` }}
                      sx={{
                        bgcolor: 'background.paper',
                        borderRadius: 1,
                        p: 0.75,
                      }}
                    />
                    <EventIcon color="action" />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 800 }} noWrap>
                        {group.event}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Latest: {group.latestTimestamp ? formatDate(group.latestTimestamp) : 'N/A'}
                      </Typography>
                    </Box>
                  </Stack>

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip label={`${group.videos.length} clips`} size="small" />
                    <Chip label={`${group.completed} completed`} size="small" color="success" variant="outlined" />
                    {group.processing > 0 && (
                      <Chip label={`${group.processing} processing`} size="small" color="warning" variant="outlined" />
                    )}
                    {group.failed > 0 && (
                      <Chip label={`${group.failed} failed`} size="small" color="error" variant="outlined" />
                    )}
                    <Chip label={`${group.raw} sirovina`} size="small" color="warning" variant="outlined" />
                    <Chip label={`${group.edited} smontirano`} size="small" color="primary" variant="outlined" />
                    <Chip label={`${group.final} final`} size="small" color="success" variant="outlined" />
                    <Chip label={`${group.archive} archive`} size="small" color="info" variant="outlined" />
                    {group.uncategorized > 0 && (
                      <Chip label={`${group.uncategorized} bez kategorije`} size="small" color="default" variant="outlined" />
                    )}
                  </Stack>
                </Stack>
              </AccordionSummary>

              <AccordionDetails sx={{ p: 2, pt: 0 }}>
                <Grid container spacing={2.5}>
                  {group.videos.map(renderVideoCard)}
                </Grid>
              </AccordionDetails>
            </Accordion>
          ))}
        </Stack>
      )}

      {workspaceMeta.totalPages > 1 && (
        <Stack alignItems="center" sx={{ mt: 3 }}>
          <Pagination
            count={workspaceMeta.totalPages}
            page={workspacePage}
            onChange={(event, value) => setWorkspacePage(value)}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
            Stranica {workspacePage} / {workspaceMeta.totalPages}
          </Typography>
        </Stack>
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Confirm bulk delete</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete {selectedVideos.length} selected video(s)?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleBulkDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={rebuildOpen} onClose={() => setRebuildOpen(false)}>
        <DialogTitle>Rebuild previewa za odabrane klipove</DialogTitle>
        <DialogContent>
          <DialogContentText>
            U background queue poslati MP4, HLS, thumbnail i scrub preview za {selectedVideos.length} odabranih klipova? Maksimalno 50 klipova po batchu.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRebuildOpen(false)}>Odustani</Button>
          <Button variant="contained" onClick={handleRebuildSelected}>Pokreni rebuild</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VideoManagement;
