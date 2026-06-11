const allowedVideoMimetypes = Object.freeze([
  'application/mxf',
  'video/3gpp',
  'video/3gpp2',
  'video/avi',
  'video/dv',
  'video/mp2t',
  'video/mp4',
  'video/mpeg',
  'video/mxf',
  'video/ogg',
  'video/quicktime',
  'video/webm',
  'video/x-dv',
  'video/x-flv',
  'video/x-m4v',
  'video/x-matroska',
  'video/x-mpeg',
  'video/x-ms-asf',
  'video/x-ms-wmv',
  'video/x-msvideo',
]);

const allowedVideoExtensions = Object.freeze([
  '.3g2',
  '.3gp',
  '.asf',
  '.avi',
  '.dv',
  '.flv',
  '.m2t',
  '.m2ts',
  '.m2v',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.mts',
  '.mxf',
  '.ogv',
  '.ts',
  '.vob',
  '.webm',
  '.wmv',
]);

const supportedVideoFormatSummary =
  'MP4, MOV/QuickTime, MXF, AVI, MKV, WebM, MPEG-TS/MTS/M2TS, MPEG/MPG, DV, WMV/ASF, VOB, OGV, FLV, 3GP';

module.exports = {
  allowedVideoExtensions,
  allowedVideoMimetypes,
  supportedVideoFormatSummary,
};
