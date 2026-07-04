import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import axiosInstance from '../../axiosConfig';
import theme from '../../theme';
import CorrectionQueue from './CorrectionQueue';

jest.mock('../../axiosConfig', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    patch: jest.fn(),
  },
}));

const correctionWorkspace = {
  items: [{
    _id: 'correction-1',
    status: 'reported',
    note: 'Audio prekida na kraju.',
    timestamp: 12.5,
    video: {
      _id: 'video-1',
      finalTitle: 'Dnevnik prilog',
    },
    assignedEditor: null,
    correctedBy: null,
  }],
  total: 1,
  summary: {
    open: 1,
    unassigned: 1,
    ready: 0,
  },
};

describe('CorrectionQueue', () => {
  beforeEach(() => {
    axiosInstance.get.mockReset();
    axiosInstance.patch.mockReset();
    axiosInstance.get.mockResolvedValue({ data: correctionWorkspace });
    axiosInstance.patch.mockResolvedValue({
      data: { message: 'Ispravka je preuzeta.' },
    });
  });

  it('shows all open corrections to an editor and allows claiming an unassigned item', async () => {
    render(
      <MemoryRouter>
        <ThemeProvider theme={theme}>
          <CorrectionQueue role="Editor" userId="editor-1" />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(axiosInstance.get).toHaveBeenCalledWith('/corrections/workspace', {
        params: { limit: 50, scope: 'all' },
      });
      expect(screen.getByText('Dnevnik prilog')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Preuzmi' }));

    await waitFor(() => {
      expect(axiosInstance.patch).toHaveBeenCalledWith('/corrections/correction-1/claim');
      expect(screen.getByText('Ispravka je preuzeta.')).toBeInTheDocument();
    });
  });
});
