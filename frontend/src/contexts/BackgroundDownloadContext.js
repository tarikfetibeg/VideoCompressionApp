import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ReplayIcon from '@mui/icons-material/Replay';
import axios from '../axiosConfig';

const BackgroundDownloadContext = createContext(null);

const createDownloadId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const terminalStatuses = new Set(['completed', 'aborted', 'failed', 'expired']);
const blockingStatuses = new Set(['creating_ticket', 'opening']);
const activeStatuses = new Set(['creating_ticket', 'opening', 'streaming']);

const statusLabels = {
  creating_ticket: 'Priprema',
  opening: 'Otvaram',
  streaming: 'Skidanje',
  completed: 'Zavrseno',
  aborted: 'Prekinuto',
  failed: 'Greska',
  expired: 'Isteklo',
};

const statusSeverity = {
  completed: 'success',
  failed: 'error',
  aborted: 'warning',
  expired: 'warning',
};

const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const getAxiosOrigin = () => {
  const baseURL = axios.defaults.baseURL || '/api';

  try {
    if (/^https?:\/\//i.test(baseURL)) {
      return new URL(baseURL).origin;
    }
  } catch (error) {
    return '';
  }

  return '';
};

const resolveDownloadUrl = (downloadUrl) => {
  if (!downloadUrl) return '';
  if (/^https?:\/\//i.test(downloadUrl)) return downloadUrl;

  const apiOrigin = getAxiosOrigin();
  if (apiOrigin && downloadUrl.startsWith('/')) {
    return `${apiOrigin}${downloadUrl}`;
  }

  return downloadUrl;
};

const getNetworkMessage = (error) => {
  if (error.response?.data?.message) return error.response.data.message;

  if (error.code === 'ECONNABORTED') {
    return 'Download priprema je istekla. Provjeri mrezu i pokusaj ponovo.';
  }

  if (!error.response) {
    return 'Nema odgovora servera. Provjeri mrezu, CORS i da li koristis backend URL na portu 5000.';
  }

  return 'Download se ne moze pokrenuti.';
};

export const BackgroundDownloadProvider = ({ children }) => {
  const [downloads, setDownloads] = useState([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const pollingRef = useRef(new Map());
  const handoffFramesRef = useRef(new Set());

  const activeDownloads = useMemo(
    () => downloads.filter((download) => activeStatuses.has(download.status)),
    [downloads]
  );
  const failedDownloads = useMemo(
    () => downloads.filter((download) => ['failed', 'aborted', 'expired'].includes(download.status)),
    [downloads]
  );
  const completedDownloads = useMemo(
    () => downloads.filter((download) => download.status === 'completed'),
    [downloads]
  );
  const hasBlockingDownloads = useMemo(
    () => downloads.some((download) => blockingStatuses.has(download.status)),
    [downloads]
  );
  const currentDownload = activeDownloads[0] || null;

  useEffect(() => {
    if (!hasBlockingDownloads) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasBlockingDownloads]);

  useEffect(() => () => {
    pollingRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    pollingRef.current.clear();
    handoffFramesRef.current.forEach((frame) => frame.remove());
    handoffFramesRef.current.clear();
  }, []);

  const updateDownload = useCallback((downloadId, patch) => {
    setDownloads((current) =>
      current.map((download) =>
        download.id === downloadId ? { ...download, ...patch, updatedAt: new Date().toISOString() } : download
      )
    );
  }, []);

  const clearPoller = useCallback((downloadId) => {
    const timeoutId = pollingRef.current.get(downloadId);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      pollingRef.current.delete(downloadId);
    }
  }, []);

  const handoffToBrowser = useCallback((downloadUrl) => {
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.setAttribute('aria-hidden', 'true');
    frame.src = downloadUrl;
    document.body.appendChild(frame);
    handoffFramesRef.current.add(frame);

    window.setTimeout(() => {
      frame.remove();
      handoffFramesRef.current.delete(frame);
    }, 60 * 1000);
  }, []);

  const pollStatus = useCallback((downloadId, ticketId) => {
    clearPoller(downloadId);

    const run = async () => {
      try {
        const response = await axios.get(`/downloads/tickets/${ticketId}/status`);
        const status = response.data?.status || 'streaming';
        const serverError = response.data?.error || '';

        updateDownload(downloadId, {
          status,
          serverStatus: status,
          message: terminalStatuses.has(status)
            ? serverError || (status === 'completed' ? 'Server je zavrsio slanje fajla.' : statusLabels[status])
            : 'Browser download manager preuzima fizicko skidanje.',
          error: ['failed', 'aborted', 'expired'].includes(status) ? serverError : '',
          startedAt: response.data?.startedAt,
          finishedAt: response.data?.finishedAt,
        });

        if (terminalStatuses.has(status)) {
          clearPoller(downloadId);
          return;
        }
      } catch (error) {
        updateDownload(downloadId, {
          status: 'failed',
          error: getNetworkMessage(error),
          message: getNetworkMessage(error),
        });
        clearPoller(downloadId);
        return;
      }

      const timeoutId = window.setTimeout(run, 2000);
      pollingRef.current.set(downloadId, timeoutId);
    };

    const timeoutId = window.setTimeout(run, 1200);
    pollingRef.current.set(downloadId, timeoutId);
  }, [clearPoller, updateDownload]);

  const createTicketAndOpen = useCallback(async (download) => {
    updateDownload(download.id, {
      status: 'creating_ticket',
      message: 'Pripremam siguran download link...',
      error: '',
    });
    setPanelOpen(true);

    try {
      const response = await axios.post('/downloads/tickets', {
        kind: download.kind,
        payload: download.payload,
      });
      const downloadUrl = resolveDownloadUrl(response.data?.downloadUrl);

      updateDownload(download.id, {
        ticketId: response.data?.ticketId,
        downloadUrl,
        expiresAt: response.data?.expiresAt,
        status: 'opening',
        message: 'Otvaram browser download manager...',
      });

      await delay(100);
      handoffToBrowser(downloadUrl);

      updateDownload(download.id, {
        status: 'streaming',
        message: 'Download je pokrenut. Mozes nastaviti koristiti aplikaciju.',
      });

      if (response.data?.ticketId) {
        pollStatus(download.id, response.data.ticketId);
      }

      return response.data;
    } catch (error) {
      console.error('Background download failed:', error);
      const message = getNetworkMessage(error);
      updateDownload(download.id, {
        status: 'failed',
        error: message,
        message,
      });
      throw error;
    }
  }, [handoffToBrowser, pollStatus, updateDownload]);

  const startDownload = useCallback((descriptor) => {
    const download = {
      id: createDownloadId(),
      kind: descriptor.kind,
      payload: descriptor.payload || {},
      label: descriptor.label || 'Download',
      status: 'creating_ticket',
      message: 'Pripremam download...',
      error: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ticketId: '',
      downloadUrl: '',
      expiresAt: null,
    };

    setDownloads((current) => [download, ...current].slice(0, 12));
    setPanelOpen(true);
    return createTicketAndOpen(download);
  }, [createTicketAndOpen]);

  const retryDownload = useCallback((downloadId) => {
    const download = downloads.find((item) => item.id === downloadId);
    if (!download) return Promise.resolve(null);

    clearPoller(downloadId);
    return createTicketAndOpen({
      ...download,
      ticketId: '',
      downloadUrl: '',
      expiresAt: null,
    });
  }, [clearPoller, createTicketAndOpen, downloads]);

  const clearFinishedDownloads = useCallback(() => {
    setDownloads((current) => current.filter((download) => activeStatuses.has(download.status)));
  }, []);

  const value = useMemo(
    () => ({
      downloads,
      activeDownloads,
      failedDownloads,
      completedDownloads,
      hasBlockingDownloads,
      startDownload,
      retryDownload,
      clearFinishedDownloads,
    }),
    [
      downloads,
      activeDownloads,
      failedDownloads,
      completedDownloads,
      hasBlockingDownloads,
      startDownload,
      retryDownload,
      clearFinishedDownloads,
    ]
  );

  return (
    <BackgroundDownloadContext.Provider value={value}>
      {children}
      {downloads.length > 0 && (
        <Box
          sx={{
            position: 'fixed',
            right: { xs: 12, md: 24 },
            bottom: { xs: 12, md: 24 },
            width: { xs: 'calc(100% - 24px)', sm: 440 },
            zIndex: 1500,
          }}
        >
          <Collapse in={panelOpen}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, boxShadow: 4 }}>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  <DownloadIcon color={activeDownloads.length > 0 ? 'primary' : 'action'} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
                      Download manager
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {activeDownloads.length > 0
                        ? 'Aplikacija priprema i prati download; browser skida fajl.'
                        : 'Download lista je mirna.'}
                    </Typography>
                  </Box>
                </Stack>
                <IconButton size="small" onClick={() => setPanelOpen(false)} disabled={hasBlockingDownloads}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>

              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                <Chip label={`${activeDownloads.length} aktivno`} size="small" color={activeDownloads.length > 0 ? 'primary' : 'default'} />
                <Chip label={`${completedDownloads.length} zavrseno`} size="small" color="success" variant="outlined" />
                {failedDownloads.length > 0 && (
                  <Chip label={`${failedDownloads.length} problem`} size="small" color="error" variant="outlined" />
                )}
              </Stack>

              {currentDownload && (
                <Box sx={{ mt: 1.25 }}>
                  <Typography variant="caption" sx={{ fontWeight: 800 }} noWrap>
                    {currentDownload.label}
                  </Typography>
                  <LinearProgress />
                  <Typography variant="caption" color="text.secondary">
                    {statusLabels[currentDownload.status] || currentDownload.status}: {currentDownload.message}
                  </Typography>
                </Box>
              )}

              <Stack spacing={0.75} sx={{ mt: 1 }}>
                {downloads.slice(0, 4).map((download) => (
                  <Alert
                    key={download.id}
                    severity={statusSeverity[download.status] || 'info'}
                    action={
                      ['failed', 'aborted', 'expired'].includes(download.status) ? (
                        <Button
                          color="inherit"
                          size="small"
                          startIcon={<ReplayIcon />}
                          onClick={() => retryDownload(download.id)}
                        >
                          Ponovi
                        </Button>
                      ) : download.downloadUrl ? (
                        <IconButton
                          color="inherit"
                          size="small"
                          onClick={() => handoffToBrowser(download.downloadUrl)}
                          title="Ponovo otvori browser download"
                        >
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      ) : null
                    }
                  >
                    <Typography variant="body2" sx={{ fontWeight: 750 }}>
                      {download.label}
                    </Typography>
                    <Typography variant="caption" component="div">
                      {statusLabels[download.status] || download.status}
                      {download.error ? ` - ${download.error}` : download.message ? ` - ${download.message}` : ''}
                    </Typography>
                  </Alert>
                ))}
              </Stack>

              {!hasBlockingDownloads && downloads.length > 0 && (
                <Button size="small" sx={{ mt: 1 }} onClick={clearFinishedDownloads}>
                  Ocisti zavrsene
                </Button>
              )}
            </Paper>
          </Collapse>
        </Box>
      )}
    </BackgroundDownloadContext.Provider>
  );
};

export const useBackgroundDownloads = () => {
  const context = useContext(BackgroundDownloadContext);
  if (!context) {
    throw new Error('useBackgroundDownloads must be used inside BackgroundDownloadProvider');
  }
  return context;
};
