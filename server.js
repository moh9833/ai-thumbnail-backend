require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const fs = require('fs');

const userRoutes = require('./routes/userRoutes');
const generateRoutes = require('./routes/generateRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── FIX: Trust Render's proxy (fixes ERR_ERL_UNEXPECTED_X_FORWARDED_FOR) ─────
app.set('trust proxy', 1);

// ─── Ensure uploads directory exists ─────────────────────────────────────────
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-App-Version'],
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// ─── Logging ──────────────────────────────────────────────────────────────────
app.use(morgan('combined'));

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
    groq: process.env.GROQ_API_KEY ? '✓ set' : '✗ missing',
    openai: process.env.OPENAI_API_KEY ? '✓ set' : '✗ missing',
    sheets: process.env.GOOGLE_SHEETS_SPREADSHEET_ID ? '✓ set' : '✗ missing',
    replicate: process.env.REPLICATE_API_TOKEN ? '✓ set' : '✗ missing',
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
  console.error('Unhandled error:', err.message);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📊 Google Sheets: ${process.env.GOOGLE_SHEETS_SPREADSHEET_ID ? '✓' : '✗'}`);
  console.log(`🤖 Groq: ${process.env.GROQ_API_KEY ? '✓' : '✗'} | OpenAI: ${process.env.OPENAI_API_KEY ? '✓' : '✗'}`);
  console.log(`🖼  Replicate: ${process.env.REPLICATE_API_TOKEN ? '✓' : '✗'}`);
});

module.exports = app;
