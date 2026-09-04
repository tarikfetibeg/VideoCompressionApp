const { spawn } = require('child_process');
const Video = require('../models/Video');
const { probeFile, resolveExistingPath } = require('./mediaCompatibilityService');
const { recordOperation } = require('./runtimeMetricsService');

const TECHNICAL_QC_PROFILE_VERSION = 1;
const DEFAULT_MAX_SECONDS = 5 * 60;

function boundedAnalysisSeconds(value) {
  return Math.min(
    Math.max(Number(value || process.env.TECHNICAL_QC_MAX_SECONDS || DEFAULT_MAX_SECONDS), 30),
    60 * 60
  );
}

function sourceForVideo(video) {
  const candidates = [
    ['mp4_preview', video.previewPath],
    ['compressed', video.compressedPath],
    ['master', video.filepath],
    ['raw', video.rawPath],
  ];
  for (const [kind, candidate] of candidates) {
    const resolved = resolveExistingPath(candidate);
    if (resolved) return { kind, path: resolved };
  }
  return { kind: 'none', path: null };
}

function sumDurations(items) {
  return Math.round(items.reduce((total, item) => total + (Number(item.duration) || 0), 0) * 1000) / 1000;
}

function parseIntervals(stderr, type) {
  const patterns = {
    black: /black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g,
    silence: /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g,
    freeze: /freeze_duration:\s*([\d.]+)/g,
  };
  const items = [];
  let match;
  const pattern = patterns[type];
  while ((match = pattern.exec(stderr)) !== null) {
    if (type === 'black') {
      items.push({ start: Number(match[1]), end: Number(match[2]), duration: Number(match[3]) });
    } else if (type === 'silence') {
      const end = Number(match[1]);
      const duration = Number(match[2]);
      items.push({ start: Math.max(end - duration, 0), end, duration });
    } else {
      items.push({ start: null, end: null, duration: Number(match[1]) });
    }
  }
  return items.filter((item) => Number.isFinite(item.duration) && item.duration > 0);
}

function lastNumericMatch(value, pattern) {
  let result = null;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) result = parsed;
  }
  return result;
}

function parseTechnicalQcOutput(stderr, probe, analyzedDuration) {
  const black = parseIntervals(stderr, 'black');
  const freeze = parseIntervals(stderr, 'freeze');
  const silence = parseIntervals(stderr, 'silence');
  const integratedLufs = lastNumericMatch(stderr, /\bI:\s*(-?[\d.]+)\s+LUFS/g);
  const truePeakDbfs = lastNumericMatch(stderr, /\bPeak:\s*(-?[\d.]+)\s+dBFS/g);
  const findings = [];

  if (sumDurations(black) >= 1) {
    findings.push({
      code: 'black_frames',
      severity: 'warning',
      label: 'Detektovan crni kadar',
      detail: `${black.length} intervala / ${sumDurations(black).toFixed(1)} s`,
    });
  }
  if (sumDurations(freeze) >= 2) {
    findings.push({
      code: 'frozen_frames',
      severity: 'warning',
      label: 'Detektovan zamrznut kadar',
      detail: `${freeze.length} intervala / ${sumDurations(freeze).toFixed(1)} s`,
    });
  }
  if (probe.hasAudio && sumDurations(silence) >= 3) {
    findings.push({
      code: 'long_silence',
      severity: 'warning',
      label: 'Detektovana duža tišina',
      detail: `${silence.length} intervala / ${sumDurations(silence).toFixed(1)} s`,
    });
  }
  if (!probe.hasAudio) {
    findings.push({
      code: 'no_audio',
      severity: 'info',
      label: 'Video nema audio zapis',
      detail: 'Provjeriti da li je to očekivano za ovu vrstu materijala.',
    });
  }
  if (integratedLufs != null && (integratedLufs < -27 || integratedLufs > -18)) {
    findings.push({
      code: 'loudness_outside_review_range',
      severity: 'warning',
      label: 'Glasnoća traži provjeru',
      detail: `${integratedLufs.toFixed(1)} LUFS`,
    });
  }
  if (truePeakDbfs != null && truePeakDbfs > -1) {
    findings.push({
      code: 'true_peak_high',
      severity: 'warning',
      label: 'Visok audio peak',
      detail: `${truePeakDbfs.toFixed(1)} dBFS`,
    });
  }
  if (probe.duration && analyzedDuration < probe.duration - 0.5) {
    findings.push({
      code: 'partial_analysis',
      severity: 'info',
      label: 'Analiziran je početni dio klipa',
      detail: `${Math.round(analyzedDuration)} od ${Math.round(probe.duration)} sekundi`,
    });
  }

  return {
    findings,
    metrics: {
      blackSeconds: sumDurations(black),
      freezeSeconds: sumDurations(freeze),
      silenceSeconds: sumDurations(silence),
      integratedLufs,
      truePeakDbfs,
      blackIntervals: black.slice(0, 50),
      silenceIntervals: silence.slice(0, 50),
    },
  };
}

