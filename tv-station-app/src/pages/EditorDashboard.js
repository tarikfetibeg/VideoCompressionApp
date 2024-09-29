import React from 'react';
import VideoList from '../components/VideoList';
import { Container, Typography } from '@mui/material';

const EditorDashboard = () => {
  return (
    <Container sx={{ mt: 4 }}>
      <Typography variant="h4">Editor Dashboard</Typography>
      <VideoList showTimecodeOptions={true} />
    </Container>
  );
};

export default EditorDashboard;