import React, { useEffect, useState } from 'react';
import axios from '../axiosConfig';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import TuneIcon from '@mui/icons-material/Tune';
import { ACCEPTED_VIDEO_FILE_TYPES } from '../constants/videoFormats';

const getTodayInputValue = () => {
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  return today.toISOString().slice(0, 10);
};

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const UploadComponent = ({ onUploadComplete }) => {
  const [files, setFiles] = useState([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [eventTag, setEventTag] = useState('');
  const [date, setDate] = useState(getTodayInputValue);
  const [showTechnicalProfile, setShowTechnicalProfile] = useState(false);
  const [codec, setCodec] = useState('h264');
  const [resolution, setResolution] = useState('1080');
  const [bitrate, setBitrate] = useState(10);
  const [framerate, setFramerate] = useState(30);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [currentUploadLabel, setCurrentUploadLabel] = useState('');
  const [uploadResults, setUploadResults] = useState([]);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    axios
      .get('/admin/ffmpeg-settings-default', {
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      })
      .then((response) => {
        const defaults = response.data;
        const defaultCodec = defaults.codec === 'hevc_nvenc' ? 'h265_nvenc' : defaults.codec;
        const resVal = defaults.resolution || '1920x1080';

        setCodec(defaultCodec || 'h264');

        if (resVal.includes('720')) {
          setResolution('720');
        } else if (resVal.includes('1080')) {
          setResolution('1080');
        } else if (resVal.includes('1440')) {
          setResolution('1440');
        } else if (resVal.includes('2160') || resVal.includes('3840')) {
          setResolution('2160');
        } else {
          setResolution('1080');
        }

        setBitrate(Math.round((defaults.bitrate || 1500) / 1000));
        setFramerate(defaults.framerate || 30);
      })
      .catch((err) => {
        console.error('Error fetching default FFmpeg settings:', err);
      });
  }, []);

  const handleFileChange = (event) => {
    setFiles(Array.from(event.target.files));
  };

  const buildUploadFormData = (file) => {
    const formData = new FormData();

    formData.append('videos', file);
    formData.append('event', eventTag.trim());
    formData.append('location', '');
    formData.append('date', date);
    formData.append('codec', codec);
    formData.append('resolution', resolution);
    formData.append('bitrate', bitrate);
    formData.append('framerate', framerate);

    return formData;
  };

  const handleUpload = async () => {
    setMessage('');
    setErrorMessage('');
    setUploadResults([]);

    if (files.length === 0) {
      setErrorMessage('Select at least one file.');
      return;
    }

    if (!eventTag.trim() || !date) {
      setErrorMessage('Event and date are required.');
      return;
    }

    const uploadedFiles = [];
    const failedFiles = [];
    const queueWarnings = [];

    setUploading(true);
    setUploadProgress(0);

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      setCurrentUploadLabel(`Uploading ${index + 1}/${files.length}: ${file.name}`);

      try {
        const response = await axios.post('/upload', buildUploadFormData(file), {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (progressEvent) => {
            const total = progressEvent.total || file.size || 1;
            const fileProgress = Math.round((progressEvent.loaded * 100) / total);
            const overallProgress = Math.round(((index + fileProgress / 100) / files.length) * 100);

            setUploadProgress(Math.min(overallProgress, 100));
          },
        });
        const queueFailures = Array.isArray(response.data?.queueFailures)
          ? response.data.queueFailures
          : [];

        uploadedFiles.push(file);
        if (queueFailures.length > 0) {
          queueWarnings.push(file.name);
        }

        setUploadResults((current) => [
          ...current,
          { name: file.name, status: queueFailures.length > 0 ? 'warning' : 'success' },
        ]);
      } catch (error) {
        console.error('Error uploading file:', error);
        const errorText = error.response?.data?.message || error.message || 'Upload failed.';

        failedFiles.push({ file, error: errorText });
        setUploadResults((current) => [
          ...current,
          { name: file.name, status: 'error', error: errorText },
        ]);
      }
    }

    setUploading(false);
    setCurrentUploadLabel('');
    setUploadProgress(0);

    if (uploadedFiles.length > 0 && onUploadComplete) {
      onUploadComplete();
    }

    if (failedFiles.length === 0) {
      setFiles([]);
      setFileInputKey((current) => current + 1);
      setErrorMessage(queueWarnings.length > 0
        ? `${queueWarnings.length} file(s) were saved, but processing needs retry after queue/worker is available.`
        : '');
      setMessage(`Upload saved ${uploadedFiles.length} file(s). Processing has been queued.`);
      return;
    }

    setFiles(failedFiles.map((failure) => failure.file));
    setMessage(
      uploadedFiles.length > 0
        ? `Upload saved ${uploadedFiles.length} file(s). Failed file(s) stayed selected for retry.`
        : ''
    );
    setErrorMessage(
      `${failedFiles.length} file(s) failed: ${failedFiles.map((failure) => `${failure.file.name} (${failure.error})`).join('; ')}`
    );
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', sm: 'center' }}
        >
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              Raw Ingest
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {files.length > 0 ? `${files.length} file(s) selected` : 'Ready for today'}
            </Typography>
          </Box>

          <Button variant="outlined" component="label" startIcon={<CloudUploadIcon />} disabled={uploading}>
            Select
            <input
              key={fileInputKey}
              type="file"
              hidden
              multiple
              accept={ACCEPTED_VIDEO_FILE_TYPES}
              onChange={handleFileChange}
              disabled={uploading}
            />
          </Button>
        </Stack>

        {message && <Alert severity="success">{message}</Alert>}
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

        <Grid container spacing={1.5}>
          <Grid item xs={12} md={7}>
            <TextField
              label="Event"
              value={eventTag}
              onChange={(event) => setEventTag(event.target.value)}
              fullWidth
              required
            />
          </Grid>
          <Grid item xs={12} md={5}>
            <TextField
              label="Date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
              required
            />
          </Grid>
        </Grid>

        {files.length > 0 && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {files.slice(0, 5).map((file) => (
              <Chip key={`${file.name}-${file.size}`} label={`${file.name} / ${formatBytes(file.size)}`} size="small" />
            ))}
            {files.length > 5 && <Chip label={`+${files.length - 5} more`} size="small" />}
          </Stack>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Button
            variant="contained"
            onClick={handleUpload}
            startIcon={<CloudUploadIcon />}
            disabled={uploading}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
          <Button
            variant="text"
            onClick={() => setShowTechnicalProfile((current) => !current)}
            startIcon={<TuneIcon />}
            disabled={uploading}
          >
            Technical profile
          </Button>
        </Stack>

        <Collapse in={showTechnicalProfile}>
          <Grid container spacing={1.5} sx={{ pt: 1 }}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Codec</InputLabel>
                <Select value={codec} label="Codec" onChange={(event) => setCodec(event.target.value)}>
                  <MenuItem value="h264">H.264 Software</MenuItem>
                  <MenuItem value="h265">H.265 Software</MenuItem>
                  <MenuItem value="h264_nvenc">H.264 NVENC</MenuItem>
                  <MenuItem value="h265_nvenc">H.265 NVENC</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Resolution</InputLabel>
                <Select value={resolution} label="Resolution" onChange={(event) => setResolution(event.target.value)}>
                  <MenuItem value="720">1280x720 HD</MenuItem>
                  <MenuItem value="1080">1920x1080 Full HD</MenuItem>
                  <MenuItem value="1440">2560x1440 2K</MenuItem>
                  <MenuItem value="2160">3840x2160 4K</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Frame rate"
                type="number"
                fullWidth
                value={framerate}
                onChange={(event) => setFramerate(parseInt(event.target.value, 10) || 30)}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="caption" color="text.secondary">
                Bitrate: {bitrate} Mbps
              </Typography>
              <Slider
                value={bitrate}
                min={1}
                max={50}
                step={1}
                onChange={(event, newValue) => setBitrate(newValue)}
                valueLabelDisplay="auto"
              />
            </Grid>
          </Grid>
        </Collapse>

        {uploading && (
          <Box>
            <LinearProgress variant="determinate" value={uploadProgress} />
            <Typography variant="caption" color="text.secondary">
              {currentUploadLabel || 'Uploading'} / {uploadProgress}%
            </Typography>
          </Box>
        )}

        {uploadResults.length > 0 && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {uploadResults.slice(-8).map((result) => (
              <Chip
                key={`${result.name}-${result.status}`}
                label={result.name}
                size="small"
                color={
                  result.status === 'success'
                    ? 'success'
                    : result.status === 'warning'
                      ? 'warning'
                      : 'error'
                }
                variant="outlined"
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
};

export default UploadComponent;
