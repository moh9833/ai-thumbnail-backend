const express = require('express');
const router = express.Router();
const sheets = require('../config/googleSheets');

// ─── POST /api/register-user ──────────────────────────────────────────────────
/**
 * @body { name, email, deviceId }
 * @returns { success, data: UserModel }
 */
router.post('/register-user', async (req, res) => {
  try {
    const { name, email, deviceId } = req.body;

    if (!name || !email || !deviceId) {
      return res.status(400).json({ success: false, message: 'Name, email and deviceId are required' });
    }

    // Check if already registered
    const existing = await sheets.findUserByDeviceId(deviceId);
    if (existing) {
      return res.json({ success: true, message: 'Already registered', data: existing });
    }

    // Check if email already used
    const emailExists = await sheets.findUserByEmail(email);
    if (emailExists) {
      return res.status(409).json({ success: false, message: 'Email already registered on another device' });
    }

    const user = await sheets.registerUser({ name, email, deviceId });
    return res.status(201).json({ success: true, message: 'Registered successfully', data: user });

  } catch (err) {
    console.error('register-user error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// ─── POST /api/check-user ─────────────────────────────────────────────────────
/**
 * @body { deviceId }
 * @returns { success, data: UserModel }
 */
router.post('/check-user', async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) {
      return res.status(400).json({ success: false, message: 'deviceId is required' });
    }

    const user = await sheets.findUserByDeviceId(deviceId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (user.status !== 'Active') {
      return res.status(403).json({ success: false, message: 'Account suspended' });
    }

    return res.json({ success: true, data: user });

  } catch (err) {
    console.error('check-user error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

module.exports = router;
