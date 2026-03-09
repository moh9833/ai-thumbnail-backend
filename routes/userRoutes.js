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

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address' });
    }

    // Already registered on this device?
    const existingDevice = await sheets.findUserByDeviceId(deviceId);
    if (existingDevice) {
      return res.json({ success: true, message: 'Welcome back!', data: existingDevice });
    }

    // Email already used on another device?
    const existingEmail = await sheets.findUserByEmail(email);
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        alreadyExists: true,
        message: 'This email is already registered. Please use Login instead.',
      });
    }

    const user = await sheets.registerUser({ name, email, deviceId, phone: phone || '', country: country || '' });
    return res.status(201).json({ success: true, message: 'Registration successful! Welcome 🎉', data: user });

  } catch (err) {
    console.error('register-user error:', err);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ─── POST /api/login-user ─────────────────────────────────────────────────────
// Login with email — updates deviceId in sheet so new device gets linked
router.post('/login-user', async (req, res) => {
  try {
    const { email, deviceId } = req.body;

    if (!email || !deviceId) {
      return res.status(400).json({ success: false, message: 'Email and deviceId are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address' });
    }

    // Find user by email in sheet
    const user = await sheets.findUserByEmail(email);

    if (!user) {
      // Email not found — not registered
      return res.status(404).json({
        success: false,
        notFound: true,
        message: 'No account found with this email. Please register first.',
      });
    }

    if (user.status !== 'Active') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Please contact support on WhatsApp.',
      });
    }

    // Update deviceId in sheet so this new device is linked to account
    await sheets.updateDeviceId(email, deviceId);

    // Return user with updated deviceId
    const updatedUser = { ...user, deviceId };
    return res.json({
      success: true,
      message: `Welcome back, ${user.name}! 👋`,
      data: updatedUser,
    });

  } catch (err) {
    console.error('login-user error:', err);
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
      return res.status(403).json({ success: false, message: 'Account suspended.' });
    }
    return res.json({ success: true, data: user });
  } catch (err) {
    console.error('check-user error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
