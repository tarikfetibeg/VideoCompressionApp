import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import axiosInstance from '../axiosConfig';
import theme from '../theme';
import ArchivistDashboard from './ArchivistDashboard';

jest.mock('../axiosConfig', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../components/common/VideoThumbnailPreview', () => () => (
  <div data-testid="video-thumbnail" />
));

const archiveVideo = {
  _id: 'video-archive-1',
  filename: 'dnevnik-prilog.mp4',
  originalFilename: 'Dnevnik prilog.mp4',
  finalTitle: 'Dnevnik prilog',
  event: 'Dnevnik',
  status: 'edited',
  processingStatus: 'completed',
  correctionStatus: 'none',
  activeCorrectionRequest: null,
  archiveReviewStatus: 'reviewed',
  keywords: [],
  uploader: { username: 'reporter' },
  reporter: { username: 'reporter' },
  editor: { username: 'montazer' },
  uploadDate: '2026-09-08T08:00:00.000Z',
};

describe('ArchivistDashboard correction reporting', () => {
  beforeEach(() => {
    axiosInstance.get.mockReset();
    axiosInstance.post.mockReset();
    axiosInstance.patch.mockReset();
    axiosInstance.put.mockReset();
    axiosInstance.delete.mockReset();

    axiosInstance.get.mockImplementation((url) => {
      if (url === '/archive/summary') return Promise.resolve({ data: {} });
      if (url === '/broadcast/content-types') return Promise.resolve({ data: [] });
      if (url === '/archive/videos/workspace') {
        return Promise.resolve({
          data: {
            items: [archiveVideo],
            total: 1,
            page: 1,
            limit: 40,
            totalPages: 1,
            summary: {},
            facets: {},
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
    axiosInstance.post.mockResolvedValue({
      data: { message: 'Ispravka je poslana odgovornom montažeru.' },
    });
  });

  it('allows an archivist to report a completed video with a note and timestamp', async () => {
    render(
      <MemoryRouter>
        <ThemeProvider theme={theme}>
          <ArchivistDashboard />
        </ThemeProvider>
      </MemoryRouter>
    );

    const reportButton = await screen.findByRole('button', { name: 'Prijavi grešku' });
    fireEvent.click(reportButton);

    fireEvent.change(await screen.findByRole('textbox', { name: /Opis problema/ }), {
      target: { value: 'Zvuk prekida poslije izjave.' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Vrijeme greške u sekundama/ }), {
      target: { value: '42,5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pošalji u montažu' }));

    await waitFor(() => {
      expect(axiosInstance.post).toHaveBeenCalledWith(
        '/corrections/video/video-archive-1/ensure',
        {
          note: 'Zvuk prekida poslije izjave.',
          timestamp: 42.5,
        }
      );
      expect(screen.getByText('Ispravka je poslana odgovornom montažeru.')).toBeInTheDocument();
    });
  });
});
