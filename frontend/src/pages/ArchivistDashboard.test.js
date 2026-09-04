import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import axios from '../axiosConfig';
import theme from '../theme';
import { UserContext } from '../contexts/UserContext';
import ArchivistDashboard from './ArchivistDashboard';

vi.mock('../axiosConfig', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../components/VideoPlayer', () => ({
  __esModule: true,
  default: () => <div data-testid="video-player">Player</div>,
}));

vi.mock('../components/common/VideoThumbnailPreview', () => ({
  __esModule: true,
  default: ({ title }) => <div>{title} thumbnail</div>,
}));

const video = {
  _id: 'video-1',
  finalTitle: 'Dnevnik prilog',
  event: 'Dnevnik',
  tagDate: '2026-07-21T10:00:00.000Z',
  uploadDate: '2026-07-21T10:00:00.000Z',
  contentType: { _id: 'type-1', name: 'Prilog' },
  reporter: { _id: 'reporter-1', username: 'reporter' },
  editor: { _id: 'editor-1', username: 'montazer' },
  uploader: { _id: 'reporter-1', username: 'reporter' },
  keywords: ['dnevnik'],
  archiveReviewStatus: 'unreviewed',
  processingStatus: 'completed',
  broadcastStatus: 'approved_for_air',
  correctionStatus: 'none',
};

const workspace = {
  items: [video],
  total: 1,
  page: 1,
  limit: 40,
  totalPages: 1,
  summary: { mine: 0, unassigned: 1, needsMetadata: 0, inEdit: 0, readyForReview: 0 },
  facets: {},
};

describe('ArchivistDashboard', () => {
  beforeEach(() => {
    axios.get.mockReset();
    axios.patch.mockReset();
    axios.get.mockImplementation((url) => {
      if (url === '/archive/summary') return Promise.resolve({ data: { totalVideos: 1 } });
      if (url === '/broadcast/content-types') return Promise.resolve({ data: [{ _id: 'type-1', name: 'Prilog', active: true }] });
      if (url === '/archive/metadata-options') return Promise.resolve({ data: { archivists: [] } });
      if (url === '/archive/videos/workspace') return Promise.resolve({ data: workspace });
      if (url === '/corrections/video/video-1/context') {
        return Promise.resolve({ data: { active: null, history: [], permissions: { claimRequired: true } } });
      }
      return Promise.resolve({ data: {} });
    });
    axios.patch.mockResolvedValue({
      data: {
        message: 'Materijal je preuzet.',
        video: {
          ...video,
          archiveAssignedTo: { _id: 'archivist-1', username: 'arhivista' },
          archiveAssignedAt: '2026-07-21T10:00:00.000Z',
          archiveAssignmentExpiresAt: '2099-07-21T12:00:00.000Z',
        },
      },
    });
  });

  it('otključava arhivističke akcije tek nakon uspješnog claima', async () => {
    render(
      <MemoryRouter>
        <ThemeProvider theme={theme}>
          <UserContext.Provider value={{ user: { id: 'archivist-1', role: 'Archivist' } }}>
            <ArchivistDashboard />
          </UserContext.Provider>
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(await screen.findAllByText('Dnevnik prilog')).toHaveLength(2);
    const metadataBeforeClaim = screen.getByRole('button', { name: 'Uredi metadata' });
    expect(metadataBeforeClaim).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Preuzmi' }));

    await waitFor(() => {
      expect(axios.patch).toHaveBeenCalledWith('/archive/videos/video-1/claim');
      expect(screen.getByRole('button', { name: 'Uredi metadata' })).toBeEnabled();
      expect(screen.getByText(/Preuzeo: arhivista/)).toBeInTheDocument();
    });
  });
});
