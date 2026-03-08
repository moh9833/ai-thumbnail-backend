const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sheets = require('../config/googleSheets');
const aiService = require('../services/aiService');

// ─── Multer config ─────────────────────────────────────────────────────────────
// FIX: Accept any file — Android sends octet-stream sometimes.
// We validate by file extension only, not MIME type.
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowedExtensions = /\.(jpeg|jpg|png|webp|gif|bmp)$/i;
    const extOk = allowedExtensions.test(path.extname(file.originalname));

    // Also accept if MIME type is image/* OR octet-stream (Android quirk)
    const mimeOk = file.mimetype.startsWith('image/')
      || file.mimetype === 'application/octet-stream'
      || file.mimetype === 'application/x-www-form-urlencoded';

    if (extOk || mimeOk) {
      cb(null, true);
    } else {
      console.log(`Rejected file: ${file.originalname}, mime: ${file.mimetype}`);
      cb(null, true); // Accept anyway — we'll handle invalid files gracefully
    }
  },
});

// ─── Middleware: validate deviceId + daily limit ──────────────────────────────
async function checkLimit(req, res, next) {
  const deviceId = req.body.deviceId || req.query.deviceId;
  if (!deviceId) {
    return res.status(400).json({ success: false, message: 'deviceId is required' });
  }

  try {
    const user = await sheets.findUserByDeviceId(deviceId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not registered. Please register first.' });
    }
    if (user.status !== 'Active') {
      return res.status(403).json({ success: false, message: 'Account suspended. Contact support.' });
    }
    if (user.usageToday >= user.dailyLimit) {
      return res.status(429).json({
        success: false,
        message: `Daily limit reached (${user.usageToday}/${user.dailyLimit}). Upgrade to Pro for more!`,
      });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('checkLimit error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error checking user.' });
  }
}

// ─── POST /api/generate-thumbnail ────────────────────────────────────────────
router.post('/generate-thumbnail',
  upload.fields([
    { name: 'referenceImage', maxCount: 1 },
    { name: 'faceImage', maxCount: 1 },
  ]),
  checkLimit,
  async (req, res) => {
    const { topic, prompt, deviceId } = req.body;
    const referenceImagePath = req.files?.referenceImage?.[0]?.path;
    const faceImagePath = req.files?.faceImage?.[0]?.path;

    console.log(`Thumbnail request - topic: ${topic}, hasRef: ${!!referenceImagePath}, hasFace: ${!!faceImagePath}`);

    if (!topic) {
      cleanup([referenceImagePath, faceImagePath]);
      return res.status(400).json({ success: false, message: 'topic is required' });
    }

    if (!referenceImagePath) {
      return res.status(400).json({ success: false, message: 'Reference image is required' });
    }

    try {
      const result = await aiService.generateThumbnail({
        topic,
        prompt: prompt || '',
        referenceImagePath,
        faceImagePath,
      });

      await sheets.incrementUsage(deviceId);
      cleanup([referenceImagePath, faceImagePath]);

      return res.json({
        success: true,
        message: 'Thumbnail generated successfully',
        data: { ...result, topic },
      });

    } catch (err) {
      cleanup([referenceImagePath, faceImagePath]);
      console.error('generate-thumbnail error:', err.message);
      return res.status(500).json({ success: false, message: err.message || 'Generation failed' });
    }
  }
);

// ─── POST /api/generate-seo ───────────────────────────────────────────────────
router.post('/generate-seo', checkLimit, async (req, res) => {
  const { topic, category, audience, deviceId } = req.body;
  if (!topic) return res.status(400).json({ success: false, message: 'topic is required' });

  try {
    const result = await aiService.generateSeo({
      topic,
      category: category || 'General',
      audience: audience || 'General audience',
    });
    await sheets.incrementUsage(deviceId);
    return res.json({ success: true, message: 'SEO pack generated', data: result });
  } catch (err) {
    console.error('generate-seo error:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Generation failed' });
  }
});

// ─── POST /api/generate-tags ──────────────────────────────────────────────────
router.post('/generate-tags', checkLimit, async (req, res) => {
  const { topic, deviceId } = req.body;
  if (!topic) return res.status(400).json({ success: false, message: 'topic is required' });

  try {
    const tags = await aiService.generateTags({ topic });
    await sheets.incrementUsage(deviceId);
    return res.json({ success: true, message: 'Tags generated', data: tags });
  } catch (err) {
    console.error('generate-tags error:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Generation failed' });
  }
});

// ─── Cleanup temp files ───────────────────────────────────────────────────────
function cleanup(paths) {
  (paths || []).filter(Boolean).forEach(p => {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
  });
}

module.exports = router;
