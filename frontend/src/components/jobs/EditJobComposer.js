import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AssignmentIcon from '@mui/icons-material/Assignment';
import ArticleIcon from '@mui/icons-material/Article';
import AudiotrackIcon from '@mui/icons-material/Audiotrack';
import DeleteIcon from '@mui/icons-material/Delete';
import axiosInstance from '../../axiosConfig';
import BriefImportButton from './BriefImportButton';

const segmentTypeOptions = [
  { value: 'sot', label: 'SOT / Izjava' },
  { value: 'broll', label: 'B-roll' },
  { value: 'standup', label: 'Standup' },
  { value: 'nat_sound', label: 'Nat sound' },
  { value: 'cutaway', label: 'Cutaway' },
  { value: 'graphic', label: 'Graphic' },
  { value: 'lower_third', label: 'Lower third' },
  { value: 'do_not_use', label: 'Do not use' },
  { value: 'other', label: 'Other' },
];

const priorityOptions = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const formatTime = (seconds) => {
  const totalSeconds = Math.max(0, Number(seconds) || 0);
  const wholeSeconds = Math.floor(totalSeconds);
  const milliseconds = Math.round((totalSeconds - wholeSeconds) * 1000);
  const date = new Date(0);
  date.setSeconds(wholeSeconds);
  return `${date.toISOString().substr(11, 8)}.${String(milliseconds).padStart(3, '0')}`;
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

const buildSegmentCandidates = (video, timecodes) => {
  const sorted = [...timecodes].sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  const candidates = [];
  let activeIn = null;

  sorted.forEach((marker) => {
    if (marker.type === 'in') {
      activeIn = marker;
      return;
    }

    if (marker.type === 'out' && activeIn) {
      candidates.push({
        id: `${activeIn._id || activeIn.timestamp}-${marker._id || marker.timestamp}`,
        video: video._id,
        title: `${activeIn.description || 'In'} -> ${marker.description || 'Out'}`,
        notes: [activeIn.description, marker.description].filter(Boolean).join(' / '),
        type: 'other',
        startTime: Number(activeIn.timestamp) || 0,
        endTime: Number(marker.timestamp) || 0,
        sourceInMarker: activeIn._id,
        sourceOutMarker: marker._id,
        required: true,
      });
      activeIn = null;
    }
  });

  sorted
    .filter((marker) => ['cut', 'note'].includes(marker.type))
    .forEach((marker) => {
      candidates.push({
        id: marker._id || `${marker.type}-${marker.timestamp}`,
        video: video._id,
        title: marker.description || marker.type,
        notes: marker.description || '',
        type: marker.type === 'cut' ? 'cutaway' : 'other',
        startTime: Number(marker.timestamp) || 0,
        endTime: null,
        sourceInMarker: marker._id,
        sourceOutMarker: '',
        required: marker.type !== 'note',
      });
    });

  if (video?._id) {
    candidates.unshift({
      id: 'full-clip',
      video: video._id,
      title: 'Full clip reference',
      notes: 'Use this when the whole clip should be available to the editor.',
      type: 'other',
      startTime: 0,
      endTime: Number(video.duration) || null,
      sourceInMarker: '',
      sourceOutMarker: '',
      required: false,
    });
  }

  return candidates;
};

const EditJobComposer = ({ video, timecodes }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [offFiles, setOffFiles] = useState([]);
  const [programOptions, setProgramOptions] = useState([]);
  const [program, setProgram] = useState('');
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState('normal');
  const [comment, setComment] = useState('');
  const [selectedSegmentIds, setSelectedSegmentIds] = useState([]);
  const [segmentOverrides, setSegmentOverrides] = useState({});
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [createdJobId, setCreatedJobId] = useState('');

  const segmentCandidates = useMemo(
    () => (video ? buildSegmentCandidates(video, timecodes) : []),
    [video, timecodes]
  );

  useEffect(() => {
    axiosInstance
      .get('/broadcast/programs')
      .then((response) => {
        setProgramOptions(Array.isArray(response.data) ? response.data : []);
      })
      .catch((error) => {
        console.error('Error fetching broadcast programs:', error);
      });
  }, []);

  const updateSegmentOverride = (segmentId, field, value) => {
    setSegmentOverrides((prev) => ({
      ...prev,
      [segmentId]: {
        ...(prev[segmentId] || {}),
        [field]: value,
      },
    }));
  };

  const toggleSegment = (segmentId) => {
    setSelectedSegmentIds((prev) =>
      prev.includes(segmentId)
        ? prev.filter((id) => id !== segmentId)
        : [...prev, segmentId]
    );
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

    const selectedSegments = segmentCandidates
      .filter((segment) => selectedSegmentIds.includes(segment.id))
      .map((segment, index) => ({
        ...segment,
        ...(segmentOverrides[segment.id] || {}),
        order: index,
      }));

    if (selectedSegments.length === 0) {
      setErrorMessage('Select at least one segment or full clip reference.');
      return;
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', description);
    formData.append('scriptText', scriptText);
    formData.append('program', program);
    formData.append('deadline', deadline);
    formData.append('priority', priority);
    formData.append('comment', comment);
    formData.append('segments', JSON.stringify(selectedSegments));
    offFiles.forEach((file) => {
      formData.append('offFiles', file, file.name);
    });

    axiosInstance
      .post('/edit-jobs', formData)
      .then((response) => {
        setMessage('Edit job created and sent to production.');
        setCreatedJobId(response.data.job?._id || '');
        setTitle('');
        setDescription('');
        setScriptText('');
        setOffFiles([]);
        setProgram('');
        setDeadline('');
        setPriority('normal');
        setComment('');
        setSelectedSegmentIds([]);
        setSegmentOverrides({});
      })
      .catch((error) => {
        console.error('Error creating edit job:', error);
        setErrorMessage(error.response?.data?.message || 'Edit job could not be created.');
      });
  };

  return (
    <Paper variant="outlined" sx={{ mt: 3, p: { xs: 2, md: 3 }, borderRadius: 2 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Create Edit Job
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Send selected marker ranges and reporter instructions to the production desk.
          </Typography>
        </Box>
        <Chip icon={<AssignmentIcon />} label={`${selectedSegmentIds.length} selected`} />
      </Stack>

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {createdJobId && (
        <Button component={Link} to={`/edit-jobs/${createdJobId}`} variant="outlined" sx={{ mb: 2 }}>
          Open created job
        </Button>
      )}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <TextField label="Job title" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth required />
        </Grid>
        <Grid item xs={12} md={3}>
          <FormControl fullWidth>
            <InputLabel>Program</InputLabel>
            <Select value={program} label="Program" onChange={(e) => setProgram(e.target.value)}>
              <MenuItem value="">Select program</MenuItem>
              {programOptions.map((programOption) => (
                <MenuItem key={programOption._id} value={programOption.name}>
                  {programOption.name}{programOption.defaultTime ? ` / ${programOption.defaultTime}` : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} md={3}>
          <TextField
            label="Deadline"
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
        </Grid>
        <Grid item xs={12} md={3}>
          <FormControl fullWidth>
            <InputLabel>Priority</InputLabel>
            <Select value={priority} label="Priority" onChange={(e) => setPriority(e.target.value)}>
              {priorityOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} md={9}>
          <TextField
            label="Brief summary"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
          />
        </Grid>
        <Grid item xs={12}>
          <TextField
            label="Brief / reporter text"
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
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

              <Button component="label" variant="outlined" startIcon={<AudiotrackIcon />}>
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
            label="Initial comment / editing instruction"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
        </Grid>
      </Grid>

      <Typography variant="subtitle2" sx={{ mt: 3, mb: 1, fontWeight: 800 }}>
        Segment selection
      </Typography>

      <Stack spacing={1}>
        {segmentCandidates.map((segment) => {
          const selected = selectedSegmentIds.includes(segment.id);
          const override = segmentOverrides[segment.id] || {};

          return (
            <Paper key={segment.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Stack spacing={1}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
                  <FormControlLabel
                    control={<Checkbox checked={selected} onChange={() => toggleSegment(segment.id)} />}
                    label={
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 800 }}>
                          {segment.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatTime(segment.startTime)}
                          {segment.endTime !== null && segment.endTime !== undefined
                            ? ` - ${formatTime(segment.endTime)}`
                            : ' / point marker'}
                        </Typography>
                      </Box>
                    }
                    sx={{ flex: 1, m: 0 }}
                  />
                  <FormControl size="small" sx={{ minWidth: 170 }}>
                    <InputLabel>Type</InputLabel>
                    <Select
                      value={override.type || segment.type}
                      label="Type"
                      onChange={(e) => updateSegmentOverride(segment.id, 'type', e.target.value)}
                    >
                      {segmentTypeOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>
                <TextField
                  label="Segment notes"
                  value={override.notes ?? segment.notes}
                  onChange={(e) => updateSegmentOverride(segment.id, 'notes', e.target.value)}
                  fullWidth
                  size="small"
                />
              </Stack>
            </Paper>
          );
        })}
      </Stack>

      <Button variant="contained" onClick={handleCreateJob} sx={{ mt: 2 }}>
        Send to Production
      </Button>
    </Paper>
  );
};

export default EditJobComposer;
