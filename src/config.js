import dotenv from "dotenv";
dotenv.config();

export const config = {
  // TikTok
  eulerApiKey: process.env.EULER_API_KEY,

  // Gemini
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",

  // HeyGen / LiveAvatar
  heygenApiKey: process.env.HEYGEN_API_KEY,
  heygenAvatarId: process.env.HEYGEN_AVATAR_ID,

  // Ports — Railway injects PORT automatically
  httpPort: parseInt(process.env.PORT || process.env.HTTP_PORT || "3000", 10),

  // CORS
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()),
};

export function validateConfig() {
  const missing = [];
  if (!config.geminiApiKey) missing.push("GEMINI_API_KEY");
  if (!config.heygenApiKey) missing.push("HEYGEN_API_KEY");
  if (!config.heygenAvatarId) missing.push("HEYGEN_AVATAR_ID");

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    console.error("Copy .env.example to .env and fill in your values.");
    process.exit(1);
  }

  if (!config.eulerApiKey) {
    console.warn(
      "WARNING: EULER_API_KEY not set. tiktok-live-connector v2 requires a free " +
      "Euler Stream API key. Get one at https://www.eulerstream.com"
    );
  }
}
