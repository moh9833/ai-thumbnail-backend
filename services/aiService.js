const OpenAI = require('openai');
const axios = require('axios');
const fs = require('fs');

// ─── AI Client: Groq (free) preferred, fallback to OpenAI ────────────────────
const openai = process.env.GROQ_API_KEY
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const AI_MODEL = process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

// ─── Generate SEO Pack ────────────────────────────────────────────────────────
async function generateSeo({ topic, category, audience }) {
  const prompt = `You are an expert YouTube content strategist who has helped channels grow to millions of subscribers.

Generate a complete YouTube SEO pack for this video:
Topic: "${topic}"
Category: ${category}
Target Audience: ${audience}

RULES FOR TITLE:
- Write ONE powerful, curiosity-driven title (55-65 characters max)
- Use numbers, power words, or emotional triggers
- NO clickbait, NO ALL CAPS words, NO excessive punctuation

RULES FOR DESCRIPTION:
- Write like a real human creator, NOT like AI
- Start with a hook sentence (what the viewer will learn/get)
- 250-350 words total, natural paragraph breaks
- Add a "What's covered:" section with 3-4 bullet points
- End with a casual CTA like "Drop a comment below"
- Include placeholder: [SUBSCRIBE LINK] and [SOCIAL LINKS]
- Sound conversational, warm, and genuine

Return ONLY valid JSON, no markdown:
{
  "title": "your title here",
  "description": "your full description here",
  "tags": ["tag1","tag2",...20 tags total],
  "hashtags": ["#hashtag1","#hashtag2",...10 hashtags],
  "keywords": ["keyword1","keyword2","keyword3","keyword4","keyword5"]
}`;

  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.85,
    max_tokens: 2000,
  });

  const raw = response.choices[0].message.content.trim();
  const clean = raw.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(clean);
}

// ─── Generate Tags Only ───────────────────────────────────────────────────────
async function generateTags({ topic }) {
  const prompt = `You are a YouTube SEO expert. Generate 25 high-performing YouTube tags for: "${topic}"
Mix: 5 broad keywords, 10 medium 2-3 word phrases, 10 long-tail 4-6 word phrases.
Return ONLY a JSON array, no markdown: ["tag1","tag2",...]`;

  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 600,
  });

  const raw = response.choices[0].message.content.trim();
  const clean = raw.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(clean);
}

// ─── Generate Thumbnail ───────────────────────────────────────────────────────
async function generateThumbnail({ topic, prompt, referenceImagePath }) {
  const enhancedPrompt = buildPrompt(topic, prompt);
  console.log('Thumbnail prompt:', enhancedPrompt.substring(0, 100));

  // Try providers in order — each returns { base64, mimeType } or throws
  const providers = [
    { name: 'Pollinations', fn: () => fetchPollinationsAsBase64(enhancedPrompt) },
    { name: 'HuggingFace',  fn: () => generateWithHuggingFace(enhancedPrompt), enabled: !!process.env.HF_API_TOKEN },
    { name: 'Stability',    fn: () => generateWithStability(enhancedPrompt),    enabled: !!process.env.STABILITY_API_KEY },
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

  // Ultimate fallback — placeholder
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

// ─── Pollinations: download image → return as base64 ─────────────────────────
// This is the KEY FIX: instead of returning the Pollinations URL (which Android
// Glide can't load due to redirects), we download the image on the backend
// and return it as a base64 data URL which Android can always display.
async function fetchPollinationsAsBase64(prompt) {
  const seed = Math.floor(Math.random() * 999999);
  const encodedPrompt = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1280&height=720&seed=${seed}&nologo=true&enhance=true`;

  console.log('Fetching from Pollinations...');

  // Download the actual image bytes (follows redirects automatically)
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,          // 60s — Pollinations can be slow
    maxRedirects: 10,        // follow all redirects
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ThumbnailBot/1.0)',
      'Accept': 'image/*',
    },
  });

  if (!response.data || response.data.byteLength < 1000) {
    throw new Error('Pollinations returned empty or too-small image');
  }

  const base64 = Buffer.from(response.data).toString('base64');
  const mimeType = response.headers['content-type'] || 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${base64}`;

  console.log(`Pollinations image: ${Math.round(response.data.byteLength / 1024)} KB`);

  return { thumbnailUrl: dataUrl };
}

// ─── Hugging Face ─────────────────────────────────────────────────────────────
async function generateWithHuggingFace(prompt) {
  const response = await axios.post(
    'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0',
    { inputs: prompt, parameters: { width: 1280, height: 720 } },
    {
      headers: { 'Authorization': `Bearer ${process.env.HF_API_TOKEN}` },
      responseType: 'arraybuffer',
      timeout: 60000,
    }
  );
  const base64 = Buffer.from(response.data).toString('base64');
  return { thumbnailUrl: `data:image/jpeg;base64,${base64}` };
}

// ─── Stability AI ─────────────────────────────────────────────────────────────
async function generateWithStability(prompt) {
  const FormData = require('form-data');
  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('output_format', 'jpeg');
  formData.append('width', '1280');
  formData.append('height', '720');

  const res = await axios.post(
    'https://api.stability.ai/v2beta/stable-image/generate/core',
    formData,
    {
      headers: { ...formData.getHeaders(), Authorization: `Bearer ${process.env.STABILITY_API_KEY}`, Accept: 'application/json' },
      timeout: 60000,
    }
  );
  return { thumbnailUrl: `data:image/jpeg;base64,${res.data.image}` };
}

// ─── Replicate (kept as last resort) ─────────────────────────────────────────
async function generateWithReplicate(prompt, imagePath) {
  const headers = {
    'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
    'Content-Type': 'application/json',
  };
  const input = { prompt, negative_prompt: 'blurry, low quality', width: 1280, height: 720, num_inference_steps: 25 };

  if (imagePath && fs.existsSync(imagePath)) {
    const buf = fs.readFileSync(imagePath);
    input.image = `data:image/jpeg;base64,${buf.toString('base64')}`;
    input.prompt_strength = 0.75;
  }

  const startRes = await axios.post(
    'https://api.replicate.com/v1/predictions',
    { version: 'da77bc59ee60423279fd632efb4795ab731d9e3ca9705ef3341091fb989b7eaf', input },
    { headers }
  );

  const id = startRes.data.id;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const poll = await axios.get(`https://api.replicate.com/v1/predictions/${id}`, { headers });
    if (poll.data.status === 'succeeded' && poll.data.output?.[0]) {
      // Also download Replicate URL as base64 for consistency
      const imgRes = await axios.get(poll.data.output[0], { responseType: 'arraybuffer' });
      const base64 = Buffer.from(imgRes.data).toString('base64');
      return { thumbnailUrl: `data:image/jpeg;base64,${base64}` };
    }
    if (poll.data.status === 'failed') throw new Error('Replicate failed');
  }
  throw new Error('Replicate timed out');
}

module.exports = { generateSeo, generateTags, generateThumbnail };
