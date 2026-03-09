const OpenAI = require('openai');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

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
- 250-350 words total
- Include natural paragraph breaks
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

Return ONLY a JSON array, no markdown:
["tag1","tag2",...]`;

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
// Priority order:
// 1. Pollinations AI  — 100% free, no API key needed
// 2. Hugging Face     — free tier, needs HF_API_TOKEN env var
// 3. Stability AI     — needs STABILITY_API_KEY env var
// 4. Replicate        — needs REPLICATE_API_TOKEN env var
// 5. Placeholder      — always works as fallback
async function generateThumbnail({ topic, prompt, referenceImagePath }) {
  const enhancedPrompt = buildPrompt(topic, prompt);
  console.log('Thumbnail prompt:', enhancedPrompt.substring(0, 120));

  // Try each provider in order
  const providers = [
    { name: 'Pollinations', fn: () => generateWithPollinations(enhancedPrompt, topic) },
    { name: 'HuggingFace',  fn: () => generateWithHuggingFace(enhancedPrompt),
      enabled: !!process.env.HF_API_TOKEN },
    { name: 'Stability',    fn: () => generateWithStability(enhancedPrompt),
      enabled: !!process.env.STABILITY_API_KEY },
    { name: 'Replicate',    fn: () => generateWithReplicate(enhancedPrompt, referenceImagePath),
      enabled: !!process.env.REPLICATE_API_TOKEN },
  ];

  for (const provider of providers) {
    if (provider.enabled === false) continue; // skip if key not set
    try {
      console.log(`Trying ${provider.name}...`);
      const result = await provider.fn();
      console.log(`✅ ${provider.name} succeeded`);
      return result;
    } catch (err) {
      console.log(`❌ ${provider.name} failed: ${err.message}`);
    }
  }

  // Final fallback — placeholder image
  return {
    thumbnailUrl: `https://placehold.co/1280x720/6C63FF/FFFFFF?text=${encodeURIComponent(topic.substring(0, 30))}`,
    prompt: enhancedPrompt,
    topic,
  };
}

// ─── Build Prompt ─────────────────────────────────────────────────────────────
function buildPrompt(topic, userPrompt) {
  const extra = userPrompt ? userPrompt + ', ' : '';
  return `${extra}YouTube thumbnail for: ${topic}, eye-catching, vibrant colors, bold text overlay space, dramatic lighting, professional quality, 16:9 aspect ratio`;
}

// ─── 1. Pollinations AI (FREE — No API key needed) ───────────────────────────
async function generateWithPollinations(prompt, topic) {
  // Pollinations returns a direct image URL — no polling needed!
  const seed = Math.floor(Math.random() * 999999);
  const encodedPrompt = encodeURIComponent(prompt);

  const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1280&height=720&seed=${seed}&nologo=true&enhance=true`;

  // Verify the image actually loads (HEAD request)
  const checkRes = await axios.head(imageUrl, { timeout: 30000 });
  if (checkRes.status !== 200) throw new Error('Pollinations image not available');

  return { thumbnailUrl: imageUrl, prompt, topic };
}

// ─── 2. Hugging Face Inference API (Free tier) ────────────────────────────────
async function generateWithHuggingFace(prompt) {
  const model = 'stabilityai/stable-diffusion-xl-base-1.0';
  const response = await axios.post(
    `https://api-inference.huggingface.co/models/${model}`,
    {
      inputs: prompt,
      parameters: { width: 1280, height: 720 }
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.HF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
      timeout: 60000,
    }
  );

  // Convert image buffer to base64 data URL
  const base64 = Buffer.from(response.data).toString('base64');
  return {
    thumbnailUrl: `data:image/jpeg;base64,${base64}`,
    prompt,
  };
}

// ─── 3. Stability AI ─────────────────────────────────────────────────────────
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
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
        Accept: 'application/json',
      },
      timeout: 60000,
    }
  );

  return {
    thumbnailUrl: `data:image/jpeg;base64,${res.data.image}`,
    prompt,
  };
}

// ─── 4. Replicate (SDXL) — kept as last resort ────────────────────────────────
async function generateWithReplicate(prompt, imagePath) {
  const headers = {
    'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const input = {
    prompt,
    negative_prompt: 'blurry, low quality, distorted, watermark',
    width: 1280,
    height: 720,
    num_inference_steps: 25,
    guidance_scale: 7,
  };

  if (imagePath && fs.existsSync(imagePath)) {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');
    input.image = `data:image/jpeg;base64,${base64}`;
    input.prompt_strength = 0.75;
  }

  const startRes = await axios.post(
    'https://api.replicate.com/v1/predictions',
    { version: 'da77bc59ee60423279fd632efb4795ab731d9e3ca9705ef3341091fb989b7eaf', input },
    { headers }
  );

  const predictionId = startRes.data.id;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const poll = await axios.get(
      `https://api.replicate.com/v1/predictions/${predictionId}`, { headers });
    if (poll.data.status === 'succeeded' && poll.data.output?.[0]) {
      return { thumbnailUrl: poll.data.output[0], prompt };
    }
    if (poll.data.status === 'failed') throw new Error('Replicate failed');
  }
  throw new Error('Replicate timed out');
}

module.exports = { generateSeo, generateTags, generateThumbnail };
