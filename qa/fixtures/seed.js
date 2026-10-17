const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');

async function seed(qa) {
  const { models, load, command, password } = qa;
  const { paths, ensureStorageFolders } = load('utils/storagePaths');
  ensureStorageFolders();
  const users = {};
  for (const role of ['Reporter', 'Reporter2', 'Editor', 'Editor2', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin', 'Admin2']) {
    users[role] = await models.User.create({ username: `qa_${role.toLowerCase()}`, role: role.replace(/2$/, ''), password: await bcrypt.hash(password, 4) });
  }
  models.qaUsers = users;
  const categories = {};
  for (const [slug, name, hours] of [['prilog', 'Prilog', 8], ['insert', 'Insert', 4], ['promo', 'Promo', 48], ['spica', 'Špica', 72]]) {
    categories[slug] = await models.BroadcastContentType.create({ slug, name, jobSlaHours: hours });
  }
  const program = await models.BroadcastProgram.create({ name: 'QA dnevnik', defaultTime: '19:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
  const source = path.join(paths.raw, 'fixture-source.mp4');
  await command(qa.env.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', source]);
  const thumbnail = path.join(paths.thumbnails, 'fixture.jpg');
  await command(qa.env.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-frames:v', '1', '-vf', 'scale=320:180', thumbnail]);
  const off = path.join(paths.offAudio, 'fixture-off.wav');
  await command(qa.env.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=800', '-t', '2', off]);
  const videos = [];
  for (let index = 0; index < 100; index += 1) {
    const final = index % 2 === 1;
    const owner = index % 4 < 2 ? users.Reporter : users.Reporter2;
    const category = index % 3 === 0 ? categories.insert : categories.prilog;
    const videoPath = path.join(final ? paths.final : paths.compressed, `qa-${index}.mp4`);
    fs.copyFileSync(source, videoPath);
    const video = await models.Video.create({
      filename: `qa-${index}.mp4`, originalFilename: `Špica čćžšđ ${index} insert.mp4`, finalTitle: final ? `QA prilog ${index}` : undefined,
      filepath: videoPath, compressedPath: videoPath, thumbnailPath: thumbnail,
      uploader: owner._id, reporter: owner._id, editor: final ? users.Editor._id : null,
      status: final ? 'edited' : 'raw', processingStatus: 'completed',
      qcStatus: final ? 'passed' : 'pending', broadcastStatus: final ? 'approved_for_air' : 'not_ready',
      finalApprovalStatus: final ? 'approved' : 'not_required', contentType: category._id,
      finalCategory: category.slug, duration: 12, sizeOriginal: fs.statSync(videoPath).size,
      sizeCompressed: fs.statSync(videoPath).size, event: 'QA događaj', location: 'Sarajevo',
      tagDate: new Date(), uploadDate: new Date(Date.now() - index * 1000), keywords: ['insert', 'Špica'],
      program: final ? program._id : null,
    });
    videos.push(video);
  }
  // Force the legacy category path; direct update intentionally bypasses save hooks.
  await models.Video.updateOne({ _id: videos[5]._id }, { $unset: { contentType: 1, searchPrefixes: 1 }, $set: { finalCategory: 'video-report' } });
  const jobs = [];
  for (let index = 0; index < 30; index += 1) {
    jobs.push(await models.EditJob.create({
      title: `Špica čćžšđ QA job ${index}`, reporter: index % 2 ? users.Reporter2._id : users.Reporter._id,
      assignedEditor: index === 0 ? users.Editor._id : undefined, contentType: categories.prilog._id,
      program: program.name, status: index === 0 ? 'claimed' : 'submitted', workspaceState: 'active',
      segments: [{ video: videos[index * 2]._id, order: 0, startTime: 1, endTime: 8, type: 'broll' }],
      offFiles: index === 0 ? [{ originalName: 'Čitanje OFF.wav', filename: path.basename(off), storagePath: off, size: fs.statSync(off).size }] : [],
    }));
  }
  videos[1].sourceJob = jobs[0]._id;
  await videos[1].save();
  const show = await models.ShowDay.create({
    program: program._id, airDate: new Date(new Date().toISOString().slice(0, 10)), producers: [users.Producer._id],
    items: [1, 3].map((index, order) => ({ video: videos[index]._id, contentType: categories.prilog._id, title: `QA prilog ${index}`, order, status: 'ready', addedBy: users.Producer._id })),
  });
  await models.Feedback.create({ title: 'QA prijava', description: 'Provjera otvorenog inboxa.', submittedBy: users.Reporter._id, type: 'bug', area: 'archive', status: 'new', adminComment: 'Samo administracija' });
  for (const model of Object.values(models)) if (typeof model.createIndexes === 'function') await model.createIndexes();
  const hlsStarted = Date.now();
  await load('services/hlsPreviewService').buildHlsPreviewForVideo(videos[1], { force: true });
  await load('services/videoProcessingService').buildScrubPreviewForVideo(videos[1], { force: true });
  fs.writeFileSync(path.join(qa.output, 'fixture-metadata.json'), JSON.stringify({ count: videos.length, duration: 12, video: 'H264/yuv420p/25fps/720p', audio: 'AAC', hlsBuildMs: Date.now() - hlsStarted, queueMode: 'local' }, null, 2));
  return { users, categories, program, videos, jobs, show, source, off };
}

module.exports = { seed };
