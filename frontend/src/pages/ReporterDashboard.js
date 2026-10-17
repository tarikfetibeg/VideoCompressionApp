import React, { lazy, Suspense, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Container,
  Grid,
  LinearProgress,
  Paper,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ReporterActiveJobs from '../components/jobs/ReporterActiveJobs';
import { WorkspaceHeader } from '../components/common/WorkspaceChrome';

const UploadComponent = lazy(() => import('../components/UploadComponent'));
const VideoList = lazy(() => import('../components/VideoList'));
const ReporterEventWorkspace = lazy(() => import('../components/jobs/ReporterEventWorkspace'));

const ReporterDashboard = () => {
  const [activeTab, setActiveTab] = useState('workspace');
  const [archiveScope, setArchiveScope] = useState('mine');
  const [refreshToken, setRefreshToken] = useState(0);
  const [newStoryOpen, setNewStoryOpen] = useState(false);
  const [newStoryVisited, setNewStoryVisited] = useState(false);
  const [jobCountInitialized, setJobCountInitialized] = useState(false);

  const handleRefreshNeeded = () => {
    setRefreshToken((current) => current + 1);
  };

  const handleJobCountChange = (count) => {
    if (!jobCountInitialized) {
      if (!newStoryVisited) {
        setNewStoryOpen(count === 0);
        if (count === 0) setNewStoryVisited(true);
      }
      setJobCountInitialized(true);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 3, mb: 4 }}>
      <WorkspaceHeader
        eyebrow="Dnevni rad"
        title="Reporter radni prostor"
        subtitle="Aktivni jobovi, dopune materijala i priprema novog priloga na jednom mjestu."
        chips={[
          { label: 'Aktivni jobovi prvo', color: activeTab === 'workspace' ? 'primary' : 'default' },
          { label: 'Direktna dopuna klipova', variant: 'outlined' },
          { label: 'TV arhiva', variant: 'outlined' },
        ]}
      />

      <Tabs
        value={activeTab}
        onChange={(event, value) => setActiveTab(value)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="Radni prostor" value="workspace" />
        <Tab label="Arhiva" value="archive" />
      </Tabs>

      {activeTab === 'workspace' && (
        <Box>
          <ReporterActiveJobs
            refreshToken={refreshToken}
            onCountChange={handleJobCountChange}
            onJobUpdated={handleRefreshNeeded}
          />

          <Accordion
            expanded={newStoryOpen}
            onChange={(event, expanded) => {
              setNewStoryOpen(expanded);
              if (expanded) setNewStoryVisited(true);
            }}
            slots={{ heading: 'h2' }}
            disableGutters
            sx={{
              mt: 2,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              boxShadow: 'none',
              '&:before': { display: 'none' },
            }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box>
                <Typography variant="h6" component="span" sx={{ fontWeight: 900 }}>
                  Novi prilog
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Uploaduj sirovinu, odaberi event i pošalji novi job montaži.
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              {(newStoryOpen || newStoryVisited) && (
              <Suspense fallback={<LinearProgress aria-label="Učitavanje pripreme priloga" />}>
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
              </Suspense>
              )}
            </AccordionDetails>
          </Accordion>
        </Box>
      )}

      {activeTab === 'archive' && (
        <Box>
          <Paper variant="outlined" sx={{ mb: 2, borderRadius: 1 }}>
            <Tabs
              value={archiveScope}
              onChange={(event, value) => setArchiveScope(value)}
              variant="scrollable"
              scrollButtons="auto"
            >
              <Tab label="Moja arhiva" value="mine" />
              <Tab label="TV arhiva" value="station" />
            </Tabs>
          </Paper>

          <Suspense fallback={<LinearProgress aria-label="Učitavanje arhive" />}>
          {archiveScope === 'mine' ? (
            <VideoList
              key="my-archive"
              library="archive"
              title="Moja arhiva"
              description="Tvoji montirani ili finalizovani video klipovi sa dostupnim akcijama."
            />
          ) : (
            <VideoList
              key="tv-archive"
              scope="station"
              library="archive"
              readOnly
              title="TV arhiva"
              description="Pregled odobrenih i finalizovanih klipova TV kuće."
            />
          )}
          </Suspense>
        </Box>
      )}
    </Container>
  );
};

export default ReporterDashboard;
