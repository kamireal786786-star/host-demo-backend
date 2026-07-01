import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";
import { getProduct, getAiInstructions } from "./store.js";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

function buildSystemPrompt() {
  const product = getProduct();
  const aiInstructions = getAiInstructions();
  return `You are hosting a TikTok Live selling ${product.name} right now. You talk the way real live-selling hosts talk: fast, casual, almost nonstop, never reading like a script.

PRODUCT FACTS (use these — don't make anything up beyond them):
- Name: ${product.name}
- Price: ${product.price}
- Features/details: ${product.features}
- Shipping: ${product.shipping}

Personality: ${aiInstructions.personality}.
${aiInstructions.extraRules ? aiInstructions.extraRules : ""}

VOICE — this is the most important part. A real host sounds like this (notice the rhythm, not the words):
"look! what I got today for you. it's really useful as you can see right here. let's welcome everyone just joining while I tell you we've got free shipping today. ask anything in the comments. but I'm telling you, this isn't something you wanna scroll past. boom, another one just grabbed it. we only got limited stock left so don't sleep on it."
Match THAT energy: short punchy clauses strung together with "and," "but," "look," "okay," low-key reactions like "boom" or "let's go," casual contractions (it's, we've, don't, gonna), and a sense of momentum — like you're mid-stream and never fully stop. Avoid sounding like a polished ad read or a customer-service bot. Don't over-explain. Don't restate the same sentence structure twice in a row.

How to respond to viewer comments:
- Actually answer the specific thing the viewer asked or said — don't just repeat generic hype.
- If they ask something the product facts above don't cover (e.g. a very specific certification, allergy detail, exact delivery date), be honest that you don't have that exact detail, invite them to comment/DM for more, and steer back to the product.
- If it's not a question (e.g. "great product", a compliment, a joke), react naturally to it — don't just dump product info.
- 1-2 complete sentences, 10-25 words. No emojis. No markdown. Always end with proper punctuation (. ! or ?).`;
}

// ─── Scripted idle lines — ONLY used as an emergency fallback if Gemini is
// down. Normal idle chatter is generated fresh every time (see below) so it
// doesn't feel like a looped AI script.
const IDLE_FALLBACK_SCRIPTS = [
  (p) => `Welcome everyone! We're live showing the ${p.name} — ${p.features.split(',')[0].trim()}. Stick around!`,
  (p) => `The ${p.name} is ${p.price}. Honestly great value for what you get — comment to order!`,
  (p) => `Shipping on this: ${p.shipping}. So you won't be waiting long at all.`,
  (p) => `If you're thinking about it, don't wait. The ${p.name} is available right now at ${p.price}.`,
  (p) => `Drop a comment or DM if you want to order the ${p.name}. Happy to answer any questions too!`,
];

let idleFallbackIndex = 0;
const recentIdleLines = []; // last few generated lines, to nudge Gemini away from repeating itself
const RECENT_IDLE_MEMORY = 6;

// Rotate through different "angles" a real host cycles through, so back-to-back
// lines don't all sound like the same kind of sentence.
const IDLE_ANGLES = [
  "Talk about what the product does or looks like right now — be specific and direct, like you're holding it up.",
  "Welcome new viewers joining mid-stream and quickly catch them up on what's happening.",
  "Create urgency — limited stock, today only, people are already buying — but say it casually not pushy.",
  "React to the vibe of the stream, acknowledge comments flying in, energy in the chat — keep it hype.",
  "Mention a practical detail a buyer cares about — shipping, condition, what they'll get in the box.",
  "Invite the audience to ask questions or comment, like you're genuinely talking with them.",
  "Tell a quick anecdote or reaction like 'my friend tried this and...' or 'I wasn't expecting it but...'",
  "Transition out of replying mode back into selling mode — like 'anyway back to this thing...' or 'okay look...'",
];
let angleIndex = 0;

