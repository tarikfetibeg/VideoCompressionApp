import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axios from '../../axiosConfig';
import ReporterEventWorkspace from './ReporterEventWorkspace';

jest.mock('../../axiosConfig', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('./BriefImportButton', () => () => null);

it('preserves job fields, OFF files and clip selection when the same event refreshes', async () => {
  const videos = [1, 2].map((id) => ({ _id: String(id), event: 'QA event', uploadDate: new Date().toISOString(), originalFilename: `clip-${id}.mp4`, processingStatus: 'completed' }));
  let reads = 0;
  let resolveRefresh;
  axios.get.mockImplementation((url) => {
    if (url === '/videos' && ++reads > 1) return new Promise((resolve) => { resolveRefresh = resolve; });
    return Promise.resolve({ data: url === '/videos' ? videos : url === '/broadcast/content-types' ? [{ _id: 'type-1', name: 'Prilog', slug: 'prilog' }] : [] });
  });
  const show = (refreshToken) => <MemoryRouter><ReporterEventWorkspace refreshToken={refreshToken} /></MemoryRouter>;
  const view = render(show(0));
  const title = await screen.findByRole('textbox', { name: /Naziv joba/ });
  await waitFor(() => expect(title.value).toContain('QA event'));
  fireEvent.change(title, { target: { value: 'Moj nacrt' } });
  fireEvent.click(screen.getByRole('button', { name: 'Dodatne opcije' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Kratki brief' }), { target: { value: 'Moje instrukcije' } });
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  fireEvent.change(view.container.querySelector('input[type=file]'), { target: { files: [new File(['audio'], 'reporter-off.wav', { type: 'audio/wav' })] } });
  view.rerender(show(1));
  await waitFor(() => expect(axios.get.mock.calls.filter(([url]) => url === '/videos')).toHaveLength(2));
  await act(async () => resolveRefresh({ data: videos.map((item) => ({ ...item, processingProgress: 100 })) }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Osvježi' })).not.toBeDisabled());
  expect(screen.getByRole('textbox', { name: /Naziv joba/ })).toHaveValue('Moj nacrt');
  expect(screen.getByRole('textbox', { name: 'Kratki brief' })).toHaveValue('Moje instrukcije');
  expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked();
  expect(screen.getByText('reporter-off.wav')).toBeInTheDocument();
});
