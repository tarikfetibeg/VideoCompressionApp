import React from 'react';
import UploadComponent from '../components/UploadComponent';
import VideoList from '../components/VideoList';
import { Container, Typography } from '@mui/material';

const ReporterDashboard = () => {
  return (
    <Container sx={{ mt: 4 }}>
      <Typography variant="h4">Reporter Dashboard</Typography>
      <UploadComponent />
      <VideoList showTimecodeOptions={false} />
    </Container>
  );
};

export default ReporterDashboard;