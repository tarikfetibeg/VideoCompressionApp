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
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import EditNoteIcon from '@mui/icons-material/EditNote';
import ReplayIcon from '@mui/icons-material/Replay';
import SaveIcon from '@mui/icons-material/Save';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import LogoutIcon from '@mui/icons-material/Logout';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import axios from '../axiosConfig';
import { UserContext } from '../contexts/UserContext';
import { useBackgroundDownloads } from '../contexts/BackgroundDownloadContext';
import { StatusChip, WorkspaceHeader } from '../components/common/WorkspaceChrome';
import VideoCorrectionPanel, { VideoIssueComposer } from '../components/corrections/VideoCorrectionPanel';
import {
  broadcastLabels,
  formatDateBs,
  processingLabels,
  qcLabels,
} from '../utils/uiLabels';
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
  if (!video) return { label: 'Ucitavanje', color: 'default' };
  if (['aired', 'archived'].includes(video.broadcastStatus)) return { label: 'Arhiva / emitovano', color: 'info' };
  if (
    video.processingMode === 'finalize' ||
    video.finalApprovalStatus === 'approved' ||
    video.contentType
  ) {
    return { label: 'Final spreman', color: 'success' };
  }
  if (video.status === 'edited') return { label: 'Smontiran materijal', color: 'primary' };
  return { label: 'Sirovina / ingest', color: 'warning' };
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
  const { startDownload } = useBackgroundDownloads();
  const [videoData, setVideoData] = useState(null);
  const [timecodes, setTimecodes] = useState([]);
  const [qcStatus, setQcStatus] = useState('pending');
  const [qcNotes, setQcNotes] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [technicalQcBusy, setTechnicalQcBusy] = useState(false);
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
  const [correctionContext, setCorrectionContext] = useState(null);
  const [issueComposerOpen, setIssueComposerOpen] = useState(false);
  const [playheadSeconds, setPlayheadSeconds] = useState(0);
  const [seekRequest, setSeekRequest] = useState(null);
  const [detailTab, setDetailTab] = useState('metadata');
  const [claimBusy, setClaimBusy] = useState(false);
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

  const fetchCorrectionContext = useCallback(() => {
    axios.get(`/corrections/video/${videoId}/context`)
      .then((response) => setCorrectionContext(response.data || null))
      .catch(() => setCorrectionContext(null));
  }, [videoId]);

  useEffect(() => {
    fetchCorrectionContext();
  }, [fetchCorrectionContext]);

  useEffect(() => {
    if (!isVideoProcessingActive(videoData)) return undefined;

    const intervalId = window.setInterval(fetchVideoData, ACTIVE_PROCESSING_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [fetchVideoData, videoData]);

  useEffect(() => {
    if (!['queued', 'processing'].includes(videoData?.technicalQc?.status)) return undefined;
    const intervalId = window.setInterval(fetchVideoData, 4000);
    return () => window.clearInterval(intervalId);
  }, [fetchVideoData, videoData?.technicalQc?.status]);

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
        setActionError(error.response?.data?.message || 'Opcije za arhivsku metadata nisu učitane.');
      });
  }, []);

  const handleDownload = () => {
    startDownload({
      kind: 'video-single',
      payload: { videoId },
      label: videoData?.originalFilename || videoData?.filename || `Video ${videoId}`,
    })
      .catch((error) => {
        console.error('Error downloading video:', error);
        setActionError(error.response?.data?.message || 'Video se ne moze skinuti.');
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
  const archiveAssigneeId = videoData?.archiveAssignedTo?._id || videoData?.archiveAssignedTo;
  const archiveClaimActive = Boolean(
    archiveAssigneeId
    && videoData?.archiveAssignmentExpiresAt
    && new Date(videoData.archiveAssignmentExpiresAt).getTime() > Date.now()
  );
  const archiveClaimMine = archiveClaimActive && String(archiveAssigneeId) === String(user?.id);
  const canEditArchiveMetadata = user?.role === 'Admin' || (user?.role === 'Archivist' && archiveClaimMine);
  const canReportCorrection = ['Producer', 'Admin'].includes(user?.role)
    || (user?.role === 'Archivist' && archiveClaimMine);
  const canRunTechnicalQc = ['Editor', 'VideoEditor', 'Producer', 'Archivist', 'Admin'].includes(user?.role);

  const handleArchiveClaim = async () => {
    setClaimBusy(true);
    setActionError('');
    try {
      const response = await axios.patch(`/archive/videos/${videoId}/claim`);
      setVideoData(response.data.video);
      setActionMessage(response.data?.message || 'Materijal je preuzet.');
      fetchCorrectionContext();
    } catch (error) {
      setActionError(error.response?.data?.message || 'Materijal nije moguće preuzeti.');
    } finally {
      setClaimBusy(false);
    }
  };

  const handleArchiveRelease = async () => {
    setClaimBusy(true);
    setActionError('');
    try {
      const response = await axios.patch(`/archive/videos/${videoId}/release`);
      setVideoData(response.data.video);
      setActionMessage(response.data?.message || 'Materijal je oslobođen.');
      fetchCorrectionContext();
    } catch (error) {
      setActionError(error.response?.data?.message || 'Materijal nije moguće osloboditi.');
    } finally {
      setClaimBusy(false);
    }
  };

  const handleRunTechnicalQc = async () => {
    setTechnicalQcBusy(true);
    setActionMessage('');
    setActionError('');
    try {
      const response = await axios.post(`/v2/technical-qc/${videoId}/run`, {
        force: ['passed', 'warning', 'failed'].includes(videoData?.technicalQc?.status),
      });
      setVideoData((current) => ({
        ...current,
        technicalQc: { ...(current?.technicalQc || {}), status: 'queued', error: '' },
      }));
      setActionMessage(response.data?.message || 'Tehnički QC je dodat u red.');
    } catch (error) {
      setActionError(error.response?.data?.message || 'Tehnički QC se ne može pokrenuti.');
    } finally {
      setTechnicalQcBusy(false);
    }
  };

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
        setActionMessage('QC status je sačuvan.');
      })
      .catch((error) => {
        console.error('Error saving QC status:', error);
        setActionError(error.response?.data?.message || 'QC status nije moguće sačuvati.');
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
        setActionMessage('Status emitovanja je ažuriran.');
      })
      .catch((error) => {
        console.error('Error updating broadcast status:', error);
        setActionError(error.response?.data?.message || 'Status emitovanja nije moguće ažurirati.');
      });
  };

  const handleRetryProcessing = () => {
    setActionMessage('');
    setActionError('');

    axios
      .post(`/videos/${videoId}/requeue-processing`)
      .then((response) => {
        setVideoData(response.data.video);
        setActionMessage(response.data?.message || 'Video je ponovo dodat u red za obradu.');
      })
      .catch((error) => {
        console.error('Error retrying video processing:', error);
        setActionError(error.response?.data?.message || 'Obradu videa nije moguće ponovo pokrenuti.');
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
        setActionMessage(response.data?.message || 'Arhivska metadata je sačuvana.');
      })
      .catch((error) => {
        console.error('Error saving archive metadata:', error);
        setActionError(error.response?.data?.message || 'Arhivsku metadata nije moguće sačuvati.');
      })
      .finally(() => setMetadataSaving(false));
  };

  const handleMetadataIssue = async () => {
    setIssueComposerOpen(false);
    setActionError('');
    try {
      const response = await axios.patch(`/archive/videos/${videoId}/review`, {
        status: 'needs_metadata',
        notes: videoData?.archiveReviewNotes || 'Potrebna je dopuna metadata podataka.',
      });
      setVideoData(response.data.video);
      setActionMessage('Materijal je vraćen u metadata radni red.');
      openMetadataDialog();
    } catch (error) {
      setActionError(error.response?.data?.message || 'Metadata zadatak nije moguće otvoriti.');
    }
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
            Učitavam detalje videa...
          </Typography>
        </Paper>
      )}

      {videoData && (
        <>
          <WorkspaceHeader
            eyebrow="Pregled videa"
            title={getTitle(videoData)}
            subtitle={[videoData.event || 'Bez eventa', videoData.program?.name, formatDateBs(videoData.tagDate || videoData.airDate || videoData.uploadDate)]
              .filter(Boolean)
              .join(' / ')}
            chips={[
              { label: 'Workflow', value: workflowStage.label, color: workflowStage.color },
              { label: 'Materijal', value: formatLabel(videoData.status) },
            ]}
            actions={(
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <StatusChip value={videoData.processingStatus} maps={processingLabels} prefix="Processing " variant="outlined" tone={getProcessingColor(videoData.processingStatus)} />
                <StatusChip value={videoData.qcStatus || 'pending'} maps={qcLabels} prefix="QC " variant="outlined" />
                <StatusChip value={videoData.broadcastStatus || 'not_ready'} maps={broadcastLabels} prefix="Broadcast " variant="outlined" />
                {videoData.correctionStatus === 'needs_correction' && (
                  <StatusChip label="Potrebna ispravka" tone="error" />
                )}
                {canDownloadVideo && (
                  <Button variant="contained" size="small" startIcon={<DownloadIcon />} onClick={handleDownload}>
                    Preuzmi
                  </Button>
                )}
              </Stack>
            )}
          />

          {isVideoProcessingActive(videoData) && (
            <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderRadius: 2 }}>
              <LinearProgress
                variant="determinate"
                value={Number(videoData.processingProgress) || 0}
              />
              <Typography variant="caption" color="text.secondary">
                Obrada videa: {Number(videoData.processingProgress) || 0}%
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
                    Pokušaj ponovo
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
                initialStart={Number(searchParams.get('start') || searchParams.get('t')) || 0}
                onTimecodesChange={setTimecodes}
                onPlaybackPositionChange={setPlayheadSeconds}
                seekRequest={seekRequest}
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
                {user?.role === 'Archivist' && (
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                    {archiveClaimActive ? (
                      <Alert severity={archiveClaimMine ? 'info' : 'warning'} sx={{ mb: 1 }}>
                        Preuzeo: {videoData.archiveAssignedTo?.username || 'drugi arhivista'} / do {formatDateTime(videoData.archiveAssignmentExpiresAt)}
                      </Alert>
                    ) : (
                      <Alert severity="info" sx={{ mb: 1 }}>Materijal nije preuzet u arhivistički radni red.</Alert>
                    )}
                    {archiveClaimMine ? (
                      <Button startIcon={<LogoutIcon />} variant="outlined" onClick={handleArchiveRelease} disabled={claimBusy}>Oslobodi</Button>
                    ) : (
                      <Button startIcon={<AssignmentIndIcon />} variant="contained" onClick={handleArchiveClaim} disabled={claimBusy || archiveClaimActive}>Preuzmi</Button>
                    )}
                  </Paper>
                )}

                <VideoCorrectionPanel
                  context={correctionContext}
                  onTimestamp={(seconds) => {
                    setPlayheadSeconds(seconds);
                    setSeekRequest({ seconds, key: Date.now() });
                  }}
                  onReport={canReportCorrection ? () => setIssueComposerOpen(true) : null}
                  reportDisabled={!canReportCorrection}
                />

                <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: 'hidden' }}>
                  <Tabs value={detailTab} onChange={(event, value) => setDetailTab(value)} variant="fullWidth">
                    <Tab value="metadata" label="Metadata" />
                    <Tab value="qc" label="QC i greške" />
                    <Tab value="history" label="Historija" />
                  </Tabs>
                </Paper>

                {detailTab === 'metadata' && (
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Typography variant="h6" sx={{ fontWeight: 850, mb: 1 }}>
                    Metadata
                  </Typography>
                  {['Archivist', 'Admin'].includes(user?.role) && (
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<EditNoteIcon />}
                      onClick={openMetadataDialog}
                      disabled={!canEditArchiveMetadata}
                      sx={{ mb: 1.5 }}
                    >
                      Uredi metadata
                    </Button>
                  )}
                  <Grid container spacing={1.25}>
                    <DetailRow label="Naziv fajla" value={videoData.originalFilename || videoData.filename} />
                    <DetailRow label="Naslov" value={videoData.finalTitle || 'N/A'} />
                    <DetailRow label="Event" value={videoData.event || 'N/A'} />
                    <DetailRow label="Lokacija" value={videoData.location || 'N/A'} />
                    <DetailRow label="Datum" value={formatDate(videoData.tagDate || videoData.airDate || videoData.uploadDate)} />
                    <DetailRow label="Program" value={videoData.program?.name || 'N/A'} />
                    <DetailRow label="Kategorija" value={videoData.contentType?.name || videoData.finalCategory || 'N/A'} />
                  </Grid>

                  <Divider sx={{ my: 1.5 }} />

                  <Grid container spacing={1.25}>
                    <DetailRow label="Reporter" value={getPersonName(videoData.reporter)} />
                    <DetailRow label="Montažer" value={getPersonName(videoData.editor)} />
                    <DetailRow
                      label="Odgovoran za QA"
                      value={[
                        getPersonName(videoData.qaResponsible),
                        videoData.qaResponsibilityType ? formatLabel(videoData.qaResponsibilityType) : null,
                      ].filter(Boolean).join(' / ')}
                    />
                    <DetailRow label="Uploadovao" value={getPersonName(videoData.uploader)} />
                  </Grid>

                  <Divider sx={{ my: 1.5 }} />

                  <Grid container spacing={1.25}>
                    <DetailRow label="Izvor" value={sourceSummary || 'N/A'} />
                    <DetailRow label="Izlaz" value={mediaSummary || 'N/A'} />
                    <DetailRow label="Trajanje" value={formatDuration(videoData.duration || videoData.sourceDuration)} />
                    <DetailRow label="Veličina mastera" value={formatBytes(videoData.sizeCompressed || videoData.sizeOriginal)} />
                    <DetailRow label="Veličina previewa" value={formatBytes(videoData.sizePreview)} />
                    <DetailRow label="Uploadovano" value={formatDateTime(videoData.uploadDate)} />
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
                        Arhivska bilješka
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
                        {videoData.correctionNote || 'Klip je označen za ispravku.'}
                        {videoData.correctionReportedBy?.username
                          ? ` / ${videoData.correctionReportedBy.username}`
                          : ''}
                      </Typography>
                    </Alert>
                  )}
                </Paper>
                )}

                {detailTab === 'qc' && (
                <>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 850 }}>
                        Tehnički QC
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Lagana FFmpeg provjera crnog/zamrznutog kadra, tišine i glasnoće.
                      </Typography>
                    </Box>
                    <StatusChip
                      label={(
                        {
                          not_run: 'Nije pokrenut',
                          queued: 'Čeka',
                          processing: 'Analiza',
                          passed: 'Bez upozorenja',
                          warning: 'Provjeriti',
                          failed: 'Greška',
                        }[videoData.technicalQc?.status || 'not_run']
                      )}
                      tone={videoData.technicalQc?.status === 'passed'
                        ? 'success'
                        : videoData.technicalQc?.status === 'warning'
                          ? 'warning'
                          : videoData.technicalQc?.status === 'failed'
                            ? 'error'
                            : 'info'}
                    />
                  </Stack>

                  {['queued', 'processing'].includes(videoData.technicalQc?.status) && (
                    <LinearProgress sx={{ mb: 1.25 }} />
                  )}
                  {(videoData.technicalQc?.findings || []).length > 0 && (
                    <Stack spacing={0.75} sx={{ mb: 1.25 }}>
                      {videoData.technicalQc.findings.map((finding, index) => (
                        <Alert
                          key={`${finding.code}-${index}`}
                          severity={finding.severity === 'warning' ? 'warning' : finding.severity === 'error' ? 'error' : 'info'}
                          variant="outlined"
                        >
                          <Typography variant="body2" sx={{ fontWeight: 800 }}>{finding.label}</Typography>
                          {finding.detail && <Typography variant="caption">{finding.detail}</Typography>}
                        </Alert>
                      ))}
                    </Stack>
                  )}
                  {videoData.technicalQc?.completedAt && (
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
                      Analizirano {formatDuration(videoData.technicalQc.analyzedDuration)} / {formatDateTime(videoData.technicalQc.completedAt)}
                    </Typography>
                  )}
                  {videoData.technicalQc?.error && (
                    <Alert severity="error" sx={{ mb: 1 }}>{videoData.technicalQc.error}</Alert>
                  )}
                  {canRunTechnicalQc && (
                    <Button
                      variant="outlined"
                      startIcon={<FactCheckIcon />}
                      onClick={handleRunTechnicalQc}
                      disabled={technicalQcBusy || ['queued', 'processing'].includes(videoData.technicalQc?.status)}
                    >
                      {technicalQcBusy ? 'Dodajem u red...' : videoData.technicalQc?.completedAt ? 'Ponovi tehnički QC' : 'Pokreni tehnički QC'}
                    </Button>
                  )}
                </Paper>

                {(canUpdateQc || canUpdateBroadcastStatus) && (
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ fontWeight: 850, mb: 1.5 }}>
                      QC i emitovanje
                    </Typography>

                    {canUpdateQc && (
                      <Stack spacing={1.5}>
                        <FormControl fullWidth size="small">
                          <InputLabel>QC status</InputLabel>
                          <Select
                            value={qcStatus}
                            label="QC status"
                            onChange={(e) => setQcStatus(e.target.value)}
                          >
                            <MenuItem value="pending">Čeka</MenuItem>
                            <MenuItem value="passed">Prošao</MenuItem>
                            <MenuItem value="failed">Nije prošao</MenuItem>
                          </Select>
                        </FormControl>
                        <TextField
                          label="QC bilješka"
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
                          Sačuvaj QC
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
                            Odobri za emitovanje
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleBroadcastStatus('aired')}
                          >
                            Označi emitovano
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            onClick={() => handleBroadcastStatus('archived')}
                          >
                            Arhiviraj
                          </Button>
                        </Stack>
                      </>
                    )}
                  </Paper>
                )}
                </>
                )}

                {detailTab === 'history' && (
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ fontWeight: 850, mb: 1.5 }}>Historija ispravki</Typography>
                    {(correctionContext?.history || []).length === 0 ? (
                      <Alert severity="info" variant="outlined">Nema evidentiranih ispravki za ovaj video.</Alert>
                    ) : (
                      <Stack spacing={1.25}>
                        {(correctionContext.history || []).map((request) => (
                          <Box key={request._id} sx={{ pb: 1.25, borderBottom: 1, borderColor: 'divider' }}>
                            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                              <StatusChip label={formatLabel(request.status)} variant="outlined" />
                              <StatusChip label={`${request.issues?.length || 0} problema`} variant="outlined" />
                            </Stack>
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                              {formatDateTime(request.updatedAt)} / {request.reportedBy?.username || 'Korisnik'}
                            </Typography>
                            {(request.issues || []).slice(0, 5).map((issue, index) => (
                              <Button
                                key={issue._id || index}
                                size="small"
                                startIcon={<ReportProblemIcon />}
                                onClick={() => {
                                  const seconds = Number(issue.startSeconds) || 0;
                                  setPlayheadSeconds(seconds);
                                  setSeekRequest({ seconds, key: Date.now() });
                                }}
                                sx={{ justifyContent: 'flex-start', textAlign: 'left' }}
                              >
                                {formatDuration(issue.startSeconds)} / {issue.note}
                              </Button>
                            ))}
                          </Box>
                        ))}
                      </Stack>
                    )}
                  </Paper>
                )}
              </Stack>
            </Grid>
          </Grid>

          <VideoIssueComposer
            open={issueComposerOpen}
            video={videoData}
            playheadSeconds={playheadSeconds}
            correctionContext={correctionContext}
            onClose={() => setIssueComposerOpen(false)}
            onSubmitted={(result) => {
              setActionMessage(result?.message || 'Greške su poslane u montažu.');
              fetchVideoData();
              fetchCorrectionContext();
              setDetailTab('qc');
            }}
            onMetadataIssue={['Archivist', 'Admin'].includes(user?.role) ? handleMetadataIssue : undefined}
          />

          <Dialog
            open={metadataDialogOpen}
            onClose={() => setMetadataDialogOpen(false)}
            fullWidth
            maxWidth="md"
          >
            <DialogTitle>Uredi arhivsku metadata</DialogTitle>
            <DialogContent>
              {!metadataOptionsLoaded && <LinearProgress sx={{ mb: 2 }} />}
              <Grid container spacing={2} sx={{ mt: 0 }}>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Arhivski naslov"
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
                    label="Datum"
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
                      <TextField {...params} label="Program / emisija" size="small" fullWidth />
                    )}
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Tip sadržaja</InputLabel>
                    <Select
                      value={metadataForm.contentTypeId}
                      label="Tip sadržaja"
                      onChange={(event) => handleMetadataFieldChange('contentTypeId', event.target.value)}
                    >
                      <MenuItem value="">Bez kategorije</MenuItem>
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
                      <TextField {...params} label="Reporter / autor" size="small" fullWidth />
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
                      <TextField {...params} label="Montažer" size="small" fullWidth />
                    )}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    label="Tagovi / ključne riječi"
                    value={metadataForm.keywords}
                    onChange={(event) => handleMetadataFieldChange('keywords', event.target.value)}
                    helperText="Tagove odvojite zarezima."
                    fullWidth
                    size="small"
                    multiline
                    minRows={2}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    label="Arhivska bilješka"
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
              <Button onClick={() => setMetadataDialogOpen(false)}>Odustani</Button>
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={handleSaveMetadata}
                disabled={metadataSaving}
              >
                Sačuvaj metadata
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Box>
  );
};

export default VideoDetailsPage;
