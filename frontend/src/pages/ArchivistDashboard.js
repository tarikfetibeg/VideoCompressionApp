import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import EditNoteIcon from '@mui/icons-material/EditNote';
import FindReplaceIcon from '@mui/icons-material/FindReplace';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import SaveIcon from '@mui/icons-material/Save';
import axiosInstance from '../axiosConfig';

const reviewOptions = [
  { value: 'unreviewed', label: 'Unreviewed' },
  { value: 'needs_metadata', label: 'Needs metadata' },
  { value: 'duplicate', label: 'Marked duplicate' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'all', label: 'All review states' },
];

const workflowOptions = [
  { value: 'all', label: 'All final material' },
  { value: 'archive', label: 'Archive-ready' },
  { value: 'edited', label: 'Edited / not aired' },
  { value: 'aired', label: 'Aired / archived' },
  { value: 'needs_correction', label: 'Needs correction' },
];

const sortOptions = [
  { value: 'uploadDate', label: 'Upload date' },
  { value: 'name', label: 'Name' },
  { value: 'category', label: 'Category' },
  { value: 'tags', label: 'Tags' },
  { value: 'reporter', label: 'Reporter' },
  { value: 'editor', label: 'Editor' },
];

const reviewTone = {
  unreviewed: { color: 'warning', label: 'Unreviewed' },
  reviewed: { color: 'success', label: 'Reviewed' },
  needs_metadata: { color: 'info', label: 'Needs metadata' },
  duplicate: { color: 'error', label: 'Duplicate' },
};

const workflowTone = {
  raw: { label: 'Raw', color: 'warning' },
  edited: { label: 'Edited', color: 'primary' },
  archive: { label: 'Archive', color: 'success' },
};

const formatLabel = (value) => String(value || 'N/A').replace(/_/g, ' ');

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString();
};

const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return 'N/A';
  const value = Number(bytes);
  if (Number.isNaN(value)) return 'N/A';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const getVideoTitle = (video) =>
  video?.finalTitle || video?.originalFilename || video?.filename || 'Untitled';

const getPersonName = (person) => person?.username || 'N/A';

const getReviewChip = (video) => {
  const status = video?.archiveReviewStatus || 'unreviewed';
  return reviewTone[status] || reviewTone.unreviewed;
};

const getWorkflowChip = (video) => {
  if (['aired', 'archived'].includes(video?.broadcastStatus)) return workflowTone.archive;
  if (video?.status === 'edited') return workflowTone.edited;
  return workflowTone.raw;
};

const normalizeTags = (value) =>
  String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

