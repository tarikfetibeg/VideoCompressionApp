import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import axiosInstance from '../../axiosConfig';

const codecOptions = [
  { value: 'libx264', label: 'H.264 (libx264)', note: 'Najkompatibilniji za web preview.' },
  { value: 'libx265', label: 'H.265 (libx265)', note: 'Bolja kompresija, slabija browser podrška.' },
  { value: 'h264_nvenc', label: 'H.264 (NVENC)', note: 'GPU ubrzana H.264 obrada.' },
  { value: 'hevc_nvenc', label: 'H.265 (NVENC)', note: 'GPU ubrzana H.265 obrada.' },
];

const resolutionOptions = [
  { value: '1280x720', label: '1280x720 (HD)' },
  { value: '1920x1080', label: '1920x1080 (Full HD)' },
  { value: '2560x1440', label: '2560x1440 (2K)' },
  { value: '3840x2160', label: '3840x2160 (4K)' },
];

const defaultSettings = {
  codec: 'libx264',
  resolution: '1920x1080',
  bitrate: 10000,
  framerate: 30,
  rawRetentionDays: 0,
};

const FfmpegSettings = () => {
  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [cleanupResult, setCleanupResult] = useState(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = () => {
    setLoading(true);
    setMessage('');
    setErrorMessage('');

    axiosInstance
      .get('/admin/ffmpeg-settings')
      .then((response) => {
        setSettings({
          ...defaultSettings,
          ...response.data,
          rawRetentionDays:
            typeof response.data.rawRetentionDays === 'number'
              ? response.data.rawRetentionDays
              : 0,
        });
      })
      .catch((err) => {
        console.error('Error fetching FFmpeg settings:', err);
        setErrorMessage('Greška pri učitavanju FFmpeg postavki.');
      })
      .finally(() => setLoading(false));
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    setSettings((prev) => ({
      ...prev,
      [name]: name === 'framerate' || name === 'rawRetentionDays' ? Number(value) : value,
    }));
  };

  const handleBitrateChange = (event, newValue) => {
    setSettings((prev) => ({
      ...prev,
      bitrate: newValue,
    }));
  };

  const handleUpdate = () => {
    setLoading(true);
    setMessage('');
    setErrorMessage('');

    const payload = {
      ...settings,
      bitrate: Number(settings.bitrate),
      framerate: Number(settings.framerate),
      rawRetentionDays: Number(settings.rawRetentionDays),
    };

    axiosInstance
      .put('/admin/ffmpeg-settings', payload)
      .then((response) => {
        setSettings({
          ...defaultSettings,
          ...response.data.settings,
        });
        setMessage('Postavke su uspješno sačuvane.');
        setErrorMessage('');
      })
      .catch((err) => {
        console.error('Error updating settings:', err);
        setErrorMessage(
          err.response?.data?.message || 'Greška pri spremanju postavki.'
        );
      })
      .finally(() => setLoading(false));
  };

  const handleCleanupRaw = () => {
    setCleanupLoading(true);
    setMessage('');
    setErrorMessage('');
    setCleanupResult(null);

    axiosInstance
      .post('/admin/cleanup-raw')
      .then((response) => {
        setCleanupResult(response.data.result);
        setMessage('Raw cleanup je uspješno pokrenut.');
      })
      .catch((err) => {
        console.error('Error running raw cleanup:', err);
        setErrorMessage(
          err.response?.data?.message || 'Greška pri pokretanju raw cleanup procesa.'
        );
      })
      .finally(() => setCleanupLoading(false));
  };

  const rawRetentionDescription =
    Number(settings.rawRetentionDays) === 0
      ? 'Raw fajlovi se brišu odmah nakon uspješne obrade.'
      : `Raw fajlovi se čuvaju ${settings.rawRetentionDays} dana nakon obrade.`;

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
            FFmpeg & Storage Settings
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Globalne postavke za konverziju, preview workflow i raw retention politiku.
          </Typography>
        </Box>

        <Button variant="outlined" onClick={fetchSettings} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Grid container spacing={3}>
        <Grid item xs={12} lg={8}>
          <Card variant="outlined" sx={{ borderRadius: 3 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
                Master / Compressed Output
              </Typography>

              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel id="codec-label">Codec</InputLabel>
                    <Select
                      labelId="codec-label"
                      name="codec"
                      value={settings.codec || ''}
                      label="Codec"
                      onChange={handleChange}
                    >
                      {codecOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {option.label}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {option.note}
                            </Typography>
                          </Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel id="resolution-label">Resolution</InputLabel>
                    <Select
                      labelId="resolution-label"
                      name="resolution"
                      value={settings.resolution || ''}
                      label="Resolution"
                      onChange={handleChange}
                    >
                      {resolutionOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    label="Frame Rate (fps)"
                    name="framerate"
                    type="number"
                    fullWidth
                    value={settings.framerate || 30}
                    onChange={handleChange}
                    inputProps={{ min: 1, max: 120 }}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    label="Raw retention days"
                    name="rawRetentionDays"
                    type="number"
                    fullWidth
                    value={settings.rawRetentionDays ?? 0}
                    onChange={handleChange}
                    inputProps={{ min: 0, max: 365 }}
                    helperText="0 znači da se raw briše odmah nakon obrade."
                  />
                </Grid>

                <Grid item xs={12}>
                  <Typography gutterBottom sx={{ fontWeight: 700 }}>
                    Bitrate: {Number(settings.bitrate || 0).toLocaleString()} Kbps
                  </Typography>
                  <Slider
                    value={Number(settings.bitrate || 0)}
                    min={1000}
                    max={50000}
                    step={500}
                    onChange={handleBitrateChange}
                    valueLabelDisplay="auto"
                  />
                </Grid>
              </Grid>

              <Divider sx={{ my: 3 }} />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Button
                  variant="contained"
                  onClick={handleUpdate}
                  disabled={loading}
                >
                  Save Settings
                </Button>

                <Button
                  variant="outlined"
                  color="warning"
                  onClick={handleCleanupRaw}
                  disabled={cleanupLoading}
                >
                  Run Raw Cleanup Now
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}>
              <Typography variant="overline" color="text.secondary">
                Raw retention policy
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                {settings.rawRetentionDays ?? 0} dana
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {rawRetentionDescription}
              </Typography>
            </Paper>

            <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}>
              <Typography variant="overline" color="text.secondary">
                Preview workflow
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                <Chip label="H.264" size="small" />
                <Chip label="AAC" size="small" />
                <Chip label="720p" size="small" />
                <Chip label="Browser compatible" size="small" color="success" />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Preview fajlovi se kreiraju odvojeno od master/compressed fajlova.
              </Typography>
            </Paper>

            {cleanupResult && (
              <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}>
                <Typography variant="overline" color="text.secondary">
                  Last cleanup result
                </Typography>
                <Typography variant="body2">
                  Checked: <strong>{cleanupResult.checked}</strong>
                </Typography>
                <Typography variant="body2">
                  Deleted: <strong>{cleanupResult.deleted}</strong>
                </Typography>
              </Paper>
            )}

            <Tooltip title="Ove postavke utiču na nove uploadovane fajlove. Postojeći fajlovi ostaju sa postojećim metadata vrijednostima.">
              <Alert severity="info">
                Promjene se primjenjuju na nove uploadove.
              </Alert>
            </Tooltip>
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
};

export default FfmpegSettings;