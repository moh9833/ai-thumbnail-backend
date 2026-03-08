const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sheets = require('../config/googleSheets');
const aiService = require('../services/aiService');

// ─── Multer config (disk storage for image uploads) ───────────────────────────
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) cb(null, true);
    else cb(new Error('Only image files allowed'));
  },
});

// ─── Middleware: validate deviceId + check daily limit ────────────────────────
async function checkLimit(req, res, next) {
  const deviceId = req.body.deviceId || req.query.deviceId;
  if (!deviceId) {
    return res.status(400).json({ success: false, message: 'deviceId is required' });
  }

  const user = await sheets.findUserByDeviceId(deviceId).catch(() => null);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not registered' });
  }
  if (user.status !== 'Active') {
    return res.status(403).json({ success: false, message: 'Account suspended' });
  }

  // Daily limit check
  if (user.usageToday >= user.dailyLimit) {
    return res.status(429).json({
      success: false,
      message: `Daily limit reached (${user.dailyLimit}/day). Upgrade to Pro for more.`,
    });
  }

  req.user = user;
  next();
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

    if (!topic) {
      cleanup([referenceImagePath, faceImagePath]);
      return res.status(400).json({ success: false, message: 'topic is required' });
    }

    try {
      const result = await aiService.generateThumbnail({
        topic,
        prompt: prompt || '',
        referenceImagePath,
        faceImagePath,
      });

      // Increment usage
      await sheets.incrementUsage(deviceId);

      cleanup([referenceImagePath, faceImagePath]);
      return res.json({
        success: true,
        message: 'Thumbnail generated',
        data: { ...result, topic },
      });

    } catch (err) {
      cleanup([referenceImagePath, faceImagePath]);
      console.error('generate-thumbnail error:', err);
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
    console.error('generate-seo error:', err);
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
    console.error('generate-tags error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Generation failed' });
  }
});

// ─── Cleanup temp files ───────────────────────────────────────────────────────
function cleanup(paths) {
  (paths || []).forEach(p => {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  });
}

module.exports = router;
