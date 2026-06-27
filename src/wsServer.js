import { WebSocketServer } from "ws";

/**
 * Only counts "live" clients (the broadcast view) when deciding
 * whether to start/stop idle chatter. Dashboard clients connect
 * but don't trigger the idle chatter pipeline.
 *
 * Frontend sends { type: "identify", clientType: "live" | "dashboard" }
 * as the first message after connecting.
 */
export function startWebSocketServer(httpServer, { onClientConnect, onClientDisconnect } = {}) {
  const wss = new WebSocketServer({ server: httpServer });
  const allClients = new Set();
  let liveClientCount = 0;

  wss.on("connection", (ws) => {
    allClients.add(ws);
    let identified = false;

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "identify" && !identified) {
          identified = true;
          ws.clientType = msg.clientType || "dashboard";
          if (ws.clientType === "live") {
            liveClientCount++;
            console.log(`Live view connected. Live clients: ${liveClientCount}`);
            if (liveClientCount === 1) onClientConnect?.();
          } else {
            console.log(`Dashboard connected. Total clients: ${allClients.size}`);
          }
        }
      } catch {}
    });

    ws.on("close", () => {
      allClients.delete(ws);
      if (ws.clientType === "live") {
        liveClientCount = Math.max(0, liveClientCount - 1);
        console.log(`Live view disconnected. Live clients: ${liveClientCount}`);
        if (liveClientCount === 0) onClientDisconnect?.();
      } else {
        console.log(`Dashboard disconnected. Total clients: ${allClients.size}`);
      }
    });

    ws.on("error", (err) => {
      console.error("WebSocket client error:", err.message);
    });
  });

  console.log("WebSocket server attached to HTTP server (same port).");

  function broadcast(message) {
    const payload = JSON.stringify(message);
    for (const client of allClients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }

  return { wss, broadcast };
}
