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

  return `You are a TikTok Live seller hosting a product show. You speak naturally like a real human seller — warm, energetic, convincing.

Product you are selling:
- Name: ${product.name}
- Features: ${product.features}
- Price: ${product.price}
- Shipping: ${product.shipping}

Your personality: ${ai.personality}
${ai.extraRules ? `Additional rules: ${ai.extraRules}` : ""}

STRICT RULES:
- Always write COMPLETE sentences. Never cut off mid-sentence.
- Keep responses between 15 and 30 words — no more, no less.
- Speak in complete thoughts that make sense on their own.
- No emojis, hashtags, bullet points, or markdown.
- Never say "as an AI" or break character.
- This is a fixed price item — not an auction.
- Sound like a real person, not a robot reading a script.`;
}

const IDLE_SCRIPTS = [
  (p) => `Welcome everyone just joining! I'm here showing off the ${p.name} — honestly one of my favorite products right now. Stick around!`,
  (p) => `So the ${p.name} — what makes it special is ${p.features.split(',')[0].trim().toLowerCase()}. That alone is worth it.`,
  (p) => `Quick reminder on pricing — the ${p.name} is ${p.price}. That's a solid deal for what you're getting, trust me.`,
  (p) => `Shipping on this is ${p.shipping}. So you're not waiting forever, which I know is the first thing everyone asks.`,
  (p) => `If you've been on the fence about the ${p.name} — honestly just go for it. Comment below or DM me to order.`,
  (p) => `Real talk — I've been selling this for a while and the feedback is always great. The ${p.name} just delivers every time.`,
  (p) => `For anyone just tuning in — we've got the ${p.name} available right now at ${p.price}. Drop a comment if you want one!`,
  (p) => `What I love about this is how easy it is to use. The ${p.name} — you'll figure it out in seconds. No learning curve at all.`,
];

let idleIndex = 0;

export async function generateIdleChatter() {
  const product = getProduct();

  // Use scripted lines first — they're reliable and complete
  if (idleIndex < IDLE_SCRIPTS.length) {
    const line = IDLE_SCRIPTS[idleIndex % IDLE_SCRIPTS.length](product);
    idleIndex++;
    return line;
  }

  // After cycling through scripts, use Gemini for variety
  idleIndex = 0; // reset so scripts cycle again after Gemini turn
  const topics = [
    `You're live selling the ${product.name}. Welcome new viewers and mention one key benefit naturally. Complete sentence, under 25 words.`,
    `You're live selling the ${product.name} at ${product.price}. Remind viewers about the price in an exciting way. Complete sentence, under 25 words.`,
    `You're live selling the ${product.name}. Create gentle urgency — tell viewers not to miss out. Complete sentence, under 25 words.`,
  ];
  const prompt = topics[Math.floor(Math.random() * topics.length)];
  return callGemini(prompt);
}

export async function generateCommentResponse(username, commentText) {
  const product = getProduct();
  const prompt = `You are live selling the ${product.name} at ${product.price}.

A viewer named "${username}" just commented: "${commentText}"

Reply naturally as the seller — answer their question or respond to their comment. Be warm and helpful. Complete sentence, 15-30 words.`;
  return callGemini(prompt);
}

export function nextIdleTopic() {
  return "general"; // kept for compatibility, not used
}

async function callGemini(userPrompt) {
  try {
    const model = getModel();
    const result = await model.generateContent({
      systemInstruction: buildSystemPrompt(),
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens: 60,
        temperature: 0.85,
        topP: 0.9,
      },
    });
    const text = result.response.text().trim();
    // Safety check — if response looks cut off (no sentence-ending punctuation), add a period
    const lastChar = text[text.length - 1];
    if (!['.', '!', '?'].includes(lastChar)) return text + '.';
    return text;
  } catch (err) {
    console.error("Gemini API error:", err.message);
    return null; // return null so caller can skip speaking instead of saying error text
  }
}
