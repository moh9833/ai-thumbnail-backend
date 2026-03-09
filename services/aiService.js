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
1. Title: One powerful title, 55-65 characters, no ALL CAPS, no excessive punctuation
2. Description: 250-300 words, human-sounding, warm tone, conversational
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
  console.log('Thumbnail prompt:', enhancedPrompt.substring(0, 120));

  // Try multiple Gemini Flash model names (Google keeps renaming them)
  const flashModels = [
    'gemini-2.0-flash-exp-image-generation',
    'gemini-2.0-flash-preview-image-generation',
  ];

  for (const model of flashModels) {
    try {
      console.log('Trying model: ' + model);
      const result = await generateWithGeminiFlash(enhancedPrompt, referenceImagePath, model);
      console.log('SUCCESS: ' + model);
      return { ...result, topic, prompt: enhancedPrompt };
    } catch (err) {
      console.log('FAILED ' + model + ': ' + err.message);
    }
  }

  // Fallback: Imagen 3
  const imagenModels = ['imagen-3.0-generate-002', 'imagen-3.0-generate-001'];
  for (const model of imagenModels) {
    try {
      console.log('Trying Imagen model: ' + model);
      const result = await generateWithImagen3(enhancedPrompt, model);
      console.log('SUCCESS: ' + model);
      return { ...result, topic, prompt: enhancedPrompt };
    } catch (err) {
      console.log('FAILED ' + model + ': ' + err.message);
    }
  }

  console.log('All Gemini providers failed');
  return { thumbnailBase64: null, thumbnailMime: null, isPlaceholder: true, topic, prompt: enhancedPrompt };
}

function buildPrompt(topic, userPrompt) {
  const extra = userPrompt ? userPrompt + ', ' : '';
  return extra + 'YouTube thumbnail for: "' + topic + '", eye-catching design, vibrant colors, bold text composition, dramatic lighting, professional quality, 16:9 aspect ratio';
}

// ─── Gemini Flash Image Generation ────────────────────────────────────────────
async function generateWithGeminiFlash(prompt, referenceImagePath, model) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + GEMINI_API_KEY;

  const parts = [];

  if (referenceImagePath && fs.existsSync(referenceImagePath)) {
    const imageBuffer = fs.readFileSync(referenceImagePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType    = detectMimeType(referenceImagePath);
    parts.push({ inline_data: { mime_type: mimeType, data: base64Image } });
    parts.push({
      text: 'Use this reference image as style inspiration. Now generate: ' + prompt + '. Keep the same visual style, color palette, and layout feel but adapt for this YouTube thumbnail topic.',
    });
    console.log('Reference image loaded: ' + Math.round(imageBuffer.byteLength / 1024) + ' KB, ' + mimeType);
  } else {
    parts.push({ text: prompt });
  }

  const requestBody = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
  };

  const response = await axios.post(url, requestBody, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 90000,
    validateStatus: (s) => s < 600,
  });

  if (response.status !== 200) {
    const errMsg = (response.data && response.data.error && response.data.error.message)
      ? response.data.error.message
      : JSON.stringify(response.data).substring(0, 300);
    throw new Error('Gemini Flash HTTP ' + response.status + ': ' + errMsg);
  }

  const candidates = response.data && response.data.candidates ? response.data.candidates : [];
  for (const candidate of candidates) {
    const parts2 = (candidate.content && candidate.content.parts) ? candidate.content.parts : [];
    for (const part of parts2) {
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData && inlineData.data) {
        const mimeType = inlineData.mimeType || inlineData.mime_type || 'image/jpeg';
        console.log('Got image: ' + mimeType + ', ~' + Math.round(inlineData.data.length * 0.75 / 1024) + ' KB');
        return { thumbnailBase64: inlineData.data, thumbnailMime: mimeType };
      }
    }
  }

  console.error('No image in response:', JSON.stringify(response.data).substring(0, 500));
  throw new Error(model + ': No image found in response');
}

// ─── Imagen 3 ─────────────────────────────────────────────────────────────────
async function generateWithImagen3(prompt, model) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':predict?key=' + GEMINI_API_KEY;

  const requestBody = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: '16:9',
      safetySetting: 'block_only_high',
      personGeneration: 'allow_adult',
    },
  };

  const response = await axios.post(url, requestBody, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 90000,
    validateStatus: (s) => s < 600,
  });

  if (response.status !== 200) {
    const errMsg = (response.data && response.data.error && response.data.error.message)
      ? response.data.error.message
      : JSON.stringify(response.data).substring(0, 300);
    throw new Error(model + ' HTTP ' + response.status + ': ' + errMsg);
  }

  const predictions = response.data && response.data.predictions ? response.data.predictions : [];
  if (!predictions.length) throw new Error(model + ': No predictions returned');

  const imageData = predictions[0] && predictions[0].bytesBase64Encoded;
  if (!imageData) throw new Error(model + ': No image bytes in response');

  console.log(model + ': Got image ~' + Math.round(imageData.length * 0.75 / 1024) + ' KB');
  return { thumbnailBase64: imageData, thumbnailMime: 'image/jpeg' };
}

function detectMimeType(filePath) {
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
  return map[ext] || 'image/jpeg';
}

module.exports = { generateSeo, generateTags, generateThumbnail };
