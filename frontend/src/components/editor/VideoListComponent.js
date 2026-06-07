import React from 'react';
import { Box, Typography, Accordion, AccordionSummary, AccordionDetails, List, ListItem, ListItemText, ListItemButton, Divider, Checkbox, FormControlLabel } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Link } from 'react-router-dom';

const VideoListComponent = ({ videos, selectedVideos, onSelectVideo, onGroupSelect, showTimecodeOptions }) => {
  // Group videos by event → location → date
  const groupVideos = (videoArray) => {
    const grouped = {};
    videoArray.forEach(video => {
      const eventKey = video.event || 'No Event';
      const locationKey = video.location || 'No Location';
      const dateKey = video.tagDate ? new Date(video.tagDate).toLocaleDateString() : 'No Date';
      if (!grouped[eventKey]) grouped[eventKey] = {};
      if (!grouped[eventKey][locationKey]) grouped[eventKey][locationKey] = {};
      if (!grouped[eventKey][locationKey][dateKey]) grouped[eventKey][locationKey][dateKey] = [];
      grouped[eventKey][locationKey][dateKey].push(video);
    });
    return grouped;
  };

  const renderGroupedVideos = (grouped) => {
    return Object.keys(grouped).map(eventKey => (
      <Accordion key={eventKey} defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <FormControlLabel
            control={
              <Checkbox
                onClick={(e) => { e.stopPropagation(); onGroupSelect(Object.values(grouped[eventKey]).flat(2)); }}
                checked={Object.values(grouped[eventKey]).flat(2).every(video => selectedVideos.includes(video._id))}
              />
            }
            label={<Typography variant="h6">{eventKey}</Typography>}
          />
        </AccordionSummary>
        <AccordionDetails>
          {Object.keys(grouped[eventKey]).map(locationKey => (
            <Accordion key={locationKey} defaultExpanded sx={{ ml: 2 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <FormControlLabel
                  control={
                    <Checkbox
                      onClick={(e) => { e.stopPropagation(); onGroupSelect(Object.values(grouped[eventKey][locationKey]).flat()); }}
                      checked={Object.values(grouped[eventKey][locationKey]).flat().every(video => selectedVideos.includes(video._id))}
                    />
                  }
                  label={<Typography variant="subtitle1">{locationKey}</Typography>}
                />
              </AccordionSummary>
              <AccordionDetails>
                {Object.keys(grouped[eventKey][locationKey]).map(dateKey => (
                  <Accordion key={dateKey} defaultExpanded sx={{ ml: 4 }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            onClick={(e) => { e.stopPropagation(); onGroupSelect(grouped[eventKey][locationKey][dateKey]); }}
                            checked={grouped[eventKey][locationKey][dateKey].every(video => selectedVideos.includes(video._id))}
                          />
                        }
                        label={<Typography variant="subtitle2">{dateKey}</Typography>}
                      />
                    </AccordionSummary>
                    <AccordionDetails>
                      <List>
                        {grouped[eventKey][locationKey][dateKey].map(video => (
                          <React.Fragment key={video._id}>
                            <ListItem disablePadding>
                              <FormControlLabel
                                control={
                                  <Checkbox
                                    checked={selectedVideos.includes(video._id)}
                                    onChange={() => onSelectVideo(video._id)}
                                  />
                                }
                                label=""
                              />
                              <ListItemButton component={Link} to={`/video-details/${video._id}`}>
                                <ListItemText
                                  primary={video.originalFilename || video.filename}
                                  secondary={`Location: ${video.location || 'N/A'} | Status: ${video.status}${video.isBroll ? ' | B-roll' : ''}`}
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
  };

  // Categorize videos:
  const rawVideos = videos.filter(video => video.status === 'raw' && !video.isBroll);
  const editedVideos = videos.filter(video => video.status === 'edited' && !video.isBroll);
  const brollVideos = videos.filter(video => video.isBroll);

  const groupedRaw = groupVideos(rawVideos);
  const groupedEdited = groupVideos(editedVideos);
  const groupedBroll = groupVideos(brollVideos);

  return (
    <Box>
      {groupedRaw && (
        <Box sx={{ my: 2 }}>
          <Typography variant="h5">Raw Videos</Typography>
          {renderGroupedVideos(groupedRaw)}
        </Box>
      )}
      {groupedEdited && (
        <Box sx={{ my: 2 }}>
          <Typography variant="h5">Edited Videos</Typography>
          {renderGroupedVideos(groupedEdited)}
        </Box>
      )}
      {groupedBroll && (
        <Box sx={{ my: 2 }}>
          <Typography variant="h5">B-roll Videos</Typography>
          {renderGroupedVideos(groupedBroll)}
        </Box>
      )}
    </Box>
  );
};

export default VideoListComponent;
