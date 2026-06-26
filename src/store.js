/**
 * In-memory live state for the demo.
 *
 * This replaces hardcoded .env product/AI settings — the frontend dashboard
 * reads and writes this through the REST API (see apiServer.js), and the
 * GPT handler always reads the *current* values, so edits take effect
 * immediately without restarting the backend.
 *
 * Not persisted to disk — restarting the backend resets everything to
 * defaults below. Fine for a demo; swap for a real DB later if needed.
 */

const state = {
  product: {
    name: "Vintage Leather Watch",
    features: "Genuine leather strap, stainless steel case, water-resistant up to 50m, automatic movement",
    price: "$80 starting bid",
    shipping: "Ships worldwide within 5-7 business days, free shipping over $100",
    imageUrl: "",
    videoUrl: "",
  },

  aiInstructions: {
    // Freeform extra instructions the host adds, layered on top of the base
    // "you are a live auction host" system prompt in gptHandler.js
    personality: "Energetic, warm, a little playful. Sound like a real human auctioneer.",
    extraRules: "",
  },

  bid: {
    currentBid: 0,
    currentBidder: null,
    history: [], // { amount, username, timestamp }
    startingBid: 0,
    minIncrement: 0, // 0 = any higher amount accepted; set >0 to require minimum jumps
  },

  idleTalk: {
    enabled: true,
    minSeconds: 20,
    maxSeconds: 40,
    inactivityResetSeconds: 15,
  },

  connection: {
    tiktokUsername: null,
    isLive: false,
    roomId: null,
    lastError: null,
  },
};

// ---- Product ----
export function getProduct() {
  return { ...state.product };
}

export function updateProduct(partial) {
  state.product = { ...state.product, ...partial };
  return getProduct();
}

// ---- AI instructions ----
export function getAiInstructions() {
  return { ...state.aiInstructions };
}

export function updateAiInstructions(partial) {
  state.aiInstructions = { ...state.aiInstructions, ...partial };
  return getAiInstructions();
}

// ---- Bid state ----
export function getBidState() {
  return {
    currentBid: state.bid.currentBid,
    currentBidder: state.bid.currentBidder,
    totalBids: state.bid.history.length,
    startingBid: state.bid.startingBid,
    minIncrement: state.bid.minIncrement,
  };
}

export function setBidRules({ startingBid, minIncrement }) {
  if (startingBid !== undefined) {
    state.bid.startingBid = startingBid;
    state.bid.currentBid = startingBid;
  }
  if (minIncrement !== undefined) {
    state.bid.minIncrement = minIncrement;
  }
  return getBidState();
}

/**
 * Attempts to register a new bid against current rules (current bid + min increment).
 * Returns { accepted: boolean, reason?: string }
 */
export function submitBid(amount, username) {
  const required = state.bid.currentBid + (state.bid.minIncrement || 0);

  if (amount <= state.bid.currentBid || amount < required) {
    return {
      accepted: false,
      reason:
        state.bid.minIncrement > 0
          ? `Bid must be at least $${required}`
          : `Bid must be higher than current bid of $${state.bid.currentBid}`,
    };
  }

  state.bid.currentBid = amount;
  state.bid.currentBidder = username;
  state.bid.history.push({ amount, username, timestamp: Date.now() });

  return { accepted: true };
}

export function resetBid() {
  state.bid.currentBid = state.bid.startingBid;
  state.bid.currentBidder = null;
  state.bid.history = [];
  return getBidState();
}

// ---- Idle talk settings ----
export function getIdleTalkSettings() {
  return { ...state.idleTalk };
}

export function updateIdleTalkSettings(partial) {
  state.idleTalk = { ...state.idleTalk, ...partial };
  return getIdleTalkSettings();
}

// ---- Connection status ----
export function getConnectionState() {
  return { ...state.connection };
}

export function setConnectionState(partial) {
  state.connection = { ...state.connection, ...partial };
  return getConnectionState();
}

// ---- Full snapshot (useful for a dashboard's initial load) ----
export function getFullState() {
  return {
    product: getProduct(),
    aiInstructions: getAiInstructions(),
    bid: getBidState(),
    idleTalk: getIdleTalkSettings(),
    connection: getConnectionState(),
  };
}
