import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBackgroundDownloads } from '../contexts/BackgroundDownloadContext';
import { useBackgroundUploads } from '../contexts/BackgroundUploadContext';
import {
  initializeDesktopRuntime,
  listenForDesktopNavigation,
  listenForPremiereExports,
  setDesktopTransferGuard,
  showNativeNotification,
} from './runtime';

const DesktopRuntimeBridge = () => {
  const navigate = useNavigate();
  const { activeDownloads } = useBackgroundDownloads();
  const { activeUploads } = useBackgroundUploads();
  const [premiereTransfers, setPremiereTransfers] = useState(0);
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

  return null;
};

export default DesktopRuntimeBridge;
