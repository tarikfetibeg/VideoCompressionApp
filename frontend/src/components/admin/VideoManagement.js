import React, { useEffect, useState } from 'react';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Box,
  Checkbox,
  Divider,
  FormControlLabel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  Button,
  Alert
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import axiosInstance from '../../axiosConfig';

const VideoManagement = () => {
  const [videos, setVideos] = useState([]);
  const [selectedVideos, setSelectedVideos] = useState([]);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    fetchVideos();
  }, []);

  const fetchVideos = () => {
    axiosInstance.get('/videos', { headers: { Accept: 'application/json' } })
      .then(response => {
        setVideos(Array.isArray(response.data) ? response.data : []);
      })
      .catch(err => {
        console.error('Error fetching videos:', err);
        setErrorMessage('Error fetching videos.');
      });
  };

  const handleDelete = (videoId) => {
    axiosInstance.delete(`/admin/videos/${videoId}`)
      .then(() => {
        setVideos(videos.filter(video => video._id !== videoId));
        setMessage('Video deleted successfully.');
        setErrorMessage('');
      })
      .catch(err => {
        console.error('Error deleting video:', err);
        setErrorMessage('Error deleting video.');
      });
  };

  const handleBulkDelete = (videoIds) => {
    Promise.all(videoIds.map(id => axiosInstance.delete(`/admin/videos/${id}`)))
      .then(() => {
        setVideos(videos.filter(video => !videoIds.includes(video._id)));
        setSelectedVideos(selectedVideos.filter(id => !videoIds.includes(id)));
        setMessage('Selected videos deleted successfully.');
        setErrorMessage('');
      })
      .catch(err => {
        console.error('Error deleting videos:', err);
        setErrorMessage('Error deleting videos.');
      });
  };

  // Toggle selection for an individual video
  const handleSelectVideo = (videoId) => {
    setSelectedVideos(prev =>
      prev.includes(videoId) ? prev.filter(id => id !== videoId) : [...prev, videoId]
    );
  };

  // Toggle selection for a group of videos
  const handleGroupSelect = (groupVideos) => {
    const groupIds = groupVideos.map(video => video._id);
    const allSelected = groupIds.every(id => selectedVideos.includes(id));
    if (allSelected) {
      setSelectedVideos(prev => prev.filter(id => !groupIds.includes(id)));
    } else {
      setSelectedVideos(prev => Array.from(new Set([...prev, ...groupIds])));
    }
  };

  // Group videos by uploader, then event, then location, then date
  const groupedVideos = {};
  videos.forEach(video => {
    const uploaderKey = video.uploader?.username || 'Unknown Uploader';
    const eventKey = video.event || 'No Event';
    const locationKey = video.location || 'No Location';
    const dateKey = video.tagDate ? new Date(video.tagDate).toLocaleDateString() : 'No Date';

    if (!groupedVideos[uploaderKey]) {
      groupedVideos[uploaderKey] = {};
    }
    if (!groupedVideos[uploaderKey][eventKey]) {
      groupedVideos[uploaderKey][eventKey] = {};
    }
    if (!groupedVideos[uploaderKey][eventKey][locationKey]) {
      groupedVideos[uploaderKey][eventKey][locationKey] = {};
    }
    if (!groupedVideos[uploaderKey][eventKey][locationKey][dateKey]) {
      groupedVideos[uploaderKey][eventKey][locationKey][dateKey] = [];
    }
    groupedVideos[uploaderKey][eventKey][locationKey][dateKey].push(video);
  });

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h4">Video Management</Typography>
      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}
      
      {videos.length === 0 ? (
        <Typography>No videos available.</Typography>
      ) : (
        // Outer Accordion: Group by uploader
        Object.keys(groupedVideos).map(uploaderKey => (
          <Accordion key={uploaderKey} defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <FormControlLabel
                control={
                  <Checkbox
                    onClick={(e) => {
                      e.stopPropagation();
                      const groupVideos = Object.values(groupedVideos[uploaderKey])
                        .flatMap(eventGroup => Object.values(eventGroup))
                        .flatMap(locationGroup => Object.values(locationGroup))
                        .flat();
                      handleGroupSelect(groupVideos);
                    }}
                    checked={Object.values(groupedVideos[uploaderKey])
                      .flatMap(eventGroup => Object.values(eventGroup))
                      .flatMap(locationGroup => Object.values(locationGroup))
                      .flat().every(video => selectedVideos.includes(video._id))}
                  />
                }
                label={<Typography variant="h6">{uploaderKey}</Typography>}
              />
            </AccordionSummary>
            <AccordionDetails>
              {/* Nested Accordion: Group by event */}
              {Object.keys(groupedVideos[uploaderKey]).map(eventKey => (
                <Accordion key={eventKey} defaultExpanded sx={{ ml: 2 }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          onClick={(e) => {
                            e.stopPropagation();
                            const groupVideos = Object.values(groupedVideos[uploaderKey][eventKey])
                              .flatMap(locationGroup => Object.values(locationGroup))
                              .flat();
                            handleGroupSelect(groupVideos);
                          }}
                          checked={Object.values(groupedVideos[uploaderKey][eventKey])
                            .flatMap(locationGroup => Object.values(locationGroup))
                            .flat().every(video => selectedVideos.includes(video._id))}
                        />
                      }
                      label={<Typography variant="subtitle1">{eventKey}</Typography>}
                    />
                  </AccordionSummary>
                  <AccordionDetails>
                    {/* Nested Accordion: Group by location */}
                    {Object.keys(groupedVideos[uploaderKey][eventKey]).map(locationKey => (
                      <Accordion key={locationKey} defaultExpanded sx={{ ml: 4 }}>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                          <FormControlLabel
                            control={
                              <Checkbox
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const groupVideos = Object.values(groupedVideos[uploaderKey][eventKey][locationKey]).flat();
                                  handleGroupSelect(groupVideos);
                                }}
                                checked={Object.values(groupedVideos[uploaderKey][eventKey][locationKey])
                                  .flat().every(video => selectedVideos.includes(video._id))}
                              />
                            }
                            label={<Typography variant="subtitle2">{locationKey}</Typography>}
                          />
                        </AccordionSummary>
                        <AccordionDetails>
                          {/* Nested Accordion: Group by date */}
                          {Object.keys(groupedVideos[uploaderKey][eventKey][locationKey]).map(dateKey => (
                            <Accordion key={dateKey} defaultExpanded sx={{ ml: 6 }}>
                              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <FormControlLabel
                                  control={
                                    <Checkbox
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleGroupSelect(groupedVideos[uploaderKey][eventKey][locationKey][dateKey]);
                                      }}
                                      checked={groupedVideos[uploaderKey][eventKey][locationKey][dateKey].every(video => selectedVideos.includes(video._id))}
                                    />
                                  }
                                  label={<Typography variant="subtitle2">{dateKey}</Typography>}
                                />
                              </AccordionSummary>
                              <AccordionDetails>
                                <Table>
                                  <TableHead>
                                    <TableRow>
                                      <TableCell>Filename</TableCell>
                                      <TableCell>Uploader</TableCell>
                                      <TableCell>Actions</TableCell>
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                    {groupedVideos[uploaderKey][eventKey][locationKey][dateKey].map(video => (
                                      <TableRow key={video._id}>
                                        <TableCell>{video.originalFilename || video.filename}</TableCell>
                                        <TableCell>{video.uploader.username}</TableCell>
                                        <TableCell>
                                          <Button variant="outlined" color="error" onClick={() => handleDelete(video._id)}>
                                            Delete
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </AccordionDetails>
                            </Accordion>
                          ))}
                        </AccordionDetails>
                      </Accordion>
                    ))}
                  </AccordionDetails>
                </Accordion>
              ))}
            </AccordionDetails>
          </Accordion>
        ))
      )}
      {selectedVideos.length > 0 && (
        <Button
          variant="contained"
          color="primary"
          sx={{ mt: 2 }}
          onClick={() => handleBulkDelete(selectedVideos)}
        >
          Delete Selected ({selectedVideos.length})
        </Button>
      )}
    </Box>
  );
};

export default VideoManagement;