const ArchivistDashboard = () => {
  const [activeTab, setActiveTab] = useState('queue');
  const [summary, setSummary] = useState(null);
  const [videos, setVideos] = useState([]);
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [contentTypes, setContentTypes] = useState([]);
  const [reviewFilter, setReviewFilter] = useState('unreviewed');
  const [workflowFilter, setWorkflowFilter] = useState('all');
  const [contentTypeFilter, setContentTypeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('uploadDate');
  const [sortOrder, setSortOrder] = useState('desc');
  const [loading, setLoading] = useState(false);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [tagDialog, setTagDialog] = useState({ open: false, video: null, value: '' });
  const [reviewDialog, setReviewDialog] = useState({ open: false, video: null, status: 'needs_metadata', notes: '' });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, video: null, keeper: null, reason: '' });

  const fetchSummary = useCallback(() => {
    axiosInstance
      .get('/archive/summary')
      .then((response) => setSummary(response.data || {}))
      .catch((error) => {
        console.error('Error loading archive summary:', error);
        setErrorMessage('Archive summary could not be loaded.');
      });
  }, []);

  const fetchVideos = useCallback(() => {
    setLoading(true);
    setErrorMessage('');

    axiosInstance
      .get('/archive/videos', {
        params: {
          review: activeTab === 'queue' ? 'unreviewed' : reviewFilter,
          workflow: workflowFilter,
          contentTypeId: contentTypeFilter,
          q: searchTerm,
          sortBy,
          sortOrder,
          limit: 250,
        },
      })
      .then((response) => setVideos(response.data || []))
      .catch((error) => {
        console.error('Error loading archive videos:', error);
        setErrorMessage('Archive videos could not be loaded.');
      })
      .finally(() => setLoading(false));
  }, [activeTab, contentTypeFilter, reviewFilter, searchTerm, sortBy, sortOrder, workflowFilter]);

  const fetchDuplicates = useCallback(() => {
    setDuplicatesLoading(true);
    setErrorMessage('');

    axiosInstance
      .get('/archive/duplicates')
      .then((response) => setDuplicateGroups(response.data?.groups || []))
      .catch((error) => {
        console.error('Error loading duplicate candidates:', error);
        setErrorMessage('Duplicate candidates could not be loaded.');
      })
      .finally(() => setDuplicatesLoading(false));
  }, []);

  const fetchContentTypes = useCallback(() => {
    axiosInstance
      .get('/broadcast/content-types')
      .then((response) => setContentTypes(response.data || []))
      .catch((error) => {
        console.error('Error loading content types:', error);
      });
  }, []);

  const refreshCurrentView = useCallback(() => {
    fetchSummary();
    if (activeTab === 'duplicates') {
      fetchDuplicates();
    } else {
      fetchVideos();
    }
  }, [activeTab, fetchDuplicates, fetchSummary, fetchVideos]);

  useEffect(() => {
    fetchSummary();
    fetchContentTypes();
  }, [fetchContentTypes, fetchSummary]);

  useEffect(() => {
    if (activeTab === 'duplicates') {
      fetchDuplicates();
    } else {
      fetchVideos();
    }
  }, [activeTab, fetchDuplicates, fetchVideos]);

  const activeContentTypes = useMemo(
    () => contentTypes.filter((type) => type.active !== false),
    [contentTypes]
  );

  const metricCards = [
    { label: 'Unreviewed', value: summary?.unreviewed ?? 0, color: 'warning.main' },
    { label: 'Needs metadata', value: summary?.needsMetadata ?? 0, color: 'info.main' },
    { label: 'Duplicate groups', value: summary?.duplicateCandidateGroups ?? 0, color: 'error.main' },
    { label: 'Archive-ready', value: summary?.archiveReadyVideos ?? 0, color: 'success.main' },
    { label: 'Needs correction', value: summary?.needsCorrection ?? 0, color: 'error.main' },
    { label: 'Total videos', value: summary?.totalVideos ?? 0, color: 'text.primary' },
  ];

  const updateVideoInList = (updatedVideo) => {
    if (!updatedVideo?._id) return;
    setVideos((currentVideos) =>
      currentVideos.map((video) => (video._id === updatedVideo._id ? updatedVideo : video))
    );
  };

  const updateVideoAfterReview = (updatedVideo) => {
    if (!updatedVideo?._id) return;
    setVideos((currentVideos) => {
      if (activeTab === 'queue' && updatedVideo.archiveReviewStatus !== 'unreviewed') {
        return currentVideos.filter((video) => video._id !== updatedVideo._id);
      }

      return currentVideos.map((video) => (video._id === updatedVideo._id ? updatedVideo : video));
    });
  };

  const handleOpenTags = (video) => {
    setTagDialog({
      open: true,
      video,
      value: (video.keywords || []).join(', '),
    });
  };

  const handleSaveTags = () => {
    if (!tagDialog.video) return;
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .patch(`/archive/videos/${tagDialog.video._id}/tags`, {
        replace: normalizeTags(tagDialog.value),
      })
      .then((response) => {
        updateVideoInList(response.data.video);
        setTagDialog({ open: false, video: null, value: '' });
        setMessage('Tags saved.');
        fetchSummary();
      })
      .catch((error) => {
        console.error('Error saving tags:', error);
        setErrorMessage(error.response?.data?.message || 'Tags could not be saved.');
      });
  };

  const handleContentTypeChange = (video, contentTypeId) => {
    if (!contentTypeId) return;
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .patch(`/archive/videos/${video._id}/content-type`, { contentTypeId })
      .then((response) => {
        updateVideoInList(response.data.video);
        setMessage('Category saved.');
        fetchSummary();
      })
      .catch((error) => {
        console.error('Error saving content type:', error);
        setErrorMessage(error.response?.data?.message || 'Category could not be saved.');
      });
  };

  const handleSaveReview = (video, status, notes = '', duplicateOf = null) => {
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .patch(`/archive/videos/${video._id}/review`, { status, notes, duplicateOf })
      .then((response) => {
        updateVideoAfterReview(response.data.video);
        setReviewDialog({ open: false, video: null, status: 'needs_metadata', notes: '' });
        setMessage('Archive review saved.');
        fetchSummary();
      })
      .catch((error) => {
        console.error('Error saving review:', error);
        setErrorMessage(error.response?.data?.message || 'Review could not be saved.');
      });
  };

  const handleDeleteDuplicate = () => {
    if (!deleteDialog.video || !deleteDialog.keeper) return;
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .delete(`/archive/videos/${deleteDialog.video._id}/duplicate`, {
        data: {
          duplicateOf: deleteDialog.keeper._id,
          reason: deleteDialog.reason,
        },
      })
      .then((response) => {
        setDeleteDialog({ open: false, video: null, keeper: null, reason: '' });
        setMessage(`Duplicate removed. Deleted files: ${response.data?.deletedPaths?.length || 0}.`);
        fetchSummary();
        fetchDuplicates();
        fetchVideos();
      })
      .catch((error) => {
        console.error('Error deleting duplicate:', error);
        setErrorMessage(error.response?.data?.message || 'Duplicate could not be deleted.');
      });
  };

  const renderVideoRow = (video) => {
    const reviewChip = getReviewChip(video);
    const workflowChip = getWorkflowChip(video);
    const contentTypeValue = video.contentType?._id || '';

    return (
      <TableRow key={video._id} hover>
        <TableCell sx={{ minWidth: 280 }}>
          <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
            {getVideoTitle(video)}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {video.event || 'No event'} / {formatDateTime(video.tagDate || video.airDate || video.uploadDate)}
          </Typography>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
            <Chip size="small" label={workflowChip.label} color={workflowChip.color} variant="outlined" />
            <Chip size="small" label={reviewChip.label} color={reviewChip.color} />
            {video.correctionStatus === 'needs_correction' && (
              <Chip size="small" label="Potrebna ispravka" color="error" />
            )}
          </Stack>
        </TableCell>
        <TableCell sx={{ minWidth: 180 }}>
          <FormControl fullWidth size="small">
            <InputLabel>Category</InputLabel>
            <Select
              value={contentTypeValue}
              label="Category"
              onChange={(event) => handleContentTypeChange(video, event.target.value)}
            >
              <MenuItem value="" disabled>
                No category
              </MenuItem>
              {activeContentTypes.map((type) => (
                <MenuItem key={type._id} value={type._id}>
                  {type.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </TableCell>
        <TableCell sx={{ minWidth: 220 }}>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {(video.keywords || []).slice(0, 4).map((tag) => (
              <Chip key={tag} size="small" label={tag} variant="outlined" />
            ))}
            {(video.keywords || []).length > 4 && (
              <Chip size="small" label={`+${video.keywords.length - 4}`} variant="outlined" />
            )}
            <Tooltip title="Edit tags">
              <IconButton size="small" onClick={() => handleOpenTags(video)}>
                <LocalOfferIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </TableCell>
        <TableCell sx={{ minWidth: 190 }}>
          <Typography variant="caption" color="text.secondary" component="div">
            Reporter / Editor
          </Typography>
          <Typography variant="body2" noWrap>
            {getPersonName(video.reporter)} / {getPersonName(video.editor)}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            Reviewed: {getPersonName(video.archiveReviewedBy)}
          </Typography>
        </TableCell>
        <TableCell sx={{ minWidth: 150 }}>
          <Typography variant="body2">{formatLabel(video.processingStatus)}</Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {formatBytes(video.sizeCompressed || video.sizeOriginal || video.sizePreview)}
          </Typography>
        </TableCell>
        <TableCell align="right" sx={{ minWidth: 240 }}>
          <Stack direction="row" justifyContent="flex-end" spacing={0.75} flexWrap="wrap" useFlexGap>
            <Tooltip title="Open details">
              <IconButton size="small" component={Link} to={`/video-details/${video._id}`}>
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Button
              size="small"
              variant="outlined"
              startIcon={<DoneAllIcon />}
              onClick={() => handleSaveReview(video, 'reviewed', video.archiveReviewNotes || '')}
            >
              Reviewed
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="info"
              startIcon={<EditNoteIcon />}
              onClick={() => setReviewDialog({ open: true, video, status: 'needs_metadata', notes: video.archiveReviewNotes || '' })}
            >
              Needs metadata
            </Button>
          </Stack>
        </TableCell>
      </TableRow>
    );
  };

  const renderVideoTable = () => (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      {loading && <LinearProgress />}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Material</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Tags</TableCell>
              <TableCell>People</TableCell>
              <TableCell>Technical</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {videos.map(renderVideoRow)}
            {!loading && videos.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 3 }}>
                    No videos found.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );

  const renderFilters = () => (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ md: 'center' }}>
        {activeTab !== 'queue' && (
          <FormControl size="small" sx={{ minWidth: 170 }}>
            <InputLabel>Review</InputLabel>
            <Select value={reviewFilter} label="Review" onChange={(event) => setReviewFilter(event.target.value)}>
              {reviewOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        <FormControl size="small" sx={{ minWidth: 170 }}>
          <InputLabel>Workflow</InputLabel>
          <Select value={workflowFilter} label="Workflow" onChange={(event) => setWorkflowFilter(event.target.value)}>
            {workflowOptions.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 170 }}>
          <InputLabel>Category</InputLabel>
          <Select
            value={contentTypeFilter}
            label="Category"
            onChange={(event) => setContentTypeFilter(event.target.value)}
          >
            <MenuItem value="all">All categories</MenuItem>
            {activeContentTypes.map((type) => (
              <MenuItem key={type._id} value={type._id}>
                {type.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          size="small"
          label="Search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          sx={{ minWidth: { xs: '100%', md: 260 }, flexGrow: 1 }}
        />
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Sort by</InputLabel>
          <Select value={sortBy} label="Sort by" onChange={(event) => setSortBy(event.target.value)}>
            {sortOptions.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>Order</InputLabel>
          <Select value={sortOrder} label="Order" onChange={(event) => setSortOrder(event.target.value)}>
            <MenuItem value="asc">A-Z / oldest</MenuItem>
            <MenuItem value="desc">Z-A / newest</MenuItem>
          </Select>
        </FormControl>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refreshCurrentView}>
          Refresh
        </Button>
      </Stack>
    </Paper>
  );

  const renderDuplicates = () => (
    <Stack spacing={2}>
      {duplicatesLoading && <LinearProgress />}
      {duplicateGroups.map((group, groupIndex) => {
        const keeper = group.videos[0];
        return (
          <Paper key={group.key} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', md: 'center' }}
              spacing={1}
              sx={{ mb: 1.5 }}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>
                  Candidate group {groupIndex + 1}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {group.count} videos / {formatBytes(group.totalSize)}
                </Typography>
              </Box>
              <Chip label={`Keeper: ${getVideoTitle(keeper)}`} color="success" variant="outlined" />
            </Stack>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Material</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Uploaded</TableCell>
                    <TableCell>Size</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {group.videos.map((video) => {
                    const isKeeper = video._id === keeper._id;
                    return (
                      <TableRow key={video._id} hover>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                            {getVideoTitle(video)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap component="div">
                            {video.filename || video.originalFilename || 'N/A'}
                          </Typography>
                        </TableCell>
                        <TableCell>{video.contentType?.name || video.finalCategory || 'N/A'}</TableCell>
                        <TableCell>{formatDateTime(video.uploadDate)}</TableCell>
                        <TableCell>{formatBytes(video.sizeCompressed || video.sizeOriginal || video.sizePreview)}</TableCell>
                        <TableCell align="right">
                          <Stack direction="row" justifyContent="flex-end" spacing={0.75}>
                            <Tooltip title="Open details">
                              <IconButton size="small" component={Link} to={`/video-details/${video._id}`}>
                                <OpenInNewIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              disabled={isKeeper}
                              startIcon={<DeleteOutlineIcon />}
                              onClick={() => setDeleteDialog({ open: true, video, keeper, reason: '' })}
                            >
                              Delete duplicate
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        );
      })}
      {!duplicatesLoading && duplicateGroups.length === 0 && (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
          <Typography variant="body2" color="text.secondary" align="center">
            No duplicate candidates found.
          </Typography>
        </Paper>
      )}
    </Stack>
  );

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 900 }}>
            Archive Desk
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Review, metadata, categories and duplicate cleanup.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refreshCurrentView}>
          Refresh
        </Button>
      </Stack>

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {metricCards.map((card) => (
          <Grid item xs={6} md={4} lg={2} key={card.label}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, height: '100%' }}>
              <Typography variant="caption" color="text.secondary" noWrap>
                {card.label}
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 900, color: card.color }}>
                {card.value}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Paper variant="outlined" sx={{ borderRadius: 2, mb: 2 }}>
        <Tabs
          value={activeTab}
          onChange={(event, value) => setActiveTab(value)}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab value="queue" icon={<ReportProblemIcon />} iconPosition="start" label="Review Queue" />
          <Tab value="all" icon={<FindReplaceIcon />} iconPosition="start" label="All Videos" />
          <Tab value="duplicates" icon={<DeleteOutlineIcon />} iconPosition="start" label="Duplicates" />
        </Tabs>
      </Paper>

      {activeTab !== 'duplicates' && (
        <>
          {renderFilters()}
          {renderVideoTable()}
        </>
      )}

      {activeTab === 'duplicates' && (
        <>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>
                  Duplicate candidates
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Matches are based on comparable title, duration and stored size.
                </Typography>
              </Box>
              <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchDuplicates}>
                Rescan
              </Button>
            </Stack>
          </Paper>
          {renderDuplicates()}
        </>
      )}

      <Dialog open={tagDialog.open} onClose={() => setTagDialog({ open: false, video: null, value: '' })} fullWidth maxWidth="sm">
        <DialogTitle>Edit tags</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ fontWeight: 800, mb: 1 }}>
            {getVideoTitle(tagDialog.video)}
          </Typography>
          <TextField
            autoFocus
            label="Tags"
            value={tagDialog.value}
            onChange={(event) => setTagDialog((state) => ({ ...state, value: event.target.value }))}
            fullWidth
            multiline
            minRows={3}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTagDialog({ open: false, video: null, value: '' })}>Cancel</Button>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSaveTags}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={reviewDialog.open}
        onClose={() => setReviewDialog({ open: false, video: null, status: 'needs_metadata', notes: '' })}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Archive review</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ fontWeight: 800, mb: 1 }}>
            {getVideoTitle(reviewDialog.video)}
          </Typography>
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>Status</InputLabel>
            <Select
              value={reviewDialog.status}
              label="Status"
              onChange={(event) => setReviewDialog((state) => ({ ...state, status: event.target.value }))}
            >
              <MenuItem value="needs_metadata">Needs metadata</MenuItem>
              <MenuItem value="duplicate">Duplicate</MenuItem>
              <MenuItem value="reviewed">Reviewed</MenuItem>
              <MenuItem value="unreviewed">Unreviewed</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Notes"
            value={reviewDialog.notes}
            onChange={(event) => setReviewDialog((state) => ({ ...state, notes: event.target.value }))}
            fullWidth
            multiline
            minRows={3}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReviewDialog({ open: false, video: null, status: 'needs_metadata', notes: '' })}>
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={() => handleSaveReview(reviewDialog.video, reviewDialog.status, reviewDialog.notes)}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteDialog.open}
        onClose={() => setDeleteDialog({ open: false, video: null, keeper: null, reason: '' })}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Delete duplicate</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This removes the duplicate database record and deletes files only when no other video references them.
          </Alert>
          <Typography variant="body2">
            Duplicate: <strong>{getVideoTitle(deleteDialog.video)}</strong>
          </Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Keeper: <strong>{getVideoTitle(deleteDialog.keeper)}</strong>
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <TextField
            label="Reason"
            value={deleteDialog.reason}
            onChange={(event) => setDeleteDialog((state) => ({ ...state, reason: event.target.value }))}
            fullWidth
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog({ open: false, video: null, keeper: null, reason: '' })}>Cancel</Button>
          <Button color="error" variant="contained" startIcon={<DeleteOutlineIcon />} onClick={handleDeleteDuplicate}>
            Delete duplicate
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ArchivistDashboard;
