export const ACTIVE_PROCESSING_REFRESH_MS = 3000;
export const IDLE_REFRESH_MS = 30000;

export const activeProcessingStatuses = ['queued', 'processing'];

export const isVideoProcessingActive = (video) =>
  activeProcessingStatuses.includes(video?.processingStatus);

export const hasActiveVideoProcessing = (videos = []) =>
  videos.some(isVideoProcessingActive);
