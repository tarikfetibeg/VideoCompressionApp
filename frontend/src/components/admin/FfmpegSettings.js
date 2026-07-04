import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ScienceIcon from '@mui/icons-material/Science';
import SaveIcon from '@mui/icons-material/Save';
import axiosInstance from '../../axiosConfig';

const defaultSettings = {
  codec: 'libx264',
  resolution: '1920x1080',
  bitrate: 1500,
  framerate: 30,
  rawRetentionDays: 0,
  masterProfileVersion: 1,
  mp4PreviewPolicy: 'when_required',
  mp4PreviewEncoder: 'libx264',
  mp4PreviewResolution: '1280x720',
  mp4PreviewVideoBitrate: 2000,
  mp4PreviewAudioBitrate: 128,
  mp4PreviewFramerateMode: 'fixed',
  mp4PreviewFramerate: 30,
  mp4PreviewCpuPreset: 'veryfast',
  mp4PreviewNvencPreset: 'p5',
  mp4PreviewCpuFallback: true,
  mp4PreviewProfileVersion: 1,
  hlsEncoder: 'libx264',
  hlsNvencPreset: 'p5',
  hlsCpuFallback: true,
  hls720VideoBitrate: 2200,
  hls720AudioBitrate: 128,
  hls480VideoBitrate: 900,
  hls480AudioBitrate: 96,
  hlsSegmentDuration: 4,
  hlsProfileVersion: 1,
  thumbnailResolution: '640x360',
  thumbnailJpegQuality: 3,
  thumbnailProfileVersion: 1,
  scrubFrameCount: 12,
  scrubResolution: '320x180',
  scrubJpegQuality: 3,
  scrubProfileVersion: 1,
};

const audioBitrates = [64, 96, 128, 160, 192];
const numberFields = new Set([
  'bitrate',
  'framerate',
  'rawRetentionDays',
  'mp4PreviewVideoBitrate',
  'mp4PreviewAudioBitrate',
  'mp4PreviewFramerate',
  'hls720VideoBitrate',
  'hls720AudioBitrate',
  'hls480VideoBitrate',
  'hls480AudioBitrate',
  'hlsSegmentDuration',
  'thumbnailJpegQuality',
  'scrubFrameCount',
  'scrubJpegQuality',
]);

const estimateGbPerHour = (...bitratesKbps) =>
  bitratesKbps.reduce((total, value) => total + Number(value || 0), 0) * 0.00045;

const VersionChip = ({ label, value }) => (
  <Chip label={`${label} v${value || 1}`} size="small" variant="outlined" />
);

