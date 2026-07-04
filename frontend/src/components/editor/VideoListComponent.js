import React from 'react';
import { Link } from 'react-router-dom';
import {
  Box,
  Checkbox,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import ReplayIcon from '@mui/icons-material/Replay';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import VideoThumbnailPreview from '../common/VideoThumbnailPreview';
import { EmptyState, StatusChip } from '../common/WorkspaceChrome';
import {
  archiveReviewLabels,
  broadcastLabels,
  formatDateBs,
  materialLabels,
  processingLabels,
  qcLabels,
} from '../../utils/uiLabels';

const formatDate = (value) => {
  if (!value) return 'Bez datuma';
  return formatDateBs(value);
};

const formatBytes = (bytes) => {
  if (!bytes || Number.isNaN(Number(bytes))) return 'N/A';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Number(bytes);
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const getUploaderName = (video) => video.uploader?.username || 'Unknown';
const getPersonName = (person) => person?.username || 'N/A';
const getVideoTitle = (video) => video.finalTitle || video.originalFilename || video.filename || 'Bez naziva';
const normalizeDisplayText = (value) =>
  String(value || '')
    .trim()
    .replace(/\.[a-z0-9]{2,6}$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
const isSameDisplayText = (value, candidates = []) => {
  const normalizedValue = normalizeDisplayText(value);
  return Boolean(normalizedValue) && candidates.some((candidate) =>
    normalizeDisplayText(candidate) === normalizedValue
  );
};
const getVideoFileLabel = (video) => {
  const title = getVideoTitle(video);
  const filename = video.originalFilename || video.filename || '';
  return filename && !isSameDisplayText(filename, [title]) ? filename : '';
};
const getAssignmentEventLabel = (video, title) => (
  video.event && !isSameDisplayText(video.event, [
    title,
    video.finalTitle,
    video.originalFilename,
    video.filename,
  ])
    ? video.event
    : ''
);
const getContentTypeName = (video) => video.contentType?.name || video.finalCategory || 'Bez kategorije';
const canRequestCategoryReview = (video) =>
  video.status === 'edited' &&
  video.processingStatus === 'completed' &&
  video.archiveReviewStatus !== 'needs_metadata';

const VideoListComponent = ({
  videos,
  selectedVideos,
  onSelectVideo,
  onSelectAllVisible,
  onRetryProcessing,
  onRequestCategoryReview,
}) => {
  const visibleIds = videos.map((video) => video._id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedVideos.includes(id));
  const someVisibleSelected =
    visibleIds.some((id) => selectedVideos.includes(id)) && !allVisibleSelected;

  if (videos.length === 0) {
    return (
      <EmptyState
        title="Nema materijala"
        description="Promijeni filtere ili osvježi produkcijski prikaz."
      />
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox">
              <Checkbox
                checked={allVisibleSelected}
                indeterminate={someVisibleSelected}
                onChange={onSelectAllVisible}
              />
            </TableCell>
            <TableCell>Materijal</TableCell>
            <TableCell>Zaduženje</TableCell>
            <TableCell>Obrada</TableCell>
            <TableCell>QC / Air</TableCell>
            <TableCell>Format</TableCell>
            <TableCell align="right">Akcije</TableCell>
          </TableRow>
        </TableHead>

        <TableBody>
          {videos.map((video) => {
            const selected = selectedVideos.includes(video._id);
            const processingProgress = Number(video.processingProgress) || 0;
            const showProgress = ['queued', 'processing'].includes(video.processingStatus);
            const title = getVideoTitle(video);
            const fileLabel = getVideoFileLabel(video);
            const assignmentEvent = getAssignmentEventLabel(video, title);
            const categoryReviewDisabled = !canRequestCategoryReview(video);
            const categoryReviewTooltip = video.archiveReviewStatus === 'needs_metadata'
              ? 'Vec je poslano arhivi na provjeru kategorije'
              : categoryReviewDisabled
                ? 'Samo zavrsen/finalizovan materijal moze ici arhivi na provjeru kategorije'
                : 'Prijavi pogresnu kategoriju arhivi';

            return (
              <TableRow
                key={video._id}
                hover
                selected={selected}
                sx={{
                  '& td': {
                    verticalAlign: 'top',
                  },
                }}
              >
                <TableCell padding="checkbox">
                  <Checkbox checked={selected} onChange={() => onSelectVideo(video._id)} />
                </TableCell>

                <TableCell sx={{ minWidth: 340 }}>
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <VideoThumbnailPreview
                      videoId={video._id}
                      title={`Preview: ${title}`}
                      width={96}
                      height={54}
                      enableScrubPreview
                    />
                    <Stack spacing={0.75} sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <PlayCircleOutlineIcon fontSize="small" color="action" />
                        <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                          {title}
                        </Typography>
                      </Stack>
                      {fileLabel && (
                        <Typography variant="caption" color="text.secondary" noWrap>
                          Fajl: {fileLabel}
                        </Typography>
                      )}
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        <StatusChip value={video.status} maps={materialLabels} />
                        <StatusChip label={getContentTypeName(video)} variant="outlined" tone="default" />
                        {video.isBroll && <StatusChip label="B-roll" tone="primary" />}
                        {video.archiveReviewStatus === 'needs_metadata' && (
                          <StatusChip value={video.archiveReviewStatus} maps={archiveReviewLabels} />
                        )}
                        <StatusChip label={formatBytes(video.sizeCompressed || video.sizeOriginal)} variant="outlined" />
                      </Stack>
                    </Stack>
                  </Stack>
                </TableCell>

                <TableCell sx={{ minWidth: 220 }}>
                  {assignmentEvent && (
                    <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                      {assignmentEvent}
                    </Typography>
                  )}
                  <Typography
                    variant={assignmentEvent ? 'caption' : 'body2'}
                    color={assignmentEvent ? 'text.secondary' : 'text.primary'}
                    display="block"
                    sx={{ fontWeight: assignmentEvent ? 400 : 700 }}
                  >
                    {[video.location, formatDate(video.tagDate || video.uploadDate)].filter(Boolean).join(' / ')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {getUploaderName(video)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Reporter: {getPersonName(video.reporter)} / Editor: {getPersonName(video.editor)}
                  </Typography>
                  {video.qaResponsible && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      QA: {getPersonName(video.qaResponsible)}
                    </Typography>
                  )}
                </TableCell>

                <TableCell sx={{ minWidth: 170 }}>
                  <StatusChip value={video.processingStatus} maps={processingLabels} />
                  {showProgress && (
                    <Box sx={{ mt: 1, width: 140 }}>
                      <LinearProgress variant="determinate" value={processingProgress} />
                      <Typography variant="caption" color="text.secondary">
                        {processingProgress}%
                      </Typography>
                    </Box>
                  )}
                  {video.processingStatus === 'failed' && video.processingError && (
                    <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
                      {video.processingError}
                    </Typography>
                  )}
                </TableCell>

                <TableCell sx={{ minWidth: 190 }}>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    <StatusChip value={video.qcStatus || 'pending'} maps={qcLabels} />
                    <StatusChip value={video.broadcastStatus || 'not_ready'} maps={broadcastLabels} variant="outlined" />
                    {video.correctionStatus === 'needs_correction' && (
                      <StatusChip label="Potrebna ispravka" tone="error" />
                    )}
                  </Stack>
                </TableCell>

                <TableCell sx={{ minWidth: 150 }}>
                  <Typography variant="body2">{video.resolution || 'N/A'}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {video.codec || 'N/A'} / {video.framerate || 'N/A'} fps
                  </Typography>
                </TableCell>

                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    {video.processingStatus === 'failed' && onRetryProcessing && (
                      <Tooltip title="Ponovi obradu">
                        <IconButton onClick={() => onRetryProcessing(video)} size="small">
                          <ReplayIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {onRequestCategoryReview && (
                      <Tooltip title={categoryReviewTooltip}>
                        <span>
                          <IconButton
                            onClick={() => onRequestCategoryReview(video)}
                            size="small"
                            color={video.archiveReviewStatus === 'needs_metadata' ? 'warning' : 'default'}
                            disabled={categoryReviewDisabled}
                          >
                            <ReportProblemOutlinedIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                    <Tooltip title="Otvori detalje">
                      <IconButton component={Link} to={`/video-details/${video._id}`} size="small">
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default VideoListComponent;
