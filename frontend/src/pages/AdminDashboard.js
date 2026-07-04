import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

import axiosInstance from '../axiosConfig';
import UserManagement from '../components/admin/UserManagement';
import VideoManagement from '../components/admin/VideoManagement';
import FfmpegSettings from '../components/admin/FfmpegSettings';
import AuditLogs from '../components/admin/AuditLogs';
import BroadcastProgramManagement from '../components/admin/BroadcastProgramManagement';
import FeedbackInbox from '../components/admin/FeedbackInbox';
import StorageMaintenance from '../components/admin/StorageMaintenance';
import EditJobManagement from '../components/admin/EditJobManagement';
import {
  FilterBar,
  KpiStrip,
  WorkspaceHeader,
} from '../components/common/WorkspaceChrome';
import { formatNumberBs } from '../utils/uiLabels';

const formatBytes = (bytes) => {
  const value = Number(bytes || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const AdminDashboard = () => {
  const [activeSection, setActiveSection] = useState('overview');
  const [overviewMetrics, setOverviewMetrics] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');

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

  const sections = useMemo(
    () => [
      { id: 'overview', label: 'Overview', description: 'Sistem, rizici i dnevne admin metrike' },
      { id: 'users', label: 'Korisnici', description: 'Nalozi, role i reset lozinki' },
      { id: 'videos', label: 'Video', description: 'Materijali, owneri, download i delete' },
      { id: 'jobs', label: 'Jobs', description: 'Aktivni jobovi, SLA, rokovi, montažeri i lifecycle' },
      { id: 'ffmpeg', label: 'FFmpeg', description: 'Codec, bitrate i raw retention' },
      { id: 'maintenance', label: 'Maintenance', description: 'OFF, raw manifesti i servisni fajlovi' },
      { id: 'broadcast', label: 'Programi', description: 'Emisije i content type katalog' },
      { id: 'feedback', label: 'Feedback', description: 'Prijave, trijaza i odgovori korisnicima' },
      { id: 'logs', label: 'Audit', description: 'Osjetljive promjene i sistemski logovi' },
    ],
    []
  );

  const currentSection = sections.find((item) => item.id === activeSection) || sections[0];

  const metricItems = [
    {
      label: 'Failed processing',
      value: overviewLoading && !overviewMetrics ? '...' : formatNumberBs(overviewMetrics?.failedProcessing),
      note: 'Klipovi za retry ili intervenciju',
      color: Number(overviewMetrics?.failedProcessing || 0) > 0 ? 'error.main' : 'success.main',
    },
    {
      label: 'Open feedback',
      value: overviewLoading && !overviewMetrics ? '...' : formatNumberBs(overviewMetrics?.pendingFeedback),
      note: 'Novo i u pregledu',
      color: Number(overviewMetrics?.pendingFeedback || 0) > 0 ? 'warning.main' : 'success.main',
    },
    {
      label: 'Critical logs',
      value: overviewLoading && !overviewMetrics ? '...' : formatNumberBs(overviewMetrics?.criticalLogs),
      note: 'Delete, cleanup, reset, replace',
      color: Number(overviewMetrics?.criticalLogs || 0) > 0 ? 'warning.main' : 'text.primary',
    },
    {
      label: 'Raw orphans',
      value: overviewLoading && !overviewMetrics ? '...' : formatNumberBs(overviewMetrics?.rawOrphans),
      note: 'Disk fajlovi bez jasnog DB zapisa',
      color: Number(overviewMetrics?.rawOrphans || 0) > 0 ? 'warning.main' : 'success.main',
    },
    {
      label: 'Manifest orphans',
      value: overviewLoading && !overviewMetrics ? '...' : formatNumberBs(overviewMetrics?.rawManifestOrphans),
      note: 'Za maintenance cleanup',
      color: Number(overviewMetrics?.rawManifestOrphans || 0) > 0 ? 'warning.main' : 'success.main',
    },
    {
      label: 'Korisnici',
      value: overviewLoading && !overviewMetrics ? '...' : formatNumberBs(overviewMetrics?.activeUsers),
      note: 'Registrovani nalozi',
    },
    {
      label: 'Slobodan disk',
      value: overviewLoading && !overviewMetrics ? '...' : formatBytes(overviewMetrics?.diskFreeBytes),
      note: `${Number(overviewMetrics?.diskFreePercent || 0).toFixed(1)}% fizičkog volumena`,
      color: overviewMetrics?.diskStatus === 'critical'
        ? 'error.main'
        : overviewMetrics?.diskStatus === 'warning'
          ? 'warning.main'
          : 'success.main',
    },
    {
      label: 'Media storage',
      value: overviewLoading && !overviewMetrics ? '...' : formatBytes(overviewMetrics?.mediaStorageBytes),
      note: 'Masteri, raw i svi preview formati',
    },
  ];

  const renderOverview = () => (
    <Box>
      {overviewError && <Alert severity="error" sx={{ mb: 2 }}>{overviewError}</Alert>}
      {overviewMetrics?.diskStatus === 'critical' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Slobodan prostor je ispod critical praga. Upload nije blokiran; potrebno je provjeriti Storage Maintenance.
        </Alert>
      )}
      {overviewMetrics?.diskStatus === 'warning' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Slobodan prostor je ispod warning praga.
        </Alert>
      )}

      <KpiStrip items={metricItems} />

      <FilterBar
        title="Admin tok rada"
        summary="Kreni od gresaka u processingu, otvorenog feedbacka i maintenance signala; audit koristi za provjeru osjetljivih promjena."
        actions={(
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={fetchOverviewMetrics}
            disabled={overviewLoading}
          >
            Osvjezi metrike
          </Button>
        )}
      >
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip label={`Jobs sa izmjenama: ${formatNumberBs(overviewMetrics?.jobsWithUpdates)}`} variant="outlined" />
          <Chip label={`Rundown poslije downloada: ${formatNumberBs(overviewMetrics?.showsChangedAfterDownload)}`} variant="outlined" />
          <Chip label="Destructive akcije uvijek idu kroz potvrdu" color="warning" variant="outlined" />
        </Stack>
      </FilterBar>
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
      case 'jobs':
        return <EditJobManagement />;
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
    <Box>
      <WorkspaceHeader
        eyebrow="Admin"
        title="Sistemska kontrola"
        subtitle={currentSection.description}
        chips={[
          { label: 'Modul', value: currentSection.label },
          { label: 'Status', value: overviewLoading ? 'Osvjezavanje' : 'Spreman' },
        ]}
        actions={(
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchOverviewMetrics} disabled={overviewLoading}>
            Osvjezi overview
          </Button>
        )}
      />

      <FilterBar title="Admin moduli" summary="Kompaktan pristup bez dodatnog bocnog menija.">
        <Tabs
          value={activeSection}
          onChange={(event, value) => setActiveSection(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ minHeight: 44 }}
        >
          {sections.map((section) => (
            <Tab
              key={section.id}
              value={section.id}
              label={section.label}
              sx={{ minHeight: 44, textTransform: 'none', fontWeight: 800 }}
            />
          ))}
        </Tabs>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {currentSection.description}
        </Typography>
      </FilterBar>

      {renderSection()}
    </Box>
  );
};

export default AdminDashboard;
