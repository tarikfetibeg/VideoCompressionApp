import React, { useState, useEffect } from 'react';
import axios from '../axiosConfig';
import { Link } from 'react-router-dom';
import {
  Box,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  Divider,
  Checkbox,
  Button,
  FormControlLabel,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const VideoList = ({ showTimecodeOptions }) => {
  const [videos, setVideos] = useState([]);
  const [selectedVideos, setSelectedVideos] = useState([]);

  useEffect(() => {
    console.log("DEBUG: VideoList mounted, calling fetchVideos()");
    fetchVideos();
  }, []);

  const fetchVideos = () => {
    console.log("DEBUG: Starting fetchVideos()");
    axios
      .get('/videos', { headers: { Accept: 'application/json' } })
      .then((response) => {
        console.log("DEBUG: GET /videos response:", response.data);
        const data = Array.isArray(response.data) ? response.data : [];
        console.log("DEBUG: Number of videos received:", data.length);
        setVideos(data);
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

  // Group videos by event and then by tag date (formatted as a locale date string)
  const groupedVideos = {};
  videos.forEach((video) => {
    const eventKey = video.event || 'No Event';
    const dateKey = video.tagDate ? new Date(video.tagDate).toLocaleDateString() : 'No Date';
    if (!groupedVideos[eventKey]) {
      groupedVideos[eventKey] = {};
    }
    if (!groupedVideos[eventKey][dateKey]) {
      groupedVideos[eventKey][dateKey] = [];
    }
    groupedVideos[eventKey][dateKey].push(video);
  });

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h5">Videos</Typography>
      {selectedVideos.length > 0 && (
        <Button
          variant="contained"
          color="primary"
          sx={{ mb: 2 }}
          onClick={handleDownloadSelected}
        >
          Download Selected ({selectedVideos.length})
        </Button>
      )}
      {videos.length === 0 ? (
        <Typography>No videos available.</Typography>
      ) : (
        // Render grouped videos as Accordions
        Object.keys(groupedVideos).map((eventKey) => (
          <Accordion key={eventKey} defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6">{eventKey}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              {Object.keys(groupedVideos[eventKey]).map((dateKey) => (
                <Accordion key={dateKey} defaultExpanded sx={{ ml: 2 }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="subtitle1">{dateKey}</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <List>
                      {groupedVideos[eventKey][dateKey].map((video) => (
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
                            <ListItemButton component={Link} to={`/video-details/${video._id}`}>
                              <ListItemText
                                primary={video.originalFilename || video.filename}
                                secondary={
                                  <>
                                    {video.location && `Location: ${video.location} | `}
                                    {video.status && `Status: ${video.status}`}
                                  </>
                                }
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
                  </AccordionDetails>
                </Accordion>
              ))}
            </AccordionDetails>
          </Accordion>
        ))
      )}
    </Box>
  );
};

export default VideoList;
