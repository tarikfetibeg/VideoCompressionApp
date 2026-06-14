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
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ReplayIcon from '@mui/icons-material/Replay';
import axios from '../axiosConfig';

const BackgroundUploadContext = createContext(null);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const createUploadId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const sortFilesNaturally = (files) =>
  [...files].sort((a, b) => collator.compare(a.name || '', b.name || ''));

const buildDirectFinalFormData = (job) => {
  const formData = new FormData();
  const metadata = job.metadata || {};

  formData.append('finalVideos', job.file, job.file.name);
  formData.append('programId', metadata.programId || 'ingest');
  formData.append('contentTypeId', metadata.contentTypeId || '');
  formData.append('airDate', metadata.airDate || '');
  formData.append('finalTitle', metadata.finalTitle || '');
  formData.append('reporterId', metadata.reporterId || '');
  formData.append('keywords', metadata.keywords || '');
  formData.append('notes', metadata.notes || '');
  formData.append('useFilenameMetadata', metadata.useFilenameMetadata ? 'true' : 'false');
  formData.append('bulkUpload', metadata.bulkUpload ? 'true' : 'false');

  return formData;
};

export const BackgroundUploadProvider = ({ children }) => {
  const [uploads, setUploads] = useState([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const uploadingRef = useRef(false);

  const activeUploads = useMemo(
    () => uploads.filter((upload) => ['pending', 'uploading'].includes(upload.status)),
    [uploads]
  );
  const failedUploads = useMemo(
    () => uploads.filter((upload) => upload.status === 'error'),
    [uploads]
  );
  const completedUploads = useMemo(
    () => uploads.filter((upload) => upload.status === 'done'),
    [uploads]
  );
  const currentUpload = uploads.find((upload) => upload.status === 'uploading');
  const hasBlockingUploads = activeUploads.length > 0;

  useEffect(() => {
    if (!hasBlockingUploads) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasBlockingUploads]);

  const uploadJob = useCallback(async (job) => {
    uploadingRef.current = true;
    setPanelOpen(true);
    setUploads((current) =>
      current.map((upload) =>
        upload.id === job.id
          ? { ...upload, status: 'uploading', progress: 0, error: '' }
          : upload
      )
    );

    try {
      const response = await axios.post('/broadcast/direct-final-upload', buildDirectFinalFormData(job), {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const total = progressEvent.total || 0;
          if (total > 0) {
            const progress = Math.round((progressEvent.loaded * 100) / total);
            setUploads((current) =>
              current.map((upload) =>
                upload.id === job.id ? { ...upload, progress } : upload
              )
            );
          }
        },
      });

      setUploads((current) =>
        current.map((upload) =>
          upload.id === job.id
            ? {
                ...upload,
                file: null,
                status: 'done',
                progress: 100,
                responseMessage: response.data?.message || 'Upload saved.',
              }
            : upload
        )
      );
    } catch (error) {
      console.error('Background upload failed:', error);
      setUploads((current) =>
        current.map((upload) =>
          upload.id === job.id
            ? {
                ...upload,
                status: 'error',
                progress: 0,
                error: error.response?.data?.message || 'Upload failed.',
              }
            : upload
        )
      );
    } finally {
      uploadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (uploadingRef.current) return;
    const nextUpload = uploads.find((upload) => upload.status === 'pending' && upload.file);
    if (!nextUpload) return;

    uploadJob(nextUpload);
  }, [uploads, uploadJob]);

  const enqueueDirectFinalUploads = useCallback((files, metadata = {}) => {
    const sortedFiles = sortFilesNaturally(Array.from(files || []));
    const isBulkUpload = sortedFiles.length > 1 || Boolean(metadata.bulkUpload);
    const nextUploads = sortedFiles.map((file, index) => ({
      id: createUploadId(),
      file,
      filename: file.name,
      size: file.size,
      status: 'pending',
      progress: 0,
      error: '',
      createdAt: new Date().toISOString(),
      order: index,
      metadata: {
        ...metadata,
        bulkUpload: isBulkUpload,
        useFilenameMetadata: metadata.useFilenameMetadata !== false,
        finalTitle: isBulkUpload ? '' : metadata.finalTitle,
      },
    }));

    setUploads((current) => [...current, ...nextUploads]);
    setPanelOpen(true);
    return nextUploads.length;
  }, []);

  const retryUpload = useCallback((uploadId) => {
    setUploads((current) =>
      current.map((upload) =>
        upload.id === uploadId && upload.file
          ? { ...upload, status: 'pending', progress: 0, error: '' }
          : upload
      )
    );
    setPanelOpen(true);
  }, []);

  const clearFinishedUploads = useCallback(() => {
    setUploads((current) => current.filter((upload) => !['done', 'error'].includes(upload.status)));
  }, []);

  const value = useMemo(
    () => ({
      uploads,
      activeUploads,
      failedUploads,
      completedUploads,
      enqueueDirectFinalUploads,
      retryUpload,
      clearFinishedUploads,
      hasBlockingUploads,
    }),
    [
      uploads,
      activeUploads,
      failedUploads,
      completedUploads,
      enqueueDirectFinalUploads,
      retryUpload,
      clearFinishedUploads,
      hasBlockingUploads,
    ]
  );

  return (
    <BackgroundUploadContext.Provider value={value}>
      {children}
      {uploads.length > 0 && (
        <Box
          sx={{
            position: 'fixed',
            right: { xs: 12, md: 24 },
            bottom: { xs: 12, md: 24 },
            width: { xs: 'calc(100% - 24px)', sm: 420 },
            zIndex: 1500,
          }}
        >
          <Collapse in={panelOpen}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, boxShadow: 4 }}>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  <CloudUploadIcon color={hasBlockingUploads ? 'primary' : 'action'} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
                      Background uploads
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {hasBlockingUploads
                        ? 'Uploads continue while you use the app. Do not close this tab.'
                        : 'Upload queue finished.'}
                    </Typography>
                  </Box>
                </Stack>
                <IconButton size="small" onClick={() => setPanelOpen(false)} disabled={hasBlockingUploads}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>

              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                <Chip label={`${activeUploads.length} active`} size="small" color={hasBlockingUploads ? 'primary' : 'default'} />
                <Chip label={`${completedUploads.length} done`} size="small" color="success" variant="outlined" />
                {failedUploads.length > 0 && (
                  <Chip label={`${failedUploads.length} failed`} size="small" color="error" variant="outlined" />
                )}
              </Stack>

              {currentUpload && (
                <Box sx={{ mt: 1.25 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700 }} noWrap>
                    {currentUpload.filename}
                  </Typography>
                  <LinearProgress variant="determinate" value={Number(currentUpload.progress) || 0} />
                  <Typography variant="caption" color="text.secondary">
                    Upload {Number(currentUpload.progress) || 0}%
                  </Typography>
                </Box>
              )}

              {failedUploads.length > 0 && (
                <Stack spacing={0.75} sx={{ mt: 1 }}>
                  {failedUploads.slice(0, 3).map((upload) => (
                    <Alert
                      key={upload.id}
                      severity="error"
                      action={
                        upload.file ? (
                          <Button
                            color="inherit"
                            size="small"
                            startIcon={<ReplayIcon />}
                            onClick={() => retryUpload(upload.id)}
                          >
                            Retry
                          </Button>
                        ) : null
                      }
                    >
                      {upload.filename}: {upload.error}
                    </Alert>
                  ))}
                </Stack>
              )}

              {!hasBlockingUploads && uploads.length > 0 && (
                <Button size="small" sx={{ mt: 1 }} onClick={clearFinishedUploads}>
                  Clear finished
                </Button>
              )}
            </Paper>
          </Collapse>
        </Box>
      )}
    </BackgroundUploadContext.Provider>
  );
};

export const useBackgroundUploads = () => {
  const context = useContext(BackgroundUploadContext);
  if (!context) {
    throw new Error('useBackgroundUploads must be used inside BackgroundUploadProvider');
  }
  return context;
};
