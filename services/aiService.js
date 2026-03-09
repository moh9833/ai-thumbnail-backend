const OpenAI = require('openai');
const axios = require('axios');
const fs = require('fs');

// ─── AI Client ────────────────────────────────────────────────────────────────
const openai = process.env.GROQ_API_KEY
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const AI_MODEL = process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

// ─── Safe JSON parser — fixes control characters before parsing ───────────────
function safeParseJson(raw) {
  // Step 1: Strip markdown code fences
  let clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Step 2: Remove actual newlines/tabs/control chars INSIDE string values
  // Replace literal newlines within the JSON string content with \n escape
  clean = clean.replace(/[\r\n]+/g, ' ');

  // Step 3: Remove other bad control characters (ASCII 0-31 except space)
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Step 4: Try parsing
  try {
    return JSON.parse(clean);
  } catch (e1) {
    // Step 5: More aggressive fix — extract JSON object manually
    const start = clean.indexOf('{');
    const end   = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      try {
        return JSON.parse(clean.substring(start, end + 1));
      } catch (e2) {
        throw new Error(`JSON parse failed: ${e2.message} | Raw: ${clean.substring(0, 200)}`);
      }
    }
    throw new Error(`JSON parse failed: ${e1.message}`);
  }
}

// ─── Generate SEO Pack ────────────────────────────────────────────────────────
async function generateSeo({ topic, category, audience }) {
  const prompt = `You are an expert YouTube content strategist.

Generate a YouTube SEO pack for this video:
Topic: "${topic}"
Category: ${category}
Target Audience: ${audience}

STRICT RULES:
1. Title: One powerful title, 55-65 characters, no ALL CAPS, no excessive punctuation
2. Description: 250-300 words, human-sounding, warm tone, conversational
3. Return ONLY a single-line JSON object — NO line breaks inside string values, NO newlines in the JSON

Return exactly this JSON structure (all on values must be single-line strings):
{"title":"your title","description":"full description in one continuous string with no line breaks","tags":["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10","tag11","tag12","tag13","tag14","tag15","tag16","tag17","tag18","tag19","tag20"],"hashtags":["#hash1","#hash2","#hash3","#hash4","#hash5","#hash6","#hash7","#hash8","#hash9","#hash10"],"keywords":["kw1","kw2","kw3","kw4","kw5"]}`;

  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a JSON API. Return ONLY valid JSON. No markdown, no code fences, no newlines inside string values. All text must be on a single line within each JSON string field.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 2000,
  });

  const raw = response.choices[0].message.content.trim();
  console.log('SEO raw (first 200):', raw.substring(0, 200));
  return safeParseJson(raw);
}

// ─── Generate Tags ────────────────────────────────────────────────────────────
async function generateTags({ topic }) {
  const prompt = `Generate 25 YouTube tags for: "${topic}"
Mix: 5 broad keywords, 10 medium phrases, 10 long-tail phrases.
Return ONLY a JSON array: ["tag1","tag2",...]`;

  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: 'system', content: 'You are a JSON API. Return ONLY valid JSON array. No markdown, no explanation.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 600,
  });

  const raw = response.choices[0].message.content.trim();
  const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Handle both array and object responses
  if (clean.startsWith('[')) return JSON.parse(clean);
  const obj = safeParseJson(clean);
  return Array.isArray(obj) ? obj : Object.values(obj)[0];
}

