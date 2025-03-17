import React, { useEffect, useState } from 'react';
import VideoPlayer from '../components/VideoPlayer';
import AddTimecode from '../components/AddTimecode';
import { useParams } from 'react-router-dom';
import { Button, Box, Typography } from '@mui/material';
import axios from '../axiosConfig';

const VideoDetailsPage = () => {
  const { videoId } = useParams();
  const [videoData, setVideoData] = useState(null);

  const fetchVideoData = () => {
    axios.get(`/api/videos/${videoId}`)
      .then(response => {
        setVideoData(response.data);
      })
      .catch(error => {
        console.error('Error fetching video details:', error);
      });
  };

  useEffect(() => {
    fetchVideoData();
  }, [videoId]);

  const handleDownload = () => {
    axios
      .get(`/api/videos/download/${videoId}`, {
        responseType: 'blob',
      })
      .then((response) => {
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `video_${videoId}.mp4`);
        document.body.appendChild(link);
        link.click();
        link.parentNode.removeChild(link);
      })
      .catch((error) => {
        console.error('Error downloading video:', error);
      });
  };

  return (
    <Box sx={{ mt: 4 }}>
      {videoData && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6">Video Details</Typography>
          <Typography>Filename: {videoData.originalFilename || videoData.filename}</Typography>
          <Typography>Event: {videoData.event || 'N/A'}</Typography>
          <Typography>Location: {videoData.location || 'N/A'}</Typography>
          <Typography>
            Date: {videoData.tagDate ? new Date(videoData.tagDate).toLocaleDateString() : 'N/A'}
          </Typography>
          <Typography>Status: {videoData.status}</Typography>
        </Box>
      )}
      <VideoPlayer videoId={videoId} />
      <Button variant="contained" color="primary" sx={{ mt: 2 }} onClick={handleDownload}>
        Download Video
      </Button>
      <AddTimecode videoId={videoId} />
    </Box>
  );
};

export default VideoDetailsPage;
