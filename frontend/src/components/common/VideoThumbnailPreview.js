import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import axiosInstance from '../../axiosConfig';

const createObjectUrl = (blob) => (
  typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
    ? URL.createObjectURL(blob)
    : ''
);

const revokeObjectUrl = (objectUrl) => {
  if (objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(objectUrl);
  }
};

const VideoThumbnailPreview = ({
  videoId,
  title = 'Video thumbnail',
  width = 72,
  height = 44,
  enableScrubPreview = false,
}) => {
  const containerRef = useRef(null);
  const frameCacheRef = useRef(new Map());
  const pendingFrameRequestsRef = useRef(new Set());
  const thumbnailUrlRef = useRef('');
  const activeFrameRef = useRef(null);
  const mountedRef = useRef(true);
  const [visible, setVisible] = useState(false);
  const [thumbnailSrc, setThumbnailSrc] = useState('');
  const [displaySrc, setDisplaySrc] = useState('');
  const [manifest, setManifest] = useState(null);
  const [activeFrameIndex, setActiveFrameIndex] = useState(null);
  const flexBasis = typeof width === 'number' ? `${width}px` : width;

  const clearObjectUrls = () => {
    revokeObjectUrl(thumbnailUrlRef.current);
    thumbnailUrlRef.current = '';
    frameCacheRef.current.forEach((objectUrl) => revokeObjectUrl(objectUrl));
    frameCacheRef.current.clear();
    pendingFrameRequestsRef.current.clear();
  };

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
    clearObjectUrls();
  }, []);

  useEffect(() => {
    clearObjectUrls();
    setThumbnailSrc('');
    setDisplaySrc('');
    setManifest(null);
    setActiveFrameIndex(null);
    activeFrameRef.current = null;

    if (!visible || !videoId) return undefined;

    let cancelled = false;

    axiosInstance
      .get(`/videos/thumbnail/${videoId}`, { responseType: 'blob' })
      .then((response) => {
        if (cancelled || !mountedRef.current) return;
        const objectUrl = createObjectUrl(response.data);
        thumbnailUrlRef.current = objectUrl;
        setThumbnailSrc(objectUrl);
        setDisplaySrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled && mountedRef.current) {
          setThumbnailSrc('');
          setDisplaySrc('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [videoId, visible]);

  useEffect(() => {
    setManifest(null);

    if (!visible || !videoId || !enableScrubPreview) return undefined;

    let cancelled = false;

    axiosInstance
      .get(`/videos/scrub-preview/${videoId}/manifest`)
      .then((response) => {
        if (cancelled || !mountedRef.current) return;

        const nextManifest = response.data || {};
        if (nextManifest.available && Number(nextManifest.frameCount) > 0) {
          setManifest({
            ...nextManifest,
            frameCount: Number(nextManifest.frameCount),
          });
        }
      })
      .catch(() => {
        if (!cancelled && mountedRef.current) setManifest(null);
      });

    return () => {
      cancelled = true;
    };
  }, [enableScrubPreview, videoId, visible]);

  const loadFrame = (frameIndex) => {
    if (!videoId || !manifest?.frameCount) return;

    const cachedUrl = frameCacheRef.current.get(frameIndex);
    if (cachedUrl) {
      setDisplaySrc(cachedUrl);
      return;
    }

    if (pendingFrameRequestsRef.current.has(frameIndex)) return;
    pendingFrameRequestsRef.current.add(frameIndex);

    axiosInstance
      .get(`/videos/scrub-preview/${videoId}/frame/${frameIndex}`, { responseType: 'blob' })
      .then((response) => {
        pendingFrameRequestsRef.current.delete(frameIndex);
        if (!mountedRef.current) return;

        const objectUrl = createObjectUrl(response.data);
        frameCacheRef.current.set(frameIndex, objectUrl);

        if (activeFrameRef.current === frameIndex) {
          setDisplaySrc(objectUrl);
        }
      })
      .catch(() => {
        pendingFrameRequestsRef.current.delete(frameIndex);
      });
  };

  const handleMouseMove = (event) => {
    if (!enableScrubPreview || !manifest?.frameCount) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;

    const ratio = Math.min(Math.max((event.clientX - bounds.left) / bounds.width, 0), 0.9999);
    const nextFrameIndex = Math.min(
      manifest.frameCount - 1,
      Math.floor(ratio * manifest.frameCount)
    );

    if (activeFrameRef.current === nextFrameIndex) return;

    activeFrameRef.current = nextFrameIndex;
    setActiveFrameIndex(nextFrameIndex);
    loadFrame(nextFrameIndex);
  };

  const handleMouseLeave = () => {
    activeFrameRef.current = null;
    setActiveFrameIndex(null);
    setDisplaySrc(thumbnailSrc);
  };

  return (
    <Box
      ref={containerRef}
      data-testid="video-thumbnail-preview"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      sx={{
        width,
        height,
        flex: `0 0 ${flexBasis}`,
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: 'grey.100',
        border: 1,
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        cursor: enableScrubPreview && manifest?.frameCount ? 'ew-resize' : 'default',
      }}
    >
      {displaySrc ? (
        <Box
          component="img"
          src={displaySrc}
          alt={title}
          data-testid="video-thumbnail-image"
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <Typography variant="caption" color="text.secondary">
          Preview
        </Typography>
      )}

      {enableScrubPreview && manifest?.frameCount && activeFrameIndex !== null && (
        <Box
          data-testid="scrub-preview-indicator"
          sx={{
            position: 'absolute',
            left: `${((activeFrameIndex + 0.5) / manifest.frameCount) * 100}%`,
            bottom: 0,
            width: 2,
            height: '100%',
            bgcolor: 'common.white',
            opacity: 0.85,
            transform: 'translateX(-1px)',
            boxShadow: 1,
          }}
        />
      )}
    </Box>
  );
};

export default VideoThumbnailPreview;