// ─── Generate Thumbnail ───────────────────────────────────────────────────────
async function generateThumbnail({ topic, prompt, referenceImagePath }) {
  const enhancedPrompt = buildPrompt(topic, prompt);
  console.log('Thumbnail prompt:', enhancedPrompt.substring(0, 100));

  const providers = [
    { name: 'Pollinations', fn: () => fetchPollinationsAsBase64(enhancedPrompt) },
    { name: 'HuggingFace',  fn: () => generateWithHuggingFace(enhancedPrompt), enabled: !!process.env.HF_API_TOKEN },
    { name: 'Stability',    fn: () => generateWithStability(enhancedPrompt),   enabled: !!process.env.STABILITY_API_KEY },
    { name: 'Replicate',    fn: () => generateWithReplicate(enhancedPrompt, referenceImagePath), enabled: !!process.env.REPLICATE_API_TOKEN },
  ];

  for (const provider of providers) {
    if (provider.enabled === false) continue;
    try {
      console.log(`Trying ${provider.name}...`);
      const result = await provider.fn();
      console.log(`✅ ${provider.name} succeeded`);
      return { ...result, topic, prompt: enhancedPrompt };
    } catch (err) {
      console.log(`❌ ${provider.name} failed: ${err.message}`);
    }
  }

  return {
    thumbnailUrl: `https://placehold.co/1280x720/6C63FF/FFFFFF?text=${encodeURIComponent(topic.substring(0, 30))}`,
    isPlaceholder: true,
    topic,
    prompt: enhancedPrompt,
  };
}

function buildPrompt(topic, userPrompt) {
  const extra = userPrompt ? userPrompt + ', ' : '';
  return `${extra}YouTube thumbnail for: ${topic}, eye-catching design, vibrant colors, bold composition, dramatic lighting, professional quality, 16:9 aspect ratio`;
}

async function fetchPollinationsAsBase64(prompt) {
  const seed = Math.floor(Math.random() * 999999);
  const url  = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1280&height=720&seed=${seed}&nologo=true&enhance=true`;

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    maxRedirects: 10,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' },
  });

  if (!response.data || response.data.byteLength < 1000) throw new Error('Empty image');

  const base64   = Buffer.from(response.data).toString('base64');
  const mimeType = response.headers['content-type'] || 'image/jpeg';
  console.log(`Pollinations: ${Math.round(response.data.byteLength / 1024)} KB`);
  return { thumbnailUrl: `data:${mimeType};base64,${base64}` };
}

async function generateWithHuggingFace(prompt) {
  const response = await axios.post(
    'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0',
    { inputs: prompt, parameters: { width: 1280, height: 720 } },
    { headers: { 'Authorization': `Bearer ${process.env.HF_API_TOKEN}` }, responseType: 'arraybuffer', timeout: 60000 }
  );
  return { thumbnailUrl: `data:image/jpeg;base64,${Buffer.from(response.data).toString('base64')}` };
}

async function generateWithStability(prompt) {
  const FormData = require('form-data');
  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('output_format', 'jpeg');
  formData.append('width', '1280');
  formData.append('height', '720');
  const res = await axios.post(
    'https://api.stability.ai/v2beta/stable-image/generate/core', formData,
    { headers: { ...formData.getHeaders(), Authorization: `Bearer ${process.env.STABILITY_API_KEY}`, Accept: 'application/json' }, timeout: 60000 }
  );
  return { thumbnailUrl: `data:image/jpeg;base64,${res.data.image}` };
}

async function generateWithReplicate(prompt, imagePath) {
  const headers = { 'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json' };
  const input   = { prompt, negative_prompt: 'blurry, low quality', width: 1280, height: 720, num_inference_steps: 25 };

  if (imagePath && fs.existsSync(imagePath)) {
    input.image = `data:image/jpeg;base64,${fs.readFileSync(imagePath).toString('base64')}`;
    input.prompt_strength = 0.75;
  }

  const startRes = await axios.post(
    'https://api.replicate.com/v1/predictions',
    { version: 'da77bc59ee60423279fd632efb4795ab731d9e3ca9705ef3341091fb989b7eaf', input }, { headers }
  );

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const poll = await axios.get(`https://api.replicate.com/v1/predictions/${startRes.data.id}`, { headers });
    if (poll.data.status === 'succeeded' && poll.data.output?.[0]) {
      const imgRes = await axios.get(poll.data.output[0], { responseType: 'arraybuffer' });
      return { thumbnailUrl: `data:image/jpeg;base64,${Buffer.from(imgRes.data).toString('base64')}` };
    }
    if (poll.data.status === 'failed') throw new Error('Replicate failed');
  }
  throw new Error('Replicate timed out');
}

module.exports = { generateSeo, generateTags, generateThumbnail };
