import { validateConfig } from "./config.js";
import { startTikTokListener } from "./tiktokListener.js";
import { startWebSocketServer } from "./wsServer.js";
import { startApiServer } from "./apiServer.js";
import { setConnectionState } from "./store.js";
import { generateCommentResponse, generateIdleChatter, nextIdleTopic } from "./gptHandler.js";
import { IdleTalkManager } from "./idleTalk.js";

validateConfig();

let broadcast = () => {};
let activeConnection = null;

// ─── Speech queue ──────────────────────────────────────────────────────────
const speechQueue = [];
let isSpeaking = false;
const WORDS_PER_SECOND = 2.8;

function estimateDuration(text) {
  const words = text.split(/\s+/).length;
  return Math.max((words / WORDS_PER_SECOND) * 1000, 1500);
}

function speak(text) {
  speechQueue.push(text);
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
  }, estimateDuration(text) + 600);
}

// ─── Comment handler (used by both TikTok and test-comment endpoint) ───────
async function handleComment({ username, comment }) {
  idleManager.notifyActivity();
  broadcast({ type: "comment", username, comment });
  try {
    const response = await generateCommentResponse(username, comment);
    speak(response);
  } catch (err) {
    console.error("Comment response generation failed:", err.message);
  }
}

// ─── Idle chatter ──────────────────────────────────────────────────────────
const idleManager = new IdleTalkManager({
  onSpeak: async () => {
    if (isSpeaking || speechQueue.length > 0) return;
    try {
      const topic = nextIdleTopic();
      const text = await generateIdleChatter(topic);
      speak(text);
    } catch (err) {
      console.error("Idle chatter generation failed:", err.message);
    }
  },
});

// ─── Boot ──────────────────────────────────────────────────────────────────
const httpServer = startApiServer({
  startStream,
  stopStream,
  broadcast: (msg) => broadcast(msg),
  handleComment,  // passed so /api/test-comment can use the same pipeline
});

const { broadcast: realBroadcast } = startWebSocketServer(httpServer);
broadcast = realBroadcast;

// Start idle chatter immediately — avatar talks as soon as live view opens
idleManager.start();
console.log("AI TikTok Live Host running. Idle chatter active.");

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
  speechQueue.length = 0;
  isSpeaking = false;
  const state = setConnectionState({ isLive: false, roomId: null, lastError: null, tiktokUsername: null });
  broadcast({ type: "connectionStatus", ...state });
}
