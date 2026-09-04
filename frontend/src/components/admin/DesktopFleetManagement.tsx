import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import BlockIcon from '@mui/icons-material/Block';
import TroubleshootIcon from '@mui/icons-material/Troubleshoot';
import RefreshIcon from '@mui/icons-material/Refresh';
import axiosInstance from '../../axiosConfig';
import { ConfirmDialog, EmptyState, KpiStrip, StatusChip } from '../common/WorkspaceChrome';
import { formatBytesBs, formatDateTimeBs } from '../../utils/uiLabels';
import {
  createDesktopDiagnostics,
  isDesktopRuntime,
  openLocalPath,
} from '../../desktop/runtime';

const DeviceRow = ({ device, updateChannel, onRevoke }: any) => {
  const online = !device.revokedAt && Date.now() - new Date(device.lastSeenAt).getTime() < 90_000;
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1, minHeight: 88 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(220px, 1.3fr) minmax(180px, 1fr) 150px 150px auto' }, gap: 1.25, alignItems: 'center' }}>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <StatusChip label={device.revokedAt ? 'Opozvan' : online ? 'Online' : 'Offline'} tone={device.revokedAt ? 'error' : online ? 'success' : 'warning'} />
            <Typography variant="subtitle2" sx={{ fontWeight: 900 }} noWrap>{device.hostname}</Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">{device.user?.username || 'Bez korisnika'} / {device.user?.role || 'N/A'}</Typography>
        </Box>
        <Box>
          <Typography variant="body2">v{device.appVersion}</Typography>
          <Typography variant="caption" color="text.secondary">Zadnji heartbeat: {formatDateTimeBs(device.lastSeenAt)}</Typography>
        </Box>
        <Chip label={device.notificationPermission === 'granted' ? 'Windows obavijesti OK' : `Obavijesti: ${device.notificationPermission}`} color={device.notificationPermission === 'granted' ? 'success' : 'warning'} variant="outlined" size="small" />
        <FormControl size="small" disabled={Boolean(device.revokedAt)}>
          <InputLabel>Update kanal</InputLabel>
          <Select value={device.updateChannel || 'stable'} label="Update kanal" onChange={(event) => updateChannel(device.deviceId, event.target.value)}>
            <MenuItem value="stable">Stable</MenuItem>
            <MenuItem value="pilot">Pilot</MenuItem>
          </Select>
        </FormControl>
        <Button color="error" startIcon={<BlockIcon />} onClick={() => onRevoke(device)} disabled={Boolean(device.revokedAt)}>Opozovi</Button>
      </Box>
    </Paper>
  );
};

