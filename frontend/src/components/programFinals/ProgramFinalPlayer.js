import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Alert,
  Box,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import axiosInstance from '../../axiosConfig';

function resolveMediaUrl(url) {
  if (!url || /^https?:\/\//i.test(url)) return url || '';
  const baseURL = axiosInstance.defaults.baseURL || '/api';
  if (/^https?:\/\//i.test(baseURL) && url.startsWith('/')) return `${new URL(baseURL).origin}${url}`;
  return url;
}

function normalizeTicket(data = {}) {
  return {
    ...data,
    manifestUrl: resolveMediaUrl(data.manifestUrl),
    fallbackUrl: resolveMediaUrl(data.fallbackUrl),
    thumbnailUrl: resolveMediaUrl(data.thumbnailUrl),
  };
}

const ProgramFinalPlayer = ({ programFinalId, versionId = '' }) => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const resumeAtRef = useRef(0);
  const resumePlaybackRef = useRef(false);
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quality, setQuality] = useState(-1);
  const [levels, setLevels] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setTicket(null);
    axiosInstance.post(`/program-finals/${programFinalId}/media-ticket`, versionId ? { versionId } : {})
      .then((response) => {
        if (!cancelled) {
          setTicket(normalizeTicket(response.data));
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(requestError.response?.data?.message || 'Preview finala se ne može pokrenuti.');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [programFinalId, versionId]);

  useEffect(() => {
    const expiresAt = Date.parse(ticket?.expiresAt || '');
    if (!Number.isFinite(expiresAt)) return undefined;
    let cancelled = false;
    const delay = Math.max(expiresAt - Date.now() - 60_000, 1_000);
    const timeout = window.setTimeout(() => {
      const video = videoRef.current;
      resumeAtRef.current = Number(video?.currentTime) || 0;
      resumePlaybackRef.current = Boolean(video && !video.paused);
      axiosInstance.post(`/program-finals/${programFinalId}/media-ticket`, versionId ? { versionId } : {})
        .then((response) => {
          if (!cancelled) setTicket(normalizeTicket(response.data));
        })
        .catch((requestError) => {
          if (!cancelled) setError(requestError.response?.data?.message || 'Zaštićeni stream se ne može obnoviti.');
        });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [programFinalId, ticket?.expiresAt, versionId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !ticket?.manifestUrl) return undefined;
    setLoading(true);
    setLevels([]);
    setQuality(-1);
    const fallback = () => {
      if (!ticket.fallbackUrl) {
        setError('HLS preview nije dostupan.');
        setLoading(false);
        return;
      }
      video.src = ticket.fallbackUrl;
      video.load();
    };
    if (Hls.isSupported()) {
      const hls = new Hls({ maxBufferLength: 30, backBufferLength: 30, enableWorker: true });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(ticket.manifestUrl));
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        setLevels((data.levels || []).map((level, index) => ({ index, height: level.height, bitrate: level.bitrate })));
        setLoading(false);
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else fallback();
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = ticket.manifestUrl;
      video.load();
    } else {
      fallback();
    }
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [ticket]);

  if (error) return <Alert severity="warning">{error}</Alert>;

  return (
    <Box>
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 9',
          bgcolor: '#050505',
          overflow: 'hidden',
          borderRadius: 1,
        }}
      >
        <video
          ref={videoRef}
          controls
          controlsList="nodownload"
          disablePictureInPicture
          onContextMenu={(event) => event.preventDefault()}
          onLoadedMetadata={(event) => {
            if (resumeAtRef.current > 0) {
              event.currentTarget.currentTime = resumeAtRef.current;
              resumeAtRef.current = 0;
            }
            if (resumePlaybackRef.current) {
              resumePlaybackRef.current = false;
              event.currentTarget.play().catch(() => {});
            }
          }}
          onCanPlay={() => setLoading(false)}
          onWaiting={() => setLoading(true)}
          onPlaying={() => setLoading(false)}
          poster={ticket?.thumbnailUrl || undefined}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
        {loading && (
          <Stack
            spacing={1}
            alignItems="center"
            sx={{ position: 'absolute', inset: 0, justifyContent: 'center', color: 'common.white', pointerEvents: 'none' }}
          >
            <CircularProgress size={30} color="inherit" />
            <Typography variant="caption">Pripremam zaštićeni stream...</Typography>
          </Stack>
        )}
      </Box>
      {levels.length > 0 && (
        <FormControl size="small" sx={{ mt: 1, minWidth: 150 }}>
          <InputLabel>Kvalitet</InputLabel>
          <Select
            value={quality}
            label="Kvalitet"
            onChange={(event) => {
              const level = Number(event.target.value);
              setQuality(level);
              if (hlsRef.current) hlsRef.current.currentLevel = level;
            }}
          >
            <MenuItem value={-1}>Auto</MenuItem>
            {levels.map((level) => (
              <MenuItem key={level.index} value={level.index}>{level.height}p</MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
    </Box>
  );
};

export default ProgramFinalPlayer;
