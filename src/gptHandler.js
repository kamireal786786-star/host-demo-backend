import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "./config.js";
import { getProduct, getAiInstructions } from "./store.js";

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

function getModel() {
  return genAI.getGenerativeModel({ model: config.geminiModel });
}

function buildSystemPrompt() {
  const product = getProduct();
  const ai = getAiInstructions();
  return `You are a TikTok Live seller. You are selling: ${product.name} at ${product.price}.
Product details: ${product.features}. Shipping: ${product.shipping}.
Personality: ${ai.personality}.
${ai.extraRules ? ai.extraRules : ""}
Rules: Respond in 1-2 complete sentences. 15-25 words maximum. No emojis. No markdown. End with punctuation.`;
}

// ─── Scripted idle lines — reliable, complete, product-specific ────────────
const IDLE_SCRIPTS = [
  (p) => `Welcome everyone! We're live showing the ${p.name} — ${p.features.split(',')[0].trim()}. Stick around!`,
  (p) => `The ${p.name} is ${p.price}. Honestly great value for what you get — comment to order!`,
  (p) => `Shipping on this: ${p.shipping}. So you won't be waiting long at all.`,
  (p) => `Quick highlight — ${p.features.split(',')[1]?.trim() || p.features.split(',')[0].trim()}. That's what makes the ${p.name} stand out.`,
  (p) => `If you're thinking about it, don't wait. The ${p.name} is available right now at ${p.price}.`,
  (p) => `Over a thousand five-star reviews on this one. The ${p.name} just works — people love it.`,
  (p) => `Drop a comment or DM if you want to order the ${p.name}. Happy to answer any questions too!`,
  (p) => `${p.features.split(',')[2]?.trim() || 'Sugar free and vegan'} — and it tastes great too. The ${p.name} is the real deal.`,
];

let idleIndex = 0;

export async function generateIdleChatter() {
  const product = getProduct();
  const line = IDLE_SCRIPTS[idleIndex % IDLE_SCRIPTS.length](product);
  idleIndex++;
  return line;
}

// ─── Comment responses — Gemini handles these ─────────────────────────────
export async function generateCommentResponse(username, commentText) {
  const product = getProduct();

  // Handle common questions directly without Gemini (faster + more reliable)
  const lower = commentText.toLowerCase().trim();

  if (lower.match(/\bprice\b|\bhow much\b|\bcost\b|\bpkr\b|\bkitna\b/)) {
    return `Great question! The ${product.name} is ${product.price}. Comment to place your order right now!`;
  }
  if (lower.match(/\bship\b|\bdelivery\b|\bdeliver\b|\bhow long\b|\bkab\b/)) {
    return `Shipping is ${product.shipping}. We deliver fast — comment to order!`;
  }
  if (lower.match(/\bwhat is\b|\bwhat's this\b|\bkya hai\b|\bkya h\b/)) {
    return `This is the ${product.name} — ${product.features.split(',')[0].trim()}. Amazing product at ${product.price}!`;
  }
  if (lower.match(/\bhow to order\b|\border\b|\bbuy\b|\bkaise\b|\bkhareed\b/)) {
    return `To order the ${product.name}, just comment your details or send a DM! Price is ${product.price}.`;
  }
  if (lower.match(/\bingredient\b|\bwhat's in\b|\bcontain\b/)) {
    return `${product.name} contains ${product.features.split('.')[0]}. All clean, natural ingredients!`;
  }

  // Fall back to Gemini for other questions
  const prompt = `A viewer named "${username}" commented: "${commentText}"

You are selling ${product.name} at ${product.price}. Respond directly and helpfully to what they said. One or two sentences, under 25 words, end with punctuation.`;

  return callGemini(prompt);
}

export function nextIdleTopic() { return "general"; }

async function callGemini(userPrompt) {
  try {
    const model = getModel();
    const result = await model.generateContent({
      systemInstruction: buildSystemPrompt(),
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens: 50,
        temperature: 0.7,
        topP: 0.9,
      },
    });
    const text = result.response.text().trim();
    if (!text || text.length < 5) return null;
    const lastChar = text[text.length - 1];
    if (!['.', '!', '?'].includes(lastChar)) return text + '.';
    return text;
  } catch (err) {
    console.error("Gemini API error:", err.message);
    return null;
  }
}
