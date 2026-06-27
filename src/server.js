import { validateConfig } from "./config.js";
import { startTikTokListener } from "./tiktokListener.js";
import { startWebSocketServer } from "./wsServer.js";
import { startApiServer } from "./apiServer.js";
import { setConnectionState } from "./store.js";
import { generateCommentResponse, generateIdleChatter, testGeminiConnection } from "./gptHandler.js";
import { IdleTalkManager } from "./idleTalk.js";

validateConfig();

let broadcast = () => {};
let activeConnection = null;

// ─── Speech queue ──────────────────────────────────────────────────────────
const speechQueue = [];
let isSpeaking = false;
const WORDS_PER_SECOND = 2.5;

function estimateDuration(text) {
  const words = text.trim().split(/\s+/).length;
  return Math.max((words / WORDS_PER_SECOND) * 1000, 2000);
}

function speak(text) {
  if (!text || text.trim().length < 5) return;
  speechQueue.push(text.trim());
  processQueue();
}

function processQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  const text = speechQueue.shift();
  isSpeaking = true;
  console.log(`[AVATAR SAYS] ${text}`);
  broadcast({ type: "speak", text });
  setTimeout(() => {
    isSpeaking = false;
    processQueue();
  }, estimateDuration(text) + 1000); // +1s gap between lines
}

// ─── Comment handler ───────────────────────────────────────────────────────
export async function handleComment({ username, comment }) {
  // Suppress idle chatter for longer after a real comment
  idleManager.notifyActivity();
  broadcast({ type: "comment", username, comment });
  console.log(`[COMMENT] ${username}: ${comment}`);

  // Clear any queued idle lines so comment response comes next
  speechQueue.length = 0;

  try {
    const response = await generateCommentResponse(username, comment);
    speak(response);
  } catch (err) {
    console.error("Comment response failed:", err.message);
  }
}

// ─── Idle chatter ──────────────────────────────────────────────────────────
const idleManager = new IdleTalkManager({
  onSpeak: async () => {
    // Don't fire idle if avatar is currently speaking or queue has items
    if (isSpeaking || speechQueue.length > 0) return;
    try {
      const text = await generateIdleChatter();
      speak(text);
    } catch (err) {
      console.error("Idle chatter failed:", err.message);
    }
  },
});

// ─── Boot ──────────────────────────────────────────────────────────────────
const httpServer = startApiServer({
  startStream,
  stopStream,
  broadcast: (msg) => broadcast(msg),
  handleComment,
});

const { broadcast: realBroadcast } = startWebSocketServer(httpServer, {
  onClientConnect: () => {
    console.log("Live view opened — starting idle chatter.");
    idleManager.start();
  },
  onClientDisconnect: () => {
    console.log("No clients connected — pausing idle chatter.");
    idleManager.stop();
    speechQueue.length = 0;
    isSpeaking = false;
  },
});
broadcast = realBroadcast;

console.log("AI TikTok Live Host running.");
testGeminiConnection();

// ─── TikTok connection ─────────────────────────────────────────────────────
function startStream(tiktokUsername) {
  if (activeConnection) return;
  setConnectionState({ tiktokUsername, isLive: false, roomId: null, lastError: null });
  broadcast({ type: "connectionStatus", ...setConnectionState({}) });

  activeConnection = startTikTokListener(tiktokUsername, {
    onComment: handleComment,
    onConnected: (roomId) => {
      const state = setConnectionState({ isLive: true, roomId, lastError: null });
      broadcast({ type: "connectionStatus", ...state });
    },
    onDisconnected: () => {
      const state = setConnectionState({ isLive: false });
      broadcast({ type: "connectionStatus", ...state });
    },
    onError: (err) => {
      const state = setConnectionState({ isLive: false, lastError: err.message });
      broadcast({ type: "connectionStatus", ...state });
      activeConnection = null;
    },
  });
}

function stopStream() {
  if (activeConnection) { activeConnection.disconnect?.(); activeConnection = null; }
  const state = setConnectionState({ isLive: false, roomId: null, lastError: null, tiktokUsername: null });
  broadcast({ type: "connectionStatus", ...state });
}
