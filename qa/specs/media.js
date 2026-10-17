const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

module.exports = async (qa, f, test) => {
  const { paths } = qa.load('utils/storagePaths');
  const compatibility = qa.load('services/mediaCompatibilityService');
  const maintenance = qa.load('services/previewMaintenanceService');
  const profile = qa.load('services/mediaProfileService');
  const hls = qa.load('services/hlsPreviewService');
  const fixtures = [];
  for (const size of ['640x360', '640x480', '360x640']) for (const fps of [25, 30, 50]) for (const audio of [true, false]) fixtures.push({ name: `h264-${size}-${fps}-${audio ? 'aac' : 'silent'}`, size, fps, audio, codec: 'libx264', pix: 'yuv420p', ext: 'mp4', compatible: true });
  fixtures.push(
    { name: 'hevc8', size: '640x360', fps: 25, audio: true, codec: 'libx265', pix: 'yuv420p', ext: 'mp4', compatible: false },
    { name: 'hevc10', size: '640x360', fps: 25, audio: true, codec: 'libx265', pix: 'yuv420p10le', ext: 'mp4', compatible: false },
    { name: 'h26410', size: '640x360', fps: 25, audio: true, codec: 'libx264', pix: 'yuv420p10le', ext: 'mp4', compatible: false },
    { name: 'mov-pcm', size: '640x360', fps: 25, audio: true, codec: 'libx264', pix: 'yuv420p', ext: 'mov', audioCodec: 'pcm_s16le', compatible: false },
    { name: 'prores', size: '640x360', fps: 25, audio: true, codec: 'prores_ks', pix: 'yuv422p10le', ext: 'mov', audioCodec: 'pcm_s16le', compatible: false },
    { name: 'mxf', size: '720x576', fps: 25, audio: true, codec: 'mpeg2video', pix: 'yuv422p', ext: 'mxf', audioCodec: 'pcm_s16le', compatible: false },
  );
  for (const fixture of fixtures) {
    await test(`MEDIA-${fixture.name}`, 'Generate and FFprobe compatibility of ' + fixture.name, async () => {
      fixture.file = path.join(paths.raw, `${fixture.name}.${fixture.ext}`);
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${fixture.size}:rate=${fixture.fps}`];
      if (fixture.audio) args.push('-f', 'lavfi', '-i', 'sine=sample_rate=48000');
      args.push('-t', '2', '-c:v', fixture.codec, '-pix_fmt', fixture.pix, '-threads', '2');
      if (['libx264', 'libx265'].includes(fixture.codec)) args.push('-preset', 'ultrafast');
      if (fixture.codec === 'libx265') args.push('-x265-params', 'pools=2:log-level=error');
      if (fixture.audio) args.push('-c:a', fixture.audioCodec || 'aac', '-ac', '2', '-ar', '48000');
      args.push(fixture.file);
      await qa.command(qa.env.FFMPEG_PATH, args);
      const result = await compatibility.inspectBrowserCompatibility(fixture.file);
      assert.equal(result.compatible, fixture.compatible);
      fixture.probe = result.probe;
      return { expected: fixture.compatible, reason: result.reason, width: result.probe.width, height: result.probe.height, fps: result.probe.frameRate };
    });
  }
  const candidates = [fixtures[0], fixtures[4], fixtures[8], fixtures.find((item) => item.name === 'hevc10'), fixtures.find((item) => item.name === 'prores')];
  for (const fixture of candidates) {
    await test('MEDIA-rebuild-' + fixture.name, 'Real MP4/thumbnail/scrub/HLS rebuild: ' + fixture.name, async () => {
      assert.ok(fixture.file && fs.existsSync(fixture.file));
      const video = await qa.models.Video.create({ filename: path.basename(fixture.file), originalFilename: path.basename(fixture.file), filepath: fixture.file, compressedPath: fixture.file, uploader: f.users.Admin._id, processingStatus: 'completed', status: 'edited', duration: 2 });
      const settings = { ...await profile.getMediaSettings(), scrubFrameCount: 6, thumbnailResolution: '480x270', mp4PreviewResolution: '854x480' };
      await maintenance.rebuildMp4Preview(video, settings);
      assert.equal((await compatibility.inspectBrowserCompatibility(video.previewPath)).compatible, true);
      await maintenance.rebuildThumbnail(video, settings);
      const image = await compatibility.probeFile(video.thumbnailPath);
      assert.equal(image.width, 480); assert.equal(image.height, 270);
      await maintenance.rebuildScrubPreview(video, settings);
      assert.equal(video.scrubPreview.frameCount, 6);
      await hls.buildHlsPreviewForVideo(video, { force: true });
      hls.validateHlsBuild(hls.getActiveHlsFolder(video));
      const durations = ['720p', '480p'].map((name) => fs.readFileSync(path.join(hls.getActiveHlsFolder(video), name, 'index.m3u8'), 'utf8').match(/#EXTINF:([\d.]+)/g).map((line) => Number(line.slice(8))));
      assert.equal(durations[0].length, durations[1].length);
      assert.ok(durations[0].every((duration, i) => Math.abs(duration - durations[1][i]) <= 0.05));
      fixture.video = video;
      return { dimensions: settings.mp4PreviewResolution, scrubCount: 6, hlsAligned: true };
    });
  }
  await test('MEDIA-preserve-on-failure', 'Failed MP4 and HLS rebuild preserve the old valid files', async () => {
    const video = candidates[0].video; assert.ok(video);
    const oldMp4 = crypto.createHash('sha256').update(fs.readFileSync(video.previewPath)).digest('hex');
    const oldHls = hls.getActiveHlsFolder(video);
    const corrupt = path.join(paths.raw, 'corrupt.mp4'); fs.writeFileSync(corrupt, 'not a media file');
    video.filepath = corrupt; video.compressedPath = corrupt;
    await assert.rejects(maintenance.rebuildMp4Preview(video, await profile.getMediaSettings()));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(video.previewPath)).digest('hex'), oldMp4);
    await assert.rejects(hls.buildHlsPreviewForVideo(video, { force: true }));
    assert.equal(hls.getActiveHlsFolder(video), oldHls); assert.equal(video.hlsPreview.status, 'ready');
    assert.equal((await compatibility.inspectBrowserCompatibility(path.join(paths.raw, 'absent.mp4'))).reason, 'file_missing');
  });
  await test('F23-real-NVENC', 'Actual RTX NVENC capability probe and HLS output', async () => {
    const probe = await qa.api('Admin', '/api/admin/ffmpeg-capabilities/probe', 'POST', { preset: 'p5' });
    if (probe.status === 422) return { status: 'blocked', reason: 'Actual NVENC probe failed', error: probe.data.error };
    assert.equal(probe.status, 200); assert.equal(probe.data.ok, true);
    const update = await qa.api('Admin', '/api/admin/ffmpeg-settings', 'PUT', { hlsEncoder: 'h264_nvenc' }); assert.equal(update.status, 200);
    const video = await qa.models.Video.findById(f.videos[1]._id);
    const result = await hls.buildHlsPreviewForVideo(video, { force: true });
    assert.equal(result.encoderUsed, 'h264_nvenc'); assert.equal(result.cpuFallbackUsed, false);
    fs.writeFileSync(path.join(qa.output, 'nvenc.json'), JSON.stringify({ gpu: probe.data.gpuName, driver: probe.data.driverVersion, ffmpeg: probe.data.ffmpegVersion, ...result }, null, 2));
    return { encoder: result.encoderUsed, ms: result.processingMs, gpu: probe.data.gpuName };
  });
  await test('F23-NVENC-fallback', 'Injected GPU initialization failure retries once with actual libx264', async () => {
    await qa.models.FfmpegSettings.updateOne({}, { $set: { hlsEncoder: 'h264_nvenc', hlsCpuFallback: true } });
    const file = require.resolve(path.join(qa.runtime, 'backend/services/hlsPreviewService'));
    const originalSpawn = childProcess.spawn; let injected = 0;
    childProcess.spawn = (command, args, options) => {
      if (args.includes('h264_nvenc') && injected++ === 0) {
        const process = new EventEmitter(); process.stdout = new EventEmitter(); process.stderr = new EventEmitter(); process.kill = () => {};
        setImmediate(() => { process.stderr.emit('data', Buffer.from('Cannot load nvcuda.dll')); process.emit('close', 1); });
        return process;
      }
      return originalSpawn(command, args, options);
    };
    delete require.cache[file]; const injectedHls = require(file); childProcess.spawn = originalSpawn;
    try {
      const result = await injectedHls.buildHlsPreviewForVideo(await qa.models.Video.findById(f.videos[1]._id), { force: true });
      assert.equal(result.encoderUsed, 'libx264'); assert.equal(result.cpuFallbackUsed, true); assert.equal(injected, 1);
    } finally { childProcess.spawn = originalSpawn; await qa.models.FfmpegSettings.updateOne({}, { $set: { hlsEncoder: 'libx264' } }); }
  });
  fs.writeFileSync(path.join(qa.output, 'media-fixtures.json'), JSON.stringify(fixtures.map(({ file, video, ...item }) => ({ ...item, exists: Boolean(file && fs.existsSync(file)) })), null, 2));
};
