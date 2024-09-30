import React, { useState, useEffect, useRef } from 'react';
import ReactPlayer from 'react-player';
import axios from '../axiosConfig';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
} from '@mui/material';

const VideoPlayer = ({ videoId }) => {
  const [videoUrl, setVideoUrl] = useState('');
  const [timecodes, setTimecodes] = useState([]);
  const playerRef = useRef(null);

  useEffect(() => {
    // Retrieve the token from localStorage
    const user = JSON.parse(localStorage.getItem('user'));
    const token = user?.token;

    // Set video URL with token as query parameter
    setVideoUrl(`${axios.defaults.baseURL}/videos/stream/${videoId}?token=${encodeURIComponent(token)}`);

    // Fetch timecodes
    axios
      .get(`/videos/${videoId}/timecodes`)
      .then((response) => {
        setTimecodes(response.data);
      })
      .catch((error) => {
        console.error('Error fetching timecodes:', error);
      });
  }, [videoId]);

  const handleTimecodeClick = (timestamp) => {
    if (playerRef.current) {
      playerRef.current.seekTo(timestamp, 'seconds');
    }
  };

  return (
    <Box sx={{ mt: 4 }}>
      <ReactPlayer
        ref={playerRef}
        url={videoUrl}
        controls
        width="100%"
        height="auto"
        config={{
          file: {
            attributes: {
              controlsList: 'nodownload',
            },
          },
        }}
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