function runFfmpegAnalysis(inputPath, { hasAudio, duration }) {
  const args = [
    '-hide_banner',
    '-nostats',
    '-threads', '1',
    '-filter_threads', '1',
    '-i', inputPath,
    '-t', String(duration),
    '-vf', 'blackdetect=d=1:pix_th=0.10,freezedetect=n=-60dB:d=2',
  ];
  if (hasAudio) {
    args.push('-af', 'silencedetect=n=-45dB:d=3,ebur128=peak=true');
  }
  args.push('-f', 'null', '-');

  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { windowsHide: true, shell: false });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-2_000_000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(stderr);
      const error = new Error(stderr.slice(-4000).trim() || `FFmpeg technical QC exited with code ${code}.`);
      error.code = 'TECHNICAL_QC_FFMPEG_FAILED';
      return reject(error);
    });
  });
}

async function runTechnicalQc(videoId, options = {}) {
  const startedAtMs = Date.now();
  const video = await Video.findById(videoId);
  if (!video) throw new Error('Video nije pronađen.');
  const source = sourceForVideo(video);
  if (!source.path) throw new Error('Nema dostupnog preview/master fajla za tehnički QC.');

  video.technicalQc = {
    ...(video.technicalQc?.toObject?.() || video.technicalQc || {}),
    status: 'processing',
    profileVersion: TECHNICAL_QC_PROFILE_VERSION,
    sourceKind: source.kind,
    requestedBy: options.requestedBy || video.technicalQc?.requestedBy || null,
    startedAt: new Date(),
    completedAt: null,
    error: '',
  };
  await video.save();

  try {
    const probe = await probeFile(source.path);
    const maximumSeconds = boundedAnalysisSeconds(options.maxSeconds);
    const analyzedDuration = Math.max(Math.min(Number(probe.duration) || maximumSeconds, maximumSeconds), 1);
    const stderr = await runFfmpegAnalysis(source.path, {
      hasAudio: probe.hasAudio,
      duration: analyzedDuration,
    });
    const parsed = parseTechnicalQcOutput(stderr, probe, analyzedDuration);
    const hasWarnings = parsed.findings.some((finding) => finding.severity === 'warning');
    const processingMs = Date.now() - startedAtMs;
    video.technicalQc = {
      status: hasWarnings ? 'warning' : 'passed',
      profileVersion: TECHNICAL_QC_PROFILE_VERSION,
      sourceKind: source.kind,
      requestedBy: options.requestedBy || video.technicalQc?.requestedBy || null,
      startedAt: video.technicalQc?.startedAt || new Date(startedAtMs),
      completedAt: new Date(),
      analyzedDuration,
      mediaDuration: probe.duration,
      processingMs,
      findings: parsed.findings,
      metrics: parsed.metrics,
      error: '',
    };
    await video.save();
    recordOperation('technical_qc', processingMs, 'completed');
    return video.technicalQc;
  } catch (error) {
    const processingMs = Date.now() - startedAtMs;
    video.technicalQc = {
      ...(video.technicalQc?.toObject?.() || video.technicalQc || {}),
      status: 'failed',
      completedAt: new Date(),
      processingMs,
      error: String(error.message || error).slice(0, 4000),
    };
    await video.save();
    recordOperation('technical_qc', processingMs, 'failed');
    throw error;
  }
}

module.exports = {
  TECHNICAL_QC_PROFILE_VERSION,
  boundedAnalysisSeconds,
  parseTechnicalQcOutput,
  runTechnicalQc,
  sourceForVideo,
};
