import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
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
import AssignmentIcon from '@mui/icons-material/Assignment';
import AudiotrackIcon from '@mui/icons-material/Audiotrack';
import DeleteIcon from '@mui/icons-material/Delete';
import EventIcon from '@mui/icons-material/Event';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArticleIcon from '@mui/icons-material/Article';
import TodayIcon from '@mui/icons-material/Today';
import axiosInstance from '../../axiosConfig';
import BriefImportButton from './BriefImportButton';
import {
  ACTIVE_PROCESSING_REFRESH_MS,
  hasActiveVideoProcessing,
  isVideoProcessingActive,
} from '../../utils/videoProcessing';

const priorityOptions = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const statusColor = {
  queued: 'default',
  processing: 'warning',
  completed: 'success',
  failed: 'error',
};

const getTodayInputValue = () => {
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  return today.toISOString().slice(0, 10);
};

const normalizeDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const formatDate = (value) => {
  if (!value) return 'No date';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'No date';
  return date.toLocaleDateString();
};

const formatDuration = (seconds) => {
  if (!seconds && seconds !== 0) return 'N/A';
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
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

const getClipName = (video) => video.originalFilename || video.filename || `Video ${video._id}`;

const buildGroups = (videos) => {
  const groups = new Map();

  videos.forEach((video) => {
    const dateKey = normalizeDate(video.tagDate || video.uploadDate) || 'no-date';
    const eventName = video.event || 'No event';
    const groupKey = `${dateKey}::${eventName}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key: groupKey,
        dateKey,
        event: eventName,
        videos: [],
      });
    }

    groups.get(groupKey).videos.push(video);
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      videos: [...group.videos].sort((a, b) => {
        const first = new Date(a.uploadDate || a.tagDate || 0).getTime();
        const second = new Date(b.uploadDate || b.tagDate || 0).getTime();
        return first - second;
      }),
    }))
    .sort((a, b) => {
      if (a.dateKey !== b.dateKey) {
        return b.dateKey.localeCompare(a.dateKey);
      }

      return a.event.localeCompare(b.event);
    });
};

const ReporterEventWorkspace = ({ refreshToken = 0, onJobCreated }) => {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dateFilter, setDateFilter] = useState(getTodayInputValue);
  const [eventFilter, setEventFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeGroupKey, setActiveGroupKey] = useState('');
  const [selectedVideoIds, setSelectedVideoIds] = useState([]);
  const [clipNotes, setClipNotes] = useState({});
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [offFiles, setOffFiles] = useState([]);
  const [program, setProgram] = useState('');
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState('normal');
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [createdJobId, setCreatedJobId] = useState('');

  const fetchVideos = useCallback(({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setErrorMessage('');
    }

    axiosInstance
      .get('/videos', {
        params: dateFilter ? { date: dateFilter } : {},
        headers: { Accept: 'application/json' },
      })
      .then((response) => {
        setVideos(Array.isArray(response.data) ? response.data : []);
      })
      .catch((error) => {
        console.error('Error fetching reporter videos:', error);
        if (!silent) {
          setErrorMessage('Clips could not be loaded.');
        }
      })
      .finally(() => {
        if (!silent) {
          setLoading(false);
        }
      });
  }, [dateFilter]);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos, refreshToken]);

  const hasActiveProcessing = useMemo(() => hasActiveVideoProcessing(videos), [videos]);

  useEffect(() => {
    if (!hasActiveProcessing) return undefined;

    const intervalId = window.setInterval(() => {
      fetchVideos({ silent: true });
    }, ACTIVE_PROCESSING_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [fetchVideos, hasActiveProcessing]);

  const eventOptions = useMemo(() => {
    const events = videos.map((video) => video.event).filter(Boolean);
    return Array.from(new Set(events)).sort();
  }, [videos]);

  const filteredVideos = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return videos.filter((video) => {
      const matchesEvent = eventFilter === 'all' || (video.event || 'No event') === eventFilter;
      const matchesSearch =
        !search ||
        [video.originalFilename, video.filename, video.event, video.processingStatus]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));

      return matchesEvent && matchesSearch;
    });
  }, [videos, eventFilter, searchTerm]);

  const groups = useMemo(() => buildGroups(filteredVideos), [filteredVideos]);

  const activeGroup = useMemo(
    () => groups.find((group) => group.key === activeGroupKey) || null,
    [groups, activeGroupKey]
  );

  useEffect(() => {
    if (groups.length === 0) {
      setActiveGroupKey('');
      return;
    }

    if (!groups.some((group) => group.key === activeGroupKey)) {
      setActiveGroupKey(groups[0].key);
    }
  }, [groups, activeGroupKey]);

  useEffect(() => {
    if (!activeGroup) {
      setSelectedVideoIds([]);
      return;
    }

    setSelectedVideoIds(activeGroup.videos.map((video) => video._id));
    setClipNotes({});
    setTitle(`${activeGroup.event} - ${formatDate(activeGroup.dateKey)}`);
    setDescription('');
    setScriptText('');
    setOffFiles([]);
    setComment('');
    setCreatedJobId('');
  }, [activeGroup]);

  const selectedVideos = useMemo(() => {
    if (!activeGroup) return [];
    return activeGroup.videos.filter((video) => selectedVideoIds.includes(video._id));
  }, [activeGroup, selectedVideoIds]);

  const activeStats = useMemo(() => {
    const groupVideos = activeGroup?.videos || [];
    return {
      total: groupVideos.length,
      ready: groupVideos.filter((video) => video.processingStatus === 'completed').length,
      working: groupVideos.filter((video) => ['queued', 'processing'].includes(video.processingStatus)).length,
      failed: groupVideos.filter((video) => video.processingStatus === 'failed').length,
    };
  }, [activeGroup]);

  const toggleClip = (videoId) => {
    setSelectedVideoIds((current) =>
      current.includes(videoId)
        ? current.filter((id) => id !== videoId)
        : [...current, videoId]
    );
  };

  const handleSelectAll = () => {
    if (!activeGroup) return;

    if (selectedVideoIds.length === activeGroup.videos.length) {
      setSelectedVideoIds([]);
      return;
    }

    setSelectedVideoIds(activeGroup.videos.map((video) => video._id));
  };

  const updateClipNote = (videoId, value) => {
    setClipNotes((current) => ({
      ...current,
      [videoId]: value,
    }));
  };

  const handleOffFileSelection = (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      setOffFiles((current) => [...current, ...files]);
    }
    event.target.value = '';
  };

  const removeOffFile = (indexToRemove) => {
    setOffFiles((current) => current.filter((file, index) => index !== indexToRemove));
  };

  const handleBriefImported = (importedText) => {
    setScriptText((current) => {
      const existingText = current.trim();
      if (!existingText) return importedText;
      return `${existingText}\n\n${importedText}`;
    });
  };

  const handleCreateJob = () => {
    setMessage('');
    setErrorMessage('');
    setCreatedJobId('');

    if (!title.trim()) {
      setErrorMessage('Job title is required.');
      return;
    }

    if (selectedVideos.length === 0) {
      setErrorMessage('Select at least one clip.');
      return;
    }

    const segments = selectedVideos.map((video, index) => ({
      video: video._id,
      order: index,
      title: getClipName(video),
      notes: clipNotes[video._id] || '',
      type: video.isBroll ? 'broll' : 'other',
      startTime: 0,
      endTime: Number(video.duration) || null,
      required: true,
    }));

    const formData = new FormData();
    formData.append('title', title.trim());
    formData.append('description', description);
    formData.append('scriptText', scriptText);
    formData.append('program', program);
    formData.append('deadline', deadline);
    formData.append('priority', priority);
    formData.append('comment', comment);
    formData.append('segments', JSON.stringify(segments));
    offFiles.forEach((file) => {
      formData.append('offFiles', file, file.name);
    });

    axiosInstance
      .post('/edit-jobs', formData)
      .then((response) => {
        setMessage('Edit job sent to production.');
        setCreatedJobId(response.data.job?._id || '');
        setComment('');

        if (onJobCreated) {
          onJobCreated(response.data.job);
        }
      })
      .catch((error) => {
        console.error('Error creating grouped edit job:', error);
        setErrorMessage(error.response?.data?.message || 'Edit job could not be created.');
      });
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', md: 'center' }}
        >
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              Event Workspace
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {activeGroup ? `${activeGroup.event} / ${formatDate(activeGroup.dateKey)}` : 'No active group'}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<TodayIcon />}
              onClick={() => setDateFilter(getTodayInputValue())}
            >
              Today
            </Button>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchVideos} disabled={loading}>
              Refresh
            </Button>
          </Stack>
        </Stack>

        {message && <Alert severity="success">{message}</Alert>}
        {createdJobId && (
          <Button component={Link} to={`/edit-jobs/${createdJobId}`} variant="outlined" sx={{ alignSelf: 'flex-start' }}>
            Open created job
          </Button>
        )}
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

        <Grid container spacing={1.5}>
          <Grid item xs={12} md={3}>
            <TextField
              label="Date"
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth>
              <InputLabel>Event</InputLabel>
              <Select value={eventFilter} label="Event" onChange={(event) => setEventFilter(event.target.value)}>
                <MenuItem value="all">All events</MenuItem>
                {eventOptions.map((eventName) => (
                  <MenuItem key={eventName} value={eventName}>
                    {eventName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={5}>
            <TextField
              label="Search clips"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              fullWidth
            />
          </Grid>
        </Grid>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <Stack spacing={1}>
                {groups.length === 0 ? (
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, textAlign: 'center' }}>
                    <EventIcon color="disabled" />
                    <Typography variant="body2" color="text.secondary">
                      No clips for selected filters.
                    </Typography>
                  </Paper>
                ) : (
                  groups.map((group) => {
                    const selected = group.key === activeGroupKey;
                    const readyCount = group.videos.filter((video) => video.processingStatus === 'completed').length;

                    return (
                      <Paper
                        key={group.key}
                        variant="outlined"
                        onClick={() => setActiveGroupKey(group.key)}
                        sx={{
                          p: 1.5,
                          borderRadius: 2,
                          cursor: 'pointer',
                          borderColor: selected ? 'primary.main' : 'divider',
                          bgcolor: selected ? 'action.selected' : 'background.paper',
                        }}
                      >
                        <Stack direction="row" justifyContent="space-between" spacing={1}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                              {group.event}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {formatDate(group.dateKey)}
                            </Typography>
                          </Box>
                          <Chip label={`${group.videos.length} clips`} size="small" />
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {readyCount}/{group.videos.length} ready
                        </Typography>
                      </Paper>
                    );
                  })
                )}
              </Stack>
            </Grid>

            <Grid item xs={12} md={8}>
              <Stack spacing={2}>
                <Grid container spacing={1}>
                  <Grid item xs={6} md={3}>
                    <WorkspaceStat label="Clips" value={activeStats.total} />
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <WorkspaceStat label="Ready" value={activeStats.ready} tone="success.main" />
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <WorkspaceStat label="Working" value={activeStats.working} tone="warning.main" />
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <WorkspaceStat label="Failed" value={activeStats.failed} tone="error.main" />
                  </Grid>
                </Grid>

                <Grid container spacing={1.5}>
                  <Grid item xs={12} md={6}>
                    <TextField
                      label="Job title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      fullWidth
                      required
                    />
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <TextField label="Program" value={program} onChange={(event) => setProgram(event.target.value)} fullWidth />
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <FormControl fullWidth>
                      <InputLabel>Priority</InputLabel>
                      <Select value={priority} label="Priority" onChange={(event) => setPriority(event.target.value)}>
                        {priorityOptions.map((option) => (
                          <MenuItem key={option.value} value={option.value}>
                            {option.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <TextField
                      label="Deadline"
                      type="datetime-local"
                      value={deadline}
                      onChange={(event) => setDeadline(event.target.value)}
                      fullWidth
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                  <Grid item xs={12} md={8}>
                    <TextField
                      label="Brief summary"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      fullWidth
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      label="Brief / reporter text"
                      value={scriptText}
                      onChange={(event) => setScriptText(event.target.value)}
                      multiline
                      minRows={6}
                      fullWidth
                      placeholder={'OFF:\n\nIZJAVA:\n\nINSERT / GRAFIKA:\n\nOFF:'}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <BriefImportButton onImported={handleBriefImported} />
                  </Grid>
                  <Grid item xs={12}>
                    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={1.5}
                        alignItems={{ xs: 'stretch', sm: 'center' }}
                        justifyContent="space-between"
                      >
                        <Stack direction="row" spacing={1} alignItems="center">
                          <ArticleIcon color="action" />
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 800 }}>
                              Reporter brief and OFF audio
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {scriptText.trim() ? 'Brief text added' : 'No brief text'} / {offFiles.length} OFF file(s)
                            </Typography>
                          </Box>
                        </Stack>

                        <Button
                          component="label"
                          variant="outlined"
                          startIcon={<AudiotrackIcon />}
                        >
                          Add OFF
                          <input
                            hidden
                            type="file"
                            multiple
                            accept="audio/*,.wav,.wave,.mp3,.m4a,.aac,.flac,.ogg,.opus,.wma"
                            onChange={handleOffFileSelection}
                          />
                        </Button>
                      </Stack>

                      {offFiles.length > 0 && (
                        <Stack spacing={1} sx={{ mt: 1.5 }}>
                          {offFiles.map((file, index) => (
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
                                  <IconButton size="small" onClick={() => removeOffFile(index)}>
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Stack>
                            </Paper>
                          ))}
                        </Stack>
                      )}
                    </Paper>
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      label="Instruction"
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      multiline
                      minRows={2}
                      fullWidth
                    />
                  </Grid>
                </Grid>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                  <Button variant="outlined" onClick={handleSelectAll} disabled={!activeGroup}>
                    {activeGroup && selectedVideoIds.length === activeGroup.videos.length ? 'Clear clips' : 'Select all'}
                  </Button>
                  <Chip label={`${selectedVideos.length} selected`} />
                  <Box sx={{ flex: 1 }} />
                  <Button
                    variant="contained"
                    startIcon={<AssignmentIcon />}
                    onClick={handleCreateJob}
                    disabled={!activeGroup || selectedVideos.length === 0}
                  >
                    Send to Production
                  </Button>
                </Stack>

                <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">Use</TableCell>
                        <TableCell>Clip</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Duration</TableCell>
                        <TableCell>Note</TableCell>
                        <TableCell align="right">Open</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(activeGroup?.videos || []).map((video) => {
                        const selected = selectedVideoIds.includes(video._id);
                        const processingProgress = Number(video.processingProgress) || 0;
                        const showProgress = isVideoProcessingActive(video);

                        return (
                          <TableRow key={video._id} hover selected={selected}>
                            <TableCell padding="checkbox">
                              <Checkbox checked={selected} onChange={() => toggleClip(video._id)} />
                            </TableCell>
                            <TableCell sx={{ minWidth: 220 }}>
                              <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                                {getClipName(video)}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {video.status || 'raw'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={video.processingStatus || 'N/A'}
                                size="small"
                                color={statusColor[video.processingStatus] || 'default'}
                              />
                              {showProgress && (
                                <Box sx={{ mt: 1, width: 140 }}>
                                  <LinearProgress variant="determinate" value={processingProgress} />
                                  <Typography variant="caption" color="text.secondary">
                                    {processingProgress}%
                                  </Typography>
                                </Box>
                              )}
                            </TableCell>
                            <TableCell>{formatDuration(video.duration)}</TableCell>
                            <TableCell sx={{ minWidth: 220 }}>
                              <TextField
                                size="small"
                                value={clipNotes[video._id] || ''}
                                onChange={(event) => updateClipNote(video._id, event.target.value)}
                                fullWidth
                              />
                            </TableCell>
                            <TableCell align="right">
                              <Tooltip title="Open clip">
                                <IconButton component={Link} to={`/video-details/${video._id}`} size="small">
                                  <OpenInNewIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Stack>
            </Grid>
          </Grid>
        )}
      </Stack>
    </Paper>
  );
};

const WorkspaceStat = ({ label, value, tone = 'text.primary' }) => (
  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
      {label}
    </Typography>
    <Typography variant="h6" sx={{ fontWeight: 800, color: tone }}>
      {value}
    </Typography>
  </Paper>
);

export default ReporterEventWorkspace;
