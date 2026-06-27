import { WebSocketServer } from "ws";

/**
 * Attaches WebSocket server to the existing HTTP server.
 * Calls onClientConnect / onClientDisconnect so server.js
 * can start/stop idle chatter based on whether anyone is watching.
 */
export function startWebSocketServer(httpServer, { onClientConnect, onClientDisconnect } = {}) {
  const wss = new WebSocketServer({ server: httpServer });
  const clients = new Set();

  wss.on("connection", (ws) => {
    clients.add(ws);
    console.log(`Frontend connected. Total clients: ${clients.size}`);
    if (clients.size === 1) onClientConnect?.(); // first client connected

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`Frontend disconnected. Total clients: ${clients.size}`);
      if (clients.size === 0) onClientDisconnect?.(); // last client left
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
