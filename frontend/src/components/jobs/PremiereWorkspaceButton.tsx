import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import MovieCreationIcon from '@mui/icons-material/MovieCreation';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { useSearchParams } from 'react-router-dom';
import axiosInstance from '../../axiosConfig';
import {
  isDesktopRuntime,
  listenForNativeTransferProgress,
  openLocalPath,
  preparePremiereWorkspace,
} from '../../desktop/runtime';
import { resolveHttpDownloadUrl } from '../../utils/downloadUrls';

function absoluteDownloadUrl(value: string) {
  return resolveHttpDownloadUrl(value, {
    apiBaseUrl: axiosInstance.defaults.baseURL || '/api',
    runtimeOrigin: window.location.origin,
    desktopRuntime: true,
  });
}

function numberedFilename(index: number, value: string, fallback: string) {
  const clean = String(value || fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  return `${String(index + 1).padStart(2, '0')}-${clean}`;
}

const PremiereWorkspaceButton = ({ job, role }: { job: any; role?: string }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [workspace, setWorkspace] = useState<any>(null);
  const autoStartedRef = useRef(false);
  const allowed = ['Editor', 'VideoEditor', 'Producer', 'Admin'].includes(role || '');

  const segmentByVideo = useMemo<Map<string, any>>(() => new Map(
    (job?.segments || []).map((segment: any) => [String(segment.video?._id || ''), segment])
  ), [job]);

  useEffect(() => {
    if (!isDesktopRuntime() || !job?._id) return undefined;
    let cleanup = () => {};
    listenForNativeTransferProgress((event) => {
      if (!event.id.startsWith(`premiere:${job._id}:`)) return;
      const filename = event.path?.split(/[\\/]/).pop() || 'fajl';
      const percent = event.totalBytes > 0 ? Math.round((event.transferredBytes / event.totalBytes) * 100) : null;
      setProgress(event.status === 'completed' ? `${filename} je spreman.` : `${filename}${percent == null ? '' : `: ${percent}%`}`);
    }).then((unlisten) => { cleanup = unlisten; });
    return () => cleanup();
  }, [job?._id]);

  const prepare = async () => {
    if (!job?._id || !allowed || busy) return;
    setBusy(true);
    setError('');
    setWorkspace(null);
    setProgress('Pripremam sigurne media linkove...');
    window.dispatchEvent(new CustomEvent('vca:premiere-transfer', { detail: 1 }));

    try {
      const roughCutResponse = await axiosInstance.get(`/v2/edit-jobs/${job._id}/rough-cut`);
      const roughCut = roughCutResponse.data?.roughCut || null;
      const videoSegments = (job.segments || []).filter((segment: any) => segment.video?._id);
      const ticketRequests = [
        ...videoSegments.map((segment: any) => axiosInstance.post('/downloads/tickets', {
          kind: 'video-single',
          payload: { videoId: segment.video._id },
          purpose: 'premiere-workspace',
        })),
        ...(job.offFiles || []).map((file: any) => axiosInstance.post('/downloads/tickets', {
          kind: 'edit-off-file',
          payload: { jobId: job._id, fileId: file._id },
          purpose: 'premiere-workspace',
        })),
      ];
      const tickets = await Promise.all(ticketRequests);
      let ticketIndex = 0;
      const files: any[] = videoSegments.map((segment: any, index: number) => ({
        sourceUrl: absoluteDownloadUrl(tickets[ticketIndex++].data.downloadUrl),
        fileName: numberedFilename(index, segment.video.originalFilename || segment.video.filename, `video-${segment.video._id}.mp4`),
        category: 'Media' as const,
        videoId: segment.video._id,
        inMs: Math.round(Number(segment.startTime || 0) * 1000),
        outMs: Math.round(Number(segment.endTime ?? segment.video.duration ?? 0) * 1000),
        order: Number(segment.order || index),
        note: segment.notes || segment.title || '',
      }));
      (job.offFiles || []).forEach((file: any, index: number) => {
        files.push({
          sourceUrl: absoluteDownloadUrl(tickets[ticketIndex++].data.downloadUrl),
          fileName: numberedFilename(index, file.originalName, `off-${file._id}`),
          category: 'OFF' as any,
          fileId: file._id,
          inMs: 0,
          outMs: 0,
          order: index,
          note: '',
          videoId: undefined as any,
        });
      });

      const enrichedRoughCut = roughCut ? {
        ...roughCut,
        items: (roughCut.items || []).map((item: any) => ({
          ...item,
          fileName: segmentByVideo.get(String(item.videoId))?.video?.originalFilename
            || segmentByVideo.get(String(item.videoId))?.video?.filename
            || item.videoId,
        })),
      } : null;
      setProgress('Desktop skida sirovine u lokalni workspace...');
      const result = await preparePremiereWorkspace({
        jobId: job._id,
        title: job.title || `Job ${job._id}`,
        brief: job.scriptText || job.description || '',
        roughCut: enrichedRoughCut,
        files,
      });
      setWorkspace(result);
      setProgress(`Workspace je spreman: ${result.downloaded} novih, ${result.skipped} već postojećih fajlova.`);
      await openLocalPath(result.workspacePath);
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || requestError.message || String(requestError));
    } finally {
      setBusy(false);
      window.dispatchEvent(new CustomEvent('vca:premiere-transfer', { detail: -1 }));
      if (searchParams.get('desktopAction') === 'premiere') {
        const next = new URLSearchParams(searchParams);
        next.delete('desktopAction');
        setSearchParams(next, { replace: true });
      }
    }
  };

  useEffect(() => {
    if (
      isDesktopRuntime()
      && allowed
      && job?._id
      && searchParams.get('desktopAction') === 'premiere'
      && !autoStartedRef.current
    ) {
      autoStartedRef.current = true;
      prepare();
    }
  }, [allowed, job?._id, searchParams]);

  if (!isDesktopRuntime() || !allowed) return null;

  return (
    <Stack spacing={0.75}>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        <Button variant="contained" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <MovieCreationIcon />} onClick={prepare} disabled={busy}>
          {busy ? 'Pripremam workspace...' : 'Otvori u Premiere'}
        </Button>
        {workspace && <Button startIcon={<FolderOpenIcon />} onClick={() => openLocalPath(workspace.workspacePath)}>Otvori folder</Button>}
      </Stack>
      {progress && <Typography variant="caption" color="text.secondary">{progress}</Typography>}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
};

export default PremiereWorkspaceButton;
