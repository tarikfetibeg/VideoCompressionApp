const Queue = require('bull');
const ffmpeg = require('fluent-ffmpeg');
const Video = require('../models/Video');
const path = require('path');

const videoQueue = new Queue('video processing');

videoQueue.process(async (job, done) => {
  const { videoId } = job.data;
  const video = await Video.findById(videoId);
  const inputPath = path.join(process.cwd(), video.filepath);
  const outputFilename = `${video.filename}-compressed.mp4`;
  const outputPath = path.join('uploads', 'compressed', outputFilename);

  ffmpeg(inputPath)
    .outputOptions('-c:v libx264', '-crf 23', '-preset medium')
    .save(outputPath)
    .on('end', async () => {
      // Update video document with new filepath
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
