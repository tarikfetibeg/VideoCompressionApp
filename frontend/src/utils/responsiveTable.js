export const stackedTableSx = {
  '@media (max-width: 599.95px)': {
    display: 'block',
    position: 'relative',
    '& thead': { display: 'block', position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' },
    '& tbody': { display: 'block' },
    '& tbody tr': { display: 'block', borderBottom: '1px solid', borderColor: 'divider', py: 1 },
    '& tbody td': { display: 'block', width: 'auto !important', minWidth: '0 !important', borderBottom: 0, textAlign: 'left' },
    '& tbody td[data-label]::before': {
      content: 'attr(data-label)', display: 'block', fontSize: '0.75rem', color: 'text.secondary', mb: 0.5,
    },
  },
};
