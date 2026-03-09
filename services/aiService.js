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
- Examples of good titles: "I Tried 7 AI Tools for 30 Days - Here's What Happened", "This $10 Trick Made My Videos Go Viral"
- NO clickbait, NO ALL CAPS words, NO excessive punctuation

RULES FOR DESCRIPTION:
- Write like a real human creator, NOT like AI
- Start with a hook sentence (what the viewer will learn/get)
- 250-350 words total
- Include natural paragraph breaks
- Add a "What's covered:" section with 3-4 bullet points  
- End with a casual CTA like "Drop a comment below" or "Let me know what you think"
- Include placeholder: [SUBSCRIBE LINK] and [SOCIAL LINKS]
- Sound conversational, warm, and genuine

Return ONLY valid JSON, no markdown:
{
  "title": "your title here",
  "description": "your full description here",
  "tags": ["tag1","tag2",...20 tags total, mix of short and long-tail],
  "hashtags": ["#hashtag1","#hashtag2",...10 hashtags],
  "keywords": ["trending keyword 1","trending keyword 2","trending keyword 3","trending keyword 4","trending keyword 5"]
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

Mix these types:
- 5 broad single keywords
- 10 medium 2-3 word phrases  
- 10 long-tail specific phrases (4-6 words)

Return ONLY a JSON array, no markdown, no explanation:
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
async function generateThumbnail({ topic, prompt, referenceImagePath, faceImagePath }) {
  const enhancedPrompt = buildThumbnailPrompt(topic, prompt);
  console.log('Generating thumbnail with prompt:', enhancedPrompt.substring(0, 100));

  if (process.env.REPLICATE_API_TOKEN) {
    return await generateWithReplicate(enhancedPrompt, referenceImagePath);
  }
  if (process.env.STABILITY_API_KEY) {
    return await generateWithStability(enhancedPrompt);
  }

  // Fallback placeholder
  return {
    thumbnailUrl: `https://placehold.co/1280x720/6C63FF/FFFFFF?text=${encodeURIComponent(topic)}`,
    prompt: enhancedPrompt,
    topic,
  };
}

function buildThumbnailPrompt(topic, userPrompt) {
  const extra = userPrompt ? userPrompt + ', ' : '';
  return `${extra}YouTube thumbnail for topic: ${topic}, eye-catching design, vibrant colors, bold composition, dramatic lighting, professional quality, 16:9 aspect ratio, high resolution`;
}

// ─── Replicate (SDXL) ─────────────────────────────────────────────────────────
async function generateWithReplicate(prompt, imagePath) {
  const headers = {
    'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  // Build input — use img2img if reference image available
  const input = {
    prompt,
    negative_prompt: 'blurry, low quality, distorted, watermark, text, ugly',
    width: 1280,
    height: 720,
    num_inference_steps: 25,
    guidance_scale: 7,
    num_outputs: 1,
  };

  // If reference image exists, convert to base64 correctly
  if (imagePath && fs.existsSync(imagePath)) {
    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const base64 = imageBuffer.toString('base64');
      const ext = path.extname(imagePath).toLowerCase().replace('.', '') || 'jpeg';
      const mimeType = ext === 'jpg' ? 'jpeg' : ext;
      input.image = `data:image/${mimeType};base64,${base64}`;
      input.prompt_strength = 0.75;
      console.log(`Reference image loaded: ${imageBuffer.length} bytes`);
    } catch (e) {
      console.log('Could not load reference image, generating from text only:', e.message);
    }
  }

  // Use SDXL model
  const startRes = await axios.post(
    'https://api.replicate.com/v1/predictions',
    {
      version: 'da77bc59ee60423279fd632efb4795ab731d9e3ca9705ef3341091fb989b7eaf',
      input,
    },
    { headers }
  );

  const predictionId = startRes.data.id;
  if (!predictionId) throw new Error('Replicate did not return a prediction ID');

  console.log('Replicate prediction started:', predictionId);

  // Poll for result (max 60 seconds)
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await axios.get(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      { headers }
    );

    const { status, output, error } = pollRes.data;
    console.log(`Poll ${i + 1}: status = ${status}`);

    if (status === 'succeeded' && output && output[0]) {
      return { thumbnailUrl: output[0], prompt };
    }
    if (status === 'failed') {
      throw new Error(`Replicate generation failed: ${error || 'unknown error'}`);
    }
  }

  throw new Error('Thumbnail generation timed out. Please try again.');
}

// ─── Stability AI ─────────────────────────────────────────────────────────────
async function generateWithStability(prompt) {
  const FormData = require('form-data');
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

  return {
    thumbnailUrl: `data:image/webp;base64,${res.data.image}`,
    prompt,
  };
}

module.exports = { generateSeo, generateTags, generateThumbnail };
