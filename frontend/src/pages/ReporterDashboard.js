import React, { useState } from 'react';
import UploadComponent from '../components/UploadComponent';
import VideoList from '../components/VideoList';
import EditJobBoard from '../components/jobs/EditJobBoard';
import ReporterEventWorkspace from '../components/jobs/ReporterEventWorkspace';
import { Box, Container, Grid, Paper, Tab, Tabs, Typography } from '@mui/material';

const ReporterDashboard = () => {
  const [activeTab, setActiveTab] = useState('prep');
  const [archiveScope, setArchiveScope] = useState('mine');
  const [refreshToken, setRefreshToken] = useState(0);

  const handleRefreshNeeded = () => {
    setRefreshToken((current) => current + 1);
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 3, mb: 4 }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          Reporter Desk
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Daily ingest, event grouping, and edit job preparation.
        </Typography>
      </Box>

      <Tabs
        value={activeTab}
        onChange={(event, value) => setActiveTab(value)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="Prep" value="prep" />
        <Tab label="Jobs" value="jobs" />
        <Tab label="Archive" value="archive" />
      </Tabs>

      {activeTab === 'prep' && (
        <Grid container spacing={2} alignItems="flex-start">
          <Grid item xs={12} lg={4}>
            <UploadComponent onUploadComplete={handleRefreshNeeded} />
          </Grid>
          <Grid item xs={12} lg={8}>
            <ReporterEventWorkspace
              refreshToken={refreshToken}
              onJobCreated={handleRefreshNeeded}
            />
          </Grid>
        </Grid>
      )}

      {activeTab === 'jobs' && <EditJobBoard refreshToken={refreshToken} />}

      {activeTab === 'archive' && (
        <Box>
          <Paper variant="outlined" sx={{ mb: 2, borderRadius: 2 }}>
            <Tabs
              value={archiveScope}
              onChange={(event, value) => setArchiveScope(value)}
              variant="scrollable"
              scrollButtons="auto"
            >
              <Tab label="My Archive" value="mine" />
              <Tab label="TV Archive" value="station" />
            </Tabs>
          </Paper>

          {archiveScope === 'mine' ? (
            <VideoList
              key="my-archive"
              library="archive"
              title="My Archive"
              description="Tvoji montirani ili finalizovani video klipovi sa dostupnim akcijama."
            />
          ) : (
            <VideoList
              key="tv-archive"
              scope="station"
              library="archive"
              readOnly
              title="TV Archive"
              description="Pregled TV arhive montiranih/finalizovanih klipova bez manipulacije nad tudjim materijalom."
            />
          )}
        </Box>
      )}
    </Container>
  );
};

export default ReporterDashboard;
