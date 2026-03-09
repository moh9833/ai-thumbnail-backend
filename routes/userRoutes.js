const express = require('express');
const router = express.Router();
const sheets = require('../config/googleSheets');

// ─── POST /api/register-user ──────────────────────────────────────────────────
router.post('/register-user', async (req, res) => {
  try {
    const { name, email, deviceId, phone, country } = req.body;

    if (!name || !email || !deviceId) {
      return res.status(400).json({ success: false, message: 'Name, email and deviceId are required' });
    }

    // Email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address' });
    }

    // Already registered on this device?
    const existing = await sheets.findUserByDeviceId(deviceId);
    if (existing) {
      return res.json({ success: true, message: 'Welcome back!', data: existing });
    }

    // Email already used on another device?
    const emailExists = await sheets.findUserByEmail(email);
    if (emailExists) {
      return res.status(409).json({
        success: false,
        message: 'This email is already registered on another device.',
      });
    }

    const user = await sheets.registerUser({ name, email, deviceId, phone: phone || '', country: country || '' });
    return res.status(201).json({ success: true, message: 'Registration successful! Welcome 🎉', data: user });

  } catch (err) {
    console.error('register-user error:', err);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ─── POST /api/check-user ─────────────────────────────────────────────────────
router.post('/check-user', async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ success: false, message: 'deviceId is required' });

    const user = await sheets.findUserByDeviceId(deviceId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.status !== 'Active') {
      return res.status(403).json({ success: false, message: 'Account suspended. Contact support.' });
    }

    return res.json({ success: true, data: user });
  } catch (err) {
    console.error('check-user error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