const DesktopFleetManagement = () => {
  const theme = useTheme();
  const desktopLayout = useMediaQuery(theme.breakpoints.up('md'));
  const [devices, setDevices] = useState<any[]>([]);
  const [deviceSummary, setDeviceSummary] = useState<any>({});
  const [platform, setPlatform] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [revokeDevice, setRevokeDevice] = useState<any>(null);
  const deviceListRef = useRef<HTMLDivElement | null>(null);
  const healthQuery = useQuery({
    queryKey: ['admin-platform-health'],
    queryFn: async () => (await axiosInstance.get('/v2/admin/platform/health')).data,
    refetchInterval: () => document.visibilityState === 'visible' ? 30_000 : false,
  });
  const deviceVirtualizer = useVirtualizer({
    count: desktopLayout ? devices.length : 0,
    getScrollElement: () => deviceListRef.current,
    estimateSize: () => 96,
    overscan: 5,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [deviceResponse, platformResponse] = await Promise.all([
        axiosInstance.get('/v2/devices/workspace', { params: { page: 1, limit: 100 } }),
        axiosInstance.get('/v2/admin/platform'),
      ]);
      setDevices(deviceResponse.data?.items || []);
      setDeviceSummary(deviceResponse.data?.summary || {});
      setPlatform(platformResponse.data || {});
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || 'Desktop i Edge pregled se ne može učitati.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateChannel = async (deviceId: string, updateChannel: string) => {
    setError('');
    try {
      const response = await axiosInstance.patch(`/v2/devices/${deviceId}`, { updateChannel });
      setDevices((current) => current.map((item) => item.deviceId === deviceId ? response.data.device : item));
      setMessage('Update kanal uređaja je promijenjen.');
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || 'Update kanal se ne može promijeniti.');
    }
  };

  const confirmRevoke = async () => {
    if (!revokeDevice) return;
    try {
      await axiosInstance.patch(`/v2/devices/${revokeDevice.deviceId}/revoke`);
      setRevokeDevice(null);
      setMessage('Uređaj je opozvan; njegove aktivne sesije su ugašene.');
      await load();
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || 'Uređaj se ne može opozvati.');
    }
  };

  const setNodeStatus = async (nodeId: string, status: string) => {
    try {
      await axiosInstance.patch(`/v2/admin/platform/media-nodes/${nodeId}/status`, { status });
      setMessage('Media Edge status je promijenjen.');
      await load();
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || 'Media Edge status se ne može promijeniti.');
    }
  };

  const savePolicy = async (policy: any) => {
    try {
      const response = await axiosInstance.put(
        `/v2/admin/platform/escalation-policy/${encodeURIComponent(policy.eventType)}`,
        policy
      );
      setPlatform((current: any) => ({
        ...current,
        policies: (current.policies || []).map((item: any) => item.eventType === policy.eventType ? response.data.policy : item),
      }));
      setMessage('Pravilo eskalacije je sačuvano.');
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || 'Pravilo eskalacije se ne može sačuvati.');
    }
  };

  const mutatePolicy = (eventType: string, patch: any) => {
    setPlatform((current: any) => ({
      ...current,
      policies: (current.policies || []).map((item: any) => item.eventType === eventType ? { ...item, ...patch } : item),
    }));
  };

  const nodes = platform?.nodes || [];
  const onlineNodes = nodes.filter((node: any) => node.effectiveStatus === 'online').length;
  const health = healthQuery.data || {};
  const runtime = health.runtime || {};

  const exportDiagnostics = async () => {
    try {
      const path = await createDesktopDiagnostics({
        platformHealth: health,
        deviceSummary,
        collectedAt: new Date().toISOString(),
      });
      setMessage(`Dijagnostika je sačuvana: ${path}`);
      await openLocalPath(path);
    } catch (requestError: any) {
      setError(requestError.message || 'Dijagnostika se ne može izvesti.');
    }
  };

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 900 }}>Desktop uređaji i Media Edge</Typography>
          <Typography variant="body2" color="text.secondary">Instalacije, update kanali, Windows notifikacije i lokalni media čvorovi.</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          {isDesktopRuntime() && (
            <Button startIcon={<TroubleshootIcon />} onClick={exportDiagnostics} variant="outlined">Dijagnostika</Button>
          )}
          <Button
            startIcon={<RefreshIcon />}
            onClick={() => Promise.all([load(), healthQuery.refetch()])}
            disabled={loading || healthQuery.isFetching}
            variant="outlined"
          >Osvježi</Button>
        </Stack>
      </Stack>

      {message && <Alert severity="success" onClose={() => setMessage('')} sx={{ mb: 2 }}>{message}</Alert>}
      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

      <KpiStrip dense items={[
        { label: 'Desktop online', value: deviceSummary.online || 0, color: deviceSummary.online ? 'success.main' : 'warning.main' },
        { label: 'Desktop offline', value: deviceSummary.offline || 0, color: deviceSummary.offline ? 'warning.main' : 'text.primary' },
        { label: 'Stara verzija', value: deviceSummary.outdated || 0, color: deviceSummary.outdated ? 'warning.main' : 'text.primary' },
        { label: 'Notifikacije odbijene', value: deviceSummary.notificationsDenied || 0, color: deviceSummary.notificationsDenied ? 'error.main' : 'text.primary' },
        { label: 'Edge online', value: `${onlineNodes}/${nodes.length}`, color: onlineNodes === nodes.length && nodes.length ? 'success.main' : 'warning.main' },
        { label: 'Outbox čeka', value: platform?.queues?.outbox?.pending || 0, color: platform?.queues?.outbox?.retrying ? 'error.main' : 'text.primary' },
      ]} />

      <Box component="section" sx={{ mb: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" sx={{ mb: 1 }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>Runtime health</Typography>
            <Typography variant="caption" color="text.secondary">Lagane metrike procesa, API odziva i veze sa bazom.</Typography>
          </Box>
          <StatusChip label={health.status === 'healthy' ? 'Sistem stabilan' : 'Potrebna provjera'} tone={health.status === 'healthy' ? 'success' : 'warning'} />
        </Stack>
        {healthQuery.isError && <Alert severity="warning">Runtime health trenutno nije dostupan.</Alert>}
        {(health.warnings || []).map((warning: string) => <Alert key={warning} severity="warning" sx={{ mb: 0.75 }}>{warning}</Alert>)}
        <KpiStrip dense items={[
          { label: 'MongoDB ping', value: health.mongo?.pingMs == null ? 'N/A' : `${health.mongo.pingMs} ms`, color: health.mongo?.connected ? 'success.main' : 'error.main' },
          { label: 'API aktivno', value: runtime.requests?.active || 0 },
          { label: 'API greške', value: runtime.requests?.errors || 0, color: runtime.requests?.errors ? 'error.main' : 'text.primary' },
          { label: 'Event loop p95', value: `${runtime.eventLoop?.p95Ms || 0} ms`, color: (runtime.eventLoop?.p95Ms || 0) >= 200 ? 'warning.main' : 'text.primary' },
          { label: 'RAM procesa', value: formatBytesBs(runtime.process?.memory?.rssBytes || 0) },
          { label: 'Disk slobodno', value: health.disk?.available ? `${health.disk.freePercent}%` : 'N/A', color: health.disk?.freePercent <= 10 ? 'error.main' : 'text.primary' },
        ]} />
        {(runtime.requests?.slowestRoutes || []).length > 0 && (
          <Stack spacing={0.5} sx={{ mt: 1 }}>
            {(runtime.requests.slowestRoutes || []).slice(0, 5).map((route: any) => (
              <Box key={route.key} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 1, py: 0.5, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="caption" noWrap>{route.key}</Typography>
                <Typography variant="caption" color="text.secondary">prosjek {route.averageMs} ms</Typography>
                <Typography variant="caption" color={route.errors ? 'error.main' : 'text.secondary'}>{route.count} zahtjeva</Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Box>

      <Box component="section" sx={{ mb: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 900, mb: 1 }}>Instalirani računari</Typography>
        {devices.length === 0 ? (
          <EmptyState title="Nema registrovanih desktop uređaja" description="Uređaj se pojavljuje nakon prve v2 prijave." />
        ) : desktopLayout ? (
          <Box
            ref={deviceListRef}
            sx={{
              height: Math.min(Math.max(deviceVirtualizer.getTotalSize(), 96), 560),
              overflowY: 'auto',
              contain: 'strict',
            }}
          >
            <Box sx={{ height: deviceVirtualizer.getTotalSize(), position: 'relative' }}>
              {deviceVirtualizer.getVirtualItems().map((virtualRow) => {
                const device = devices[virtualRow.index];
                return (
                  <Box
                    key={device.deviceId}
                    ref={deviceVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                      pb: 1,
                    }}
                  >
                    <DeviceRow device={device} updateChannel={updateChannel} onRevoke={setRevokeDevice} />
                  </Box>
                );
              })}
            </Box>
          </Box>
        ) : (
          <Stack spacing={1}>
            {devices.map((device) => (
              <DeviceRow key={device.deviceId} device={device} updateChannel={updateChannel} onRevoke={setRevokeDevice} />
            ))}
          </Stack>
        )}
      </Box>

      <Box component="section" sx={{ mb: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 900, mb: 1 }}>Media Edge čvorovi</Typography>
        {nodes.length === 0 ? (
          <EmptyState title="Media Edge nije registrovan" description="Pokreni edge servis sa ispravnim EDGE_REGISTRATION_SECRET." />
        ) : (
          <Stack spacing={1}>
            {nodes.map((node: any) => (
              <Paper key={node.nodeId} variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(220px, 1fr) minmax(180px, 1fr) minmax(190px, 1fr) 170px' }, gap: 1.25, alignItems: 'center' }}>
                  <Box>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <StatusChip value={node.effectiveStatus} />
                      <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>{node.name}</Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">{node.nodeId} / {node.site}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="body2">Slobodno: {formatBytesBs(node.storage?.freeBytes)}</Typography>
                    <Typography variant="caption" color="text.secondary">Ukupno: {formatBytesBs(node.storage?.totalBytes)}</Typography>
                  </Box>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    <Chip label={node.capabilities?.nvenc ? 'NVENC' : 'CPU'} size="small" variant="outlined" />
                    <Chip label={node.capabilities?.hls ? 'HLS' : 'Bez HLS'} size="small" variant="outlined" />
                    <Chip label={`Heartbeat ${formatDateTimeBs(node.lastSeenAt)}`} size="small" variant="outlined" />
                  </Stack>
                  <FormControl size="small">
                    <InputLabel>Operativni status</InputLabel>
                    <Select value={node.status} label="Operativni status" onChange={(event) => setNodeStatus(node.nodeId, event.target.value)}>
                      <MenuItem value="online">Online</MenuItem>
                      <MenuItem value="degraded">Degraded</MenuItem>
                      <MenuItem value="maintenance">Maintenance</MenuItem>
                      <MenuItem value="offline">Offline</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
              </Paper>
            ))}
          </Stack>
        )}
      </Box>

      <Box component="section">
        <Typography variant="subtitle1" sx={{ fontWeight: 900, mb: 1 }}>Critical escalation</Typography>
        {(platform?.policies || []).length === 0 ? (
          <Alert severity="info">Default pravila će biti kreirana v2 migracijom.</Alert>
        ) : (
          <Stack spacing={1}>
            {(platform.policies || []).map((policy: any) => (
              <Paper key={policy.eventType} variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(220px, 1fr) 150px 170px auto auto' }, gap: 1.25, alignItems: 'center' }}>
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>{policy.eventType}</Typography>
                    <Typography variant="caption" color="text.secondary">Eskalira prema: {(policy.escalationRoles || []).join(', ') || 'Admin'}</Typography>
                  </Box>
                  <TextField type="number" size="small" label="Ponovi nakon (s)" value={policy.repeatAfterSeconds} onChange={(event) => mutatePolicy(policy.eventType, { repeatAfterSeconds: Number(event.target.value) })} />
                  <TextField type="number" size="small" label="Eskaliraj nakon (s)" value={policy.acknowledgeAfterSeconds} onChange={(event) => mutatePolicy(policy.eventType, { acknowledgeAfterSeconds: Number(event.target.value) })} />
                  <Stack direction="row" spacing={0.5} alignItems="center"><Switch checked={policy.enabled} onChange={(event) => mutatePolicy(policy.eventType, { enabled: event.target.checked })} /><Typography variant="caption">Aktivno</Typography></Stack>
                  <Button onClick={() => savePolicy(policy)} variant="outlined">Sačuvaj</Button>
                </Box>
              </Paper>
            ))}
          </Stack>
        )}
      </Box>

      <ConfirmDialog
        open={Boolean(revokeDevice)}
        title="Opozvati desktop uređaj?"
        description={`Uređaj ${revokeDevice?.hostname || ''} će odmah izgubiti sve refresh sesije. Ponovna prijava nije moguća dok se ponovo ne registruje.`}
        confirmLabel="Opozovi uređaj"
        confirmColor="error"
        onClose={() => setRevokeDevice(null)}
        onConfirm={confirmRevoke}
      />
    </Box>
  );
};

export default DesktopFleetManagement;
