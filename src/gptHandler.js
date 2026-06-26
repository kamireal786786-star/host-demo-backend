import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "./config.js";
import { getProduct, getAiInstructions } from "./store.js";

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

function getModel() {
  return genAI.getGenerativeModel({ model: config.geminiModel });
}

/**
 * Builds the system prompt fresh on every call — dashboard edits apply
 * to the very next Gemini call with no restart needed.
 */
function buildSystemPrompt() {
  const product = getProduct();
  const ai = getAiInstructions();

  return `You are an energetic, persuasive live auction host on TikTok Live.

Product being sold:
- Name: ${product.name}
- Features: ${product.features}
- Price: ${product.price}
- Shipping: ${product.shipping}

Personality: ${ai.personality}
${ai.extraRules ? `Additional rules: ${ai.extraRules}` : ""}

Rules:
- Keep every response under 30 words. You are speaking out loud, not writing.
- Always try to nudge viewers toward bidding.
- Never make up facts about the product beyond what's listed above.
- Do not use emojis, hashtags, or markdown — this text is converted directly to speech.
- Do not say "as an AI" or break character.`;
}

export async function generateCommentResponse(username, commentText, bidState) {
  const prompt = `Viewer "${username}" said: "${commentText}"

Current highest bid: $${bidState.currentBid}${bidState.currentBidder ? ` by ${bidState.currentBidder}` : " (no bids yet)"}

Respond as the host, speaking directly to the stream (don't repeat the viewer's name unless natural).`;

  return callGemini(prompt);
}

export async function generateBidAnnouncement(amount, username, previousBid) {
  const prompt = `A new highest bid just came in: $${amount} from ${username}. Previous highest bid was $${previousBid}.

Announce this bid enthusiastically and encourage others to top it.`;

  return callGemini(prompt);
}

export async function generateBidRejection(attemptedAmount, username, reason) {
  const prompt = `${username} tried to bid $${attemptedAmount}, but it wasn't accepted: ${reason}. Gently let them know, and stay upbeat.`;

  return callGemini(prompt);
}

export async function generateIdleChatter(bidState, topicHint) {
  const topics = {
    welcome: "Welcome new viewers who just joined and briefly explain what's being auctioned.",
    benefits: "Highlight one specific feature or benefit of the product.",
    bidStatus: `Announce the current highest bid ($${bidState.currentBid}${bidState.currentBidder ? ` by ${bidState.currentBidder}` : ""}) and invite others to beat it.`,
    shipping: "Mention shipping details to reassure potential bidders.",
    urgency: "Create gentle urgency — remind viewers the auction won't last forever.",
  };

  const instruction = topics[topicHint] || topics.welcome;
  const prompt = `No one has said anything in chat for a bit. ${instruction}`;

  return callGemini(prompt);
}

async function callGemini(userPrompt) {
  try {
    const model = getModel();
    const result = await model.generateContent({
      systemInstruction: buildSystemPrompt(),
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens: 100,
        temperature: 0.8,
      },
    });
    return result.response.text().trim();
  } catch (err) {
    console.error("Gemini API error:", err.message);
    return "Sorry folks, having a little technical hiccup — but the auction is still live, keep those bids coming!";
  }
}

const IDLE_TOPICS = ["welcome", "benefits", "bidStatus", "shipping", "urgency"];
let idleTopicIndex = 0;

export function nextIdleTopic() {
  const topic = IDLE_TOPICS[idleTopicIndex % IDLE_TOPICS.length];
  idleTopicIndex++;
  return topic;
}
