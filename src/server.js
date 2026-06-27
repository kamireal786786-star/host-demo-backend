import { validateConfig } from "./config.js";
import { startTikTokListener } from "./tiktokListener.js";
import { startWebSocketServer } from "./wsServer.js";
import { startApiServer } from "./apiServer.js";
import { getBidState, setConnectionState } from "./store.js";
import {
  generateCommentResponse,
  generateIdleChatter,
  nextIdleTopic,
} from "./gptHandler.js";
import { IdleTalkManager } from "./idleTalk.js";

validateConfig();

let broadcast = () => {};

const httpServer = startApiServer({
  startStream,
  stopStream,
  broadcast: (msg) => broadcast(msg),
});

const { broadcast: realBroadcast } = startWebSocketServer(httpServer);
broadcast = realBroadcast;

let activeConnection = null;

// ─── Speech queue ───────────────────────────────────────────────────────────
// Ensures the avatar finishes one thing before starting the next.
// Comments from chat are pushed to the queue; they never interrupt mid-speech.
// Idle chatter is only spoken when the queue is empty.

const speechQueue = [];
let isSpeaking = false;
const WORDS_PER_SECOND = 2.8; // average spoken words per second

function estimateDuration(text) {
  const words = text.split(/\s+/).length;
  return Math.max((words / WORDS_PER_SECOND) * 1000, 1500); // min 1.5s
}

function speak(text, priority = "normal") {
  if (priority === "high") {
    speechQueue.unshift(text);
  } else {
    speechQueue.push(text);
  }
  processQueue();
}

function processQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  const text = speechQueue.shift();
  isSpeaking = true;
  console.log(`[AVATAR SAYS] ${text}`);
  broadcast({ type: "speak", text });
  // Wait estimated duration before allowing next item
  setTimeout(() => {
    isSpeaking = false;
    processQueue();
  }, estimateDuration(text) + 500); // +500ms buffer between lines
}

function broadcastBidState() {
  broadcast({ type: "bidUpdate", ...getBidState() });
}

const idleManager = new IdleTalkManager({
  onSpeak: async () => {
    // Only speak idle chatter when queue is empty and not currently speaking
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

async function handleComment({ username, comment }) {
  idleManager.notifyActivity();
  broadcast({ type: "comment", username, comment });

  // Generate response and push to queue — never interrupts current speech
  try {
    const response = await generateCommentResponse(username, comment);
    speak(response);
  } catch (err) {
    console.error("Comment response generation failed:", err.message);
  }
}

function startStream(tiktokUsername) {
  if (activeConnection) {
    console.warn("startStream called while a connection is already active — ignoring.");
    return;
  }

  setConnectionState({ tiktokUsername, isLive: false, roomId: null, lastError: null });
  broadcast({ type: "connectionStatus", ...setConnectionState({}) });

  activeConnection = startTikTokListener(tiktokUsername, {
    onComment: handleComment,
    onConnected: (roomId) => {
      const state = setConnectionState({ isLive: true, roomId, lastError: null });
      broadcast({ type: "connectionStatus", ...state });
      idleManager.start();
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
  if (activeConnection) {
    activeConnection.disconnect?.();
    activeConnection = null;
  }
  idleManager.stop();
  speechQueue.length = 0;
  isSpeaking = false;
  const state = setConnectionState({ isLive: false, roomId: null, lastError: null, tiktokUsername: null });
  broadcast({ type: "connectionStatus", ...state });
}

startApiServer({ startStream, stopStream, broadcast: (msg) => broadcast(msg) });

console.log("AI TikTok Live Host backend running.");
console.log("Waiting for the dashboard to call POST /api/connection/start to go live...");
