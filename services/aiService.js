const OpenAI = require('openai');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

// Uses Groq (free) if GROQ_API_KEY is set, otherwise OpenAI
const openai = process.env.GROQ_API_KEY
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const AI_MODEL = process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

// ─── Generate SEO Pack ────────────────────────────────────────────────────────
async function generateSeo({ topic, category, audience }) {
  const prompt = `You are a YouTube SEO expert. Generate a complete SEO pack for a YouTube video.

Video Topic: "${topic}"
Category: ${category}
Target Audience: ${audience}

Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "title": "One viral, click-worthy YouTube title (max 70 chars)",
  "description": "A compelling SEO-optimized YouTube description (300-500 words). Include keywords naturally, call-to-action, and social links placeholders.",
  "tags": ["tag1", "tag2", ... exactly 20 tags, each 1-3 words, highly relevant],
  "hashtags": ["#hashtag1", "#hashtag2", ... exactly 10 hashtags, trending],
  "keywords": ["keyword1", "keyword2", ... 5 trending keyword suggestions"]
}`;

  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
    max_tokens: 1500,
  });

  const raw = response.choices[0].message.content.trim();
  // Strip markdown fences if present
  const clean = raw.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(clean);
}

// ─── Generate Tags Only ───────────────────────────────────────────────────────
async function generateTags({ topic }) {
  const prompt = `Generate 25 highly relevant YouTube tags for the topic: "${topic}".
Return ONLY a valid JSON array of strings. No markdown, no explanation.
Mix: broad keywords, long-tail phrases, trending terms.
Example: ["youtube tag", "longer phrase tag", ...]`;

  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 500,
  });

  const raw = response.choices[0].message.content.trim();
  const clean = raw.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(clean);
}

// ─── Generate Thumbnail (via Replicate/Stability AI) ─────────────────────────
async function generateThumbnail({ topic, prompt, referenceImagePath, faceImagePath }) {
  // Build an enhanced prompt
  const enhancedPrompt = buildThumbnailPrompt(topic, prompt);

  // Option A: Replicate (Stable Diffusion / FLUX)
  if (process.env.REPLICATE_API_TOKEN) {
    return await generateWithReplicate(enhancedPrompt, referenceImagePath);
  }

  // Option B: Stability AI
  if (process.env.STABILITY_API_KEY) {
    return await generateWithStability(enhancedPrompt);
  }

  // Fallback: return a placeholder
  return {
    thumbnailUrl: `https://via.placeholder.com/1280x720/6C63FF/FFFFFF?text=${encodeURIComponent(topic)}`,
    prompt: enhancedPrompt,
    topic,
  };
}

function buildThumbnailPrompt(topic, userPrompt) {
  const base = userPrompt || '';
  return `YouTube thumbnail, ${base ? base + ', ' : ''}topic: ${topic}. 
High quality, vibrant colors, eye-catching, professional YouTube thumbnail design, 
bold text overlay space, dramatic lighting, 16:9 aspect ratio, 
photorealistic, ultra detailed, trending on YouTube`;
}

async function generateWithReplicate(prompt, imagePath) {
  const REPLICATE_API = 'https://api.replicate.com/v1/predictions';

  const input = {
    prompt,
    width: 1280,
    height: 720,
    num_outputs: 1,
    num_inference_steps: 30,
    guidance_scale: 7.5,
  };

  // If reference image provided, add it
  if (imagePath && fs.existsSync(imagePath)) {
    const imageBase64 = fs.readFileSync(imagePath, 'base64');
    input.image = `data:image/jpeg;base64,${imageBase64}`;
    input.prompt_strength = 0.8;
  }

  // Start prediction (using SDXL model)
  const startRes = await axios.post(REPLICATE_API, {
    version: 'stability-ai/sdxl:39ed52f2319f9bbdf5eb8736e4c89b9b',
    input,
  }, {
    headers: {
      'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    }
  });

  // Poll for result
  const predictionId = startRes.data.id;
  let thumbnailUrl = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await axios.get(`${REPLICATE_API}/${predictionId}`, {
      headers: { 'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}` }
    });
    if (pollRes.data.status === 'succeeded') {
      thumbnailUrl = pollRes.data.output[0];
      break;
    }
    if (pollRes.data.status === 'failed') {
      throw new Error('Image generation failed: ' + pollRes.data.error);
    }
  }

  if (!thumbnailUrl) throw new Error('Generation timed out');
  return { thumbnailUrl, prompt };
}

async function generateWithStability(prompt) {
  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('output_format', 'webp');
  formData.append('width', '1280');
  formData.append('height', '720');

  const res = await axios.post(
    'https://api.stability.ai/v2beta/stable-image/generate/core',
    formData,
    {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
        Accept: 'application/json',
      }
    }
  );

  // Stability returns base64
  const imageBase64 = res.data.image;
  // In production: upload to S3/Cloudinary and return URL
  // For now return as data URL
  return {
    thumbnailUrl: `data:image/webp;base64,${imageBase64}`,
    prompt,
  };
}

module.exports = { generateSeo, generateTags, generateThumbnail };
