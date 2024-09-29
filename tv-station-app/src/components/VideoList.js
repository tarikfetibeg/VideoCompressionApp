import React, { useState, useEffect } from 'react';
import axios from '../axiosConfig';
import { Link } from 'react-router-dom';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  Divider,
  Checkbox,
  Button,
  FormControlLabel,
} from '@mui/material';

const VideoList = ({ showTimecodeOptions }) => {
  const [videos, setVideos] = useState([]);
  const [selectedVideos, setSelectedVideos] = useState([]);

  useEffect(() => {
    fetchVideos();
  }, []);

  const fetchVideos = () => {
    axios
      .get('/videos')
      .then((response) => {
        setVideos(response.data);
      })
      .catch((error) => {
        console.error('Error fetching videos:', error);
      });
  };

  const handleSelectVideo = (videoId) => {
    setSelectedVideos((prevSelected) =>
      prevSelected.includes(videoId)
        ? prevSelected.filter((id) => id !== videoId)
        : [...prevSelected, videoId]
    );
  };

    // For bulk download as a ZIP file
  const handleDownloadSelected = () => {
    axios
      .post(
        '/videos/download',
        { videoIds: selectedVideos },
        { responseType: 'blob' }
      )
      .then((response) => {
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `videos_${Date.now()}.zip`);
        document.body.appendChild(link);
        link.click();
        link.parentNode.removeChild(link);
      })
      .catch((error) => {
        console.error('Error downloading videos:', error);
      });
  };

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h5">Videos</Typography>
      {selectedVideos.length > 0 && (
        <Button variant="contained" color="primary" sx={{ mb: 2 }} onClick={handleDownloadSelected}>
          Download Selected ({selectedVideos.length})
        </Button>
      )}
      <List>
        {videos.map((video) => (
          <React.Fragment key={video._id}>
            <ListItem disablePadding>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={selectedVideos.includes(video._id)}
                    onChange={() => handleSelectVideo(video._id)}
                  />
                }
                label=""
              />
              <ListItemButton
                component={Link}
                to={`/video-details/${video._id}`}
              >
                <ListItemText
                  primary={video.originalFilename || video.filename}
                  secondary={`Uploaded by: ${video.uploader.username}`}
                />
              </ListItemButton>
              {showTimecodeOptions && (
                <Button
                  component={Link}
                  to={`/video-details/${video._id}`}
                  variant="outlined"
                  sx={{ ml: 2 }}
                >
                  Add Timecode
                </Button>
              )}
            </ListItem>
            <Divider />
          </React.Fragment>
        ))}
      </List>
    </Box>
  );
};

export default VideoList;
