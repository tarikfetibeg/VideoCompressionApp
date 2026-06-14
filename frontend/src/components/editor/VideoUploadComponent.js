import React, { useEffect, useMemo, useState } from 'react';
import axios from '../../axiosConfig';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { ACCEPTED_VIDEO_FILE_TYPES } from '../../constants/videoFormats';
import { useBackgroundUploads } from '../../contexts/BackgroundUploadContext';

const INGEST_PROGRAM_VALUE = 'ingest';

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
  const [programId, setProgramId] = useState(INGEST_PROGRAM_VALUE);
  const [contentTypeId, setContentTypeId] = useState('');
  const [airDate, setAirDate] = useState(getTodayInputValue);
  const [finalTitle, setFinalTitle] = useState('');
  const [reporterId, setReporterId] = useState('');
  const [keywords, setKeywords] = useState('');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const { enqueueDirectFinalUploads } = useBackgroundUploads();

  const selectedContentType = useMemo(
    () => contentTypes.find((type) => type._id === contentTypeId),
    [contentTypes, contentTypeId]
  );
  const visibleFiles = files.slice(0, 30);
  const hiddenFileCount = Math.max(files.length - visibleFiles.length, 0);

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
        setProgramId((current) => current || INGEST_PROGRAM_VALUE);
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
  };

  const handleUpload = () => {
    if (files.length === 0) {
      setErrorMessage('Select at least one final video file.');
      return;
    }
    const ingestOnly = programId === INGEST_PROGRAM_VALUE;
    if (!contentTypeId) {
      setErrorMessage('Content type is required.');
      return;
    }
    if (!ingestOnly && !airDate) {
      setErrorMessage('Air date is required when material is assigned to a show.');
      return;
    }

    setMessage('');
    setErrorMessage('');
    const queuedCount = enqueueDirectFinalUploads(files, {
      programId: ingestOnly ? INGEST_PROGRAM_VALUE : programId,
      contentTypeId,
      airDate,
      finalTitle,
      reporterId,
      keywords,
      notes,
      useFilenameMetadata: true,
      bulkUpload: files.length > 1,
    });

    setMessage(`${queuedCount} file(s) added to background upload queue.`);
    resetForm();
    if (onUploadComplete) {
      onUploadComplete();
    }
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
      {files.length > 1 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Bulk upload uses each filename as the title, extracts date/keywords from filenames, and uploads files one by one in the background.
        </Alert>
      )}
      {selectedContentType?.slug === 'marketing' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Marketing bulk is uploaded in natural filename order, so names like Marketing Blok 1, Marketing Blok 2, Marketing Blok 10 keep their airing order.
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={3}>
          <FormControl fullWidth>
            <InputLabel>Program / ingest</InputLabel>
            <Select
              value={programId}
              label="Program / ingest"
              onChange={(event) => setProgramId(event.target.value)}
            >
              <MenuItem value={INGEST_PROGRAM_VALUE}>Nema emisije / ingest</MenuItem>
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
            label="Air / reference date"
            type="date"
            value={airDate}
            onChange={(event) => setAirDate(event.target.value)}
            fullWidth
            InputLabelProps={{ shrink: true }}
            required={programId !== INGEST_PROGRAM_VALUE}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField
            label={files.length > 1 ? 'Final title (single file only)' : 'Final title'}
            value={finalTitle}
            onChange={(event) => setFinalTitle(event.target.value)}
            fullWidth
            disabled={files.length > 1}
            helperText={files.length > 1 ? 'Bulk upload titles are generated from each filename.' : 'Leave empty to use the filename.'}
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
          {visibleFiles.map((file) => (
            <Chip key={`${file.name}-${file.lastModified}`} label={file.name} size="small" />
          ))}
          {hiddenFileCount > 0 && <Chip label={`+${hiddenFileCount} more`} size="small" />}
        </Stack>
      )}

      <Button variant="contained" onClick={handleUpload} sx={{ mt: 2 }}>
        Add to background upload
      </Button>
    </Paper>
  );
};

export default VideoUploadComponent;
