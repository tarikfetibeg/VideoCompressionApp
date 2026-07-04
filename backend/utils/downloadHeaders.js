const path = require('path');

function normalizeFilename(value, fallback = 'download') {
  const rawValue = String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
  const normalized = rawValue || fallback;
  return path.basename(normalized.replace(/\\/g, '/')) || fallback;
}

function sanitizeAsciiFilename(value, fallback = 'download') {
  const filename = normalizeFilename(value, fallback);
  const parsed = path.parse(filename);
  const safeName = parsed.name
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/[\\/:*?"<>|;%]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();
  const safeExt = parsed.ext
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\/:*?"<>|;%\s]+/g, '')
    .slice(0, 16);
  const safeFilename = `${safeName || fallback}${safeExt || ''}`;

  return safeFilename.slice(0, 180);
}

function encodeRFC5987Value(value) {
  return encodeURIComponent(value)
    .replace(/['()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

function buildContentDisposition(filename, { type = 'attachment', fallback = 'download' } = {}) {
  const normalizedFilename = normalizeFilename(filename, fallback);
  const asciiFilename = sanitizeAsciiFilename(normalizedFilename, fallback)
    .replace(/\\/g, '_')
    .replace(/"/g, "'");
  const encodedFilename = encodeRFC5987Value(normalizedFilename);
  const dispositionType = type === 'inline' ? 'inline' : 'attachment';

  return `${dispositionType}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
}

function setDownloadHeaders(res, filename, options = {}) {
  res.setHeader('Content-Disposition', buildContentDisposition(filename, options));
}

module.exports = {
  buildContentDisposition,
  sanitizeAsciiFilename,
  setDownloadHeaders,
};
