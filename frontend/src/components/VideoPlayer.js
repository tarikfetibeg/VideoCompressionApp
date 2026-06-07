import React, { useState, useEffect, useRef } from 'react';
import axiosInstance from '../axiosConfig';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
} from '@mui/material';

const VideoPlayer = ({ videoId }) => {
  const [videoBlobUrl, setVideoBlobUrl] = useState('');
  const [timecodes, setTimecodes] = useState([]);
  const playerRef = useRef(null);

  useEffect(() => {
    const fetchVideo = async () => {
      try {
        const response = await axiosInstance.get(`/videos/preview/${videoId}`, {
          responseType: 'blob',
        });
        const blob = new Blob([response.data], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        setVideoBlobUrl(url);
      } catch (error) {
        console.error('Error fetching video:', error);
      }
    };

    fetchVideo();

    // Fetch timecodes
    axiosInstance
      .get(`/videos/${videoId}/timecodes`)
      .then((response) => {
        setTimecodes(response.data);
      })
      .catch((error) => {
        console.error('Error fetching timecodes:', error);
      });

    // Cleanup Blob URL when component unmounts
    return () => {
      URL.revokeObjectURL(videoBlobUrl);
    };
  }, [videoId]);

  const handleTimecodeClick = (timestamp) => {
    if (playerRef.current) {
      playerRef.current.currentTime = timestamp;
    }
  };

  return (
    <Box sx={{ mt: 4 }}>
      <video
        ref={playerRef}
        controls
        width="100%"
        height="auto"
        src={videoBlobUrl}
        onError={(e) => console.error('Video playback error:', e)}
      />
      <Typography variant="h6" sx={{ mt: 2 }}>
        Timecodes
      </Typography>
      <List>
        {timecodes.map((tc, index) => (
          <ListItem key={index} disablePadding>
            <ListItemButton onClick={() => handleTimecodeClick(tc.timestamp)}>
              <ListItemText
                primary={tc.description}
                secondary={formatTime(tc.timestamp)}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );
};

const formatTime = (seconds) => {
  const date = new Date(0);
  date.setSeconds(seconds);
  return date.toISOString().substr(11, 8);
};

export default VideoPlayer;
