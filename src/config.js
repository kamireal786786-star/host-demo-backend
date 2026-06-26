import dotenv from "dotenv";
dotenv.config();

export const config = {
  // Signing key for tiktok-live-connector (required) — free tier at eulerstream.com
  eulerApiKey: process.env.EULER_API_KEY,

  // Gemini
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.0-flash",

  // Ports — Railway injects PORT automatically, fallback to HTTP_PORT or 3000
  httpPort: parseInt(process.env.PORT || process.env.HTTP_PORT || "3000", 10),

  // CORS — set to your frontend's deployed URL in production.
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()),
};

export function validateConfig() {
  const missing = [];
  if (!config.geminiApiKey) missing.push("GEMINI_API_KEY");

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    console.error("Copy .env.example to .env and fill in your values.");
    process.exit(1);
  }

  if (!config.eulerApiKey) {
    console.warn(
      "WARNING: EULER_API_KEY not set. tiktok-live-connector v2 requires a free " +
      "Euler Stream API key to connect to TikTok Live chat. Get one at " +
      "https://www.eulerstream.com — the backend will run, but TikTok connection will fail."
    );
  }
}
