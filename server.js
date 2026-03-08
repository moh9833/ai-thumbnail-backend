require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const userRoutes = require('./routes/userRoutes');
const generateRoutes = require('./routes/generateRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Ensure uploads directory exists ─────────────────────────────────────────
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: '*', // Restrict to your domain in production
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-App-Version'],
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // max 100 requests per window per IP
  message: { success: false, message: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// ─── Logging ──────────────────────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'AI Thumbnail & SEO Generator API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api', userRoutes);
app.use('/api', generateRoutes);

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📊 Google Sheets ID: ${process.env.GOOGLE_SHEETS_SPREADSHEET_ID ? '✓ set' : '✗ missing'}`);
  console.log(`🤖 OpenAI key: ${process.env.OPENAI_API_KEY ? '✓ set' : '✗ missing'}`);
});

module.exports = app;
