import { WebSocketServer } from "ws";

/**
 * Attaches the WebSocket server to an existing Node http.Server so both
 * HTTP (REST API) and WS share the same port — required for Railway which
 * only exposes one public port per service.
 *
 * Message types sent to frontend:
 *   { type: "speak", text: "..." }
 *   { type: "bidUpdate", currentBid, currentBidder, totalBids }
 *   { type: "comment", username, comment }
 *   { type: "connectionStatus", isLive, roomId, lastError }
 *   { type: "stateChanged", section, data }
 *
 * @param {import("http").Server} httpServer - the server returned by app.listen()
 */
export function startWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });
  const clients = new Set();

  wss.on("connection", (ws) => {
    clients.add(ws);
    console.log(`Frontend connected. Total clients: ${clients.size}`);

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`Frontend disconnected. Total clients: ${clients.size}`);
    });

    ws.on("error", (err) => {
      console.error("WebSocket client error:", err.message);
    });
  });

  console.log("WebSocket server attached to HTTP server (same port).");

  function broadcast(message) {
    const payload = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }

  return { wss, broadcast };
}
