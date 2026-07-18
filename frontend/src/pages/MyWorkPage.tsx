import React, { useContext, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import DevicesIcon from '@mui/icons-material/Devices';
import RefreshIcon from '@mui/icons-material/Refresh';
import ViewTimelineIcon from '@mui/icons-material/ViewTimeline';
import axiosInstance from '../axiosConfig';
import { UserContext } from '../contexts/UserContext';
import { useRealtime } from '../contexts/RealtimeContext';
import { EmptyState, KpiStrip, StatusChip, WorkspaceHeader } from '../components/common/WorkspaceChrome';
import { formatDateTimeBs, jobStatusLabels, priorityLabels } from '../utils/uiLabels';

const roleCopy: Record<string, { title: string; subtitle: string; primary: string; primaryLink: string }> = {
  Reporter: { title: 'Moj rad', subtitle: 'Aktivni prilozi, komentari i rokovi na jednom mjestu.', primary: 'Novi prilog', primaryLink: '/reporter-dashboard?new=1' },
  Editor: { title: 'Moj red za montažu', subtitle: 'Prvo su prikazani hitni, istekli i correction jobovi.', primary: 'Otvori produkciju', primaryLink: '/editor-dashboard' },
  VideoEditor: { title: 'Moj red za montažu', subtitle: 'Prvo su prikazani hitni, istekli i correction jobovi.', primary: 'Otvori produkciju', primaryLink: '/editor-dashboard' },
  Producer: { title: 'Producent: akcije', subtitle: 'Odobrenja, ispravke i promjene emisije koje traže reakciju.', primary: 'Otvori Producer Desk', primaryLink: '/producer-dashboard' },
  Realizator: { title: 'Današnja emisija', subtitle: 'Rundown verzije i kritične promjene od zadnjeg preuzimanja.', primary: 'Otvori realizaciju', primaryLink: '/realizator-dashboard' },
  Archivist: { title: 'Red za arhiviranje', subtitle: 'Materijali koji čekaju pregled, metadata ili odluku o duplikatu.', primary: 'Otvori arhivu', primaryLink: '/archivist-dashboard' },
  Admin: { title: 'Sistem danas', subtitle: 'Posao, uređaji, edge čvorovi, transferi i kritični događaji.', primary: 'Otvori Admin', primaryLink: '/admin-dashboard' },
};

function notificationPath(notification: any) {
  if (notification.deepLink?.startsWith('vca://')) {
    try {
      const url = new URL(notification.deepLink);
      const id = url.pathname.replace(/^\//, '');
      if (url.hostname === 'job' && id) {
        return url.searchParams.get('view') === 'storyboard'
          ? `/edit-jobs/${id}/storyboard`
          : `/edit-jobs/${id}`;
      }
      if (url.hostname === 'video' && id) return `/video-details/${id}`;
    } catch {
      return '/my-work';
    }
  }
  if (notification.entityType === 'edit_job' && notification.entityId) return `/edit-jobs/${notification.entityId}`;
  return '/my-work';
}

const WorkSection = ({ title, subtitle, children }: any) => (
  <Box component="section" sx={{ py: 2.25, borderTop: '1px solid', borderColor: 'divider' }}>
    <Box sx={{ mb: 1.25 }}>
      <Typography variant="h6" sx={{ fontWeight: 900 }}>{title}</Typography>
      {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
    </Box>
    {children}
  </Box>
);

const MyWorkPage = () => {
  const { user } = useContext(UserContext);
  const realtime = useRealtime();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['my-work', user?._id || user?.id],
    queryFn: async () => (await axiosInstance.get('/v2/my-work')).data,
    enabled: Boolean(user),
    refetchInterval: () => document.visibilityState === 'visible' ? 30_000 : false,
  });

  useEffect(() => {
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['my-work'] });
    window.addEventListener('vca:domain-event', invalidate);
    window.addEventListener('vca:notification', invalidate);
    return () => {
      window.removeEventListener('vca:domain-event', invalidate);
      window.removeEventListener('vca:notification', invalidate);
    };
  }, [queryClient]);

  const data = query.data || {};
  const summary = data.summary || {};
  const copy = roleCopy[user?.role] || roleCopy.Reporter;
  const jobs = data.jobs || [];
  const corrections = data.corrections || [];
  const showDays = data.showDays || [];
  const notifications = data.notifications || [];
  const transfers = data.transfers || [];
  const archiveItems = data.archiveItems || [];
  const urgentJobs = useMemo(() => jobs.filter((job: any) => (
    job.priority === 'urgent' || job.jobKind === 'correction' || (job.deadline && new Date(job.deadline) <= new Date())
  )).length, [jobs]);

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2.5, minHeight: '100vh', bgcolor: 'background.default' }}>
      <WorkspaceHeader
        eyebrow="Aplikacija v2"
        title={copy.title}
        subtitle={copy.subtitle}
        chips={[
          { label: 'Veza', value: realtime.status === 'connected' ? 'uživo' : 'ponovno povezivanje', color: realtime.status === 'connected' ? 'success' : 'warning' },
          { label: 'Korisnik', value: user?.username || user?.role },
        ]}
        actions={(
          <>
            <Button startIcon={<RefreshIcon />} onClick={() => query.refetch()} disabled={query.isFetching} variant="outlined">Osvježi</Button>
            <Button component={Link} to={copy.primaryLink} variant="contained" startIcon={user?.role === 'Reporter' ? <AddCircleOutlineIcon /> : <ArrowForwardIcon />}>{copy.primary}</Button>
          </>
        )}
      />

      {query.isFetching && <LinearProgress sx={{ mb: 1.5 }} />}
      {query.error && <Alert severity="error" sx={{ mb: 2 }}>Radni pregled se trenutno ne može učitati.</Alert>}
      {summary.critical > 0 && <Alert severity="error" sx={{ mb: 2 }}>{summary.critical} kritičnih događaja čeka tvoju potvrdu. Otvori prvi događaj ispod.</Alert>}

      <KpiStrip dense items={[
        { label: 'Aktivni jobovi', value: summary.activeJobs || 0 },
        { label: 'Traži reakciju', value: (summary.critical || 0) + urgentJobs, color: (summary.critical || urgentJobs) ? 'error.main' : 'text.primary' },
        { label: 'Notifikacije', value: summary.unread || 0, color: summary.unread ? 'warning.main' : 'text.primary' },
        { label: 'Transferi', value: summary.activeTransfers || 0, color: summary.activeTransfers ? 'primary.main' : 'text.primary' },
        ...(user?.role === 'Archivist' ? [{ label: 'Čeka arhivu', value: summary.archivePending || 0 }] : []),
      ]} />

      {notifications.length > 0 && (
        <WorkSection title="Traži tvoju pažnju" subtitle="Kritični događaji ostaju aktivni dok ih ne potvrdiš.">
          <Stack spacing={1}>
            {notifications.slice(0, 6).map((notification: any) => (
              <Paper key={notification._id} variant="outlined" sx={{ p: 1.5, borderRadius: 1, borderColor: notification.severity === 'critical' ? 'error.main' : 'divider' }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.25 }}>
                      <StatusChip label={notification.severity === 'critical' ? 'Kritično' : notification.severity === 'action_required' ? 'Potrebna akcija' : 'Info'} tone={notification.severity === 'critical' ? 'error' : notification.severity === 'action_required' ? 'warning' : 'info'} />
                      <Typography variant="caption" color="text.secondary">{formatDateTimeBs(notification.createdAt)}</Typography>
                    </Stack>
                    <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>{notification.title}</Typography>
                    <Typography variant="body2" color="text.secondary">{notification.bodyPreview}</Typography>
                  </Box>
                  <Button onClick={() => navigate(notificationPath(notification))} endIcon={<ArrowForwardIcon />}>Otvori</Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </WorkSection>
      )}

      {jobs.length > 0 && (
        <WorkSection title="Aktivni jobovi" subtitle="Redoslijed prati rok, prioritet i potrebnu reakciju.">
          <Stack spacing={1}>
            {jobs.map((job: any) => (
              <Paper key={job._id} variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ md: 'center' }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
                      <StatusChip value={job.status} maps={jobStatusLabels} />
                      <StatusChip value={job.priority} maps={priorityLabels} variant="outlined" />
                      {job.jobKind === 'correction' && <StatusChip label="Ispravka" tone="error" />}
                    </Stack>
                    <Typography variant="subtitle1" sx={{ fontWeight: 900 }} noWrap>{job.title}</Typography>
                    <Typography variant="caption" color="text.secondary">{job.deadline ? `Rok: ${formatDateTimeBs(job.deadline)} / ` : ''}{job.segments?.length || 0} klipova</Typography>
                  </Box>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {user?.role === 'Reporter' && <Button component={Link} to={`/edit-jobs/${job._id}/storyboard`} startIcon={<ViewTimelineIcon />} variant="outlined">Storyboard</Button>}
                    <Button component={Link} to={`/edit-jobs/${job._id}`} endIcon={<ArrowForwardIcon />} variant="contained">Otvori job</Button>
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </WorkSection>
      )}

      {corrections.length > 0 && (
        <WorkSection title="Ispravke" subtitle="Otvorene prijave ostaju ovdje do rješenja ili odbacivanja.">
          <Stack spacing={1}>
            {corrections.map((item: any) => (
              <Paper key={item._id} variant="outlined" sx={{ p: 1.5, borderRadius: 1, borderColor: 'warning.main' }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>{item.video?.originalFilename || item.video?.filename || 'Video za ispravku'}</Typography>
                    <Typography variant="body2" color="text.secondary">{item.note}</Typography>
                  </Box>
                  {item.correctionJob && <Button component={Link} to={`/edit-jobs/${item.correctionJob}`} endIcon={<ArrowForwardIcon />}>Otvori montažu</Button>}
                </Stack>
              </Paper>
            ))}
          </Stack>
        </WorkSection>
      )}

      {showDays.length > 0 && (
        <WorkSection title="Emisije" subtitle="Promjena nakon zadnjeg preuzimanja posebno je označena.">
          <Stack spacing={1}>
            {showDays.map((showDay: any) => (
              <Paper key={showDay._id} variant="outlined" sx={{ p: 1.5, borderRadius: 1, borderColor: showDay.changedSinceDownload ? 'error.main' : 'divider' }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      {showDay.changedSinceDownload && <StatusChip label="Promijenjeno nakon downloada" tone="error" />}
                      {showDay.hasNeverDownloaded && <StatusChip label="Air paket nije preuzet" tone="warning" variant="outlined" />}
                    </Stack>
                    <Typography variant="subtitle1" sx={{ fontWeight: 900, mt: 0.5 }}>{showDay.program?.name || showDay.program?.title || 'Emisija'}</Typography>
                    <Typography variant="caption" color="text.secondary">{formatDateTimeBs(showDay.airDate)} / {showDay.itemCount} stavki</Typography>
                  </Box>
                  <Button component={Link} to={user?.role === 'Realizator' ? '/realizator-dashboard' : '/producer-dashboard'} variant="contained">Otvori rundown</Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </WorkSection>
      )}

      {archiveItems.length > 0 && (
        <WorkSection title="Materijali za pregled">
          <Stack spacing={1}>
            {archiveItems.map((video: any) => (
              <Paper key={video._id} variant="outlined" sx={{ p: 1.25, borderRadius: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 900 }} noWrap>{video.originalFilename || video.filename}</Typography>
                    <Typography variant="caption" color="text.secondary">{video.event || 'Bez eventa'} / {video.archiveReviewStatus}</Typography>
                  </Box>
                  <Button component={Link} to={`/video-details/${video._id}`}>Pregled</Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </WorkSection>
      )}

      {transfers.length > 0 && (
        <WorkSection title="Transferi u toku" subtitle="Možeš nastaviti raditi; desktop aplikacija čuva red i nakon restarta.">
          <Stack spacing={1}>
            {transfers.map((transfer: any) => {
              const progress = transfer.totalBytes > 0 ? Math.round((transfer.transferredBytes / transfer.totalBytes) * 100) : 0;
              return (
                <Box key={transfer.transferId}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>{transfer.filename || transfer.kind}</Typography>
                    <Typography variant="caption">{transfer.status} / {progress}%</Typography>
                  </Stack>
                  <LinearProgress variant={transfer.totalBytes ? 'determinate' : 'indeterminate'} value={progress} />
                </Box>
              );
            })}
          </Stack>
        </WorkSection>
      )}

      {data.platform && (
        <WorkSection title="Desktop i Media Edge" subtitle="Brzi pregled dostupnosti instaliranih klijenata i lokalnih media čvorova.">
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <DevicesIcon color="action" />
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>Uređaji online: {data.platform.devicesOnline} / {data.platform.devicesTotal}</Typography>
                <Typography variant="body2" color="text.secondary">Edge online: {(data.platform.nodes || []).filter((node: any) => node.status === 'online').length} / {(data.platform.nodes || []).length}</Typography>
              </Box>
              <Button component={Link} to="/admin-dashboard?section=desktop" variant="outlined">Detalji sistema</Button>
            </Stack>
          </Paper>
        </WorkSection>
      )}

      {!query.isLoading && !notifications.length && !jobs.length && !corrections.length && !showDays.length && !archiveItems.length && (
        <EmptyState title="Nema otvorenih zadataka" description="Trenutno nema ničega što traži tvoju reakciju." />
      )}
    </Box>
  );
};

export default MyWorkPage;
