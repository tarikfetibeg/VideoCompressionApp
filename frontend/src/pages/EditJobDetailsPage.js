import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
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
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import ArticleIcon from '@mui/icons-material/Article';
import AudiotrackIcon from '@mui/icons-material/Audiotrack';
import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import axiosInstance from '../axiosConfig';
import BriefImportButton from '../components/jobs/BriefImportButton';
import { ACCEPTED_VIDEO_FILE_TYPES } from '../constants/videoFormats';
import { UserContext } from '../contexts/UserContext';

const statusOptions = [
  'submitted',
  'claimed',
  'in_edit',
  'needs_info',
  'ready_for_qc',
  'approved',
  'aired',
  'archived',
];

const formatLabel = (value) => String(value || 'N/A').replace(/_/g, ' ');

const formatTime = (seconds) => {
  const totalSeconds = Math.max(0, Number(seconds) || 0);
  const wholeSeconds = Math.floor(totalSeconds);
  const milliseconds = Math.round((totalSeconds - wholeSeconds) * 1000);
  const date = new Date(0);
  date.setSeconds(wholeSeconds);
  return `${date.toISOString().substr(11, 8)}.${String(milliseconds).padStart(3, '0')}`;
};

const formatDate = (value) => {
  if (!value) return 'No deadline';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No deadline';
  return date.toLocaleString();
};

const getDateInputValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return 'N/A';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = Number(bytes) || 0;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDuration = (seconds) => {
  if (!seconds && seconds !== 0) return 'N/A';
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

const getClipName = (video) => video.originalFilename || video.filename || `Video ${video._id}`;

const getResponseFilename = (response, fallbackName) => {
  const disposition = response.headers?.['content-disposition'] || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallbackName;
};

const downloadBlobResponse = (response, fallbackName) => {
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');

  link.href = url;
  link.setAttribute('download', getResponseFilename(response, fallbackName));
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.URL.revokeObjectURL(url);
};

const getRequestErrorMessage = (error, fallback) => error.response?.data?.message || fallback;

const getDownloadErrorMessage = async (error, fallback) => {
  const data = error.response?.data;

  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const parsed = JSON.parse(text);
      return parsed.message || fallback;
    } catch (parseError) {
      return fallback;
    }
  }

  return data?.message || fallback;
};

const OffAudioPlayer = ({ jobId, offFile }) => {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let objectUrl = '';
    setSrc('');
    setError('');

    axiosInstance
      .get(`/edit-jobs/${jobId}/off-files/${offFile._id}`, { responseType: 'blob' })
      .then((response) => {
        objectUrl = window.URL.createObjectURL(new Blob([response.data], {
          type: offFile.mimetype || response.headers?.['content-type'] || 'audio/mpeg',
        }));
        setSrc(objectUrl);
      })
      .catch((requestError) => {
        console.error('Error loading OFF audio:', requestError);
        setError('Audio preview unavailable.');
      });

    return () => {
      if (objectUrl) {
        window.URL.revokeObjectURL(objectUrl);
      }
    };
  }, [jobId, offFile]);

  if (error) {
    return <Typography variant="caption" color="error">{error}</Typography>;
  }

  if (!src) {
    return <Typography variant="caption" color="text.secondary">Loading audio...</Typography>;
  }

  return <audio controls src={src} style={{ width: '100%' }} />;
};

