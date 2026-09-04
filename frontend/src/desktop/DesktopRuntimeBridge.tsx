import { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, LinearProgress, Snackbar, Stack } from '@mui/material';
import { useBackgroundDownloads } from '../contexts/BackgroundDownloadContext';
import { useBackgroundUploads } from '../contexts/BackgroundUploadContext';
import { UserContext } from '../contexts/UserContext';
import axiosInstance from '../axiosConfig';
import { getCurrentDeviceId } from '../auth/sessionApi';
import {
  checkForDesktopUpdate,
  initializeDesktopRuntime,
  installPendingDesktopUpdate,
  isDesktopRuntime,
  listenForDesktopNavigation,
  listenForPremiereExports,
  relaunchDesktopApp,
  setDesktopTransferGuard,
  showNativeNotification,
} from './runtime';

const DesktopRuntimeBridge = () => {
  const navigate = useNavigate();
  const { user } = useContext(UserContext);
  const { activeDownloads } = useBackgroundDownloads();
  const { activeUploads } = useBackgroundUploads();
  const [premiereTransfers, setPremiereTransfers] = useState(0);
  const [updatePolicy, setUpdatePolicy] = useState<any>(null);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [updateError, setUpdateError] = useState('');
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updateInstalled, setUpdateInstalled] = useState(false);
  const hasActiveTransfers = activeDownloads.length > 0 || activeUploads.length > 0 || premiereTransfers > 0;

  useEffect(() => {
    initializeDesktopRuntime().catch((error) => {
      console.error('Desktop runtime initialization failed:', error);
    });

    let cleanup = () => {};
    listenForDesktopNavigation((path) => navigate(path))
      .then((unlisten) => { cleanup = unlisten; })
      .catch((error) => console.error('Desktop deep link initialization failed:', error));

    return () => cleanup();
  }, [navigate]);

  useEffect(() => {
    let cleanup = () => {};
    listenForPremiereExports((exportFile) => {
      window.dispatchEvent(new CustomEvent('vca:premiere-export-ready', { detail: exportFile }));
      showNativeNotification({
        title: 'Premiere export je spreman',
        body: 'Otvori job da pregledaš i pošalješ novi final.',
        severity: 'action_required',
        deepLink: `vca://job/${exportFile.jobId}`,
      }).catch(() => {});
    }).then((unlisten) => { cleanup = unlisten; });
    return () => cleanup();
  }, []);

  useEffect(() => {
    const handlePremiereTransfer = (event: Event) => {
      const delta = Number((event as CustomEvent).detail || 0);
      setPremiereTransfers((current) => Math.max(0, current + delta));
    };
    window.addEventListener('vca:premiere-transfer', handlePremiereTransfer);
    return () => window.removeEventListener('vca:premiere-transfer', handlePremiereTransfer);
  }, []);

  useEffect(() => {
    setDesktopTransferGuard(hasActiveTransfers).catch((error) => {
      console.error('Desktop transfer guard failed:', error);
    });
  }, [hasActiveTransfers]);

  useEffect(() => {
    if (!user || !isDesktopRuntime()) return undefined;
    let active = true;
    const checkPolicy = async () => {
      try {
        const deviceId = await getCurrentDeviceId();
        const response = await axiosInstance.get('/v2/devices/update-policy/current', { params: { deviceId } });
        if (!active) return;
        setUpdatePolicy(response.data);
        window.dispatchEvent(new CustomEvent('vca:desktop-update-status', { detail: response.data }));
        if (response.data?.updateAvailable && response.data?.updaterConfigured) {
          const info = await checkForDesktopUpdate();
          if (active) setUpdateInfo(info.available ? info : null);
        }
      } catch (error: any) {
        if (active) setUpdateError(error.message || 'Desktop update provjera nije uspjela.');
      }
    };
    checkPolicy();
    const interval = window.setInterval(checkPolicy, 6 * 60 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [user]);

  const installUpdate = async () => {
    setUpdateError('');
    setUpdateProgress(0);
    try {
      await installPendingDesktopUpdate(({ downloadedBytes, totalBytes }) => {
        setUpdateProgress(totalBytes ? Math.min(Math.round((downloadedBytes / totalBytes) * 100), 100) : 0);
      });
      setUpdateProgress(100);
      setUpdateInstalled(true);
    } catch (error: any) {
      setUpdateProgress(null);
      setUpdateError(error.message || 'Desktop update nije instaliran.');
    }
  };

  const showUpdate = Boolean(updatePolicy?.updateAvailable || updateError || updateInstalled);
  return (
    <Snackbar
      open={showUpdate}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      onClose={() => {
        if (!updatePolicy?.updateRequired && !updateInstalled) {
          setUpdatePolicy((current: any) => current ? { ...current, updateAvailable: false } : current);
          setUpdateError('');
        }
      }}
    >
      <Alert
        severity={updateError ? 'error' : updatePolicy?.updateRequired ? 'warning' : 'info'}
        variant="filled"
        sx={{ minWidth: { sm: 420 }, maxWidth: 620 }}
        action={updateInstalled ? (
          <Button color="inherit" size="small" onClick={() => relaunchDesktopApp()}>Restartuj</Button>
        ) : updateInfo ? (
          <Button color="inherit" size="small" onClick={installUpdate} disabled={updateProgress != null}>Instaliraj</Button>
        ) : null}
      >
        <Stack spacing={0.75}>
          <span>
            {updateError
              || (updateInstalled
                ? 'Nova verzija je instalirana i spremna za restart.'
                : updatePolicy?.updaterConfigured
                  ? `Dostupna je verzija ${updatePolicy?.targetVersion}.`
                  : `Verzija ${updatePolicy?.targetVersion} je potrebna, ali updater još nije konfigurisan na serveru.`)}
          </span>
          {updateProgress != null && (
            <LinearProgress
              variant={updateProgress > 0 ? 'determinate' : 'indeterminate'}
              value={updateProgress}
              color="inherit"
            />
          )}
        </Stack>
      </Alert>
    </Snackbar>
  );
};

export default DesktopRuntimeBridge;
