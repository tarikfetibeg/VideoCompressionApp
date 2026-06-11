import React from 'react';
import { Link } from 'react-router-dom';
import {
  Box,
  Checkbox,
  Chip,
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

const formatDate = (value) => {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No date';
  return date.toLocaleDateString();
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

const getProcessingColor = (status) => {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'processing' || status === 'queued') return 'warning';
  return 'default';
};

const getQcColor = (status) => {
  if (status === 'passed') return 'success';
  if (status === 'failed') return 'error';
  return 'warning';
};

const getBroadcastColor = (status) => {
  if (status === 'approved_for_air' || status === 'aired') return 'success';
  if (status === 'qc_failed') return 'error';
  if (status === 'ready_for_approval' || status === 'qc_pending') return 'warning';
  return 'default';
};

const formatStatusLabel = (value) => String(value || 'N/A').replace(/_/g, ' ');

const VideoListComponent = ({
  videos,
  selectedVideos,
  onSelectVideo,
  onSelectAllVisible,
  onRetryProcessing,
}) => {
  const visibleIds = videos.map((video) => video._id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedVideos.includes(id));
  const someVisibleSelected =
    visibleIds.some((id) => selectedVideos.includes(id)) && !allVisibleSelected;

  if (videos.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, borderRadius: 2, textAlign: 'center' }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>
          No material found
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Adjust filters or refresh the workspace.
        </Typography>
      </Paper>
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
            <TableCell>Material</TableCell>
            <TableCell>Assignment</TableCell>
            <TableCell>Processing</TableCell>
            <TableCell>QC / Air</TableCell>
            <TableCell>Format</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>

        <TableBody>
          {videos.map((video) => {
            const selected = selectedVideos.includes(video._id);
            const processingProgress = Number(video.processingProgress) || 0;
            const showProgress = ['queued', 'processing'].includes(video.processingStatus);

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

                <TableCell sx={{ minWidth: 260 }}>
                  <Stack spacing={0.75}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <PlayCircleOutlineIcon fontSize="small" color="action" />
                      <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                        {video.originalFilename || video.filename}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      <Chip label={video.status || 'N/A'} size="small" />
                      {video.isBroll && <Chip label="B-roll" size="small" color="primary" />}
                      <Chip label={formatBytes(video.sizeCompressed || video.sizeOriginal)} size="small" variant="outlined" />
                    </Stack>
                  </Stack>
                </TableCell>

                <TableCell sx={{ minWidth: 220 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                    {video.event || 'No event'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
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
                  <Chip
                    label={formatStatusLabel(video.processingStatus)}
                    size="small"
                    color={getProcessingColor(video.processingStatus)}
                  />
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
                    <Chip
                      label={`QC ${formatStatusLabel(video.qcStatus || 'pending')}`}
                      size="small"
                      color={getQcColor(video.qcStatus || 'pending')}
                    />
                    <Chip
                      label={formatStatusLabel(video.broadcastStatus || 'not_ready')}
                      size="small"
                      color={getBroadcastColor(video.broadcastStatus || 'not_ready')}
                      variant="outlined"
                    />
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
                      <Tooltip title="Retry processing">
                        <IconButton onClick={() => onRetryProcessing(video)} size="small">
                          <ReplayIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Open details">
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
