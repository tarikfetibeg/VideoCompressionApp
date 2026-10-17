const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

module.exports = async (qa, f, test) => {
  const hls = qa.load('services/hlsPreviewService');
  const probe = await qa.api('Admin', '/api/admin/ffmpeg-capabilities/probe', 'POST', { preset: 'p5' });
  if (probe.status !== 200 || !probe.data.ok) {
    await test('BENCH-NVENC', 'Actual NVENC benchmark capability', async () => ({ status: 'blocked', reason: 'NVENC runtime probe did not pass' }));
    return;
  }
  const root = path.join(qa.runtime, 'benchmark'); fs.mkdirSync(root, { recursive: true });
  const variants = [
    { name: '720p25', size: '1280x720', fps: 25 },
    { name: '720p50', size: '1280x720', fps: 50 },
    { name: '4x3', size: '640x480', fps: 25 },
    { name: 'vertical', size: '360x640', fps: 30 },
    { name: 'prores10', size: '1280x720', fps: 25, codec: 'prores_ks', pix: 'yuv422p10le', ext: 'mov' },
  ];
  const filterList = spawnSync(qa.env.FFMPEG_PATH, ['-hide_banner', '-filters'], { encoding: 'utf8', windowsHide: true });
  const hasVmaf = /\blibvmaf\b/.test(String(filterList.stdout) + String(filterList.stderr));
  const rows = [];
  const duration = Number(process.env.QA_BENCHMARK_SECONDS || 60);
  assert.ok(Number.isInteger(duration) && duration >= 12 && duration <= 300, 'Benchmark duration must be 12..300 seconds');
  for (const variant of variants) {
    await test('BENCH-' + variant.name, 'CPU/NVENC three repeated HLS encodes: ' + variant.name, async () => {
      const input = path.join(root, variant.name + '.' + (variant.ext || 'mp4'));
      await qa.command(qa.env.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${variant.size}:rate=${variant.fps}`, '-f', 'lavfi', '-i', 'sine=sample_rate=48000', '-t', String(duration), '-c:v', variant.codec || 'libx264', '-pix_fmt', variant.pix || 'yuv420p', '-threads', '2', '-c:a', variant.ext === 'mov' ? 'pcm_s16le' : 'aac', input]);
      const timings = { libx264: [], h264_nvenc: [] }; const sizes = {}; const vmaf = {};
      for (let repeat = 0; repeat < 3; repeat += 1) {
        for (const encoder of repeat % 2 ? ['h264_nvenc', 'libx264'] : ['libx264', 'h264_nvenc']) {
          const folder = path.join(root, `${variant.name}-${encoder}-${repeat}`); fs.mkdirSync(folder, { recursive: true });
          const started = Date.now();
          await hls.runFfmpeg(hls.buildFfmpegArgs(input, folder, encoder, encoder === 'libx264' ? 'veryfast' : 'p5', variant.fps), { duration });
          hls.writeMasterPlaylist(folder); hls.validateHlsBuild(folder);
          timings[encoder].push(Date.now() - started); sizes[encoder] = hls.getFolderSize(folder);
          if (hasVmaf && repeat === 0) {
            const logName = `${variant.name}-${encoder}-vmaf.json`;
            const filter = `[0:v]scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS[ref];[1:v]setsar=1,setpts=PTS-STARTPTS[dist];[dist][ref]libvmaf=log_fmt=json:log_path=${logName}`;
            const result = spawnSync(qa.env.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-i', input, '-i', path.join(folder, '720p/index.m3u8'), '-filter_complex', filter, '-an', '-f', 'null', '-'], { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024 });
            assert.equal(result.status, 0, String(result.stderr).slice(-1000));
            vmaf[encoder] = JSON.parse(fs.readFileSync(path.join(root, logName), 'utf8')).pooled_metrics.vmaf.mean;
          }
        }
      }
      const row = { name: variant.name, duration, synthetic: true, repetitions: 3, fps: variant.fps, timings, sizes, vmaf, cpuMedian: median(timings.libx264), nvencMedian: median(timings.h264_nvenc) };
      row.reductionPercent = 100 * (row.cpuMedian - row.nvencMedian) / row.cpuMedian;
      rows.push(row);
      fs.writeFileSync(path.join(qa.output, 'media-benchmark.json'), JSON.stringify({ gpu: probe.data.gpuName, driver: probe.data.driverVersion, hasVmaf, concurrency: 'serial; no QA soak/performance phase in parallel', rows }, null, 2));
      return row;
    });
  }
  await test('BENCH-speed-target', 'NVENC median reduction target >=30% on five synthetic clips', async () => {
    const reduction = median(rows.map((row) => row.reductionPercent));
    assert.ok(reduction >= 30, `Median reduction ${reduction.toFixed(1)}% < 30%`);
    return { reductionPercent: reduction, syntheticOnly: true };
  });
  await test('BENCH-quality-target', '720p NVENC VMAF >=90 and within three points of CPU reference', async () => {
    if (!hasVmaf) return { status: 'blocked', reason: 'FFmpeg build has no libvmaf' };
    assert.ok(rows.every((row) => row.vmaf.h264_nvenc >= 90 && row.vmaf.libx264 - row.vmaf.h264_nvenc <= 3), JSON.stringify(rows.map((row) => ({ name: row.name, vmaf: row.vmaf }))));
  });
};
