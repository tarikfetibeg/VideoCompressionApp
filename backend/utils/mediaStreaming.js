const fs = require('fs');

function parseRangeHeader(rangeHeader, totalSize) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader || '').trim());
  if (!match) return null;

  let start;
  let end;
  if (!match[1] && match[2]) {
    const suffixLength = Math.min(parseInt(match[2], 10), totalSize);
    start = Math.max(totalSize - suffixLength, 0);
    end = totalSize - 1;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
  }

  if (
    !Number.isFinite(start)
    || !Number.isFinite(end)
    || start < 0
    || end < start
    || start >= totalSize
  ) {
    return null;
  }

  return { start, end: Math.min(end, totalSize - 1) };
}

function sendFileWithRange(req, res, filePath, contentType = 'video/mp4') {
  const stat = fs.statSync(filePath);
  const totalSize = stat.size;
  const rangeHeader = req.headers.range;
  const commonHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType,
    'Cache-Control': 'private, max-age=3600',
    'Last-Modified': stat.mtime.toUTCString(),
  };

  if (!rangeHeader) {
    res.writeHead(200, {
      ...commonHeaders,
      'Content-Length': totalSize,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const range = parseRangeHeader(rangeHeader, totalSize);
  if (!range) {
    res.writeHead(416, {
      ...commonHeaders,
      'Content-Range': `bytes */${totalSize}`,
    });
    res.end();
    return;
  }

  const chunkSize = range.end - range.start + 1;
  res.writeHead(206, {
    ...commonHeaders,
    'Content-Range': `bytes ${range.start}-${range.end}/${totalSize}`,
    'Content-Length': chunkSize,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath, range).pipe(res);
}

module.exports = {
  parseRangeHeader,
  sendFileWithRange,
};
