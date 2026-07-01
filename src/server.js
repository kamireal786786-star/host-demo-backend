import { validateConfig } from "./config.js";
import { startTikTokListener } from "./tiktokListener.js";
import { startWebSocketServer } from "./wsServer.js";
import { startApiServer } from "./apiServer.js";
import { setConnectionState, submitBid, getBidState, getProduct } from "./store.js";
import { parseBid } from "./bidParser.js";
import { generateIdleChatter, generateBidAck, generateTransition, testGeminiConnection } from "./gptHandler.js";

validateConfig();

let broadcast = () => {};
let activeConnection = null;

// ─── Speech queue ───────────────────────────────────────────────────────────
// Each item is { text, type: 'idle' | 'comment' | 'bid' }
// Tagging lets us remove only idle lines when a comment/bid arrives, so the
// host always finishes its current sentence before pivoting — never cuts off.
const speechQueue = [];
let isSpeaking = false;
let isGeneratingIdle = false;
const WORDS_PER_SECOND = 2.8;

function estimateDuration(text) {
  const words = text.trim().split(/\s+/).length;
  return Math.max((words / WORDS_PER_SECOND) * 1000, 1500);
}

function speak(text, type = "idle") {
  if (!text || text.trim().length < 5) return;
  speechQueue.push({ text: text.trim(), type });
  processQueue();
}

function processQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  const { text } = speechQueue.shift();
  isSpeaking = true;
  console.log(`[AVATAR SAYS] ${text}`);
  broadcast({ type: "speak", text });
  setTimeout(() => {
    isSpeaking = false;
    // Queue drained → keep the host talking immediately. A real streamer
    // never goes silent; they just keep the monologue going nonstop.
    if (speechQueue.length === 0) {
      fillWithIdleChatter();
    }
    processQueue();
  }, estimateDuration(text) + 400); // 400ms breath between sentences
}

// Generates the next idle line and queues it. Called every time the queue
// drains so the host talks continuously without any dead air.
async function fillWithIdleChatter() {
  if (isGeneratingIdle) return; // already in-flight
  isGeneratingIdle = true;
  try {
    const text = await generateIdleChatter();
    speak(text, "idle");
  } catch (err) {
    console.error("Idle chatter failed:", err.message);
  } finally {
    isGeneratingIdle = false;
  }
}

// When a comment/bid arrives, only remove pending *idle* lines from the queue.
// This lets the host finish its current sentence naturally, then pivot to the
// reply — rather than going silent or cutting off mid-word.
function clearPendingIdle() {
  for (let i = speechQueue.length - 1; i >= 0; i--) {
    if (speechQueue[i].type === "idle") speechQueue.splice(i, 1);
  }
}

// ─── Comment handler ────────────────────────────────────────────────────────
export async function handleComment({ username, comment }) {
  broadcast({ type: "comment", username, comment });
  console.log(`[COMMENT] ${username}: ${comment}`);

  // Remove only queued idle lines — host finishes current sentence, then replies
  clearPendingIdle();

  // ── Bid check ─────────────────────────────────────────────────────────────
  const bidAmount = parseBid(comment);
  if (bidAmount !== null) {
    const result = submitBid(bidAmount, username);
    if (result.accepted) {
      const bidState = getBidState();
      broadcast({ type: "bidUpdate", ...bidState });
      console.log(`[BID] ${username} -> $${bidAmount} (accepted)`);
      try {
        // generateBidAck returns a line that naturally bridges from whatever
        // the host was saying ("...and boom — username just dropped $X!")
        const ack = await generateBidAck(username, bidAmount, getProduct());
        speak(ack, "bid");
      } catch (err) {
        console.error("Bid ack failed:", err.message);
        speak(`Boom — ${username} just bid $${bidAmount}! Who's going higher?`, "bid");
      }
    } else {
      console.log(`[BID] ${username} -> $${bidAmount} (rejected: ${result.reason})`);
      // Rejected/under bids don't interrupt the host — same as a real auction
    }
    return;
  }

  // ── Regular comment ────────────────────────────────────────────────────────
  try {
    // generateTransition weaves the reply into the flow naturally, as if the
    // host noticed the comment while mid-stream and pivots to address it
    const response = await generateTransition(username, comment);
    speak(response, "comment");
  } catch (err) {
    console.error("Comment response failed:", err.message);
  }
}

// ─── Startup ─────────────────────────────────────────────────────────────────
const httpServer = startApiServer({
  startStream,
  stopStream,
  broadcast: (msg) => broadcast(msg),
  handleComment,
});

const { broadcast: realBroadcast } = startWebSocketServer(httpServer, {
  onClientConnect: () => {
    console.log("Live view opened — host starting.");
    // Kick off the continuous talk loop immediately when someone opens the page
    fillWithIdleChatter();
  },
  onClientDisconnect: () => {
    console.log("No clients — host paused.");
    speechQueue.length = 0;
    isSpeaking = false;
    isGeneratingIdle = false;
  },
});
broadcast = realBroadcast;

console.log("AI TikTok Live Host running.");
testGeminiConnection();

// ─── TikTok connection ────────────────────────────────────────────────────────
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
