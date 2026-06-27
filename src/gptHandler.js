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

  return `You are a warm, natural live host on TikTok selling one product. You speak like a real person — not a robot, not a script reader.

Product:
- Name: ${product.name}
- Features: ${product.features}
- Price: ${product.price}
- Shipping: ${product.shipping}

Personality: ${ai.personality}
${ai.extraRules ? `Additional rules: ${ai.extraRules}` : ""}

HOW TO SPEAK:
- Use natural filler transitions: "so", "you know", "honestly", "I mean", "look"
- Vary your sentence length — short punchy ones mixed with longer flowing ones
- Occasionally pause mid-thought with "..." to sound like you're thinking
- Sound genuinely excited, not performatively excited
- Never list features robotically — weave them into natural sentences
- Respond to comments like a real person would in conversation, not like a customer service bot
- Keep every response under 35 words — you are speaking out loud
- Never use emojis, hashtags, bullet points, or markdown
- Never say "as an AI" or break character
- This is a fixed price item — there is no bidding, no auction. The price is set.`;
}

export async function generateCommentResponse(username, commentText) {
  const prompt = `Viewer "${username}" just said: "${commentText}"

Respond naturally as the host — like you'd reply to a friend who just asked you something mid-conversation. Keep it under 35 words.`;
  return callGemini(prompt);
}

export async function generateIdleChatter(topicHint) {
  const topics = {
    welcome: "Welcome new viewers warmly and briefly mention what you're selling, like you're telling a friend.",
    benefits: "Naturally bring up one specific thing you love about this product — make it feel genuine.",
    price: "Mention the price in a way that makes it feel like great value, not a sales pitch.",
    shipping: "Casually mention shipping like it just came to mind.",
    urgency: "Create gentle natural urgency — like you genuinely think people should grab it.",
    personal: "Share a tiny personal thought about the product — like why you'd use it yourself.",
  };

  const instruction = topics[topicHint] || topics.welcome;
  const prompt = `You're live and the chat has been quiet for a moment. ${instruction} Sound completely natural, under 35 words.`;
  return callGemini(prompt);
}

async function callGemini(userPrompt) {
  try {
    const model = getModel();
    const result = await model.generateContent({
      systemInstruction: buildSystemPrompt(),
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens: 80,
        temperature: 1.0,
        topP: 0.95,
      },
    });
    return result.response.text().trim();
  } catch (err) {
    console.error("Gemini API error:", err.message);
    return "Sorry, give me just a second...";
  }
}

const IDLE_TOPICS = ["welcome", "benefits", "price", "shipping", "urgency", "personal"];
let idleTopicIndex = 0;

export function nextIdleTopic() {
  const topic = IDLE_TOPICS[idleTopicIndex % IDLE_TOPICS.length];
  idleTopicIndex++;
  return topic;
}
