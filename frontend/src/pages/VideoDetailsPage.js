import React, { useCallback, useContext, useEffect, useState } from 'react';
import VideoPlayer from '../components/VideoPlayer';
import EditJobComposer from '../components/jobs/EditJobComposer';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Button,
  Box,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import EditNoteIcon from '@mui/icons-material/EditNote';
import ReplayIcon from '@mui/icons-material/Replay';
import SaveIcon from '@mui/icons-material/Save';
import axios from '../axiosConfig';
import { UserContext } from '../contexts/UserContext';
import {
  ACTIVE_PROCESSING_REFRESH_MS,
  isVideoProcessingActive,
} from '../utils/videoProcessing';

const formatDate = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString();
};

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

const formatDuration = (seconds) => {
  if (!seconds && seconds !== 0) return 'N/A';
  const totalSeconds = Math.round(Number(seconds) || 0);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const formatLabel = (value) => String(value || 'N/A').replace(/_/g, ' ');
const getPersonName = (person) => person?.username || 'N/A';
const getTitle = (video) => video?.finalTitle || video?.originalFilename || video?.filename || 'Video details';
const getId = (value) => value?._id || value || '';

const formatDateInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const normalizeTags = (value) =>
  String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

const findOptionById = (options, id) =>
  (options || []).find((option) => String(option._id) === String(id || '')) || null;

const getUserLabel = (option) =>
  option ? `${option.username || 'Unknown'} / ${option.role || 'Role'}` : '';

const getWorkflowStage = (video) => {
  if (!video) return { label: 'Loading', color: 'default' };
  if (['aired', 'archived'].includes(video.broadcastStatus)) return { label: 'Archive / aired', color: 'info' };
  if (
    video.processingMode === 'finalize' ||
    video.finalApprovalStatus === 'approved' ||
    video.contentType
  ) {
    return { label: 'Edited final', color: 'success' };
  }
  if (video.status === 'edited') return { label: 'Edited material', color: 'primary' };
  return { label: 'Raw ingest', color: 'warning' };
};

const getProcessingColor = (status) => {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (['queued', 'processing'].includes(status)) return 'warning';
  return 'default';
};

const DetailRow = ({ label, value }) => (
  <Grid item xs={12} sm={6}>
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="body2" sx={{ fontWeight: 650 }} noWrap>
      {value || 'N/A'}
    </Typography>
  </Grid>
);

const VideoDetailsPage = () => {
  const { videoId } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useContext(UserContext);
  const [videoData, setVideoData] = useState(null);
  const [timecodes, setTimecodes] = useState([]);
  const [qcStatus, setQcStatus] = useState('pending');
  const [qcNotes, setQcNotes] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [metadataOptions, setMetadataOptions] = useState({
    programs: [],
    contentTypes: [],
    reporters: [],
    editors: [],
    events: [],
  });
  const [metadataOptionsLoaded, setMetadataOptionsLoaded] = useState(false);
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataForm, setMetadataForm] = useState({
    finalTitle: '',
    event: '',
    tagDate: '',
    programId: '',
    contentTypeId: '',
    reporterId: '',
    editorId: '',
    keywords: '',
    archiveReviewNotes: '',
  });

  const fetchVideoData = useCallback(() => {
    axios.get(`/videos/details/${videoId}`)
      .then(response => {
        setVideoData(response.data);
        setQcStatus(response.data.qcStatus || 'pending');
        setQcNotes(response.data.qcNotes || '');
      })
      .catch(error => {
        console.error('Error fetching video details:', error);
      });
  }, [videoId]);

  useEffect(() => {
    fetchVideoData();
  }, [fetchVideoData]);

  useEffect(() => {
    if (!isVideoProcessingActive(videoData)) return undefined;

    const intervalId = window.setInterval(fetchVideoData, ACTIVE_PROCESSING_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [fetchVideoData, videoData]);

  const fetchMetadataOptions = useCallback(() => {
    axios
      .get('/archive/metadata-options')
      .then((response) => {
        setMetadataOptions({
          programs: response.data?.programs || [],
          contentTypes: response.data?.contentTypes || [],
          reporters: response.data?.reporters || [],
          editors: response.data?.editors || [],
          events: response.data?.events || [],
        });
        setMetadataOptionsLoaded(true);
      })
      .catch((error) => {
        console.error('Error fetching archive metadata options:', error);
        setActionError(error.response?.data?.message || 'Archive metadata options could not be loaded.');
      });
  }, []);

  const handleDownload = () => {
    axios
      .get(`/videos/download/${videoId}`, {
        responseType: 'blob',
      })
      .then((response) => {
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `video_${videoId}.mp4`);
        document.body.appendChild(link);
        link.click();
        link.parentNode.removeChild(link);
      })
      .catch((error) => {
        console.error('Error downloading video:', error);
      });
  };

  const canUpdateQc = ['Editor', 'VideoEditor', 'Producer', 'Admin'].includes(user?.role);
  const canUpdateBroadcastStatus = ['Producer', 'Admin'].includes(user?.role);
  const ownerId = videoData?.uploader?._id || videoData?.uploader;
  const isOwner = ownerId && user?.id && String(ownerId) === String(user.id);
  const canManageVideo =
    user?.role === 'Admin'
    || ['Editor', 'VideoEditor', 'Producer'].includes(user?.role)
    || (user?.role === 'Reporter' && isOwner);
  const canDownloadVideo =
    user?.role === 'Admin'
    || ['Editor', 'VideoEditor', 'Producer', 'Archivist'].includes(user?.role)
    || (user?.role === 'Reporter' && isOwner);
  const canEditArchiveMetadata = ['Archivist', 'Admin'].includes(user?.role);

  const openMetadataDialog = () => {
    if (!videoData) return;
    if (!metadataOptionsLoaded) fetchMetadataOptions();

    setMetadataForm({
      finalTitle: videoData.finalTitle || '',
      event: videoData.event || '',
      tagDate: formatDateInput(videoData.tagDate || videoData.airDate || videoData.uploadDate),
      programId: getId(videoData.program),
      contentTypeId: getId(videoData.contentType),
      reporterId: getId(videoData.reporter),
      editorId: getId(videoData.editor),
      keywords: (videoData.keywords || []).join(', '),
      archiveReviewNotes: videoData.archiveReviewNotes || '',
    });
    setMetadataDialogOpen(true);
  };

  const handleMetadataFieldChange = (field, value) => {
    setMetadataForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleSaveQc = () => {
    setActionMessage('');
    setActionError('');

    axios
      .patch(`/videos/${videoId}/qc`, {
        qcStatus,
        qcNotes,
      })
      .then((response) => {
        setVideoData(response.data.video);
        setActionMessage('QC status saved.');
      })
      .catch((error) => {
        console.error('Error saving QC status:', error);
        setActionError(error.response?.data?.message || 'Error saving QC status.');
      });
  };

  const handleBroadcastStatus = (broadcastStatus) => {
    setActionMessage('');
    setActionError('');

    axios
      .patch(`/videos/${videoId}/broadcast-status`, {
        broadcastStatus,
      })
      .then((response) => {
        setVideoData(response.data.video);
        setActionMessage('Broadcast status updated.');
      })
      .catch((error) => {
        console.error('Error updating broadcast status:', error);
        setActionError(error.response?.data?.message || 'Error updating broadcast status.');
      });
  };

  const handleRetryProcessing = () => {
    setActionMessage('');
    setActionError('');

    axios
      .post(`/videos/${videoId}/requeue-processing`)
      .then((response) => {
        setVideoData(response.data.video);
        setActionMessage(response.data?.message || 'Video processing has been queued again.');
      })
      .catch((error) => {
        console.error('Error retrying video processing:', error);
        setActionError(error.response?.data?.message || 'Video processing could not be retried.');
      });
  };

  const handleSaveMetadata = () => {
    setActionMessage('');
    setActionError('');
    setMetadataSaving(true);

    axios
      .patch(`/archive/videos/${videoId}/metadata`, {
        finalTitle: metadataForm.finalTitle,
        event: metadataForm.event,
        tagDate: metadataForm.tagDate,
        programId: metadataForm.programId || null,
        contentTypeId: metadataForm.contentTypeId || null,
        reporterId: metadataForm.reporterId || null,
        editorId: metadataForm.editorId || null,
        keywords: normalizeTags(metadataForm.keywords),
        archiveReviewNotes: metadataForm.archiveReviewNotes,
      })
      .then((response) => {
        setVideoData(response.data.video);
        setMetadataDialogOpen(false);
        setActionMessage(response.data?.message || 'Archive metadata saved.');
      })
      .catch((error) => {
        console.error('Error saving archive metadata:', error);
        setActionError(error.response?.data?.message || 'Archive metadata could not be saved.');
      })
      .finally(() => setMetadataSaving(false));
  };

  const sourceSummary = videoData && [
    videoData.sourceFormat,
    videoData.sourceCodec,
    videoData.sourceResolution,
    videoData.sourceFramerate ? `${videoData.sourceFramerate} fps` : null,
    videoData.sourceAudioChannels ? `${videoData.sourceAudioChannels} audio ch` : null,
  ].filter(Boolean).join(' / ');

  const workflowStage = getWorkflowStage(videoData);
  const mediaSummary = videoData && [
    videoData.codec,
    videoData.resolution,
    videoData.framerate ? `${videoData.framerate} fps` : null,
    videoData.bitrate ? `${videoData.bitrate} kbps` : null,
  ].filter(Boolean).join(' / ');

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: 'background.default', minHeight: '100vh' }}>
      {actionMessage && <Alert severity="success" sx={{ mb: 2 }}>{actionMessage}</Alert>}
      {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}

      {!videoData && (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
          <LinearProgress />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Loading video details...
          </Typography>
        </Paper>
      )}

      {videoData && (
        <>
          <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', md: 'center' }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h5" sx={{ fontWeight: 900 }} noWrap>
                  {getTitle(videoData)}
                </Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {[videoData.event || 'No event', videoData.program?.name, formatDate(videoData.tagDate || videoData.airDate || videoData.uploadDate)]
                    .filter(Boolean)
                    .join(' / ')}
                </Typography>
              </Box>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={workflowStage.label} color={workflowStage.color} />
                <Chip
                  label={`Processing: ${formatLabel(videoData.processingStatus)}`}
                  color={getProcessingColor(videoData.processingStatus)}
                  variant="outlined"
                />
                <Chip label={`QC: ${formatLabel(videoData.qcStatus || 'pending')}`} variant="outlined" />
                <Chip label={`Broadcast: ${formatLabel(videoData.broadcastStatus || 'not_ready')}`} variant="outlined" />
                {videoData.correctionStatus === 'needs_correction' && (
                  <Chip label="Potrebna ispravka" color="error" />
                )}
                {canDownloadVideo && (
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<DownloadIcon />}
                    onClick={handleDownload}
                  >
                    Download
                  </Button>
                )}
              </Stack>
            </Stack>
          </Paper>

          {isVideoProcessingActive(videoData) && (
            <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderRadius: 2 }}>
              <LinearProgress
                variant="determinate"
                value={Number(videoData.processingProgress) || 0}
              />
              <Typography variant="caption" color="text.secondary">
                Compression progress: {Number(videoData.processingProgress) || 0}%
              </Typography>
            </Paper>
          )}

          {videoData.processingStatus === 'failed' && videoData.processingError && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              action={
                canManageVideo ? (
                  <Button
                    color="inherit"
                    size="small"
                    startIcon={<ReplayIcon />}
                    onClick={handleRetryProcessing}
                  >
                    Retry
                  </Button>
                ) : null
              }
            >
              {videoData.processingError}
            </Alert>
          )}

          <Grid container spacing={2} alignItems="flex-start">
            <Grid item xs={12} lg={8}>
              <VideoPlayer
                videoId={videoId}
                initialStart={Number(searchParams.get('start')) || 0}
                onTimecodesChange={setTimecodes}
                readOnly={!canManageVideo}
                compact
              />

              {canManageVideo && (
                <Box sx={{ mt: 2 }}>
                  <EditJobComposer video={videoData} timecodes={timecodes} />
                </Box>
              )}
            </Grid>

            <Grid item xs={12} lg={4}>
              <Stack spacing={2} sx={{ position: { lg: 'sticky' }, top: { lg: 16 } }}>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Typography variant="h6" sx={{ fontWeight: 850, mb: 1 }}>
                    Metadata
                  </Typography>
                  {canEditArchiveMetadata && (
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<EditNoteIcon />}
                      onClick={openMetadataDialog}
                      sx={{ mb: 1.5 }}
                    >
                      Edit metadata
                    </Button>
                  )}
                  <Grid container spacing={1.25}>
                    <DetailRow label="Filename" value={videoData.originalFilename || videoData.filename} />
                    <DetailRow label="Title" value={videoData.finalTitle || 'N/A'} />
                    <DetailRow label="Event" value={videoData.event || 'N/A'} />
                    <DetailRow label="Location" value={videoData.location || 'N/A'} />
                    <DetailRow label="Date" value={formatDate(videoData.tagDate || videoData.airDate || videoData.uploadDate)} />
                    <DetailRow label="Program" value={videoData.program?.name || 'N/A'} />
                    <DetailRow label="Category" value={videoData.contentType?.name || videoData.finalCategory || 'N/A'} />
                  </Grid>

                  <Divider sx={{ my: 1.5 }} />

                  <Grid container spacing={1.25}>
                    <DetailRow label="Reporter" value={getPersonName(videoData.reporter)} />
                    <DetailRow label="Editor" value={getPersonName(videoData.editor)} />
                    <DetailRow
                      label="QA responsible"
                      value={[
                        getPersonName(videoData.qaResponsible),
                        videoData.qaResponsibilityType ? formatLabel(videoData.qaResponsibilityType) : null,
                      ].filter(Boolean).join(' / ')}
                    />
                    <DetailRow label="Uploader" value={getPersonName(videoData.uploader)} />
                  </Grid>

                  <Divider sx={{ my: 1.5 }} />

                  <Grid container spacing={1.25}>
                    <DetailRow label="Source" value={sourceSummary || 'N/A'} />
                    <DetailRow label="Output" value={mediaSummary || 'N/A'} />
                    <DetailRow label="Duration" value={formatDuration(videoData.duration || videoData.sourceDuration)} />
                    <DetailRow label="Master size" value={formatBytes(videoData.sizeCompressed || videoData.sizeOriginal)} />
                    <DetailRow label="Preview size" value={formatBytes(videoData.sizePreview)} />
                    <DetailRow label="Uploaded" value={formatDateTime(videoData.uploadDate)} />
                  </Grid>

                  {(videoData.keywords || []).length > 0 && (
                    <>
                      <Divider sx={{ my: 1.5 }} />
                      <Typography variant="caption" color="text.secondary">
                        Tags
                      </Typography>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                        {(videoData.keywords || []).map((tag) => (
                          <Chip key={tag} label={tag} size="small" variant="outlined" />
                        ))}
                      </Stack>
                    </>
                  )}

                  {videoData.archiveReviewNotes && (
                    <Alert severity="info" sx={{ mt: 1.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>
                        Archive note
                      </Typography>
                      <Typography variant="caption">
                        {videoData.archiveReviewNotes}
                      </Typography>
                    </Alert>
                  )}
                  {videoData.correctionStatus === 'needs_correction' && (
                    <Alert severity="error" sx={{ mt: 1.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>
                        Potrebna ispravka
                      </Typography>
                      <Typography variant="caption">
                        {videoData.correctionNote || 'Clip has been tagged for correction.'}
                        {videoData.correctionReportedBy?.username
                          ? ` / ${videoData.correctionReportedBy.username}`
                          : ''}
                      </Typography>
                    </Alert>
                  )}
                </Paper>

                {(canUpdateQc || canUpdateBroadcastStatus) && (
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ fontWeight: 850, mb: 1.5 }}>
                      QC & Broadcast
                    </Typography>

                    {canUpdateQc && (
                      <Stack spacing={1.5}>
                        <FormControl fullWidth size="small">
                          <InputLabel>QC Status</InputLabel>
                          <Select
                            value={qcStatus}
                            label="QC Status"
                            onChange={(e) => setQcStatus(e.target.value)}
                          >
                            <MenuItem value="pending">Pending</MenuItem>
                            <MenuItem value="passed">Passed</MenuItem>
                            <MenuItem value="failed">Failed</MenuItem>
                          </Select>
                        </FormControl>
                        <TextField
                          label="QC Notes"
                          value={qcNotes}
                          onChange={(e) => setQcNotes(e.target.value)}
                          multiline
                          minRows={2}
                          fullWidth
                          size="small"
                        />
                        <Button
                          variant="contained"
                          startIcon={<SaveIcon />}
                          onClick={handleSaveQc}
                        >
                          Save QC
                        </Button>
                      </Stack>
                    )}

                    {canUpdateBroadcastStatus && (
                      <>
                        {canUpdateQc && <Divider sx={{ my: 1.5 }} />}
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleBroadcastStatus('approved_for_air')}
                          >
                            Approve for Air
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleBroadcastStatus('aired')}
                          >
                            Mark Aired
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            onClick={() => handleBroadcastStatus('archived')}
                          >
                            Archive
                          </Button>
                        </Stack>
                      </>
                    )}
                  </Paper>
                )}
              </Stack>
            </Grid>
          </Grid>

          <Dialog
            open={metadataDialogOpen}
            onClose={() => setMetadataDialogOpen(false)}
            fullWidth
            maxWidth="md"
          >
            <DialogTitle>Edit archive metadata</DialogTitle>
            <DialogContent>
              {!metadataOptionsLoaded && <LinearProgress sx={{ mb: 2 }} />}
              <Grid container spacing={2} sx={{ mt: 0 }}>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Archive title"
                    value={metadataForm.finalTitle}
                    onChange={(event) => handleMetadataFieldChange('finalTitle', event.target.value)}
                    fullWidth
                    size="small"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    freeSolo
                    options={metadataOptions.events}
                    value={metadataForm.event || ''}
                    inputValue={metadataForm.event || ''}
                    onChange={(event, value) => handleMetadataFieldChange('event', value || '')}
                    onInputChange={(event, value) => handleMetadataFieldChange('event', value || '')}
                    renderInput={(params) => (
                      <TextField {...params} label="Event" size="small" fullWidth />
                    )}
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    label="Date"
                    type="date"
                    value={metadataForm.tagDate}
                    onChange={(event) => handleMetadataFieldChange('tagDate', event.target.value)}
                    fullWidth
                    size="small"
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <Autocomplete
                    options={metadataOptions.programs}
                    value={findOptionById(metadataOptions.programs, metadataForm.programId)}
                    onChange={(event, value) => handleMetadataFieldChange('programId', value?._id || '')}
                    getOptionLabel={(option) => option?.name || ''}
                    isOptionEqualToValue={(option, value) => option._id === value._id}
                    renderInput={(params) => (
                      <TextField {...params} label="Program / show" size="small" fullWidth />
                    )}
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Content type</InputLabel>
                    <Select
                      value={metadataForm.contentTypeId}
                      label="Content type"
                      onChange={(event) => handleMetadataFieldChange('contentTypeId', event.target.value)}
                    >
                      <MenuItem value="">No category</MenuItem>
                      {metadataOptions.contentTypes.map((type) => (
                        <MenuItem key={type._id} value={type._id}>
                          {type.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    options={metadataOptions.reporters}
                    value={findOptionById(metadataOptions.reporters, metadataForm.reporterId)}
                    onChange={(event, value) => handleMetadataFieldChange('reporterId', value?._id || '')}
                    getOptionLabel={getUserLabel}
                    isOptionEqualToValue={(option, value) => option._id === value._id}
                    renderInput={(params) => (
                      <TextField {...params} label="Reporter / author" size="small" fullWidth />
                    )}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    options={metadataOptions.editors}
                    value={findOptionById(metadataOptions.editors, metadataForm.editorId)}
                    onChange={(event, value) => handleMetadataFieldChange('editorId', value?._id || '')}
                    getOptionLabel={getUserLabel}
                    isOptionEqualToValue={(option, value) => option._id === value._id}
                    renderInput={(params) => (
                      <TextField {...params} label="Editor / montage" size="small" fullWidth />
                    )}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    label="Tags / keywords"
                    value={metadataForm.keywords}
                    onChange={(event) => handleMetadataFieldChange('keywords', event.target.value)}
                    helperText="Separate tags with commas."
                    fullWidth
                    size="small"
                    multiline
                    minRows={2}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    label="Archive note"
                    value={metadataForm.archiveReviewNotes}
                    onChange={(event) => handleMetadataFieldChange('archiveReviewNotes', event.target.value)}
                    fullWidth
                    size="small"
                    multiline
                    minRows={2}
                  />
                </Grid>
              </Grid>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setMetadataDialogOpen(false)}>Cancel</Button>
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={handleSaveMetadata}
                disabled={metadataSaving}
              >
                Save metadata
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Box>
  );
};

export default VideoDetailsPage;
