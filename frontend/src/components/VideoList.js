import React, { useState, useEffect, useContext } from 'react';
import axiosInstance from '../axiosConfig';
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { UserContext } from '../contexts/UserContext';

const VideoList = ({ showTimecodeOptions }) => {
  const [videos, setVideos] = useState([]);
  const [selectedVideos, setSelectedVideos] = useState([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { user } = useContext(UserContext);

  useEffect(() => {
    console.log("DEBUG: VideoList mounted, calling fetchVideos()");
    fetchVideos();
  }, []);

  const fetchVideos = () => {
    console.log("DEBUG: Starting fetchVideos()");
    axiosInstance
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
    axiosInstance
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

  // Bulk delete function: use different endpoint for Admin vs. Reporter.
  const handleBulkDelete = (videoIds) => {
    if (user.role === 'Admin') {
      Promise.all(
        videoIds.map(id =>
          axiosInstance.delete(`/admin/videos/${id}`)
        )
      )
        .then(() => {
          setVideos(videos.filter(video => !videoIds.includes(video._id)));
          setSelectedVideos(selectedVideos.filter(id => !videoIds.includes(id)));
        })
        .catch(err => {
          console.error('Error deleting videos:', err);
        });
    } else {
      Promise.all(
        videoIds.map(id =>
          axiosInstance.delete(`/videos/${id}`)
        )
      )
        .then(() => {
          setVideos(videos.filter(video => !videoIds.includes(video._id)));
          setSelectedVideos(selectedVideos.filter(id => !videoIds.includes(id)));
        })
        .catch(err => {
          console.error('Error deleting videos:', err);
        });
    }
  };

  // Helper for group selection
  const handleGroupSelect = (groupVideos) => {
    const groupIds = groupVideos.map(video => video._id);
    const allSelected = groupIds.every(id => selectedVideos.includes(id));
    if (allSelected) {
      setSelectedVideos(prev => prev.filter(id => !groupIds.includes(id)));
    } else {
      setSelectedVideos(prev => Array.from(new Set([...prev, ...groupIds])));
    }
  };

  // Group videos conditionally:
  // For Admin: group by uploader, then event -> location -> date.
  // For Reporter: group by event -> location -> date.
  let groupedVideos = {};
  if (user.role === 'Admin') {
    videos.forEach(video => {
      const uploaderKey = video.uploader?.username || 'Unknown Uploader';
      const eventKey = video.event || 'No Event';
      const locationKey = video.location || 'No Location';
      const dateKey = video.tagDate ? new Date(video.tagDate).toLocaleDateString() : 'No Date';
      if (!groupedVideos[uploaderKey]) groupedVideos[uploaderKey] = {};
      if (!groupedVideos[uploaderKey][eventKey]) groupedVideos[uploaderKey][eventKey] = {};
      if (!groupedVideos[uploaderKey][eventKey][locationKey]) groupedVideos[uploaderKey][eventKey][locationKey] = {};
      if (!groupedVideos[uploaderKey][eventKey][locationKey][dateKey]) groupedVideos[uploaderKey][eventKey][locationKey][dateKey] = [];
      groupedVideos[uploaderKey][eventKey][locationKey][dateKey].push(video);
    });
  } else {
    videos.forEach(video => {
      const eventKey = video.event || 'No Event';
      const locationKey = video.location || 'No Location';
      const dateKey = video.tagDate ? new Date(video.tagDate).toLocaleDateString() : 'No Date';
      if (!groupedVideos[eventKey]) groupedVideos[eventKey] = {};
      if (!groupedVideos[eventKey][locationKey]) groupedVideos[eventKey][locationKey] = {};
      if (!groupedVideos[eventKey][locationKey][dateKey]) groupedVideos[eventKey][locationKey][dateKey] = [];
      groupedVideos[eventKey][locationKey][dateKey].push(video);
    });
  }

  // Render grouped view
  const renderGroupedView = () => {
    if (user.role === 'Admin') {
      // Admin view: group by uploader first
      return Object.keys(groupedVideos).map(uploaderKey => (
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
                              <List>
                                {groupedVideos[uploaderKey][eventKey][locationKey][dateKey].map((video) => (
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
                                          secondary={video.status && `Status: ${video.status}`}
                                        />
                                      </ListItemButton>
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
                  ))}
                </AccordionDetails>
              </Accordion>
            ))}
          </AccordionDetails>
        </Accordion>
      ));
    } else {
      // Reporter view: group by event -> location -> date.
      return Object.keys(groupedVideos).map((eventKey) => (
        <Accordion key={eventKey} defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <FormControlLabel
              control={
                <Checkbox
                  onClick={(e) => {
                    e.stopPropagation();
                    const groupVideos = Object.values(groupedVideos[eventKey])
                      .flatMap(locationGroup => Object.values(locationGroup))
                      .flat();
                    handleGroupSelect(groupVideos);
                  }}
                  checked={Object.values(groupedVideos[eventKey])
                    .flatMap(locationGroup => Object.values(locationGroup))
                    .flat().every(video => selectedVideos.includes(video._id))}
                />
              }
              label={<Typography variant="h6">{eventKey}</Typography>}
            />
          </AccordionSummary>
          <AccordionDetails>
            {Object.keys(groupedVideos[eventKey]).map((locationKey) => (
              <Accordion key={locationKey} defaultExpanded sx={{ ml: 2 }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle1">{locationKey}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  {Object.keys(groupedVideos[eventKey][locationKey]).map((dateKey) => (
                    <Accordion key={dateKey} defaultExpanded sx={{ ml: 4 }}>
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography variant="subtitle2">{dateKey}</Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <List>
                          {groupedVideos[eventKey][locationKey][dateKey].map((video) => (
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
                                    secondary={video.status && `Status: ${video.status}`}
                                  />
                                </ListItemButton>
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
            ))}
          </AccordionDetails>
        </Accordion>
      ));
    }
  };

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h5">Videos</Typography>
      {selectedVideos.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Button variant="contained" color="primary" onClick={handleDownloadSelected}>
            Download Selected ({selectedVideos.length})
          </Button>
          <Button
            variant="contained"
            color="primary"
            sx={{ ml: 2 }}
            onClick={() => setConfirmOpen(true)}
          >
            Delete Selected ({selectedVideos.length})
          </Button>
        </Box>
      )}
      {videos.length === 0 ? (
        <Typography>No videos available.</Typography>
      ) : (
        renderGroupedView()
      )}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
      >
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the following videos?
          </DialogContentText>
          <ul>
            {videos
              .filter(video => selectedVideos.includes(video._id))
              .map(video => (
                <li key={video._id}>{video.originalFilename || video.filename}</li>
              ))}
          </ul>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button onClick={() => {
            handleBulkDelete(selectedVideos);
            setConfirmOpen(false);
          }} color="error">
            Confirm Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VideoList;
