import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";
import { getProduct, getAiInstructions } from "./store.js";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

function buildSystemPrompt() {
  const product = getProduct();
  const aiInstructions = getAiInstructions();
  return `You are a TikTok Live seller hosting a livestream right now.

PRODUCT FACTS (use these — don't make anything up beyond them):
- Name: ${product.name}
- Price: ${product.price}
- Features/details: ${product.features}
- Shipping: ${product.shipping}

Personality: ${aiInstructions.personality}.
${aiInstructions.extraRules ? aiInstructions.extraRules : ""}

How to respond to viewer comments:
- Actually answer the specific thing the viewer asked or said — don't just repeat generic hype.
- If they ask something the product facts above don't cover (e.g. a very specific certification, allergy detail, exact delivery date), be honest that you don't have that exact detail, invite them to comment/DM for more, and steer back to the product.
- If it's not a question (e.g. "great product", a compliment, a joke), react naturally to it — don't just dump product info.
- 1-2 complete sentences, 10-25 words. No emojis. No markdown. Always end with proper punctuation (. ! or ?).`;
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

// ─── Comment responses ─────────────────────────────────────────────────────
//
// Strategy: only the handful of intents where an instant, perfectly
// consistent, on-brand answer matters more than "understanding" stay
// hardcoded (price, how-to-order). Everything else — shipping, ingredients,
// safety, reactions, off-script questions, typos, Roman Urdu, whatever a
// viewer types — goes to Gemini, which actually reads the comment and
// answers it using the real product facts. If Gemini ever fails or returns
// something low-quality, we retry once, then fall back to a safe line that
// still engages the viewer — a comment should never get silently ignored.

const FAST_PATHS = [
  {
    name: "price",
    test: (lower) => /\b(price|cost|kitna)\b/.test(lower) || /\bpkr\b/.test(lower) || /how much( is|'s)?\s*(it|this|that)?\s*$/.test(lower),
    reply: (product) =>
      `Great question! The ${product.name} is ${product.price}. Comment to place your order right now!`,
  },
  {
    name: "order",
    test: (lower) => /\b(how (do|to) (i|you)? ?(order|buy)|wanna buy|want to buy|kaise khareed|how to order)\b/.test(lower),
    reply: (product) =>
      `To order the ${product.name}, just comment your details or send a DM! Price is ${product.price}.`,
  },
];

export async function generateCommentResponse(username, commentText) {
  const product = getProduct();
  const lower = commentText.toLowerCase().trim();

  for (const path of FAST_PATHS) {
    if (path.test(lower)) {
      return path.reply(product);
    }
  }

  // Everything else: let the model actually read and answer the comment.
  const prompt = `A viewer named "${username}" commented: "${commentText}"

Respond directly to what they said, using the product facts you were given.`;

  const aiResponse = await callGeminiWithRetry(prompt);
  if (aiResponse) return aiResponse;

  // Guaranteed fallback — never let a comment go unanswered just because
  // the AI call failed or returned junk.
  return safeFallback(product);
}

export function nextIdleTopic() { return "general"; }

function safeFallback(product) {
  const lines = [
    `Great question! Drop a comment or send a DM and I'll get you all the details on the ${product.name}.`,
    `Love the engagement! Comment below and I'll make sure you get a full answer on that.`,
    `Good one — comment or DM me and I'll walk you through everything on the ${product.name}.`,
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

// ─── Quality gate ───────────────────────────────────────────────────────────
// Rejects empty/too-short/non-answer responses (e.g. a bare "Absolutely,")
// instead of letting them through just because they're 5+ characters.
function isUsableResponse(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 8) return false;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount < 3) return false;
  return true;
}

function finalizePunctuation(text) {
  let cleaned = text.trim();
  // Strip trailing commas/semicolons/dashes before adding sentence punctuation,
  // so we never end up with something like "Absolutely,."
  cleaned = cleaned.replace(/[,;:\-–—\s]+$/, "");
  const lastChar = cleaned[cleaned.length - 1];
  if (!['.', '!', '?'].includes(lastChar)) {
    cleaned += '.';
  }
  return cleaned;
}

async function callGeminiWithRetry(userPrompt) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await callGemini(
      attempt === 0
        ? userPrompt
        : `${userPrompt}\n\nYour previous reply wasn't usable (too short or didn't actually answer). Try again with a real, complete answer.`
    );
    if (isUsableResponse(text)) {
      return finalizePunctuation(text);
    }
  }
  return null;
}

async function callGemini(userPrompt) {
  try {
    const result = await ai.models.generateContent({
      model: config.geminiModel,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: buildSystemPrompt(),
        maxOutputTokens: 60,
        temperature: 0.7,
        topP: 0.9,
        // gemini-2.5-flash has "thinking" on by default, and thinking tokens
        // count against maxOutputTokens — with a small budget like this, the
        // model can burn it all on invisible reasoning and return empty text
        // with no error. We don't need reasoning for a short chat reply.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    return (result.text || "").trim();
  } catch (err) {
    console.error("Gemini API error:", err?.message || err);
    return null;
  }
}

// ─── Startup self-test ──────────────────────────────────────────────────────
// The Gemini SDK/model/key can silently break (wrong model name, expired key,
// quota, deprecated SDK version, etc.) and the failure mode looks identical
// to "comments are getting ignored" from the outside — every comment quietly
// falls back to the safe generic line with no obvious error in the stream.
// Call this once at boot so a broken setup shows up immediately in the logs
// instead of being discovered live.
export async function testGeminiConnection() {
  try {
    const result = await ai.models.generateContent({
      model: config.geminiModel,
      contents: [{ role: "user", parts: [{ text: "Reply with the word OK." }] }],
      config: { maxOutputTokens: 10, thinkingConfig: { thinkingBudget: 0 } },
    });
    const text = (result.text || "").trim();
    if (text) {
      console.log(`Gemini self-test OK (model: ${config.geminiModel}) — sample reply: "${text}"`);
      return true;
    }
    const finishReason = result.candidates?.[0]?.finishReason;
    console.error(`Gemini self-test FAILED — model "${config.geminiModel}" returned an empty response (finishReason: ${finishReason || "unknown"}). Comment replies will fall back to generic lines until this is fixed.`);
    return false;
  } catch (err) {
    console.error(`Gemini self-test FAILED — model "${config.geminiModel}" errored: ${err?.message || err}. Check GEMINI_API_KEY and GEMINI_MODEL. Comment replies will fall back to generic lines until this is fixed.`);
    return false;
  }
}
