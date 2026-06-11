import React, { useEffect, useState } from 'react';
import axios from '../../axiosConfig';
import {
  Alert,
  Box,
  Button,
  Chip,
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
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { ACCEPTED_VIDEO_FILE_TYPES } from '../../constants/videoFormats';

const getTodayInputValue = () => {
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  return today.toISOString().slice(0, 10);
};

const VideoUploadComponent = ({ onUploadComplete }) => {
  const [files, setFiles] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [contentTypes, setContentTypes] = useState([]);
  const [reporters, setReporters] = useState([]);
  const [programId, setProgramId] = useState('');
  const [contentTypeId, setContentTypeId] = useState('');
  const [airDate, setAirDate] = useState(getTodayInputValue);
  const [finalTitle, setFinalTitle] = useState('');
  const [reporterId, setReporterId] = useState('');
  const [keywords, setKeywords] = useState('');
  const [notes, setNotes] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    Promise.all([
      axios.get('/broadcast/programs'),
      axios.get('/broadcast/content-types'),
      axios.get('/broadcast/reporters'),
    ])
      .then(([programResponse, typeResponse, reporterResponse]) => {
        const nextPrograms = Array.isArray(programResponse.data) ? programResponse.data : [];
        const nextTypes = Array.isArray(typeResponse.data) ? typeResponse.data : [];
        const nextReporters = Array.isArray(reporterResponse.data) ? reporterResponse.data : [];

        setPrograms(nextPrograms);
        setContentTypes(nextTypes);
        setReporters(nextReporters);
        setProgramId((current) => current || nextPrograms[0]?._id || '');
        setContentTypeId((current) => current || nextTypes[0]?._id || '');
      })
      .catch((error) => {
        console.error('Error loading direct final upload settings:', error);
        setErrorMessage('Broadcast settings could not be loaded.');
      });
  }, []);

  const handleFileChange = (event) => {
    setFiles(Array.from(event.target.files || []));
    event.target.value = '';
  };

  const resetForm = () => {
    setFiles([]);
    setFinalTitle('');
    setReporterId('');
    setKeywords('');
    setNotes('');
    setAirDate(getTodayInputValue());
    setUploadProgress(0);
  };

  const handleUpload = () => {
    if (files.length === 0) {
      setErrorMessage('Select at least one final video file.');
      return;
    }
    if (!programId || !contentTypeId || !airDate) {
      setErrorMessage('Program, content type and air date are required.');
      return;
    }

    const formData = new FormData();
    files.forEach((file) => {
      formData.append('finalVideos', file, file.name);
    });
    formData.append('programId', programId);
    formData.append('contentTypeId', contentTypeId);
    formData.append('airDate', airDate);
    formData.append('finalTitle', finalTitle);
    formData.append('reporterId', reporterId);
    formData.append('keywords', keywords);
    formData.append('notes', notes);

    setMessage('');
    setErrorMessage('');
    setUploadProgress(0);

    axios
      .post('/broadcast/direct-final-upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const total = progressEvent.total || 0;
          if (total > 0) {
            setUploadProgress(Math.round((progressEvent.loaded * 100) / total));
          }
        },
      })
      .then((response) => {
        setMessage(response.data?.message || 'Direct final upload saved.');
        setErrorMessage('');
        resetForm();
        if (onUploadComplete) {
          onUploadComplete();
        }
      })
      .catch((error) => {
        console.error('Error uploading direct final material:', error);
        setErrorMessage(error.response?.data?.message || 'Direct final upload failed.');
      });
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Direct Final Upload
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {files.length > 0 ? `${files.length} file(s) selected` : 'No files selected'}
          </Typography>
        </Box>
        <Button variant="outlined" component="label" startIcon={<CloudUploadIcon />}>
          Select
          <input
            type="file"
            hidden
            multiple
            accept={ACCEPTED_VIDEO_FILE_TYPES}
            onChange={handleFileChange}
          />
        </Button>
      </Stack>

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={12} md={3}>
          <FormControl fullWidth required>
            <InputLabel>Program</InputLabel>
            <Select
              value={programId}
              label="Program"
              onChange={(event) => setProgramId(event.target.value)}
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
          <FormControl fullWidth required>
            <InputLabel>Content type</InputLabel>
            <Select
              value={contentTypeId}
              label="Content type"
              onChange={(event) => setContentTypeId(event.target.value)}
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
            value={airDate}
            onChange={(event) => setAirDate(event.target.value)}
            fullWidth
            InputLabelProps={{ shrink: true }}
            required
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField
            label="Final title"
            value={finalTitle}
            onChange={(event) => setFinalTitle(event.target.value)}
            fullWidth
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <FormControl fullWidth>
            <InputLabel>Reporter / author</InputLabel>
            <Select
              value={reporterId}
              label="Reporter / author"
              onChange={(event) => setReporterId(event.target.value)}
            >
              <MenuItem value="">No reporter tag</MenuItem>
              {reporters.map((reporter) => (
                <MenuItem key={reporter._id} value={reporter._id}>
                  {reporter.username} / {reporter.role}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField
            label="Keywords"
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
            fullWidth
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField
            label="QA note"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            fullWidth
          />
        </Grid>
      </Grid>

      {files.length > 0 && (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
          {files.map((file) => (
            <Chip key={`${file.name}-${file.lastModified}`} label={file.name} size="small" />
          ))}
        </Stack>
      )}

      {uploadProgress > 0 && (
        <Box sx={{ mt: 2 }}>
          <LinearProgress variant="determinate" value={uploadProgress} />
          <Typography variant="caption" color="text.secondary">
            Upload {uploadProgress}%
          </Typography>
        </Box>
      )}

      <Button variant="contained" onClick={handleUpload} sx={{ mt: 2 }}>
        Upload final
      </Button>
    </Paper>
  );
};

export default VideoUploadComponent;
