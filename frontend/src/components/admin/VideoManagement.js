import React, { useEffect, useState } from 'react';
import { Table, TableHead, TableRow, TableCell, TableBody, Button, Alert, Typography } from '@mui/material';
import axiosInstance from '../../axiosConfig';

const VideoManagement = () => {
  const [videos, setVideos] = useState([]);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    fetchVideos();
  }, []);

  const fetchVideos = () => {
    axiosInstance.get('/videos')
      .then(response => setVideos(response.data))
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

  return (
    <div>
      <h2>Video Management</h2>
      {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}
      {videos.length === 0 ? (
        <Typography>No videos available.</Typography>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Filename</TableCell>
              <TableCell>Uploader</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {videos.map(video => (
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
      )}
    </div>
  );
};

export default VideoManagement;