const FfmpegSettings = () => {
  const [tab, setTab] = useState('master');
  const [settings, setSettings] = useState(defaultSettings);
  const [capabilities, setCapabilities] = useState(null);
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchSettings = () => {
    setLoading(true);
    setErrorMessage('');
    Promise.all([
      axiosInstance.get('/admin/ffmpeg-settings'),
      axiosInstance.get('/admin/ffmpeg-capabilities'),
    ])
      .then(([settingsResponse, capabilityResponse]) => {
        setSettings({ ...defaultSettings, ...(settingsResponse.data || {}) });
        setCapabilities(capabilityResponse.data || null);
      })
      .catch((error) => {
        console.error('Error loading media profiles:', error);
        setErrorMessage('Media profile nije moguće učitati.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setSettings((current) => ({
      ...current,
      [name]: numberFields.has(name) ? Number(value) : value,
    }));
  };

  const runNvencProbe = () => {
    setProbing(true);
    setMessage('');
    setErrorMessage('');
    axiosInstance
      .post('/admin/ffmpeg-capabilities/probe', {
        preset: settings.hlsNvencPreset || 'p5',
      })
      .then((response) => {
        setCapabilities((current) => ({
          ...(current || {}),
          ...(response.data?.capabilities || {}),
          savedProbe: response.data,
        }));
        setMessage(`NVENC probe je prošao za ${response.data?.gpuName || 'NVIDIA GPU'}.`);
      })
      .catch((error) => {
        setErrorMessage(error.response?.data?.message || error.response?.data?.error || 'NVENC probe nije prošao.');
      })
      .finally(() => setProbing(false));
  };

  const saveSettings = () => {
    setLoading(true);
    setConfirmSave(false);
    setMessage('');
    setErrorMessage('');
    axiosInstance
      .put('/admin/ffmpeg-settings', settings)
      .then((response) => {
        setSettings({ ...defaultSettings, ...(response.data?.settings || {}) });
        const changed = response.data?.changedGroups || [];
        setMessage(changed.length > 0
          ? `Sačuvano. Nove verzije profila: ${changed.join(', ')}.`
          : 'Postavke su sačuvane bez promjene media verzije.');
      })
      .catch((error) => {
        setErrorMessage(error.response?.data?.message || 'Postavke nije moguće sačuvati.');
      })
      .finally(() => setLoading(false));
  };

  const cleanupRaw = () => {
    setCleanupLoading(true);
    setMessage('');
    setErrorMessage('');
    axiosInstance
      .post('/admin/cleanup-raw')
      .then((response) => {
        const result = response.data?.result || {};
        setMessage(`Raw cleanup: provjereno ${result.checked || 0}, obrisano ${result.deleted || 0}.`);
      })
      .catch((error) => {
        setErrorMessage(error.response?.data?.message || 'Raw cleanup nije moguće pokrenuti.');
      })
      .finally(() => setCleanupLoading(false));
  };

  const mp4Estimate = useMemo(
    () => estimateGbPerHour(settings.mp4PreviewVideoBitrate, settings.mp4PreviewAudioBitrate),
    [settings.mp4PreviewVideoBitrate, settings.mp4PreviewAudioBitrate]
  );
  const hlsEstimate = useMemo(
    () => estimateGbPerHour(
      settings.hls720VideoBitrate,
      settings.hls720AudioBitrate,
      settings.hls480VideoBitrate,
      settings.hls480AudioBitrate
    ),
    [
      settings.hls720VideoBitrate,
      settings.hls720AudioBitrate,
      settings.hls480VideoBitrate,
      settings.hls480AudioBitrate,
    ]
  );
  const nvencReady = capabilities?.savedProbe?.ok === true;

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'center' }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>Media profili</Typography>
          <Typography variant="body2" color="text.secondary">
            Kontrolisani FFmpeg profili za nove obrade i ručni rebuild postojećih previewa.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchSettings} disabled={loading}>
            Osvježi
          </Button>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={() => setConfirmSave(true)} disabled={loading}>
            Sačuvaj
          </Button>
        </Stack>
      </Stack>

      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}
      <Alert severity="info" sx={{ mb: 2 }}>
        Promjene važe za nove obrade. Postojeći klipovi se mijenjaju samo kroz ručni rebuild u Storage Maintenance modulu.
      </Alert>

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Tabs
          value={tab}
          onChange={(event, value) => setTab(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="master" label="Master" />
          <Tab value="mp4" label="MP4 preview" />
          <Tab value="hls" label="HLS" />
          <Tab value="images" label="Slike" />
        </Tabs>

        <Box sx={{ p: 2.5 }}>
          {tab === 'master' && (
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <VersionChip label="Master" value={settings.masterProfileVersion} />
                  <Typography variant="body2" color="text.secondary">Default za raw ingest; korisnički upload ga može promijeniti.</Typography>
                </Stack>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Codec</InputLabel>
                  <Select name="codec" value={settings.codec} label="Codec" onChange={handleChange}>
                    <MenuItem value="libx264">H.264 / libx264</MenuItem>
                    <MenuItem value="libx265">H.265 / libx265</MenuItem>
                    <MenuItem value="h264_nvenc" disabled={!nvencReady}>H.264 / NVENC</MenuItem>
                    <MenuItem value="hevc_nvenc" disabled={!nvencReady}>H.265 / NVENC</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Rezolucija</InputLabel>
                  <Select name="resolution" value={settings.resolution} label="Rezolucija" onChange={handleChange}>
                    {['1280x720', '1920x1080', '2560x1440', '3840x2160'].map((value) => (
                      <MenuItem key={value} value={value}>{value}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField fullWidth type="number" label="Frame rate" name="framerate" value={settings.framerate} onChange={handleChange} inputProps={{ min: 1, max: 120 }} />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField fullWidth type="number" label="Raw retention (dana)" name="rawRetentionDays" value={settings.rawRetentionDays} onChange={handleChange} inputProps={{ min: 0, max: 365 }} />
              </Grid>
              <Grid item xs={12}>
                <Typography gutterBottom sx={{ fontWeight: 700 }}>Bitrate: {Number(settings.bitrate).toLocaleString()} kbps</Typography>
                <Slider name="bitrate" value={Number(settings.bitrate)} min={1000} max={50000} step={500} onChange={(event, value) => setSettings((current) => ({ ...current, bitrate: value }))} valueLabelDisplay="auto" />
              </Grid>
              <Grid item xs={12}>
                <Button variant="outlined" color="warning" onClick={cleanupRaw} disabled={cleanupLoading}>
                  {cleanupLoading ? 'Čistim raw...' : 'Pokreni raw cleanup'}
                </Button>
              </Grid>
            </Grid>
          )}

          {tab === 'mp4' && (
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <VersionChip label="MP4" value={settings.mp4PreviewProfileVersion} />
                  <Chip label={`Procjena ${mp4Estimate.toFixed(2)} GB/sat`} size="small" color="info" variant="outlined" />
                </Stack>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Politika</InputLabel>
                  <Select name="mp4PreviewPolicy" value={settings.mp4PreviewPolicy} label="Politika" onChange={handleChange}>
                    <MenuItem value="when_required">Samo kada master nije browser-kompatibilan</MenuItem>
                    <MenuItem value="always">Uvijek kreiraj zaseban preview</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Encoder</InputLabel>
                  <Select name="mp4PreviewEncoder" value={settings.mp4PreviewEncoder} label="Encoder" onChange={handleChange}>
                    <MenuItem value="libx264">CPU / libx264</MenuItem>
                    <MenuItem value="h264_nvenc" disabled={!nvencReady}>NVIDIA NVENC / H.264</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>Rezolucija</InputLabel>
                  <Select name="mp4PreviewResolution" value={settings.mp4PreviewResolution} label="Rezolucija" onChange={handleChange}>
                    {['1920x1080', '1280x720', '854x480'].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth type="number" label="Video bitrate (kbps)" name="mp4PreviewVideoBitrate" value={settings.mp4PreviewVideoBitrate} onChange={handleChange} inputProps={{ min: 500, max: 8000 }} />
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>Audio bitrate</InputLabel>
                  <Select name="mp4PreviewAudioBitrate" value={settings.mp4PreviewAudioBitrate} label="Audio bitrate" onChange={handleChange}>
                    {audioBitrates.map((value) => <MenuItem key={value} value={value}>{value} kbps</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>FPS režim</InputLabel>
                  <Select name="mp4PreviewFramerateMode" value={settings.mp4PreviewFramerateMode} label="FPS režim" onChange={handleChange}>
                    <MenuItem value="fixed">Fiksni FPS</MenuItem>
                    <MenuItem value="source_capped_50">Izvorni, maksimalno 50</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth disabled={settings.mp4PreviewFramerateMode !== 'fixed'}>
                  <InputLabel>FPS</InputLabel>
                  <Select name="mp4PreviewFramerate" value={settings.mp4PreviewFramerate} label="FPS" onChange={handleChange}>
                    {[25, 30, 50].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>Preset</InputLabel>
                  <Select
                    name={settings.mp4PreviewEncoder === 'h264_nvenc' ? 'mp4PreviewNvencPreset' : 'mp4PreviewCpuPreset'}
                    value={settings.mp4PreviewEncoder === 'h264_nvenc' ? settings.mp4PreviewNvencPreset : settings.mp4PreviewCpuPreset}
                    label="Preset"
                    onChange={handleChange}
                  >
                    {(settings.mp4PreviewEncoder === 'h264_nvenc' ? ['p4', 'p5', 'p6'] : ['veryfast', 'faster', 'medium'])
                      .map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <FormControlLabel
                  control={<Checkbox checked={settings.mp4PreviewCpuFallback !== false} onChange={(event) => setSettings((current) => ({ ...current, mp4PreviewCpuFallback: event.target.checked }))} />}
                  label="Automatski CPU fallback za NVENC runtime grešku"
                />
              </Grid>
            </Grid>
          )}

          {tab === 'hls' && (
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <VersionChip label="HLS" value={settings.hlsProfileVersion} />
                  <Chip label={`Procjena ${hlsEstimate.toFixed(2)} GB/sat`} size="small" color="info" variant="outlined" />
                </Stack>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>Encoder</InputLabel>
                  <Select name="hlsEncoder" value={settings.hlsEncoder} label="Encoder" onChange={handleChange}>
                    <MenuItem value="libx264">CPU / libx264</MenuItem>
                    <MenuItem value="h264_nvenc" disabled={!nvencReady}>NVIDIA NVENC / H.264</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth disabled={settings.hlsEncoder !== 'h264_nvenc'}>
                  <InputLabel>NVENC preset</InputLabel>
                  <Select name="hlsNvencPreset" value={settings.hlsNvencPreset} label="NVENC preset" onChange={handleChange}>
                    {['p2', 'p3', 'p4', 'p5', 'p6'].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>Segment</InputLabel>
                  <Select name="hlsSegmentDuration" value={settings.hlsSegmentDuration} label="Segment" onChange={handleChange}>
                    {[2, 4, 6].map((value) => <MenuItem key={value} value={value}>{value} sekunde</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              {[
                ['hls720VideoBitrate', '720p video (kbps)', 1000, 6000],
                ['hls480VideoBitrate', '480p video (kbps)', 400, 3000],
              ].map(([name, label, min, max]) => (
                <Grid item xs={12} md={4} key={name}>
                  <TextField fullWidth type="number" name={name} label={label} value={settings[name]} onChange={handleChange} inputProps={{ min, max }} />
                </Grid>
              ))}
              {[
                ['hls720AudioBitrate', '720p audio'],
                ['hls480AudioBitrate', '480p audio'],
              ].map(([name, label]) => (
                <Grid item xs={12} md={4} key={name}>
                  <FormControl fullWidth>
                    <InputLabel>{label}</InputLabel>
                    <Select name={name} value={settings[name]} label={label} onChange={handleChange}>
                      {audioBitrates.map((value) => <MenuItem key={value} value={value}>{value} kbps</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
              ))}
              <Grid item xs={12}>
                <FormControlLabel
                  control={<Checkbox checked={settings.hlsCpuFallback !== false} onChange={(event) => setSettings((current) => ({ ...current, hlsCpuFallback: event.target.checked }))} />}
                  label="Automatski CPU fallback za NVENC runtime grešku"
                />
              </Grid>
            </Grid>
          )}

          {tab === 'images' && (
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <VersionChip label="Thumbnail" value={settings.thumbnailProfileVersion} />
                  <VersionChip label="Scrub" value={settings.scrubProfileVersion} />
                </Stack>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Thumbnail rezolucija</InputLabel>
                  <Select name="thumbnailResolution" value={settings.thumbnailResolution} label="Thumbnail rezolucija" onChange={handleChange}>
                    {['640x360', '480x270', '320x180'].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField fullWidth type="number" name="thumbnailJpegQuality" label="Thumbnail JPEG q (2 najbolje, 8 najmanje)" value={settings.thumbnailJpegQuality} onChange={handleChange} inputProps={{ min: 2, max: 8 }} />
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>Scrub rezolucija</InputLabel>
                  <Select name="scrubResolution" value={settings.scrubResolution} label="Scrub rezolucija" onChange={handleChange}>
                    {['320x180', '240x135', '160x90'].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth type="number" name="scrubFrameCount" label="Broj scrub frameova" value={settings.scrubFrameCount} onChange={handleChange} inputProps={{ min: 6, max: 24 }} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth type="number" name="scrubJpegQuality" label="Scrub JPEG q (2 najbolje, 8 najmanje)" value={settings.scrubJpegQuality} onChange={handleChange} inputProps={{ min: 2, max: 8 }} />
              </Grid>
            </Grid>
          )}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>NVENC capability</Typography>
            <Typography variant="body2" color="text.secondary">
              {capabilities?.gpu?.name || capabilities?.savedProbe?.gpuName || 'GPU nije detektovan'}
              {' · '}
              {nvencReady ? 'Probe PASS' : 'Probe nije potvrđen'}
            </Typography>
          </Box>
          <Button variant="outlined" startIcon={<ScienceIcon />} onClick={runNvencProbe} disabled={probing}>
            {probing ? 'Provjeravam...' : 'Pokreni NVENC probe'}
          </Button>
        </Stack>
      </Paper>

      <Dialog open={confirmSave} onClose={() => setConfirmSave(false)}>
        <DialogTitle>Sačuvati media profile?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Promijenjene grupe dobit će novu verziju. Postojeći previewi ostaju nepromijenjeni dok ručno ne pokreneš rebuild.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmSave(false)}>Odustani</Button>
          <Button variant="contained" onClick={saveSettings}>Sačuvaj</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default FfmpegSettings;
