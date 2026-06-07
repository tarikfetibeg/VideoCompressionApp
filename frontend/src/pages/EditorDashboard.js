import React, { useContext, useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import axiosInstance from '../axiosConfig';
import SearchAndFilterComponent from '../components/editor/SearchAndFilterComponent';
import VideoListComponent from '../components/editor/VideoListComponent';
import VideoUploadComponent from '../components/editor/VideoUploadComponent';
import BulkActionsComponent from '../components/editor/BulkActionsComponent';
import { UserContext } from '../contexts/UserContext';

const EditorDashboard = () => {
  const { user } = useContext(UserContext);
  const [videos, setVideos] = useState([]);
  const [filters, setFilters] = useState({ event: '', location: '', date: '', uploader: '', keywords: '' });
  const [selectedVideos, setSelectedVideos] = useState([]);
  const [reporterOptions, setReporterOptions] = useState([]);

  // Fetch all videos for editors (no filtering by uploader)
  const fetchVideos = () => {
    axiosInstance.get('/videos?all=true', { headers: { Accept: 'application/json' } })
      .then(response => {
        setVideos(response.data);
      })
      .catch(err => {
        console.error('Error fetching videos:', err);
      });
  };

  useEffect(() => {
    fetchVideos();
  }, []);

  useEffect(() => {
    const uniqueReporters = [...new Set(videos.map(v => v.uploader?.username).filter(Boolean))];
    setReporterOptions(uniqueReporters);
  }, [videos]);

  const clearSelection = () => setSelectedVideos([]);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>Editor Dashboard</Typography>
      
      {/* Upload Component for Edited Videos */}
      {user?.role === 'Editor' && <VideoUploadComponent />}
      
      {/* Search and Filter Panel */}
      <SearchAndFilterComponent filters={filters} setFilters={setFilters} reporterOptions={reporterOptions} />
      
      {/* Bulk Actions */}
      <BulkActionsComponent selectedVideos={selectedVideos} clearSelection={clearSelection} refreshVideos={fetchVideos} />
      
      {/* Video List */}
      <VideoListComponent 
        videos={videos.filter(video => {
          const eventMatch = filters.event ? video.event?.toLowerCase().includes(filters.event.toLowerCase()) : true;
          const locationMatch = filters.location ? video.location?.toLowerCase().includes(filters.location.toLowerCase()) : true;
          const dateMatch = filters.date ? new Date(video.uploadDate).toLocaleDateString() === filters.date : true;
          const uploaderMatch = filters.uploader ? video.uploader?.username?.toLowerCase().includes(filters.uploader.toLowerCase()) : true;
          const keywordMatch = filters.keywords ? (video.keywords && video.keywords.join(', ').toLowerCase().includes(filters.keywords.toLowerCase())) : true;
          return eventMatch && locationMatch && dateMatch && uploaderMatch && keywordMatch;
        })}
        selectedVideos={selectedVideos}
        onSelectVideo={(id) => {
          setSelectedVideos(prev => 
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
          );
        }}
        onGroupSelect={(groupVideos) => {
          const groupIds = groupVideos.map(v => v._id);
          const allSelected = groupIds.every(id => selectedVideos.includes(id));
          if (allSelected) {
            setSelectedVideos(selectedVideos.filter(id => !groupIds.includes(id)));
          } else {
            setSelectedVideos([...new Set([...selectedVideos, ...groupIds])]);
          }
        }}
        showTimecodeOptions={false}
      />
    </Box>
  );
};

export default EditorDashboard;
