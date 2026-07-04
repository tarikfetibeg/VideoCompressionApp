import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axiosInstance from '../axiosConfig';
import {
  BackgroundDownloadProvider,
  useBackgroundDownloads,
} from './BackgroundDownloadContext';

jest.mock('../axiosConfig', () => ({
  __esModule: true,
  default: {
    defaults: { baseURL: '/api' },
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const TriggerDownload = ({ descriptor }) => {
  const { startDownload } = useBackgroundDownloads();

  return (
    <button type="button" onClick={() => startDownload(descriptor).catch(() => {})}>
      Start download
    </button>
  );
};

const renderDownloadManager = (descriptor = {
  kind: 'video-single',
  payload: { videoId: 'video-1' },
  label: 'Test klip',
}) =>
  render(
    <BackgroundDownloadProvider>
      <TriggerDownload descriptor={descriptor} />
    </BackgroundDownloadProvider>
  );

describe('BackgroundDownloadContext', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    axiosInstance.get.mockReset();
    axiosInstance.post.mockReset();
    document.body.querySelectorAll('iframe').forEach((frame) => frame.remove());
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('creates a ticket, hands off to browser download, and polls status', async () => {
    axiosInstance.post.mockResolvedValue({
      data: {
        ticketId: 'ticket-1',
        downloadUrl: '/api/downloads/tickets/token-1',
        expiresAt: '2026-06-17T12:15:00.000Z',
      },
    });
    axiosInstance.get.mockResolvedValue({
      data: {
        status: 'completed',
        finishedAt: '2026-06-17T12:01:00.000Z',
      },
    });

    renderDownloadManager();
    fireEvent.click(screen.getByRole('button', { name: /start download/i }));

    await waitFor(() => {
      expect(axiosInstance.post).toHaveBeenCalledWith('/downloads/tickets', {
        kind: 'video-single',
        payload: { videoId: 'video-1' },
      });
    });

    await act(async () => {
      jest.advanceTimersByTime(250);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(document.body.querySelector('iframe')?.getAttribute('src')).toBe('/api/downloads/tickets/token-1');
    });

    await act(async () => {
      jest.advanceTimersByTime(1300);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(axiosInstance.get).toHaveBeenCalledWith('/downloads/tickets/ticket-1/status');
      expect(screen.getAllByText(/Zavrseno/i).length).toBeGreaterThan(0);
    });
  });

  it('shows a failed ticket creation in the panel', async () => {
    axiosInstance.post.mockRejectedValue(new Error('network down'));

    renderDownloadManager();
    fireEvent.click(screen.getByRole('button', { name: /start download/i }));

    await waitFor(() => {
      expect(screen.getByText(/Nema odgovora servera/i)).toBeInTheDocument();
    });
  });

  it('guards tab close while the download ticket is being prepared', async () => {
    let resolveTicket;
    axiosInstance.post.mockImplementation(() => new Promise((resolve) => {
      resolveTicket = resolve;
    }));

    renderDownloadManager();
    fireEvent.click(screen.getByRole('button', { name: /start download/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/Pripremam siguran download link/i).length).toBeGreaterThan(0);
    });

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    await act(async () => {
      resolveTicket({
        data: {
          ticketId: 'ticket-2',
          downloadUrl: '/api/downloads/tickets/token-2',
        },
      });
      await Promise.resolve();
    });
  });
});
