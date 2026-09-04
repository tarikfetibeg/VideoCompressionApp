import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import axios from '../../axiosConfig';
import theme from '../../theme';
import { VideoIssueComposer } from './VideoCorrectionPanel';

vi.mock('../../axiosConfig', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('VideoIssueComposer', () => {
  beforeEach(() => {
    axios.get.mockReset();
    axios.post.mockReset();
    axios.get.mockResolvedValue({ data: [{ _id: 'editor-1', username: 'montazer' }] });
    axios.post.mockResolvedValue({ data: { message: 'Greške su poslane.' } });
  });

  it('šalje grešku sa trenutnim playheadom u grupisani correction endpoint', async () => {
    const onSubmitted = vi.fn();
    const renderComposer = (playheadSeconds) => (
      <ThemeProvider theme={theme}>
        <VideoIssueComposer
          open
          video={{ _id: 'video-1', finalTitle: 'Prilog' }}
          playheadSeconds={playheadSeconds}
          correctionContext={{ suggestedEditorId: 'editor-1' }}
          onClose={vi.fn()}
          onSubmitted={onSubmitted}
        />
      </ThemeProvider>
    );
    const { rerender } = render(renderComposer(12.5));

    await waitFor(() => expect(axios.get).toHaveBeenCalledWith('/corrections/editors'));
    fireEvent.change(screen.getByLabelText('Opis problema'), {
      target: { value: 'Crna slika na početku kadra.' },
    });
    rerender(renderComposer(20));
    fireEvent.click(screen.getByRole('button', { name: 'Pošalji montažeru' }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith('/corrections/video/video-1/issues', {
        assignedEditorId: 'editor-1',
        issues: [{
          type: 'picture',
          severity: 'major',
          startSeconds: 12.5,
          endSeconds: null,
          note: 'Crna slika na početku kadra.',
        }],
      });
      expect(onSubmitted).toHaveBeenCalledWith({ message: 'Greške su poslane.' });
    });
  });
});
