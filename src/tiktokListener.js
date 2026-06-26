import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";
import { config } from "./config.js";

/**
 * Sets up the TikTok live connection and wires comment events to a handler callback.
 *
 * Unlike the original version, this no longer reads the username from .env —
 * it's passed in at call time (e.g. from a dashboard "Go Live" button via the API).
 *
 * @param {string} tiktokUsername - account to connect to (no @)
 * @param {function} onComment - called with { username, comment } for every chat message
 * @param {function} onConnected - called with roomId when connection succeeds
 * @param {function} onDisconnected - called when connection drops
 * @param {function} onError - called with an Error if the connection attempt fails
 * @returns {TikTokLiveConnection} the connection instance, so the caller can stop() it later
 */
export function startTikTokListener(tiktokUsername, { onComment, onConnected, onDisconnected, onError }) {
  if (!config.eulerApiKey) {
    console.warn(
      "WARNING: No EULER_API_KEY set. tiktok-live-connector v2 requires a free Euler Stream API key " +
      "to sign WebSocket connections. Get one at https://www.eulerstream.com and set EULER_API_KEY in your .env file. " +
      "The connection will likely fail without it."
    );
  }

  // The installed v2 constructor requires the options object to be present
  // (it reads options.processInitialData etc. directly, with no internal
  // default applied when the whole options argument is missing) — always
  // pass at least {}. signApiKey is passed per-connection here rather than
  // relying on the global SignConfig.
  const connection = new TikTokLiveConnection(tiktokUsername, {
    signApiKey: config.eulerApiKey,
  });

  connection
    .connect()
    .then((state) => {
      console.log(`Connected to TikTok room: ${state.roomId}`);
      if (onConnected) onConnected(state.roomId);
    })
    .catch((err) => {
      console.error("Failed to connect to TikTok Live:", err.message);
      console.error(
        `Make sure "${tiktokUsername}" is currently live and the username is correct (no @).`
      );
      if (onError) onError(err);
    });

  connection.on(WebcastEvent.CHAT, (data) => {
    const username = data.user?.uniqueId || data.uniqueId || "unknown";
    const comment = data.comment;
    if (!comment) return;

    console.log(`[CHAT] ${username}: ${comment}`);
    onComment({ username, comment });
  });

  connection.on(WebcastEvent.DISCONNECTED, () => {
    console.warn("Disconnected from TikTok Live. Attempting reconnect in 5s...");
    if (onDisconnected) onDisconnected();

    setTimeout(() => {
      connection.connect().catch((err) => {
        console.error("Reconnect failed:", err.message);
        if (onError) onError(err);
      });
    }, 5000);
  });

  connection.on(WebcastEvent.ERROR, (err) => {
    console.error("TikTok connection error:", err);
    if (onError) onError(err);
  });

  return connection;
}
