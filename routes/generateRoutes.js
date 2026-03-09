const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const sheets = require('../config/googleSheets');
const aiService = require('../services/aiService');

// ─── Multer ───────────────────────────────────────────────────────────────────
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, true),
});

// ─── Middleware: verify user + enforce daily limit ─────────────────────────────
async function checkLimit(req, res, next) {
  const deviceId = req.body.deviceId || req.query.deviceId;
  if (!deviceId) {
    return res.status(400).json({ success: false, message: 'deviceId is required' });
  }
  try {
    const user = await sheets.findUserByDeviceId(deviceId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not registered. Please restart the app.' });
    }
    if (user.status !== 'Active') {
      return res.status(403).json({ success: false, message: 'Account suspended. Contact support on WhatsApp.' });
    }
    if (user.usageToday >= user.dailyLimit) {
      return res.status(429).json({
        success: false,
        limitReached: true,
        message: `Daily limit reached! You have used ${user.usageToday}/${user.dailyLimit} generations today.\n\n⚡ Upgrade to Premium for unlimited generations!\nWhatsApp: +919833144776`,
      });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('checkLimit error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
}

// ─── POST /api/generate-thumbnail ─────────────────────────────────────────────
router.post('/generate-thumbnail',
  upload.fields([
    { name: 'referenceImage', maxCount: 1 },
    { name: 'faceImage', maxCount: 1 },
  ]),
  checkLimit,
  async (req, res) => {
    const { topic, prompt, deviceId } = req.body;
    const referenceImagePath = req.files?.referenceImage?.[0]?.path;
    const faceImagePath      = req.files?.faceImage?.[0]?.path;

    console.log(`Thumbnail request — topic: "${topic}", hasRef: ${!!referenceImagePath}, device: ${deviceId}`);

    if (!topic) {
      cleanup([referenceImagePath, faceImagePath]);
      return res.status(400).json({ success: false, message: 'Video topic is required' });
    }
    if (!referenceImagePath) {
      cleanup([faceImagePath]);
      return res.status(400).json({ success: false, message: 'Please select a reference image' });
    }

    try {
      const result = await aiService.generateThumbnail({
        topic,
        prompt: prompt || '',
        referenceImagePath,
        faceImagePath,
      });

      cleanup([referenceImagePath, faceImagePath]);

      // If Gemini returned no image at all
      if (!result.thumbnailBase64) {
        return res.status(500).json({
          success: false,
          message: 'Thumbnail generation failed. Please try again in a moment.',
        });
      }

      // ✅ Increment usage in Google Sheet ONLY on success
      try {
        await sheets.incrementUsage(deviceId);
        console.log(`✅ Usage incremented for ${deviceId}`);
      } catch (sheetErr) {
        // Don't fail the request if sheet update fails — log and continue
        console.error('⚠️ Sheet increment failed (non-fatal):', sheetErr.message);
      }

      const newUsage = (req.user.usageToday || 0) + 1;

      // ─── Return base64 + mime separately ─────────────────────────────────
      // Flutter app uses these to:
      //   1. Display image:  "data:${thumbnailMime};base64,${thumbnailBase64}"
      //   2. Save to gallery: decode base64 → Uint8List → GallerySaver.saveImage()
      return res.json({
        success: true,
        message: 'Thumbnail generated!',
        data: {
          topic,
          prompt:          result.prompt,
          thumbnailBase64: result.thumbnailBase64,   // raw base64, no data: prefix
          thumbnailMime:   result.thumbnailMime,     // e.g. "image/jpeg"
          usageToday:      newUsage,
          dailyLimit:      req.user.dailyLimit,
        },
      });

    } catch (err) {
      cleanup([referenceImagePath, faceImagePath]);
      console.error('generate-thumbnail error:', err.message);

      let userMessage = 'Thumbnail generation failed. Please try again.';
      if (err.message.includes('timed out'))      userMessage = 'Generation timed out. Please try again.';
      if (err.message.includes('429'))            userMessage = 'AI service is busy. Please wait 30 seconds and try again.';
      if (err.message.includes('GEMINI_API_KEY')) userMessage = 'Gemini not configured. Contact support.';
      if (err.message.includes('API_KEY_INVALID'))userMessage = 'Invalid Gemini API key. Contact support.';

      return res.status(500).json({ success: false, message: userMessage });
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
    try { await sheets.incrementUsage(deviceId); } catch (e) { console.error('Sheet increment failed:', e.message); }
    return res.json({ success: true, message: 'SEO pack generated!', data: result });
  } catch (err) {
    console.error('generate-seo error:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'SEO generation failed' });
  }
});

// ─── POST /api/generate-tags ──────────────────────────────────────────────────
router.post('/generate-tags', checkLimit, async (req, res) => {
  const { topic, deviceId } = req.body;
  if (!topic) return res.status(400).json({ success: false, message: 'topic is required' });

  try {
    const tags = await aiService.generateTags({ topic });
    try { await sheets.incrementUsage(deviceId); } catch (e) { console.error('Sheet increment failed:', e.message); }
    return res.json({ success: true, message: 'Tags generated!', data: tags });
  } catch (err) {
    console.error('generate-tags error:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Tags generation failed' });
  }
});

// ─── Cleanup temp uploaded files ──────────────────────────────────────────────
function cleanup(paths) {
  (paths || []).filter(Boolean).forEach(p => {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
  });
}

module.exports = router;
