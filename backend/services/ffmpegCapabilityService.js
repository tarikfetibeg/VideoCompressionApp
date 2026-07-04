const { spawn } = require('child_process');

function runCommand(command, args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: false, code: null, stdout, stderr, error: error.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
        error: code === 0 ? '' : stderr.trim() || `Command exited with code ${code}.`,
      });
    });
  });
}

function firstLine(value) {
  return String(value || '').split(/\r?\n/).find(Boolean) || '';
}

async function getFfmpegCapabilities() {
  const [version, encoders, hwaccels, filters, gpu] = await Promise.all([
    runCommand('ffmpeg', ['-hide_banner', '-version']),
    runCommand('ffmpeg', ['-hide_banner', '-encoders']),
    runCommand('ffmpeg', ['-hide_banner', '-hwaccels']),
    runCommand('ffmpeg', ['-hide_banner', '-filters']),
    runCommand('nvidia-smi', [
      '--query-gpu=name,driver_version,memory.total',
      '--format=csv,noheader,nounits',
    ]),
  ]);
  const encoderOutput = `${encoders.stdout}\n${encoders.stderr}`;
  const hwaccelOutput = `${hwaccels.stdout}\n${hwaccels.stderr}`;
  const filterOutput = `${filters.stdout}\n${filters.stderr}`;
  const gpuParts = firstLine(gpu.stdout).split(',').map((part) => part.trim());

  return {
    ffmpegAvailable: version.ok,
    ffmpegVersion: firstLine(version.stdout || version.stderr),
    encoders: {
      h264Nvenc: /\bh264_nvenc\b/.test(encoderOutput),
      hevcNvenc: /\bhevc_nvenc\b/.test(encoderOutput),
      av1Nvenc: /\bav1_nvenc\b/.test(encoderOutput),
    },
    hwaccels: {
      cuda: /(^|\s)cuda(\s|$)/m.test(hwaccelOutput),
    },
    filters: {
      scaleCuda: /\bscale_cuda\b/.test(filterOutput),
      scaleNpp: /\bscale_npp\b/.test(filterOutput),
      hwuploadCuda: /\bhwupload_cuda\b/.test(filterOutput),
    },
    gpu: {
      available: gpu.ok && Boolean(gpuParts[0]),
      name: gpuParts[0] || '',
      driverVersion: gpuParts[1] || '',
      memoryMiB: Number(gpuParts[2]) || null,
      error: gpu.ok ? '' : gpu.error,
    },
  };
}

async function runNvencProbe({ preset = 'p5' } = {}) {
  const startedAt = Date.now();
  const result = await runCommand('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', 'testsrc2=size=1280x720:rate=30',
    '-t', '2',
    '-an',
    '-c:v', 'h264_nvenc',
    '-preset', preset,
    '-tune', 'hq',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-f', 'null',
    '-',
  ], { timeoutMs: 30000 });
  const capabilities = await getFfmpegCapabilities();

  return {
    ok: result.ok,
    checkedAt: new Date(),
    processingMs: Date.now() - startedAt,
    preset,
    ffmpegVersion: capabilities.ffmpegVersion,
    gpuName: capabilities.gpu.name,
    driverVersion: capabilities.gpu.driverVersion,
    error: result.ok ? '' : result.error,
    capabilities,
  };
}

module.exports = {
  getFfmpegCapabilities,
  runCommand,
  runNvencProbe,
};
