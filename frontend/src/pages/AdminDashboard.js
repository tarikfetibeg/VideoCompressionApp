// src/pages/AdminDashboard.js
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  Grid,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTheme } from '@mui/material/styles';

import axiosInstance from '../axiosConfig';
import UserManagement from '../components/admin/UserManagement';
import VideoManagement from '../components/admin/VideoManagement';
import FfmpegSettings from '../components/admin/FfmpegSettings';
import AuditLogs from '../components/admin/AuditLogs';
import BroadcastProgramManagement from '../components/admin/BroadcastProgramManagement';
import FeedbackInbox from '../components/admin/FeedbackInbox';
import StorageMaintenance from '../components/admin/StorageMaintenance';

const drawerWidth = 280;

const AdminDashboard = () => {
  const [activeSection, setActiveSection] = useState('overview');
  const [overviewMetrics, setOverviewMetrics] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('md'));

  const fetchOverviewMetrics = useCallback(() => {
    setOverviewLoading(true);
    setOverviewError('');

    axiosInstance
      .get('/admin/overview-metrics')
      .then((response) => setOverviewMetrics(response.data || {}))
      .catch((error) => {
        console.error('Error loading admin overview metrics:', error);
        setOverviewError('Nije moguce ucitati admin metrike.');
      })
      .finally(() => setOverviewLoading(false));
  }, []);

  useEffect(() => {
    fetchOverviewMetrics();
  }, [fetchOverviewMetrics]);

  const menuItems = useMemo(
    () => [
      {
        id: 'overview',
        label: 'Overview',
        description: 'System summary',
      },
      {
        id: 'users',
        label: 'User Management',
        description: 'Roles and accounts',
      },
      {
        id: 'videos',
        label: 'Video Management',
        description: 'Browse, download, delete',
      },
      {
        id: 'ffmpeg',
        label: 'FFmpeg & Storage',
        description: 'Codec, bitrate, raw retention',
      },
      {
        id: 'maintenance',
        label: 'Maintenance',
        description: 'OFF and raw manifests',
      },
      {
        id: 'broadcast',
        label: 'Programs',
        description: 'Shows and content types',
      },
      {
        id: 'feedback',
        label: 'Feedback Inbox',
        description: 'Bug reports and suggestions',
      },
      {
        id: 'logs',
        label: 'Audit Logs',
        description: 'System activity',
      },
    ],
    []
  );

  const currentSection = menuItems.find((item) => item.id === activeSection);

  const metricCards = [
    {
      label: 'Failed processing',
      value: overviewMetrics?.failedProcessing ?? 0,
      note: 'Klipovi koji trebaju intervenciju ili retry.',
      color: Number(overviewMetrics?.failedProcessing || 0) > 0 ? 'error.main' : 'success.main',
    },
    {
      label: 'Open feedback',
      value: overviewMetrics?.pendingFeedback ?? 0,
      note: 'Nove i aktivne prijave korisnika.',
      color: Number(overviewMetrics?.pendingFeedback || 0) > 0 ? 'warning.main' : 'success.main',
    },
    {
      label: 'Critical logs',
      value: overviewMetrics?.criticalLogs ?? 0,
      note: 'Brisanja, cleanup akcije i osjetljive promjene.',
      color: Number(overviewMetrics?.criticalLogs || 0) > 0 ? 'warning.main' : 'text.primary',
    },
    {
      label: 'Raw orphans',
      value: overviewMetrics?.rawOrphans ?? 0,
      note: 'Raw fajlovi na disku bez jasnog DB zapisa.',
      color: Number(overviewMetrics?.rawOrphans || 0) > 0 ? 'warning.main' : 'success.main',
    },
    {
      label: 'Raw manifest orphans',
      value: overviewMetrics?.rawManifestOrphans ?? 0,
      note: 'Manifesti za ciscenje iz maintenance taba.',
      color: Number(overviewMetrics?.rawManifestOrphans || 0) > 0 ? 'warning.main' : 'success.main',
    },
    {
      label: 'Active users',
      value: overviewMetrics?.activeUsers ?? 0,
      note: 'Registrovani korisnici sistema.',
      color: 'text.primary',
    },
    {
      label: 'Jobs with updates',
      value: overviewMetrics?.jobsWithUpdates ?? 0,
      note: 'Jobovi koji imaju change log izmjena.',
      color: 'text.primary',
    },
    {
      label: 'Shows after download',
      value: overviewMetrics?.showsChangedAfterDownload ?? 0,
      note: 'Emisije sa download state pracenjem.',
      color: 'text.primary',
    },
  ];

  const renderOverview = () => (
    <Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800, mb: 1 }}>
            Admin Overview
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Operativni pregled korisnika, processing gresaka, feedbacka, logova i storage stanja.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={fetchOverviewMetrics}
          disabled={overviewLoading}
        >
          Refresh
        </Button>
      </Stack>

      {overviewError && <Alert severity="error" sx={{ mb: 2 }}>{overviewError}</Alert>}

      <Grid container spacing={2}>
        {metricCards.map((card) => (
          <Grid item xs={12} sm={6} lg={3} key={card.label}>
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, height: '100%' }}>
              <Typography variant="overline" color="text.secondary">
                {card.label}
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 900, color: card.color }}>
                {overviewLoading && overviewMetrics === null ? '...' : card.value}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {card.note}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Paper variant="outlined" sx={{ p: 3, mt: 3, borderRadius: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>
          Brzi admin tok rada
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Kreni od failed processing i open feedback metrika, zatim koristi Maintenance za OFF/raw
          servisne fajlove i Audit Logs za provjeru ko je izvrsio osjetljive promjene.
        </Typography>
      </Paper>
    </Box>
  );

  const renderSection = () => {
    switch (activeSection) {
      case 'overview':
        return renderOverview();
      case 'users':
        return <UserManagement />;
      case 'videos':
        return <VideoManagement />;
      case 'ffmpeg':
        return <FfmpegSettings />;
      case 'maintenance':
        return <StorageMaintenance />;
      case 'broadcast':
        return <BroadcastProgramManagement />;
      case 'feedback':
        return <FeedbackInbox />;
      case 'logs':
        return <AuditLogs />;
      default:
        return renderOverview();
    }
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Drawer
        variant={isSmallScreen ? 'temporary' : 'permanent'}
        open={!isSmallScreen}
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          display: { xs: 'none', md: 'block' },
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            borderRight: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
          },
        }}
      >
        <Toolbar>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              AVC Admin
            </Typography>
            <Typography variant="caption" color="text.secondary">
              System control panel
            </Typography>
          </Box>
        </Toolbar>

        <Divider />

        <Box sx={{ p: 2 }}>
          <Chip
            label="Admin mode"
            color="primary"
            size="small"
            sx={{ mb: 2, fontWeight: 600 }}
          />

          <List disablePadding>
            {menuItems.map((item) => (
              <ListItemButton
                key={item.id}
                selected={activeSection === item.id}
                onClick={() => setActiveSection(item.id)}
                sx={{
                  borderRadius: 2,
                  mb: 0.75,
                  alignItems: 'flex-start',
                  '&.Mui-selected': {
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    '& .MuiListItemText-secondary': {
                      color: 'primary.contrastText',
                      opacity: 0.85,
                    },
                  },
                }}
              >
                <ListItemText
                  primary={item.label}
                  secondary={item.description}
                  primaryTypographyProps={{ fontWeight: 700 }}
                  secondaryTypographyProps={{ fontSize: 12 }}
                />
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
        <AppBar
          position="sticky"
          color="default"
          elevation={0}
          sx={{
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Toolbar>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h6" noWrap sx={{ fontWeight: 800 }}>
                {currentSection?.label || 'Admin Dashboard'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {currentSection?.description || 'System management'}
              </Typography>
            </Box>
          </Toolbar>
        </AppBar>

        <Box sx={{ p: { xs: 2, md: 4 } }}>
          {isSmallScreen && (
            <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
                Sections
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {menuItems.map((item) => (
                  <Chip
                    key={item.id}
                    label={item.label}
                    clickable
                    color={activeSection === item.id ? 'primary' : 'default'}
                    onClick={() => setActiveSection(item.id)}
                  />
                ))}
              </Stack>
            </Paper>
          )}

          {renderSection()}
        </Box>
      </Box>
    </Box>
  );
};

export default AdminDashboard;
