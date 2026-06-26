import express from "express";
import cors from "cors";
import { config } from "./config.js";
import {
  getFullState,
  getProduct,
  updateProduct,
  getAiInstructions,
  updateAiInstructions,
  getBidState,
  setBidRules,
  resetBid,
  getIdleTalkSettings,
  updateIdleTalkSettings,
  getConnectionState,
} from "./store.js";

/**
 * Starts the REST API and returns the underlying http.Server so the
 * WebSocket server can attach to the same port (required for Railway).
 *
 * @param {object} deps
 * @param {function} deps.startStream
 * @param {function} deps.stopStream
 * @param {function} deps.broadcast
 * @returns {import("http").Server}
 */
export function startApiServer({ startStream, stopStream, broadcast }) {
  const app = express();
  app.use(express.json());
  app.use(
    cors({
      origin: config.allowedOrigins.includes("*") ? true : config.allowedOrigins,
    })
  );

  // ---- Full state ----
  app.get("/api/state", (req, res) => {
    res.json(getFullState());
  });

  // ---- Product ----
  app.get("/api/product", (req, res) => {
    res.json(getProduct());
  });

  app.put("/api/product", (req, res) => {
    const updated = updateProduct(req.body);
    broadcast({ type: "stateChanged", section: "product", data: updated });
    res.json(updated);
  });

  // ---- AI instructions ----
  app.get("/api/ai-instructions", (req, res) => {
    res.json(getAiInstructions());
  });

  app.put("/api/ai-instructions", (req, res) => {
    const updated = updateAiInstructions(req.body);
    broadcast({ type: "stateChanged", section: "aiInstructions", data: updated });
    res.json(updated);
  });

  // ---- Bid rules ----
  app.get("/api/bid", (req, res) => {
    res.json(getBidState());
  });

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
  app.get("/api/idle-talk", (req, res) => {
    res.json(getIdleTalkSettings());
  });

  app.put("/api/idle-talk", (req, res) => {
    const updated = updateIdleTalkSettings(req.body);
    broadcast({ type: "stateChanged", section: "idleTalk", data: updated });
    res.json(updated);
  });

  // ---- Connection control ----
  app.get("/api/connection", (req, res) => {
    res.json(getConnectionState());
  });

  app.post("/api/connection/start", (req, res) => {
    const { tiktokUsername } = req.body;
    if (!tiktokUsername) {
      return res.status(400).json({ error: "tiktokUsername is required" });
    }

    const current = getConnectionState();
    if (current.isLive) {
      return res.status(409).json({ error: "Already connected. Stop the current connection first." });
    }

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
    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }
    broadcast({ type: "speak", text });
    res.json({ spoken: true });
  });

  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Return the http.Server (not just the Express app) so wsServer can
  // attach to it and share the same port.
  const httpServer = app.listen(config.httpPort, () => {
    console.log(`API server listening on http://localhost:${config.httpPort}`);
  });

  return httpServer;
}