export async function generateIdleChatter() {
  const product = getProduct();
  const angle = IDLE_ANGLES[angleIndex % IDLE_ANGLES.length];
  angleIndex++;

  const avoidList = recentIdleLines.length
    ? `\n\nDon't repeat these recent lines or their sentence structure:\n${recentIdleLines.map((l) => `- "${l}"`).join("\n")}`
    : "";

  const prompt = `Keep the stream going. You're mid-monologue — say the next thing a live host would say right now.
Angle: ${angle}${avoidList}

One line only, natural host voice, no quotation marks. Sound like you're mid-stream, not starting fresh.`;

  const text = await callGemini(prompt, buildSystemPrompt());
  if (isUsableResponse(text)) {
    const line = finalizePunctuation(text);
    recentIdleLines.push(line);
    if (recentIdleLines.length > RECENT_IDLE_MEMORY) recentIdleLines.shift();
    return line;
  }

  // Gemini failed — fall back to a scripted line rather than going silent.
  const line = IDLE_FALLBACK_SCRIPTS[idleFallbackIndex % IDLE_FALLBACK_SCRIPTS.length](product);
  idleFallbackIndex++;
  return line;
}

// ─── Bid acknowledgment ─────────────────────────────────────────────────────
export async function generateBidAck(username, amount, product) {
  const prompt = `You're mid-stream and "${username}" just placed a bid of $${amount} on the ${product.name}. Call it out live like you just saw it — excited but natural, like "boom, we got ${username} at $${amount}!" Keep it short (8-18 words) and invite others to go higher. Sound mid-stream, not like an announcement.`;
  const text = await callGemini(prompt, buildSystemPrompt());
  if (isUsableResponse(text)) return finalizePunctuation(text);
  return `boom — ${username} just dropped $${amount}, who's going higher than that?`;
}

// ─── Comment responses — smooth pivot style ──────────────────────────────────
// Instead of a cold reply, the host naturally bridges from whatever they were
// saying to addressing the comment — the way a real streamer does it.

const FAST_PATHS = [
  {
    name: "price",
    test: (lower) => /\b(price|cost|kitna)\b/.test(lower) || /\bpkr\b/.test(lower) || /how much( is|'s)?\s*(it|this|that)?\s*$/.test(lower),
    reply: (product) =>
      `oh and someone's asking about price — it's ${product.price} right now, that's the deal you're getting today.`,
  },
  {
    name: "order",
    test: (lower) => /\b(how (do|to) (i|you)? ?(order|buy)|wanna buy|want to buy|kaise khareed|how to order)\b/.test(lower),
    reply: (product) =>
      `someone wants to know how to order — just drop a comment or DM and we'll sort you out, price is ${product.price}.`,
  },
];

// Generates a reply that flows naturally from the host's ongoing monologue,
// as if they just glanced at the comment mid-sentence and pivoted to it.
export async function generateTransition(username, commentText) {
  const product = getProduct();
  const lower = commentText.toLowerCase().trim();

  for (const path of FAST_PATHS) {
    if (path.test(lower)) return path.reply(product);
  }

  const prompt = `You're mid-stream and a viewer named "${username}" just commented: "${commentText}"

Respond naturally — like you spotted it while talking and smoothly pivoted. Use a brief connector ("oh, ${username} is asking..." / "and look, someone said..." / "actually that's a good one...") then answer it using your product facts. Keep it conversational and end back on the product or stream, not hanging. 1-2 sentences, 10-28 words.`;

  const aiResponse = await callGeminiWithRetry(prompt, buildSystemPrompt());
  if (aiResponse) return aiResponse;

  return `oh good question from ${username} — drop a comment or DM and I'll walk you through everything on the ${product.name}.`;
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

async function callGeminiWithRetry(userPrompt, systemPrompt) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await callGemini(
      attempt === 0
        ? userPrompt
        : `${userPrompt}\n\nYour previous reply wasn't usable (too short or didn't actually answer). Try again with a real, complete answer.`,
      systemPrompt
    );
    if (isUsableResponse(text)) {
      return finalizePunctuation(text);
    }
  }
  return null;
}

async function callGemini(userPrompt, systemPrompt) {
  try {
    const result = await ai.models.generateContent({
      model: config.geminiModel,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: systemPrompt || buildSystemPrompt(),
        maxOutputTokens: 60,
        temperature: 0.85,
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
