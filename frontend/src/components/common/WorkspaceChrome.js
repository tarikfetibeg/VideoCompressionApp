import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import InboxIcon from '@mui/icons-material/Inbox';
import { formatStatusLabel, getStatusTone } from '../../utils/uiLabels';

export const WorkspaceHeader = ({
  title,
  subtitle,
  eyebrow,
  chips = [],
  actions = null,
  alert = null,
}) => (
  <Box sx={{ mb: 3 }}>
    {alert && (
      <Alert severity={alert.severity || 'info'} sx={{ mb: 2 }}>
        {alert.message}
      </Alert>
    )}
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={2}
      justifyContent="space-between"
      alignItems={{ xs: 'flex-start', md: 'center' }}
    >
      <Box sx={{ minWidth: 0 }}>
        {eyebrow && (
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>
            {eyebrow}
          </Typography>
        )}
        <Typography variant="h4" sx={{ fontWeight: 900, lineHeight: 1.12 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
        {chips.length > 0 && (
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
            {chips.map((chip) => (
              <Chip
                key={`${chip.label}-${chip.value || ''}`}
                label={chip.value ? `${chip.label}: ${chip.value}` : chip.label}
                color={chip.color || 'default'}
                variant={chip.variant || 'outlined'}
                size="small"
              />
            ))}
          </Stack>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {actions}
        </Stack>
      )}
    </Stack>
  </Box>
);

export const StatusChip = ({
  value,
  label,
  maps = [],
  tone,
  prefix = '',
  variant = 'filled',
  size = 'small',
}) => {
  const displayLabel = label || `${prefix}${formatStatusLabel(value, maps)}`;
  return (
    <Chip
      label={displayLabel}
      color={tone || getStatusTone(value)}
      variant={variant}
      size={size}
      sx={{ fontWeight: 750, textTransform: 'none' }}
    />
  );
};

export const KpiStrip = ({ items = [], dense = false }) => (
  <Box
    sx={{
      display: 'grid',
      gridTemplateColumns: {
        xs: 'repeat(2, minmax(0, 1fr))',
        sm: 'repeat(3, minmax(0, 1fr))',
        lg: `repeat(${Math.min(Math.max(items.length, 1), 6)}, minmax(0, 1fr))`,
      },
      gap: dense ? 1 : 1.5,
      mb: dense ? 2 : 3,
    }}
  >
    {items.map((item) => (
      <Paper
        key={item.label}
        variant="outlined"
        sx={{
          p: dense ? 1.25 : 2,
          borderRadius: 1.5,
          borderColor: item.active ? 'primary.main' : 'divider',
          bgcolor: item.active ? 'primary.light' : 'background.paper',
          minHeight: dense ? 74 : 90,
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
          {item.label}
        </Typography>
        <Typography variant={dense ? 'h6' : 'h5'} sx={{ fontWeight: 900, color: item.color || 'text.primary' }}>
          {item.value}
        </Typography>
        {item.note && (
          <Typography variant="caption" color="text.secondary">
            {item.note}
          </Typography>
        )}
      </Paper>
    ))}
  </Box>
);

export const FilterBar = ({ title = 'Filteri', summary, actions = null, children }) => (
  <Paper variant="outlined" sx={{ p: 2, mb: 2.5, borderRadius: 1.5 }}>
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      justifyContent="space-between"
      alignItems={{ xs: 'stretch', sm: 'center' }}
      sx={{ mb: children ? 2 : 0 }}
    >
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>
          {title}
        </Typography>
        {summary && (
          <Typography variant="caption" color="text.secondary">
            {summary}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {actions}
        </Stack>
      )}
    </Stack>
    {children}
  </Paper>
);

export const ActionToolbar = ({ selectedCount = 0, label = 'Odabrano', children }) => {
  if (!selectedCount) return null;

  return (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 2.5, borderRadius: 1.5, bgcolor: 'primary.light' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
        <Chip color="primary" label={`${label}: ${selectedCount}`} sx={{ fontWeight: 800 }} />
        <Divider flexItem orientation="vertical" sx={{ display: { xs: 'none', sm: 'block' } }} />
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {children}
        </Stack>
      </Stack>
    </Paper>
  );
};

export const EmptyState = ({
  title = 'Nema rezultata',
  description = 'Promijeni filtere ili osvjezi prikaz.',
  icon = <InboxIcon color="disabled" />,
  action = null,
}) => (
  <Paper variant="outlined" sx={{ p: 4, borderRadius: 1.5, textAlign: 'center' }}>
    <Box sx={{ mb: 1 }}>{icon}</Box>
    <Typography variant="h6" sx={{ fontWeight: 850 }}>
      {title}
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
      {description}
    </Typography>
    {action && <Box sx={{ mt: 2 }}>{action}</Box>}
  </Paper>
);

export const ConfirmDialog = ({
  open,
  title,
  description,
  confirmLabel = 'Potvrdi',
  cancelLabel = 'Odustani',
  confirmColor = 'primary',
  busy = false,
  onClose,
  onConfirm,
}) => (
  <Dialog open={open} onClose={busy ? undefined : onClose}>
    <DialogTitle>{title}</DialogTitle>
    <DialogContent>
      <DialogContentText>{description}</DialogContentText>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose} disabled={busy}>
        {cancelLabel}
      </Button>
      <Button variant="contained" color={confirmColor} onClick={onConfirm} disabled={busy}>
        {busy ? 'Radim...' : confirmLabel}
      </Button>
    </DialogActions>
  </Dialog>
);
