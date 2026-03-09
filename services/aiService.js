const OpenAI = require('openai');
const axios = require('axios');
const fs = require('fs');

// ─── AI Client (Groq / OpenAI for SEO & Tags) ─────────────────────────────────
const openai = process.env.GROQ_API_KEY
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const AI_MODEL = process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

// ─── Safe JSON parser ──────────────────────────────────────────────────────────
function safeParseJson(raw) {
  let clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  clean = clean.replace(/[\r\n]+/g, ' ');
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  try {
    return JSON.parse(clean);
  } catch (e1) {
    const start = clean.indexOf('{');
    const end   = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      try { return JSON.parse(clean.substring(start, end + 1)); }
      catch (e2) { throw new Error('JSON parse failed: ' + e2.message); }
    }
    throw new Error('JSON parse failed: ' + e1.message);
  }
}

// ─── Generate SEO Pack ─────────────────────────────────────────────────────────
async function generateSeo({ topic, category, audience }) {
  const prompt = `You are an expert YouTube content strategist.
Generate a YouTube SEO pack for this video:
Topic: "${topic}"
Category: ${category}
Target Audience: ${audience}

STRICT RULES:
1. Title: One powerful title, 55-65 characters, no ALL CAPS
2. Description: 250-300 words, human-sounding, warm tone
3. Return ONLY a single-line JSON object

Return exactly this JSON:
{"title":"your title","description":"full description","tags":["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10","tag11","tag12","tag13","tag14","tag15","tag16","tag17","tag18","tag19","tag20"],"hashtags":["#hash1","#hash2","#hash3","#hash4","#hash5","#hash6","#hash7","#hash8","#hash9","#hash10"],"keywords":["kw1","kw2","kw3","kw4","kw5"]}`;

  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: 'system', content: 'You are a JSON API. Return ONLY valid JSON. No markdown, no code fences.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 2000,
  });

  return safeParseJson(response.choices[0].message.content.trim());
}

// ─── Generate Tags ─────────────────────────────────────────────────────────────
async function generateTags({ topic }) {
  const prompt = `Generate 25 YouTube tags for: "${topic}"
Mix: 5 broad keywords, 10 medium phrases, 10 long-tail phrases.
Return ONLY a JSON array: ["tag1","tag2",...]`;

  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: 'system', content: 'You are a JSON API. Return ONLY valid JSON array.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 600,
  });

  const raw   = response.choices[0].message.content.trim();
  const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  if (clean.startsWith('[')) return JSON.parse(clean);
  const obj = safeParseJson(clean);
  return Array.isArray(obj) ? obj : Object.values(obj)[0];
}

// ─── Generate Thumbnail ────────────────────────────────────────────────────────
async function generateThumbnail({ topic, prompt, referenceImagePath }) {
  const enhancedPrompt = buildPrompt(topic, prompt);
  console.log('Thumbnail prompt:', enhancedPrompt.substring(0, 100));

  // ── Provider list in priority order ──────────────────────────────────────────
  // Each entry: { name, fn }
  const providers = [
    {
      name: 'gemini-2.0-flash-exp-image-generation (v1beta)',
      fn: () => generateWithGeminiFlash(
        enhancedPrompt, referenceImagePath,
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent'
      ),
    },
    {
      name: 'gemini-2.0-flash-exp-image-generation (v1)',
      fn: () => generateWithGeminiFlash(
        enhancedPrompt, referenceImagePath,
        'https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash-exp-image-generation:generateContent'
      ),
    },
    {
      name: 'imagen-3.0-generate-001 (v1)',
      fn: () => generateWithImagen(
        enhancedPrompt,
        'https://generativelanguage.googleapis.com/v1/models/imagen-3.0-generate-001:predict'
      ),
    },
    {
      name: 'imagen-3.0-generate-001 (v1beta)',
      fn: () => generateWithImagen(
        enhancedPrompt,
        'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict'
      ),
    },
    {
      name: 'imagen-3.0-generate-002 (v1)',
      fn: () => generateWithImagen(
        enhancedPrompt,
        'https://generativelanguage.googleapis.com/v1/models/imagen-3.0-generate-002:predict'
      ),
    },
  ];

  for (const provider of providers) {
    try {
      console.log('Trying: ' + provider.name);
      const result = await provider.fn();
      console.log('SUCCESS: ' + provider.name);
      return { ...result, topic, prompt: enhancedPrompt };
    } catch (err) {
      console.log('FAILED ' + provider.name + ': ' + err.message);
    }
  }

  console.log('All providers failed');
  return { thumbnailBase64: null, thumbnailMime: null, isPlaceholder: true, topic, prompt: enhancedPrompt };
}

