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

// ─── Middleware: only verify user exists (NO limit check) ─────────────────────
// Used for thumbnail — Pollinations is free so no daily limit needed
async function checkUser(req, res, next) {
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
    req.user = user;
    next();
  } catch (err) {
    console.error('checkUser error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
}

// ─── Middleware: verify user + enforce daily limit ────────────────────────────
// Used for SEO & Tags — these use paid AI (OpenAI/Groq)
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

    // Daily limit check — only for SEO & Tags
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

// ─── POST /api/generate-thumbnail ────────────────────────────────────────────
// Uses checkUser (NOT checkLimit) — Pollinations is free, unlimited
router.post('/generate-thumbnail',
  upload.fields([
    { name: 'referenceImage', maxCount: 1 },
    { name: 'faceImage', maxCount: 1 },
  ]),
  checkUser,   // ← only verifies account, NO limit
  async (req, res) => {
    const { topic, prompt, deviceId } = req.body;
    const referenceImagePath = req.files?.referenceImage?.[0]?.path;
    const faceImagePath      = req.files?.faceImage?.[0]?.path;

    console.log(`Thumbnail request - topic: ${topic}, hasRef: ${!!referenceImagePath}`);

    if (!topic) {
      cleanup([referenceImagePath, faceImagePath]);
      return res.status(400).json({ success: false, message: 'Video topic is required' });
    }
    if (!referenceImagePath) {
      return res.status(400).json({ success: false, message: 'Please select a reference image' });
    }

    try {
      const result = await aiService.generateThumbnail({
        topic, prompt: prompt || '', referenceImagePath, faceImagePath,
      });

      cleanup([referenceImagePath, faceImagePath]);
      return res.json({ success: true, message: 'Thumbnail generated!', data: { ...result, topic } });

    } catch (err) {
      cleanup([referenceImagePath, faceImagePath]);
      console.error('generate-thumbnail error:', err.message);

      let userMessage = 'Thumbnail generation failed. Please try again.';
      if (err.message.includes('timed out'))  userMessage = 'Generation timed out. Please try again.';
      if (err.message.includes('429'))        userMessage = 'AI service is busy. Please wait 30 seconds and try again.';

      return res.status(500).json({ success: false, message: userMessage });
    }
  }
);

// ─── POST /api/generate-seo ───────────────────────────────────────────────────
// Uses checkLimit — OpenAI/Groq costs money per call
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
    return res.json({ success: true, message: 'SEO pack generated!', data: result });
  } catch (err) {
    console.error('generate-seo error:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'SEO generation failed' });
  }
});

// ─── POST /api/generate-tags ──────────────────────────────────────────────────
// Uses checkLimit — OpenAI/Groq costs money per call
router.post('/generate-tags', checkLimit, async (req, res) => {
  const { topic, deviceId } = req.body;
  if (!topic) return res.status(400).json({ success: false, message: 'topic is required' });

  try {
    const tags = await aiService.generateTags({ topic });
    await sheets.incrementUsage(deviceId);
    return res.json({ success: true, message: 'Tags generated!', data: tags });
  } catch (err) {
    console.error('generate-tags error:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Tags generation failed' });
  }
});

function cleanup(paths) {
  (paths || []).filter(Boolean).forEach(p => {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
  });
}

module.exports = router;
