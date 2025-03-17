const Queue = require('bull');
const ffmpeg = require('fluent-ffmpeg');
const Video = require('../models/Video');
const path = require('path');
const FfmpegSettings = require('../models/FfmpegSettings');

const videoQueue = new Queue('video processing');

videoQueue.process(async (job, done) => {
  const { videoId } = job.data;
  const video = await Video.findById(videoId);
  const inputPath = path.join(process.cwd(), video.filepath);
  const outputFilename = `${video.filename}-compressed.mp4`;
  const outputPath = path.join('uploads', 'compressed', outputFilename);

  // Retrieve FFmpeg settings from the database (or use defaults)
  let settings = await FfmpegSettings.findOne({});
  if (!settings) {
    // Create default settings if not present
    settings = await FfmpegSettings.create({});
  }

  ffmpeg(inputPath)
    .videoCodec(settings.codec)
    .size(settings.resolution)
    .videoBitrate(settings.bitrate)
    .fps(settings.framerate)
    .save(outputPath)
    .on('end', async () => {
      video.filepath = outputPath;
      await video.save();
      done();
    })
    .on('error', (err) => {
      console.error('Compression error:', err);
      done(err);
    });
});

module.exports = videoQueue;
