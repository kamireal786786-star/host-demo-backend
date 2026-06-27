import express from "express";
import cors from "cors";
import { config } from "./config.js";
import {
  getFullState, getProduct, updateProduct,
  getAiInstructions, updateAiInstructions,
  getBidState, setBidRules, resetBid,
  getIdleTalkSettings, updateIdleTalkSettings,
  getConnectionState,
} from "./store.js";

export function startApiServer({ startStream, stopStream, broadcast, handleComment }) {
  const app = express();
  app.use(express.json());
  app.use(cors({
    origin: config.allowedOrigins.includes("*") ? true : config.allowedOrigins,
  }));

  app.get("/api/state", (req, res) => res.json(getFullState()));

  // ---- HeyGen / LiveAvatar token ----
  app.post("/api/heygen-token", async (req, res) => {
    if (!config.heygenApiKey)
      return res.status(500).json({ error: "HEYGEN_API_KEY not set on server" });
    if (!config.heygenAvatarId)
      return res.status(500).json({ error: "HEYGEN_AVATAR_ID not set on server" });
    try {
      const response = await fetch("https://api.liveavatar.com/v1/sessions/token", {
        method: "POST",
        headers: { "X-API-KEY": config.heygenApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "FULL",
          avatar_id: config.heygenAvatarId,
          avatar_persona: { language: "en" },
          quality: "low",
        }),
      });
      const data = await response.json();
      if (!response.ok || data.code !== 1000)
        return res.status(502).json({ error: "LiveAvatar token request failed", detail: data });
      res.json({ sessionToken: data.data.session_token, sessionId: data.data.session_id });
    } catch (err) {
      res.status(502).json({ error: "Failed to reach LiveAvatar API", detail: err.message });
    }
  });

  // ---- Product ----
  app.get("/api/product", (req, res) => res.json(getProduct()));
  app.put("/api/product", (req, res) => {
    const updated = updateProduct(req.body);
    broadcast({ type: "stateChanged", section: "product", data: updated });
    res.json(updated);
  });

  // ---- AI instructions ----
  app.get("/api/ai-instructions", (req, res) => res.json(getAiInstructions()));
  app.put("/api/ai-instructions", (req, res) => {
    const updated = updateAiInstructions(req.body);
    broadcast({ type: "stateChanged", section: "aiInstructions", data: updated });
    res.json(updated);
  });

  // ---- Bid rules ----
  app.get("/api/bid", (req, res) => res.json(getBidState()));
  app.put("/api/bid/rules", (req, res) => {
    const updated = setBidRules(req.body);
    broadcast({ type: "bidUpdate", ...updated });
    res.json(updated);
  });
  app.post("/api/bid/reset", (req, res) => {
    const updated = resetBid();
    broadcast({ type: "bidUpdate", ...updated });
    res.json(updated);
  });

  // ---- Idle talk ----
  app.get("/api/idle-talk", (req, res) => res.json(getIdleTalkSettings()));
  app.put("/api/idle-talk", (req, res) => {
    const updated = updateIdleTalkSettings(req.body);
    broadcast({ type: "stateChanged", section: "idleTalk", data: updated });
    res.json(updated);
  });

  // ---- Connection ----
  app.get("/api/connection", (req, res) => res.json(getConnectionState()));
  app.post("/api/connection/start", (req, res) => {
    const { tiktokUsername } = req.body;
    if (!tiktokUsername)
      return res.status(400).json({ error: "tiktokUsername is required" });
    const current = getConnectionState();
    if (current.isLive)
      return res.status(409).json({ error: "Already connected. Stop first." });
    startStream(tiktokUsername);
    res.json({ started: true, tiktokUsername });
  });
  app.post("/api/connection/stop", (req, res) => {
    stopStream();
    res.json({ stopped: true });
  });

  // ---- Manual speak ----
  app.post("/api/speak", (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });
    broadcast({ type: "speak", text });
    res.json({ spoken: true });
  });

  // ---- Test comment (simulate a viewer comment without TikTok) ----
  app.post("/api/test-comment", (req, res) => {
    const { username, comment } = req.body;
    if (!username || !comment)
      return res.status(400).json({ error: "username and comment are required" });
    handleComment({ username, comment });
    res.json({ received: true });
  });

  app.use((req, res) => res.status(404).json({ error: "Not found" }));

  const httpServer = app.listen(config.httpPort, () => {
    console.log(`API server listening on http://localhost:${config.httpPort}`);
  });

  return httpServer;
}
