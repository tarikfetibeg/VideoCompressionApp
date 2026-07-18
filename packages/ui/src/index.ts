export const roleDensity = {
  Reporter: 'guided',
  Editor: 'compact',
  VideoEditor: 'compact',
  Producer: 'compact',
  Realizator: 'control-room',
  Archivist: 'compact',
  Admin: 'dense',
} as const;

export const desktopLayout = {
  minWidth: 1024,
  minHeight: 700,
  navigationWidth: 248,
  compactNavigationWidth: 72,
  contentMaxWidth: 1680,
} as const;