function buildPrompt(topic, userPrompt) {
  const extra = userPrompt ? userPrompt + ', ' : '';
  return extra + 'YouTube thumbnail for: "' + topic + '", eye-catching design, vibrant colors, bold text, dramatic lighting, professional quality, 16:9 aspect ratio';
}

// ─── Gemini Flash (generateContent → image output) ────────────────────────────
async function generateWithGeminiFlash(prompt, referenceImagePath, baseUrl) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const url = baseUrl + '?key=' + GEMINI_API_KEY;
  const parts = [];

  if (referenceImagePath && fs.existsSync(referenceImagePath)) {
    const buf      = fs.readFileSync(referenceImagePath);
    const b64      = buf.toString('base64');
    const mime     = detectMimeType(referenceImagePath);
    parts.push({ inline_data: { mime_type: mime, data: b64 } });
    parts.push({
      text: 'Use this reference image as style inspiration. Generate: ' + prompt +
            '. Keep same visual style and color palette, adapted for this YouTube thumbnail.',
    });
    console.log('Reference image: ' + Math.round(buf.byteLength / 1024) + ' KB');
  } else {
    parts.push({ text: prompt });
  }

  const response = await axios.post(
    url,
    { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } },
    { headers: { 'Content-Type': 'application/json' }, timeout: 90000, validateStatus: (s) => s < 600 }
  );

  if (response.status !== 200) {
    const msg = (response.data && response.data.error) ? response.data.error.message : JSON.stringify(response.data).substring(0, 200);
    throw new Error('HTTP ' + response.status + ': ' + msg);
  }

  const candidates = (response.data && response.data.candidates) ? response.data.candidates : [];
  for (const c of candidates) {
    for (const p of ((c.content && c.content.parts) ? c.content.parts : [])) {
      const id = p.inlineData || p.inline_data;
      if (id && id.data) {
        const mime = id.mimeType || id.mime_type || 'image/jpeg';
        console.log('Image received: ' + mime + ' ~' + Math.round(id.data.length * 0.75 / 1024) + ' KB');
        return { thumbnailBase64: id.data, thumbnailMime: mime };
      }
    }
  }

  console.error('No image in response:', JSON.stringify(response.data).substring(0, 400));
  throw new Error('No image in response');
}

// ─── Imagen (predict endpoint) ────────────────────────────────────────────────
async function generateWithImagen(prompt, baseUrl) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const url = baseUrl + '?key=' + GEMINI_API_KEY;

  const response = await axios.post(
    url,
    {
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: '16:9', safetySetting: 'block_only_high', personGeneration: 'allow_adult' },
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 90000, validateStatus: (s) => s < 600 }
  );

  if (response.status !== 200) {
    const msg = (response.data && response.data.error) ? response.data.error.message : JSON.stringify(response.data).substring(0, 200);
    throw new Error('HTTP ' + response.status + ': ' + msg);
  }

  const preds = (response.data && response.data.predictions) ? response.data.predictions : [];
  if (!preds.length) throw new Error('No predictions returned');
  const imageData = preds[0] && preds[0].bytesBase64Encoded;
  if (!imageData) throw new Error('No image bytes in prediction');

  console.log('Imagen image: ~' + Math.round(imageData.length * 0.75 / 1024) + ' KB');
  return { thumbnailBase64: imageData, thumbnailMime: 'image/jpeg' };
}

function detectMimeType(filePath) {
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
  return map[ext] || 'image/jpeg';
}

module.exports = { generateSeo, generateTags, generateThumbnail };
