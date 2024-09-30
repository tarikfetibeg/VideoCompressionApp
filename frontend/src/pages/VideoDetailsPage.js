import React from 'react';
import VideoPlayer from '../components/VideoPlayer';
import AddTimecode from '../components/AddTimecode';
import { useParams } from 'react-router-dom';
import { Button, Box } from '@mui/material';
import axios from '../axiosConfig';

const VideoDetailsPage = () => {
  const { videoId } = useParams();

  const handleDownload = () => {
    axios
      .get(`/videos/download/${videoId}`, {
        responseType: 'blob',
      })
      .then((response) => {
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `video_${videoId}.mp4`); // or use the original filename
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
      <VideoPlayer videoId={videoId} />
      <Button variant="contained" color="primary" sx={{ mt: 2 }} onClick={handleDownload}>
        Download Video
      </Button>
      {/* Include AddTimecode component if the user has the role */}
      <AddTimecode videoId={videoId} />
    </Box>
  );
};

export default VideoDetailsPage;
