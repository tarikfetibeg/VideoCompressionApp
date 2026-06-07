// src/pages/AdminDashboard.js
import React, { useMemo, useState } from 'react';
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  AppBar,
  Toolbar,
  Typography,
  Divider,
  Chip,
  Stack,
  Paper,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

import UserManagement from '../components/admin/UserManagement';
import VideoManagement from '../components/admin/VideoManagement';
import FfmpegSettings from '../components/admin/FfmpegSettings';
import AuditLogs from '../components/admin/AuditLogs';

const drawerWidth = 280;

const AdminDashboard = () => {
  const [activeSection, setActiveSection] = useState('overview');
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('md'));

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
        id: 'logs',
        label: 'Audit Logs',
        description: 'System activity',
      },
    ],
    []
  );

  const currentSection = menuItems.find((item) => item.id === activeSection);

  const renderOverview = () => (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
        Admin Overview
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Centralno mjesto za upravljanje korisnicima, video materijalima, FFmpeg postavkama,
        raw retention politikom i audit logovima.
      </Typography>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Paper variant="outlined" sx={{ p: 3, flex: 1, borderRadius: 3 }}>
          <Typography variant="overline" color="text.secondary">
            Video workflow
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Upload → Master → Preview → Thumbnail
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Sistem sada odvaja master/compressed fajl od browser-compatible preview fajla i thumbnaila.
          </Typography>
        </Paper>

        <Paper variant="outlined" sx={{ p: 3, flex: 1, borderRadius: 3 }}>
          <Typography variant="overline" color="text.secondary">
            Storage policy
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Raw retention kontrola
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Admin može definisati koliko dana se raw fajlovi čuvaju nakon obrade.
          </Typography>
        </Paper>

        <Paper variant="outlined" sx={{ p: 3, flex: 1, borderRadius: 3 }}>
          <Typography variant="overline" color="text.secondary">
            Maintenance
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Manual cleanup
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Istečeni raw fajlovi mogu se ručno očistiti iz admin panela.
          </Typography>
        </Paper>
      </Stack>
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
            <Box sx={{ flexGrow: 1 }}>
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
            <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 3 }}>
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