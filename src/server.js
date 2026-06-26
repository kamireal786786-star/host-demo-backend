import { validateConfig } from "./config.js";
import { startTikTokListener } from "./tiktokListener.js";
import { startWebSocketServer } from "./wsServer.js";
import { startApiServer } from "./apiServer.js";
import { parseBid } from "./bidParser.js";
import {
  submitBid,
  getBidState,
  setConnectionState,
} from "./store.js";
import {
  generateCommentResponse,
  generateBidAnnouncement,
  generateBidRejection,
} from "./gptHandler.js";
import { IdleTalkManager } from "./idleTalk.js";

validateConfig();

// broadcast is a temporary stub until the real one is ready — avoids a
// circular dependency between apiServer and wsServer.
let broadcast = () => {};

// Start HTTP server first, then attach WS to it on the same port.
const httpServer = startApiServer({
  startStream,
  stopStream,
  broadcast: (msg) => broadcast(msg), // indirection so the real fn is used once assigned
});

const { broadcast: realBroadcast } = startWebSocketServer(httpServer);
broadcast = realBroadcast;

let activeConnection = null;

function speak(text) {
  console.log(`[AVATAR SAYS] ${text}`);
  broadcast({ type: "speak", text });
}

function broadcastBidState() {
  broadcast({ type: "bidUpdate", ...getBidState() });
}

const idleManager = new IdleTalkManager({ onSpeak: speak });

async function handleComment({ username, comment }) {
  idleManager.notifyActivity();
  broadcast({ type: "comment", username, comment });

  const bidAmount = parseBid(comment);

  if (bidAmount !== null) {
    const result = submitBid(bidAmount, username);

    if (result.accepted) {
      const newState = getBidState();
      broadcastBidState();
      try {
        const announcement = await generateBidAnnouncement(
          bidAmount,
          username,
          newState.currentBid
        );
        speak(announcement);
      } catch (err) {
        console.error("Bid announcement generation failed:", err.message);
      }
    } else {
      try {
        const rejection = await generateBidRejection(bidAmount, username, result.reason);
        speak(rejection);
      } catch (err) {
        console.error("Bid rejection generation failed:", err.message);
      }
    }
    return;
  }

  try {
    const response = await generateCommentResponse(username, comment, getBidState());
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
  const state = setConnectionState({ isLive: false, roomId: null, lastError: null, tiktokUsername: null });
  broadcast({ type: "connectionStatus", ...state });
}

console.log("AI TikTok Live Host backend running.");
console.log("Waiting for the dashboard to call POST /api/connection/start to go live...");
