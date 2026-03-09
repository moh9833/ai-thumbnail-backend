const OpenAI = require('openai');
const axios = require('axios');
const fs = require('fs');

// ─── AI Client ────────────────────────────────────────────────────────────────
const openai = process.env.GROQ_API_KEY
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const AI_MODEL = process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Safe JSON parser ──────────────────────────────────────────────────────────
function safeParseJson(raw) {
  let clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  clean = clean.replace(/[\r\n]+/g, ' ');
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  try { return JSON.parse(clean); } catch (e1) {
    const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
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

Return exactly this JSON (single line, no line breaks):
{"title":"your title","description":"full description","tags":["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10","tag11","tag12","tag13","tag14","tag15","tag16","tag17","tag18","tag19","tag20"],"hashtags":["#hash1","#hash2","#hash3","#hash4","#hash5","#hash6","#hash7","#hash8","#hash9","#hash10"],"keywords":["kw1","kw2","kw3","kw4","kw5"]}`;

  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: 'system', content: 'You are a JSON API. Return ONLY valid JSON. No markdown.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7, max_tokens: 2000,
  });
  return safeParseJson(response.choices[0].message.content.trim());
}

// ─── Generate Tags ─────────────────────────────────────────────────────────────
async function generateTags({ topic }) {
  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: 'system', content: 'You are a JSON API. Return ONLY valid JSON array.' },
      { role: 'user', content: `Generate 25 YouTube tags for: "${topic}". Return ONLY a JSON array: ["tag1","tag2",...]` },
    ],
    temperature: 0.7, max_tokens: 600,
  });
  const raw = response.choices[0].message.content.trim().replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  if (raw.startsWith('[')) return JSON.parse(raw);
  const obj = safeParseJson(raw);
  return Array.isArray(obj) ? obj : Object.values(obj)[0];
}

// ─── Generate Thumbnail ────────────────────────────────────────────────────────
async function generateThumbnail({ topic, prompt, referenceImagePath }) {
  const enhancedPrompt = buildPrompt(topic, prompt);
  console.log('Prompt:', enhancedPrompt.substring(0, 100));

  // gemini-2.0-flash-exp-image-generation is the ONLY free model that works
  // It's in v1beta only. If quota exceeded, wait and retry once.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log('Attempt ' + attempt + ': gemini-2.0-flash-exp-image-generation');
      const result = await callGeminiFlash(enhancedPrompt, referenceImagePath);
      console.log('SUCCESS on attempt ' + attempt);
      return { ...result, topic, prompt: enhancedPrompt };
    } catch (err) {
      console.log('Attempt ' + attempt + ' failed: ' + err.message);

      if (err.message.includes('429') && attempt === 1) {
        // Extract retryDelay from error if available, else wait 60s
        const retryMatch = err.message.match(/retry in (\d+)/i);
        const waitSec = retryMatch ? Math.min(parseInt(retryMatch[1]), 65) : 60;
        console.log('Quota exceeded — waiting ' + waitSec + 's before retry...');
        await sleep(waitSec * 1000);
        continue;
      }
      // Non-429 error or second attempt failed — break out
      break;
    }
  }

  console.log('All attempts failed');
  return { thumbnailBase64: null, thumbnailMime: null, isPlaceholder: true, topic, prompt: enhancedPrompt };
}

function buildPrompt(topic, userPrompt) {
  const extra = userPrompt ? userPrompt + ', ' : '';
  return extra + 'YouTube thumbnail for: "' + topic + '", eye-catching, vibrant colors, bold text, dramatic lighting, professional, 16:9';
}

// ─── Gemini 2.0 Flash Exp Image Generation ────────────────────────────────────
// v1beta ONLY — responseModalities required — this is the only free image model
async function callGeminiFlash(prompt, referenceImagePath) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=' + GEMINI_API_KEY;

  const parts = [];
  if (referenceImagePath && fs.existsSync(referenceImagePath)) {
    const buf  = fs.readFileSync(referenceImagePath);
    const mime = detectMimeType(referenceImagePath);
    parts.push({ inline_data: { mime_type: mime, data: buf.toString('base64') } });
    parts.push({
      text: 'Use this reference image as style inspiration. Generate: ' + prompt +
            '. Match the visual style and color palette, adapted for this YouTube thumbnail.',
    });
    console.log('Reference: ' + Math.round(buf.byteLength / 1024) + ' KB, ' + mime);
  } else {
    parts.push({ text: prompt });
  }

  const response = await axios.post(
    url,
    {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 90000, validateStatus: (s) => s < 600 }
  );

  if (response.status === 429) {
    // Pass full error message so caller can extract retry delay
    const msg = response.data && response.data.error ? response.data.error.message : 'Quota exceeded';
    throw new Error('429: ' + msg);
  }

  if (response.status !== 200) {
    const msg = response.data && response.data.error ? response.data.error.message : JSON.stringify(response.data).substring(0, 200);
    throw new Error('HTTP ' + response.status + ': ' + msg);
  }

  // Extract image
  const candidates = response.data && response.data.candidates ? response.data.candidates : [];
  for (const c of candidates) {
    for (const p of (c.content && c.content.parts ? c.content.parts : [])) {
      const id = p.inlineData || p.inline_data;
      if (id && id.data) {
        const mime = id.mimeType || id.mime_type || 'image/jpeg';
        console.log('Image: ' + mime + ' ~' + Math.round(id.data.length * 0.75 / 1024) + ' KB');
        return { thumbnailBase64: id.data, thumbnailMime: mime };
      }
    }
  }

  console.error('No image in response:', JSON.stringify(response.data).substring(0, 400));
  throw new Error('No image found in Gemini response');
}

function detectMimeType(filePath) {
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }[ext] || 'image/jpeg';
}

module.exports = { generateSeo, generateTags, generateThumbnail };
