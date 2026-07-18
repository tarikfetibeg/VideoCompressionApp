const express = require('express');
const authenticateToken = require('../../middleware/authenticateToken');
const Video = require('../../models/Video');
const { backfillLegacyVideoAssets, getMediaAccessOptions } = require('../../services/mediaLocatorService');

const router = express.Router();
router.use(authenticateToken);

router.get('/:videoId/access', async (req, res) => {
  try {
    const video = await Video.findById(req.params.videoId).select('_id hlsPreview previewPath compressedPath filepath');
    if (!video) return res.status(404).json({ message: 'Video nije pronađen.' });
    await backfillLegacyVideoAssets(video);
    const options = await getMediaAccessOptions(video._id, req.query.site || 'primary');
    return res.json({
      videoId: video._id,
      preferred: options.preferred,
      local: options.local,
      cloud: options.cloud,
      legacyTicketEndpoint: '/api/media/tickets',
      remoteOriginalAllowed: false,
    });
  } catch (error) {
    console.error('Media location failed:', error);
    return res.status(500).json({ message: 'Media lokacija trenutno nije dostupna.' });
  }
});

module.exports = router;
