import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../theme';
import ReporterDashboard from './ReporterDashboard';

jest.mock('../components/jobs/ReporterActiveJobs', () => ({
  __esModule: true,
  default: ({ onCountChange }) => <><button onClick={() => onCountChange(0)}>Bez jobova</button><button onClick={() => onCountChange(5)}>Kasni odgovor jobova</button></>,
}));
jest.mock('../components/UploadComponent', () => ({
  __esModule: true,
  default: () => <input aria-label="Nacrt uploada" defaultValue="" />,
}));
jest.mock('../components/jobs/ReporterEventWorkspace', () => ({
  __esModule: true,
  default: () => <div>Priprema eventa</div>,
}));
jest.mock('../components/VideoList', () => ({ __esModule: true, default: () => <div>Arhiva klipova</div> }));

const show = () => render(<ThemeProvider theme={theme}><ReporterDashboard /></ThemeProvider>);

it('loads new-story controls on first opening and preserves a draft when collapsed', async () => {
  show();
  expect(screen.queryByLabelText('Nacrt uploada')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Reporter radni prostor');
  fireEvent.click(screen.getByRole('button', { name: /Novi prilog/ }));
  const draft = await screen.findByLabelText('Nacrt uploada');
  fireEvent.change(draft, { target: { value: 'Snimak za prilog' } });
  fireEvent.click(screen.getByRole('button', { name: /Novi prilog/ }));
  await waitFor(() => expect(screen.getByLabelText('Nacrt uploada')).toHaveValue('Snimak za prilog'));
  fireEvent.click(screen.getByRole('button', { name: /Novi prilog/ }));
  expect(screen.getByLabelText('Nacrt uploada')).toHaveValue('Snimak za prilog');
});

it('opens preparation automatically when the initial job count is zero', async () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Bez jobova' }));
  expect(await screen.findByLabelText('Nacrt uploada')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Novi prilog/ })).toHaveAttribute('aria-expanded', 'true');
});

it('late initial job count never collapses an explicitly opened draft', async () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: /Novi prilog/ }));
  const draft = await screen.findByLabelText('Nacrt uploada');
  fireEvent.change(draft, { target: { value: 'Nacrt prije odgovora servera' } });
  fireEvent.click(screen.getByRole('button', { name: 'Kasni odgovor jobova' }));
  expect(screen.getByRole('button', { name: /Novi prilog/ })).toHaveAttribute('aria-expanded', 'true');
  expect(draft).toHaveValue('Nacrt prije odgovora servera');
});