const EditJobDetailsPage = () => {
  const { jobId } = useParams();
  const { user } = useContext(UserContext);
  const [job, setJob] = useState(null);
  const [status, setStatus] = useState('');
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [packageLoading, setPackageLoading] = useState(false);
  const [updateDescription, setUpdateDescription] = useState('');
  const [updateScriptText, setUpdateScriptText] = useState('');
  const [updateComment, setUpdateComment] = useState('');
  const [updateOffFiles, setUpdateOffFiles] = useState([]);
  const [availableVideos, setAvailableVideos] = useState([]);
  const [selectedAdditionalVideoIds, setSelectedAdditionalVideoIds] = useState([]);
  const [additionalClipNotes, setAdditionalClipNotes] = useState({});
  const [materialSearch, setMaterialSearch] = useState('');
  const [materialLoading, setMaterialLoading] = useState(false);
  const [updateSaving, setUpdateSaving] = useState(false);
  const [segmentActionLoading, setSegmentActionLoading] = useState('');
  const [replacementSegmentId, setReplacementSegmentId] = useState('');
  const [programs, setPrograms] = useState([]);
  const [contentTypes, setContentTypes] = useState([]);
  const [finalVideos, setFinalVideos] = useState([]);
  const [finalFile, setFinalFile] = useState(null);
  const [finalTitle, setFinalTitle] = useState('');
  const [finalProgramId, setFinalProgramId] = useState('');
  const [finalContentTypeId, setFinalContentTypeId] = useState('');
  const [finalAirDate, setFinalAirDate] = useState(getDateInputValue(new Date()));
  const [finalNotes, setFinalNotes] = useState('');
  const [finalUploadProgress, setFinalUploadProgress] = useState(0);
  const [finalUploading, setFinalUploading] = useState(false);

  const canClaim = ['Editor', 'VideoEditor', 'Producer', 'Admin'].includes(user?.role);
  const assignedEditorId = job?.assignedEditor?._id || job?.assignedEditor?.id || '';
  const isAssignedToCurrentUser = assignedEditorId && assignedEditorId === user?.id;
  const canDirectDownloadPackage =
    ['Producer', 'Admin'].includes(user?.role) || isAssignedToCurrentUser;
  const canUpdateStatus =
    canClaim || (user?.role === 'Reporter' && ['draft', 'submitted', 'needs_info'].includes(status));
  const reporterId = job?.reporter?._id || job?.reporter?.id || '';
  const canReporterUpdateJob =
    user?.role === 'Admin' || (user?.role === 'Reporter' && reporterId === user?.id);
  const canUploadFinal =
    user?.role === 'Admin' ||
    (['Editor', 'VideoEditor'].includes(user?.role) && (!assignedEditorId || assignedEditorId === user?.id));
  const canApproveFinal = user?.role === 'Admin' || user?.role === 'Producer' || (user?.role === 'Reporter' && reporterId === user?.id);
  const canEditSegments = canReporterUpdateJob && !['aired', 'archived'].includes(job?.status);
  const downloadMeta = job?.downloadMeta || null;

  const sortedSegments = useMemo(
    () => [...(job?.segments || [])].sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
    [job]
  );
  const existingVideoIds = useMemo(
    () => new Set(sortedSegments.map((segment) => segment.video?._id).filter(Boolean)),
    [sortedSegments]
  );
  const primaryEvent = sortedSegments.find((segment) => segment.video?.event)?.video?.event || '';
  const primaryDate = getDateInputValue(sortedSegments.find((segment) => segment.video?.tagDate)?.video?.tagDate);
  const filteredAdditionalVideos = useMemo(() => {
    const search = materialSearch.trim().toLowerCase();

    return availableVideos
      .filter((video) => !existingVideoIds.has(video._id))
      .filter((video) => {
        if (!search) return true;
        return [video.originalFilename, video.filename, video.event, video.processingStatus]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));
      });
  }, [availableVideos, existingVideoIds, materialSearch]);
  const selectedAdditionalVideos = useMemo(
    () => availableVideos.filter((video) => selectedAdditionalVideoIds.includes(video._id)),
    [availableVideos, selectedAdditionalVideoIds]
  );
  const replacementSegment = useMemo(
    () => sortedSegments.find((segment) => segment._id === replacementSegmentId) || null,
    [replacementSegmentId, sortedSegments]
  );
  const sortedChangeLog = useMemo(
    () => [...(job?.changeLog || [])].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
    [job]
  );
  const finalProcessingActive = useMemo(
    () => finalVideos.some((video) => ['queued', 'processing'].includes(video.processingStatus)),
    [finalVideos]
  );

  const fetchJob = useCallback(() => {
    setErrorMessage('');

    axiosInstance
      .get(`/edit-jobs/${jobId}`)
      .then((response) => {
        setJob(response.data);
        setStatus(response.data.status || 'submitted');
      })
      .catch((error) => {
        console.error('Error fetching edit job:', error);
        setErrorMessage(error.response?.data?.message || 'Edit job could not be loaded.');
      });
  }, [jobId]);

  const fetchAvailableVideos = useCallback(() => {
    if (!canReporterUpdateJob) return;

    setMaterialLoading(true);
    axiosInstance
      .get('/videos', {
        params: {
          ...(primaryEvent ? { event: primaryEvent } : {}),
          ...(primaryDate ? { date: primaryDate } : {}),
        },
        headers: { Accept: 'application/json' },
      })
      .then((response) => {
        setAvailableVideos(Array.isArray(response.data) ? response.data : []);
      })
      .catch((error) => {
        console.error('Error fetching additional job material:', error);
        setErrorMessage(error.response?.data?.message || 'Additional material could not be loaded.');
      })
      .finally(() => setMaterialLoading(false));
  }, [canReporterUpdateJob, primaryEvent, primaryDate]);

  const fetchBroadcastSettings = useCallback(() => {
    Promise.all([
      axiosInstance.get('/broadcast/programs'),
      axiosInstance.get('/broadcast/content-types'),
    ])
      .then(([programResponse, typeResponse]) => {
        const nextPrograms = Array.isArray(programResponse.data) ? programResponse.data : [];
        const nextTypes = Array.isArray(typeResponse.data) ? typeResponse.data : [];
        setPrograms(nextPrograms);
        setContentTypes(nextTypes);
        setFinalProgramId((current) => current || nextPrograms[0]?._id || '');
        setFinalContentTypeId((current) => current || nextTypes[0]?._id || '');
      })
      .catch((error) => {
        console.error('Error fetching broadcast settings:', error);
      });
  }, []);

  const fetchFinalVideos = useCallback(() => {
    axiosInstance
      .get(`/edit-jobs/${jobId}/final-videos`)
      .then((response) => {
        setFinalVideos(Array.isArray(response.data) ? response.data : []);
      })
      .catch((error) => {
        console.error('Error fetching final videos:', error);
      });
  }, [jobId]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  useEffect(() => {
    fetchBroadcastSettings();
    fetchFinalVideos();
  }, [fetchBroadcastSettings, fetchFinalVideos]);

  useEffect(() => {
    if (!finalProcessingActive) return undefined;

    const refreshTimer = window.setInterval(fetchFinalVideos, 3000);
    return () => window.clearInterval(refreshTimer);
  }, [fetchFinalVideos, finalProcessingActive]);

  useEffect(() => {
    if (!job) return;
    setUpdateDescription(job.description || '');
    setUpdateScriptText(job.scriptText || '');
    setFinalTitle(job.title || '');
  }, [job]);

  useEffect(() => {
    if (job && canReporterUpdateJob) {
      fetchAvailableVideos();
    }
  }, [job, canReporterUpdateJob, fetchAvailableVideos]);

  const updateJobFromResponse = (response, successMessage) => {
    setJob(response.data.job);
    setStatus(response.data.job.status);
    setMessage(successMessage);
    setErrorMessage('');
  };

  const handleClaim = () => {
    axiosInstance
      .patch(`/edit-jobs/${jobId}/claim`)
      .then((response) => updateJobFromResponse(response, 'Job claimed.'))
      .catch((error) => {
        console.error('Error claiming job:', error);
        setErrorMessage(error.response?.data?.message || 'Job could not be claimed.');
      });
  };

  const requestPackageDownload = useCallback((scope = 'all') =>
    axiosInstance
      .get(`/edit-jobs/${jobId}/download-package`, {
        params: { scope },
        responseType: 'blob',
      })
      .then((response) => {
        downloadBlobResponse(response, `edit_job_${jobId}_${scope === 'missing' ? 'new_files' : 'package'}.zip`);
      }),
  [jobId]);

  const handleDownloadPackage = (scope = 'all') => {
    setPackageLoading(true);
    setMessage('');
    setErrorMessage('');

    requestPackageDownload(scope)
      .then(() => {
        setMessage(scope === 'missing' ? 'New/missing job files download started.' : 'Full edit package download started.');
        fetchJob();
      })
      .catch(async (error) => {
        console.error('Error downloading edit package:', error);
        setErrorMessage(await getDownloadErrorMessage(error, 'Edit package could not be downloaded.'));
      })
      .finally(() => setPackageLoading(false));
  };

  const handleDownloadOffFile = (offFile) => {
    axiosInstance
      .get(`/edit-jobs/${jobId}/off-files/${offFile._id}`, { responseType: 'blob' })
      .then((response) => {
        downloadBlobResponse(response, offFile.originalName || `off_${offFile._id}`);
      })
      .catch((error) => {
        console.error('Error downloading OFF audio:', error);
        setErrorMessage(getRequestErrorMessage(error, 'OFF audio could not be downloaded.'));
      });
  };

  const handleBriefImported = (importedText) => {
    setUpdateScriptText((current) => {
      const existingText = current.trim();
      if (!existingText) return importedText;
      return `${existingText}\n\n${importedText}`;
    });
  };

  const handleUpdateOffFileSelection = (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      setUpdateOffFiles((current) => [...current, ...files]);
    }
    event.target.value = '';
  };

  const removeUpdateOffFile = (indexToRemove) => {
    setUpdateOffFiles((current) => current.filter((file, index) => index !== indexToRemove));
  };

  const toggleAdditionalVideo = (videoId) => {
    setSelectedAdditionalVideoIds((current) =>
      replacementSegmentId
        ? (current.includes(videoId) ? [] : [videoId])
        : (current.includes(videoId)
          ? current.filter((id) => id !== videoId)
          : [...current, videoId])
    );
  };

  const updateAdditionalClipNote = (videoId, value) => {
    setAdditionalClipNotes((current) => ({
      ...current,
      [videoId]: value,
    }));
  };

  const handleReporterUpdate = () => {
    if (replacementSegmentId) {
      setErrorMessage('Finish or cancel the clip replacement before sending a general job update.');
      return;
    }

    const segments = selectedAdditionalVideos.map((video, index) => ({
      video: video._id,
      order: sortedSegments.length + index,
      title: getClipName(video),
      notes: additionalClipNotes[video._id] || '',
      type: video.isBroll ? 'broll' : 'other',
      startTime: 0,
      endTime: Number(video.duration) || null,
      required: true,
    }));

    const formData = new FormData();
    formData.append('description', updateDescription);
    formData.append('scriptText', updateScriptText);
    formData.append('comment', updateComment);
    formData.append('segments', JSON.stringify(segments));
    updateOffFiles.forEach((file) => {
      formData.append('offFiles', file, file.name);
    });

    setUpdateSaving(true);
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .patch(`/edit-jobs/${jobId}/reporter-update`, formData)
      .then((response) => {
        updateJobFromResponse(response, 'Job update sent to production.');
        setUpdateComment('');
        setUpdateOffFiles([]);
        setSelectedAdditionalVideoIds([]);
        setAdditionalClipNotes({});
        fetchAvailableVideos();
      })
      .catch((error) => {
        console.error('Error updating job:', error);
        setErrorMessage(getRequestErrorMessage(error, 'Job could not be updated.'));
      })
      .finally(() => setUpdateSaving(false));
  };

  const startReplaceSegment = (segment) => {
    setReplacementSegmentId(segment._id);
    setSelectedAdditionalVideoIds([]);
    setAdditionalClipNotes({});
    setMessage('');
    setErrorMessage('');
  };

  const cancelReplaceSegment = () => {
    setReplacementSegmentId('');
    setSelectedAdditionalVideoIds([]);
    setAdditionalClipNotes({});
  };

  const handleReplaceSegment = () => {
    if (!replacementSegment) {
      setErrorMessage('Select the job clip you want to replace.');
      return;
    }

    if (selectedAdditionalVideos.length !== 1) {
      setErrorMessage('Select exactly one replacement clip.');
      return;
    }

    const replacementVideo = selectedAdditionalVideos[0];

    setSegmentActionLoading(`replace-${replacementSegment._id}`);
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .patch(`/edit-jobs/${jobId}/segments/${replacementSegment._id}/replace`, {
        videoId: replacementVideo._id,
        title: getClipName(replacementVideo),
        notes: additionalClipNotes[replacementVideo._id] || replacementSegment.notes || '',
        type: replacementVideo.isBroll ? 'broll' : replacementSegment.type || 'other',
        startTime: 0,
        endTime: Number(replacementVideo.duration) || null,
        required: replacementSegment.required !== false,
      })
      .then((response) => {
        updateJobFromResponse(response, 'Clip replaced. Editor will see it as new material.');
        cancelReplaceSegment();
        fetchAvailableVideos();
      })
      .catch((error) => {
        console.error('Error replacing job clip:', error);
        setErrorMessage(getRequestErrorMessage(error, 'Clip could not be replaced.'));
      })
      .finally(() => setSegmentActionLoading(''));
  };

  const handleDeleteSegment = (segment) => {
    if (!segment?._id) return;

    const label = segment.title || segment.video?.originalFilename || segment.video?.filename || 'this clip';
    const confirmed = window.confirm(`Remove "${label}" from this job?`);
    if (!confirmed) return;

    setSegmentActionLoading(`delete-${segment._id}`);
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .delete(`/edit-jobs/${jobId}/segments/${segment._id}`)
      .then((response) => {
        updateJobFromResponse(response, 'Clip removed from job.');
        if (replacementSegmentId === segment._id) {
          cancelReplaceSegment();
        }
        fetchAvailableVideos();
      })
      .catch((error) => {
        console.error('Error removing job clip:', error);
        setErrorMessage(getRequestErrorMessage(error, 'Clip could not be removed from job.'));
      })
      .finally(() => setSegmentActionLoading(''));
  };

  const handleFinalFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setFinalFile(file);
    event.target.value = '';
  };

  const handleFinalUpload = () => {
    if (!finalFile) {
      setErrorMessage('Select a final video file.');
      return;
    }
    if (!finalProgramId || !finalContentTypeId || !finalAirDate) {
      setErrorMessage('Program, content type and air date are required.');
      return;
    }

    const formData = new FormData();
    formData.append('finalVideo', finalFile, finalFile.name);
    formData.append('programId', finalProgramId);
    formData.append('contentTypeId', finalContentTypeId);
    formData.append('airDate', finalAirDate);
    formData.append('finalTitle', finalTitle);
    formData.append('notes', finalNotes);

    setFinalUploading(true);
    setFinalUploadProgress(0);
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .post(`/edit-jobs/${jobId}/final-upload`, formData, {
        onUploadProgress: (progressEvent) => {
          const total = progressEvent.total || 0;
          if (total > 0) {
            setFinalUploadProgress(Math.round((progressEvent.loaded * 100) / total));
          }
        },
      })
      .then((response) => {
        updateJobFromResponse(response, response.data?.message || 'Final video uploaded.');
        setFinalFile(null);
        setFinalNotes('');
        setFinalUploadProgress(0);
        fetchFinalVideos();
      })
      .catch((error) => {
        console.error('Error uploading final video:', error);
        setErrorMessage(getRequestErrorMessage(error, 'Final video could not be uploaded.'));
      })
      .finally(() => setFinalUploading(false));
  };

  const handleFinalApproval = (video, approved) => {
    axiosInstance
      .post(`/broadcast/final-videos/${video._id}/approve`, {
        approved,
        notes: finalNotes,
      })
      .then((response) => {
        setMessage(response.data?.message || 'Final video approval updated.');
        setErrorMessage('');
        fetchFinalVideos();
        fetchJob();
      })
      .catch((error) => {
        console.error('Error approving final video:', error);
        setErrorMessage(getRequestErrorMessage(error, 'Final video approval could not be updated.'));
      });
  };

  const handleClaimAndDownload = () => {
    setPackageLoading(true);
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .patch(`/edit-jobs/${jobId}/claim`)
      .then((response) => {
        setJob(response.data.job);
        setStatus(response.data.job.status);
        return requestPackageDownload('missing');
      })
      .then(() => {
        setMessage('Job claimed and new/missing files download started.');
        fetchJob();
      })
      .catch(async (error) => {
        console.error('Error claiming and downloading job:', error);
        setErrorMessage(await getDownloadErrorMessage(error, 'Job could not be claimed or downloaded.'));
      })
      .finally(() => setPackageLoading(false));
  };

  const handleStatusUpdate = () => {
    axiosInstance
      .patch(`/edit-jobs/${jobId}/status`, { status })
      .then((response) => updateJobFromResponse(response, 'Status updated.'))
      .catch((error) => {
        console.error('Error updating job status:', error);
        setErrorMessage(error.response?.data?.message || 'Status could not be updated.');
      });
  };

  const handleAddComment = () => {
    if (!comment.trim()) return;

    axiosInstance
      .post(`/edit-jobs/${jobId}/comments`, { body: comment })
      .then((response) => {
        updateJobFromResponse(response, 'Comment added.');
        setComment('');
      })
      .catch((error) => {
        console.error('Error adding comment:', error);
        setErrorMessage(error.response?.data?.message || 'Comment could not be added.');
      });
  };

  if (!job) {
    return (
      <Box sx={{ p: 3 }}>
        {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : <Typography>Loading job...</Typography>}
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: 'background.default', minHeight: '100vh' }}>
      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}
      {job.viewerMeta?.hasUnreadChanges && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Reporter added {job.viewerMeta.unreadChangeCount} new update(s) since your last view.
        </Alert>
      )}

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            {job.title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Reporter: {job.reporter?.username || 'Unknown'} / Deadline: {formatDate(job.deadline)}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip label={formatLabel(job.status)} color="primary" />
          <Chip label={formatLabel(job.priority)} variant="outlined" />
          <Chip label={`${job.segments?.length || 0} segments`} variant="outlined" />
          {downloadMeta?.hasMissingFiles && (
            <Chip
              label={`${downloadMeta.missingSegmentCount + downloadMeta.missingOffFileCount} new files`}
              color="warning"
              variant="outlined"
            />
          )}
          {job.viewerMeta?.hasUnreadChanges && (
            <Chip label="New updates" color="warning" />
          )}
        </Stack>
      </Stack>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={8}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>
              Brief
            </Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {job.description || 'No brief provided.'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Program: {job.program || 'N/A'} / Assigned editor: {job.assignedEditor?.username || 'Unassigned'}
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
              Production control
            </Typography>
            <Stack spacing={1.5}>
              {canClaim && canDirectDownloadPackage && (
                <>
                  <Button
                    startIcon={<DownloadIcon />}
                    variant="contained"
                    onClick={() => handleDownloadPackage('missing')}
                    disabled={packageLoading || downloadMeta?.hasMissingFiles === false}
                  >
                    {downloadMeta?.hasMissingFiles === false ? 'No new files' : 'Download new / missed'}
                  </Button>
                  <Button
                    startIcon={<DownloadIcon />}
                    variant="outlined"
                    onClick={() => handleDownloadPackage('all')}
                    disabled={packageLoading}
                  >
                    Download full package
                  </Button>
                  {downloadMeta && (
                    <Typography variant="caption" color="text.secondary">
                      Last download: {downloadMeta.lastDownloadedAt ? formatDate(downloadMeta.lastDownloadedAt) : 'Never'} / missing {downloadMeta.missingSegmentCount} clip(s), {downloadMeta.missingOffFileCount} OFF file(s)
                    </Typography>
                  )}
                </>
              )}
              {canClaim && !canDirectDownloadPackage && (
                <Button
                  startIcon={<AssignmentIndIcon />}
                  variant="contained"
                  onClick={handleClaimAndDownload}
                  disabled={packageLoading}
                >
                  Claim & download new / missed
                </Button>
              )}
              {canClaim && !canDirectDownloadPackage && (
                <Button variant="outlined" onClick={handleClaim} disabled={packageLoading}>
                  Claim Only
                </Button>
              )}
              <FormControl fullWidth disabled={!canUpdateStatus}>
                <InputLabel>Status</InputLabel>
                <Select value={status} label="Status" onChange={(e) => setStatus(e.target.value)}>
                  {statusOptions.map((option) => (
                    <MenuItem key={option} value={option}>
                      {formatLabel(option)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button variant="outlined" onClick={handleStatusUpdate} disabled={!canUpdateStatus}>
                Save Status
              </Button>
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={7}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <ArticleIcon color="action" />
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Brief / reporter text
              </Typography>
            </Stack>
            <Typography
              variant="body2"
              sx={{
                whiteSpace: 'pre-wrap',
                bgcolor: 'grey.50',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.5,
                minHeight: 180,
              }}
            >
              {job.scriptText || job.description || 'No brief text provided.'}
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12} md={5}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <AudiotrackIcon color="action" />
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                OFF audio
              </Typography>
              <Chip label={`${job.offFiles?.length || 0}`} size="small" />
            </Stack>

            {(job.offFiles || []).length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No OFF audio attached.
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {job.offFiles.map((offFile) => (
                  <Paper key={offFile._id} variant="outlined" sx={{ p: 1.25, borderRadius: 1 }}>
                    <Stack spacing={1}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <AudiotrackIcon color="action" fontSize="small" />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                            {offFile.originalName || offFile.filename || 'OFF audio'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatBytes(offFile.size)}
                          </Typography>
                        </Box>
                        <Tooltip title="Download OFF">
                          <IconButton size="small" onClick={() => handleDownloadOffFile(offFile)}>
                            <DownloadIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                      <OffAudioPlayer jobId={jobId} offFile={offFile} />
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            )}
          </Paper>
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3 }}>
        <Stack spacing={2}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            justifyContent="space-between"
            alignItems={{ xs: 'stretch', md: 'center' }}
          >
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Final delivery
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Upload finished local edits and approve them before producer rundown.
              </Typography>
            </Box>
            {canUploadFinal && (
              <Button component="label" variant="outlined" startIcon={<CloudUploadIcon />}>
                Select final
                <input
                  hidden
                  type="file"
                  accept={ACCEPTED_VIDEO_FILE_TYPES}
                  onChange={handleFinalFileChange}
                />
              </Button>
            )}
          </Stack>

          {canUploadFinal && (
            <Grid container spacing={1.5}>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Final title"
                  value={finalTitle}
                  onChange={(event) => setFinalTitle(event.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <FormControl fullWidth>
                  <InputLabel>Program</InputLabel>
                  <Select
                    value={finalProgramId}
                    label="Program"
                    onChange={(event) => setFinalProgramId(event.target.value)}
                  >
                    {programs.map((program) => (
                      <MenuItem key={program._id} value={program._id}>
                        {program.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={3}>
                <FormControl fullWidth>
                  <InputLabel>Content type</InputLabel>
                  <Select
                    value={finalContentTypeId}
                    label="Content type"
                    onChange={(event) => setFinalContentTypeId(event.target.value)}
                  >
                    {contentTypes.map((type) => (
                      <MenuItem key={type._id} value={type._id}>
                        {type.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={2}>
                <TextField
                  label="Air date"
                  type="date"
                  value={finalAirDate}
                  onChange={(event) => setFinalAirDate(event.target.value)}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Delivery note / approval note"
                  value={finalNotes}
                  onChange={(event) => setFinalNotes(event.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
                  <Chip label={finalFile ? finalFile.name : 'No final file selected'} />
                  <Button variant="contained" onClick={handleFinalUpload} disabled={finalUploading || !finalFile}>
                    {finalUploading ? 'Uploading...' : 'Upload final'}
                  </Button>
                </Stack>
                {finalUploadProgress > 0 && (
                  <Box sx={{ mt: 1.5 }}>
                    <LinearProgress variant="determinate" value={finalUploadProgress} />
                    <Typography variant="caption" color="text.secondary">
                      Upload {finalUploadProgress}%
                    </Typography>
                  </Box>
                )}
              </Grid>
            </Grid>
          )}

          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Final video</TableCell>
                  <TableCell>Program</TableCell>
                  <TableCell>Processing</TableCell>
                  <TableCell>Approval</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {finalVideos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                        No final videos uploaded for this job.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  finalVideos.map((video) => (
                    <TableRow key={video._id} hover>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 800 }}>
                          {video.finalTitle || video.originalFilename || video.filename}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Uploaded by {video.uploader?.username || 'Unknown'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" display="block">
                          Reporter: {video.reporter?.username || 'N/A'} / Editor: {video.editor?.username || 'N/A'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{video.program?.name || 'N/A'}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {video.contentType?.name || 'N/A'} / {formatDate(video.airDate)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip label={formatLabel(video.processingStatus)} size="small" />
                        {['queued', 'processing'].includes(video.processingStatus) && (
                          <Box sx={{ mt: 1, width: 140 }}>
                            <LinearProgress variant="determinate" value={Number(video.processingProgress) || 0} />
                          </Box>
                        )}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                          <Chip
                            label={formatLabel(video.finalApprovalStatus || 'pending')}
                            size="small"
                            color={video.finalApprovalStatus === 'approved' ? 'success' : video.finalApprovalStatus === 'rejected' ? 'error' : 'warning'}
                          />
                          {video.finalApprovedBy?.username && (
                            <Chip label={video.finalApprovedBy.username} size="small" variant="outlined" />
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          {canApproveFinal && video.finalApprovalStatus === 'pending' && video.processingStatus === 'completed' && (
                            <>
                              <Tooltip title="Approve final">
                                <IconButton size="small" color="success" onClick={() => handleFinalApproval(video, true)}>
                                  <CheckCircleIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Reject final">
                                <IconButton size="small" color="error" onClick={() => handleFinalApproval(video, false)}>
                                  <CancelIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </>
                          )}
                          <Tooltip title="Open video">
                            <IconButton component={Link} to={`/video-details/${video._id}`} size="small">
                              <OpenInNewIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Stack>
      </Paper>

      {canReporterUpdateJob && !['aired', 'archived'].includes(job.status) && (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3 }}>
          <Stack spacing={2}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1.5}
              justifyContent="space-between"
              alignItems={{ xs: 'stretch', md: 'center' }}
            >
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  Update job
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Add missing material, update the brief, or send new OFF audio to production.
                </Typography>
              </Box>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={fetchAvailableVideos}
                disabled={materialLoading}
              >
                Refresh material
              </Button>
            </Stack>

            <Grid container spacing={1.5}>
              <Grid item xs={12} md={5}>
                <TextField
                  label="Brief summary"
                  value={updateDescription}
                  onChange={(event) => setUpdateDescription(event.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} md={7}>
                <BriefImportButton onImported={handleBriefImported} />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Brief / reporter text"
                  value={updateScriptText}
                  onChange={(event) => setUpdateScriptText(event.target.value)}
                  multiline
                  minRows={5}
                  fullWidth
                />
              </Grid>
            </Grid>

            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                justifyContent="space-between"
                alignItems={{ xs: 'stretch', sm: 'center' }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <AudiotrackIcon color="action" />
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>
                      Add OFF audio
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {updateOffFiles.length} new file(s) selected
                    </Typography>
                  </Box>
                </Stack>
                <Button component="label" variant="outlined" startIcon={<AudiotrackIcon />}>
                  Add OFF
                  <input
                    hidden
                    type="file"
                    multiple
                    accept="audio/*,.wav,.wave,.mp3,.m4a,.aac,.flac,.ogg,.opus,.wma"
                    onChange={handleUpdateOffFileSelection}
                  />
                </Button>
              </Stack>

              {updateOffFiles.length > 0 && (
                <Stack spacing={1} sx={{ mt: 1.5 }}>
                  {updateOffFiles.map((file, index) => (
                    <Paper key={`${file.name}-${file.lastModified}-${index}`} variant="outlined" sx={{ p: 1, borderRadius: 1 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <AudiotrackIcon color="action" fontSize="small" />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                            {file.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatBytes(file.size)}
                          </Typography>
                        </Box>
                        <Tooltip title="Remove OFF file">
                          <IconButton size="small" onClick={() => removeUpdateOffFile(index)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              )}
            </Paper>

            <Stack spacing={1}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1}
                justifyContent="space-between"
                alignItems={{ xs: 'stretch', md: 'center' }}
              >
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                    {replacementSegment ? 'Choose replacement clip' : 'Add missing clips / inserts'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {replacementSegment
                      ? `Replacing: ${replacementSegment.title || replacementSegment.video?.originalFilename || replacementSegment.video?.filename || 'selected segment'}`
                      : `${selectedAdditionalVideos.length} clip(s) selected`}
                  </Typography>
                </Box>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  {replacementSegment && (
                    <>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<SwapHorizIcon />}
                        onClick={handleReplaceSegment}
                        disabled={segmentActionLoading === `replace-${replacementSegment._id}` || selectedAdditionalVideos.length !== 1}
                      >
                        Replace clip
                      </Button>
                      <Button size="small" variant="outlined" onClick={cancelReplaceSegment}>
                        Cancel
                      </Button>
                    </>
                  )}
                  <TextField
                    size="small"
                    label="Search material"
                    value={materialSearch}
                    onChange={(event) => setMaterialSearch(event.target.value)}
                    sx={{ minWidth: { md: 280 } }}
                  />
                </Stack>
              </Stack>

              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, maxHeight: 340 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">Use</TableCell>
                      <TableCell>Clip</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Duration</TableCell>
                      <TableCell>Note</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredAdditionalVideos.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                            {materialLoading ? 'Loading material...' : 'No additional clips found for this job event.'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredAdditionalVideos.map((video) => {
                        const selected = selectedAdditionalVideoIds.includes(video._id);

                        return (
                          <TableRow key={video._id} hover selected={selected}>
                            <TableCell padding="checkbox">
                              <Checkbox checked={selected} onChange={() => toggleAdditionalVideo(video._id)} />
                            </TableCell>
                            <TableCell sx={{ minWidth: 220 }}>
                              <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                                {getClipName(video)}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {video.event || 'No event'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Chip label={video.processingStatus || 'N/A'} size="small" />
                            </TableCell>
                            <TableCell>{formatDuration(video.duration)}</TableCell>
                            <TableCell sx={{ minWidth: 220 }}>
                              <TextField
                                size="small"
                                value={additionalClipNotes[video._id] || ''}
                                onChange={(event) => updateAdditionalClipNote(video._id, event.target.value)}
                                fullWidth
                                disabled={!selected}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>

            <TextField
              label="Update note"
              value={updateComment}
              onChange={(event) => setUpdateComment(event.target.value)}
              multiline
              minRows={2}
              fullWidth
            />

            <Button
              variant="contained"
              onClick={handleReporterUpdate}
              disabled={updateSaving || Boolean(replacementSegment)}
              sx={{ alignSelf: 'flex-start' }}
            >
              {replacementSegment ? 'Finish replacement first' : (updateSaving ? 'Sending update...' : 'Send update to production')}
            </Button>
          </Stack>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
          Requested segments
        </Typography>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Clip</TableCell>
                <TableCell>Range</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Notes</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedSegments.map((segment, index) => (
                <TableRow key={segment._id || index} hover selected={segment._id === replacementSegmentId}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>
                      {segment.video?.originalFilename || segment.video?.filename || 'Unknown clip'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {[segment.video?.event || 'No event', segment.video?.location].filter(Boolean).join(' / ')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {formatTime(segment.startTime)}
                    {segment.endTime !== null && segment.endTime !== undefined
                      ? ` - ${formatTime(segment.endTime)}`
                      : ' / point'}
                  </TableCell>
                  <TableCell>
                    <Chip label={formatLabel(segment.type)} size="small" />
                  </TableCell>
                  <TableCell>{segment.notes || segment.title || 'No notes'}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      {segment.video?._id && (
                        <Tooltip title="Open source clip">
                          <IconButton
                            component={Link}
                            to={`/video-details/${segment.video._id}?start=${segment.startTime || 0}`}
                            size="small"
                          >
                            <OpenInNewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {canEditSegments && (
                        <>
                          <Tooltip title="Replace clip in job">
                            <IconButton
                              size="small"
                              color={segment._id === replacementSegmentId ? 'primary' : 'default'}
                              onClick={() => startReplaceSegment(segment)}
                              disabled={Boolean(segmentActionLoading)}
                            >
                              <SwapHorizIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Remove clip from job">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => handleDeleteSegment(segment)}
                              disabled={Boolean(segmentActionLoading)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
          Job updates
        </Typography>
        <Stack spacing={1.5}>
          {sortedChangeLog.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No job updates recorded.
            </Typography>
          ) : (
            sortedChangeLog.map((change) => (
              <Box key={change._id}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Chip label={formatLabel(change.type)} size="small" />
                  <Typography variant="body2" sx={{ fontWeight: 800 }}>
                    {change.summary}
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {change.author?.username || 'Unknown'} / {formatDate(change.createdAt)}
                </Typography>
                <Divider sx={{ mt: 1 }} />
              </Box>
            ))
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
          Job comments
        </Typography>
        <Stack spacing={1.5}>
          {(job.comments || []).map((jobComment) => (
            <Box key={jobComment._id}>
              <Typography variant="body2">{jobComment.body}</Typography>
              <Typography variant="caption" color="text.secondary">
                {jobComment.author?.username || 'Unknown'} / {formatDate(jobComment.createdAt)}
              </Typography>
              <Divider sx={{ mt: 1 }} />
            </Box>
          ))}

          <TextField
            label="Add comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
          <Button variant="contained" onClick={handleAddComment}>
            Add Comment
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
};

export default EditJobDetailsPage;
