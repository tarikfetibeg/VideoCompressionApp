import React, { useContext, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  AppBar,
  Badge,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import FeedbackOutlinedIcon from '@mui/icons-material/FeedbackOutlined';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import NewspaperIcon from '@mui/icons-material/Newspaper';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import TvIcon from '@mui/icons-material/Tv';
import VideoSettingsIcon from '@mui/icons-material/VideoSettings';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import { UserContext } from '../../contexts/UserContext';
import { useBackgroundUploads } from '../../contexts/BackgroundUploadContext';
import { useBackgroundDownloads } from '../../contexts/BackgroundDownloadContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { useRealtime } from '../../contexts/RealtimeContext';
import { formatProgressPercent, formatTransferRate } from '../../utils/downloadProgress';
import { formatRole } from '../../utils/uiLabels';

const drawerWidth = 268;

const navItems = [
  {
    label: 'Moj rad',
    description: 'Prioriteti i sljedeće akcije',
    to: '/my-work',
    icon: <HomeWorkIcon />,
    roles: ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin'],
  },
  {
    label: 'Reporter',
    description: 'Ingest i priprema priloga',
    to: '/reporter-dashboard',
    icon: <NewspaperIcon />,
    roles: ['Reporter', 'Admin'],
  },
  {
    label: 'Produkcija',
    description: 'Jobovi, QC i finali',
    to: '/editor-dashboard',
    icon: <AssignmentTurnedInIcon />,
    roles: ['Editor', 'VideoEditor', 'Admin'],
  },
  {
    label: 'Producent',
    description: 'Emisija i rundown',
    to: '/producer-dashboard',
    icon: <VideoSettingsIcon />,
    roles: ['Producer', 'Admin'],
  },
  {
    label: 'Realizator',
    description: 'Air paket i kontrola',
    to: '/realizator-dashboard',
    icon: <TvIcon />,
    roles: ['Realizator', 'Admin'],
  },
  {
    label: 'Arhiva',
    description: 'Pregled i metadata',
    to: '/archivist-dashboard',
    icon: <Inventory2Icon />,
    roles: ['Archivist', 'Admin'],
  },
  {
    label: 'Admin',
    description: 'Sistem i održavanje',
    to: '/admin-dashboard',
    icon: <AdminPanelSettingsIcon />,
    roles: ['Admin'],
  },
  {
    label: 'Feedback',
    description: 'Prijave i sugestije',
    to: '/feedback',
    icon: <FeedbackOutlinedIcon />,
    roles: ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin'],
  },
];

const matchesPath = (pathname, target) =>
  pathname === target || pathname.startsWith(`${target}/`);

const DrawerContent = ({ visibleItems, pathname, onNavigate }) => (
  <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <Toolbar sx={{ alignItems: 'center' }}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1 }}>
          VideoCompressionApp
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Produkcijski centar
        </Typography>
      </Box>
    </Toolbar>
    <Divider />
    <Box sx={{ p: 1.25, flex: 1, overflowY: 'auto' }}>
      <List disablePadding>
        {visibleItems.map((item) => {
          const selected = matchesPath(pathname, item.to);
          return (
            <ListItemButton
              key={item.to}
              component={Link}
              to={item.to}
              selected={selected}
              onClick={onNavigate}
              sx={{
                borderRadius: 1.5,
                mb: 0.5,
                alignItems: 'flex-start',
                '&.Mui-selected': {
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  '& .MuiListItemIcon-root, & .MuiListItemText-secondary': {
                    color: 'primary.contrastText',
                  },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 38, color: selected ? 'primary.contrastText' : 'text.secondary' }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                secondary={item.description}
                primaryTypographyProps={{ fontWeight: 800 }}
                secondaryTypographyProps={{ fontSize: 12 }}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  </Box>
);

const GlobalStatusBar = () => {
  const { activeUploads, failedUploads, completedUploads, hasBlockingUploads } = useBackgroundUploads();
  const {
    activeDownloads,
    failedDownloads,
    completedDownloads,
    hasBlockingDownloads,
    downloadSummary,
    openDownloadPanel,
  } = useBackgroundDownloads();
  const { status: realtimeStatus } = useRealtime();
  const hasActiveTransfers = hasBlockingUploads || activeDownloads.length > 0;

  return (
    <Box
      sx={{
        px: { xs: 1.5, md: 3 },
        py: 0.75,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
        <Chip
          label={hasBlockingUploads ? 'Upload u toku' : 'Upload miruje'}
          color={hasBlockingUploads ? 'primary' : 'default'}
          size="small"
          variant={hasBlockingUploads ? 'filled' : 'outlined'}
        />
        <Chip label={`${activeUploads.length} aktivno`} size="small" variant="outlined" />
        <Chip label={`${completedUploads.length} završeno`} size="small" color="success" variant="outlined" />
        {failedUploads.length > 0 && (
          <Chip label={`${failedUploads.length} greška`} size="small" color="error" variant="outlined" />
        )}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
        <Chip
          label={
            hasBlockingDownloads
              ? 'Download se priprema'
              : activeDownloads.length > 0
                ? `Download ${formatProgressPercent(downloadSummary.progress) || 'u toku'}`
                : 'Download miruje'
          }
          color={activeDownloads.length > 0 ? 'primary' : 'default'}
          size="small"
          variant={activeDownloads.length > 0 ? 'filled' : 'outlined'}
          onClick={(activeDownloads.length > 0 || completedDownloads.length > 0 || failedDownloads.length > 0)
            ? openDownloadPanel
            : undefined}
        />
        {downloadSummary.speedBytesPerSecond > 0 && (
          <Chip label={formatTransferRate(downloadSummary.speedBytesPerSecond)} size="small" variant="outlined" />
        )}
        <Chip label={`${activeDownloads.length} skidanja`} size="small" variant="outlined" />
        <Chip label={`${completedDownloads.length} završeno`} size="small" color="success" variant="outlined" />
        {failedDownloads.length > 0 && (
          <Chip label={`${failedDownloads.length} problem`} size="small" color="error" variant="outlined" />
        )}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
        <Chip
          label={realtimeStatus === 'connected' ? 'Notifikacije uživo' : 'Ponovno povezivanje'}
          color={realtimeStatus === 'connected' ? 'success' : 'warning'}
          size="small"
          variant="outlined"
        />
      </Stack>
      {hasActiveTransfers && (
        <LinearProgress
          variant={!hasBlockingUploads && downloadSummary.progress != null ? 'determinate' : 'indeterminate'}
          value={!hasBlockingUploads && downloadSummary.progress != null ? downloadSummary.progress : undefined}
          sx={{ mt: 0.75 }}
        />
      )}
    </Box>
  );
};

const NotificationCenter = () => {
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount,
    loading,
    latestNotification,
    refreshNotifications,
    markRead,
    markAllRead,
    acknowledge,
    dismissLatest,
  } = useNotifications();
  const [anchorEl, setAnchorEl] = useState(null);

  const openMenu = (event) => {
    setAnchorEl(event.currentTarget);
    refreshNotifications({ silent: true });
  };

  const openNotification = async (notification) => {
    if (notification.severity !== 'critical') await markRead(notification._id);
    setAnchorEl(null);
    if (notification.deepLink?.startsWith('vca://')) {
      try {
        const url = new URL(notification.deepLink);
        const id = url.pathname.replace(/^\//, '');
        if (url.hostname === 'job' && id) {
          return navigate(url.searchParams.get('view') === 'storyboard'
            ? `/edit-jobs/${id}/storyboard`
            : `/edit-jobs/${id}`);
        }
        if (url.hostname === 'video' && id) return navigate(`/video-details/${id}`);
      } catch (error) {
        // Entity fallback below keeps legacy notifications working.
      }
    }
    const jobId = notification.job?._id || notification.job;
    if (jobId) navigate(`/edit-jobs/${jobId}#comments`);
  };

  return (
    <>
      <Tooltip title="Notifikacije">
        <IconButton color="inherit" onClick={openMenu} aria-label={`${unreadCount} nepročitanih notifikacija`}>
          <Badge badgeContent={unreadCount} color="error" max={99}>
            <NotificationsNoneIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        PaperProps={{ sx: { width: { xs: 320, sm: 390 }, maxWidth: 'calc(100vw - 24px)', maxHeight: 480 } }}
      >
        <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
              Notifikacije
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {unreadCount > 0 ? `${unreadCount} nepročitano` : 'Sve je pregledano'}
            </Typography>
          </Box>
          <Tooltip title="Označi sve kao pročitano">
            <span>
              <IconButton size="small" onClick={markAllRead} disabled={unreadCount === 0}>
                <DoneAllIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
        <Divider />
        {loading && notifications.length === 0 && (
          <MenuItem disabled>Učitavam notifikacije...</MenuItem>
        )}
        {!loading && notifications.length === 0 && (
          <MenuItem disabled>Nema novih notifikacija.</MenuItem>
        )}
        {notifications.map((notification) => (
          <MenuItem
            key={notification._id}
            onClick={() => openNotification(notification)}
            sx={{
              alignItems: 'flex-start',
              whiteSpace: 'normal',
              py: 1.25,
              bgcolor: notification.state === 'read' || notification.readAt ? 'transparent' : 'action.selected',
            }}
          >
            <Box sx={{ minWidth: 0, width: '100%' }}>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Typography variant="body2" sx={{ flex: 1, fontWeight: notification.readAt ? 700 : 900 }}>
                  {notification.title}
                </Typography>
                {notification.severity === 'critical' && (
                  <Chip label="Kritično" color="error" size="small" />
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary" component="div">
                {notification.actor?.username || 'Korisnik'}: {notification.bodyPreview}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {notification.createdAt ? new Date(notification.createdAt).toLocaleString('bs-BA') : ''}
              </Typography>
              {notification.severity === 'critical' && notification.state !== 'acknowledged' && (
                <Button
                  size="small"
                  color="error"
                  variant="contained"
                  sx={{ mt: 0.75 }}
                  onClick={(event) => {
                    event.stopPropagation();
                    acknowledge(notification._id);
                  }}
                >
                  Potvrdi prijem
                </Button>
              )}
            </Box>
          </MenuItem>
        ))}
      </Menu>
      <Snackbar
        open={Boolean(latestNotification)}
        autoHideDuration={6000}
        onClose={dismissLatest}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={latestNotification?.severity === 'critical' ? 'error' : latestNotification?.severity === 'action_required' ? 'warning' : 'info'}
          variant="filled"
          onClose={dismissLatest}
          action={latestNotification ? (
            <Button
              color="inherit"
              size="small"
              onClick={() => openNotification(latestNotification)}
            >
              Otvori
            </Button>
          ) : null}
        >
          {latestNotification?.title || 'Nova notifikacija'}
        </Alert>
      </Snackbar>
    </>
  );
};

const AppShell = ({ children }) => {
  const { user, logout } = useContext(UserContext);
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleItems = useMemo(
    () => navItems.filter((item) => item.roles.includes(user?.role)),
    [user]
  );

  const activeItem = visibleItems.find((item) => matchesPath(location.pathname, item.to));

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  if (!user) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        {children}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Drawer
        variant={isDesktop ? 'permanent' : 'temporary'}
        open={isDesktop || mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            borderRight: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
          },
        }}
      >
        <DrawerContent
          visibleItems={visibleItems}
          pathname={location.pathname}
          onNavigate={() => setMobileOpen(false)}
        />
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
            zIndex: (currentTheme) => currentTheme.zIndex.drawer + 1,
          }}
        >
          <Toolbar sx={{ gap: 1.25 }}>
            {!isDesktop && (
              <IconButton edge="start" onClick={() => setMobileOpen(true)}>
                <MenuIcon />
              </IconButton>
            )}
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" noWrap sx={{ fontWeight: 900 }}>
                {activeItem?.label || 'Radni prostor'}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {activeItem?.description || 'Dnevni produkcijski workflow'}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <NotificationCenter />
              <Chip
                label={`${user.username || 'Korisnik'} / ${formatRole(user.role)}`}
                size="small"
                color="primary"
                variant="outlined"
                sx={{ display: { xs: 'none', sm: 'inline-flex' }, fontWeight: 750 }}
              />
              <Button
                component={Link}
                to="/feedback"
                size="small"
                startIcon={<FeedbackOutlinedIcon />}
                sx={{ display: { xs: 'none', md: 'inline-flex' } }}
              >
                Feedback
              </Button>
              <Tooltip title="Odjava">
                <IconButton onClick={handleLogout} color="inherit">
                  <LogoutIcon />
                </IconButton>
              </Tooltip>
            </Stack>
          </Toolbar>
          <GlobalStatusBar />
        </AppBar>
        {children}
      </Box>
    </Box>
  );
};

export default AppShell;
