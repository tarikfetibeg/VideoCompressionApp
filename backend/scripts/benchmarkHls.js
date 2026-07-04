const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  buildFfmpegArgs,
  getFolderSize,
  runFfmpeg,
  validateHlsBuild,
  writeMasterPlaylist,
} = require('../services/hlsPreviewService');
const { getFfmpegCapabilities } = require('../services/ffmpegCapabilityService');
const { probeFile } = require('../services/mediaCompatibilityService');

function parseArgs(argv) {
  const options = {};
  for (const argument of argv) {
    if (!argument.startsWith('--')) continue;
    const [key, ...valueParts] = argument.slice(2).split('=');
    options[key] = valueParts.length ? valueParts.join('=') : true;
  }
  return options;
}

function parseFrameRate(value) {
  const [numerator, denominator] = String(value || '').split('/').map(Number);
  if (!numerator || !denominator) return 30;
  return Math.max(Math.min(numerator / denominator, 120), 1);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** unitIndex)).toFixed(2)} ${units[unitIndex]}`;
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk.toString()}`.slice(-32000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-16000);
    });
    child.on('error', (error) => resolve({
      ok: false,
      stdout,
      stderr,
      error: error.message,
    }));
    child.on('close', (code) => resolve({
      ok: code === 0,
      stdout,
      stderr,
      error: code === 0 ? '' : stderr.trim() || `Command exited with code ${code}.`,
    }));
  });
}

async function calculateVmaf(referencePath, renditionPath, outputPath) {
  const filter = [
    '[0:v:0]scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2',
    'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,setpts=PTS-STARTPTS[ref]',
    '[1:v:0]setsar=1,setpts=PTS-STARTPTS[dist]',
    `[dist][ref]libvmaf=log_fmt=json:log_path=${outputPath.replace(/\\/g, '/').replace(/:/g, '\\:')}`,
  ].join(';');
  const result = await runCommand('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', referencePath,
    '-i', renditionPath,
    '-filter_complex', filter,
    '-an',
    '-f', 'null',
    '-',
  ]);
  if (!result.ok || !fs.existsSync(outputPath)) {
    return { available: false, error: result.error || 'VMAF log was not created.' };
  }
  const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  return {
    available: true,
    score: Number(report?.pooled_metrics?.vmaf?.mean),
  };
}

async function runVariant({ inputPath, outputRoot, encoder, preset, frameRate, duration }) {
  const folder = path.join(outputRoot, encoder);
  fs.mkdirSync(folder, { recursive: true });
  const startedAt = Date.now();
  await runFfmpeg(
    buildFfmpegArgs(inputPath, folder, encoder, preset, frameRate),
    { duration }
  );
  writeMasterPlaylist(folder);
  validateHlsBuild(folder);
  return {
    encoder,
    preset,
    folder,
    elapsedMs: Date.now() - startedAt,
    size: getFolderSize(folder),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = options.input ? path.resolve(String(options.input)) : null;
  if (!inputPath || !fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
    throw new Error('Usage: npm run hls:benchmark -- --input=<local-video> [--keep]');
  }

  const capabilities = await getFfmpegCapabilities();
  const probe = await probeFile(inputPath);
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hls-benchmark-'));
  const results = [];

  console.log(`Input: ${inputPath}`);
  console.log(`Duration: ${probe.duration || 'unknown'} s`);
  console.log(`FFmpeg: ${capabilities.ffmpegVersion || 'not found'}`);
  console.log(`GPU: ${capabilities.gpu.name || 'not detected'}`);
  console.log(`Output: ${outputRoot}`);

  results.push(await runVariant({
    inputPath,
    outputRoot,
    encoder: 'libx264',
    preset: 'veryfast',
    frameRate: parseFrameRate(probe.frameRate),
    duration: probe.duration,
  }));

  if (capabilities.encoders.h264Nvenc && capabilities.gpu.available) {
    results.push(await runVariant({
      inputPath,
      outputRoot,
      encoder: 'h264_nvenc',
      preset: String(options.preset || 'p5'),
      frameRate: parseFrameRate(probe.frameRate),
      duration: probe.duration,
    }));
  } else {
    console.warn('NVENC benchmark skipped: encoder or NVIDIA GPU is unavailable.');
  }

  const filterList = await runCommand('ffmpeg', ['-hide_banner', '-filters']);
  const hasVmaf = filterList.ok && /\blibvmaf\b/.test(`${filterList.stdout}\n${filterList.stderr}`);
  if (hasVmaf) {
    for (const result of results) {
      const vmafPath = path.join(outputRoot, `${result.encoder}-vmaf.json`);
      result.vmaf = await calculateVmaf(
        inputPath,
        path.join(result.folder, '720p', 'index.m3u8'),
        vmafPath
      );
    }
  } else {
    console.warn('VMAF skipped: this FFmpeg build does not include the libvmaf filter.');
  }

  console.table(results.map((result) => ({
    encoder: result.encoder,
    preset: result.preset,
    seconds: (result.elapsedMs / 1000).toFixed(2),
    size: formatBytes(result.size),
    vmaf: result.vmaf?.available ? result.vmaf.score.toFixed(2) : 'unavailable',
  })));

  if (results.length === 2) {
    const cpu = results.find((result) => result.encoder === 'libx264');
    const nvenc = results.find((result) => result.encoder === 'h264_nvenc');
    const speedup = ((cpu.elapsedMs - nvenc.elapsedMs) / cpu.elapsedMs) * 100;
    console.log(`NVENC time reduction: ${speedup.toFixed(1)}%`);
  }

  if (options.keep !== true && options.keep !== 'true') {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  } else {
    console.log(`Benchmark files retained at: ${outputRoot}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
