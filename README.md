# AI TikTok Live Host — Backend (v2, dashboard-driven)

This backend is built to sit behind a **dashboard frontend** (the one you're
building with HeyGen embedded, product config, bid overlay, comment feed,
etc.). Instead of hardcoded `.env` settings, product info, AI personality,
and bid rules are all editable live through a REST API — your dashboard
calls these endpoints, and changes apply immediately without restarting
anything.

## How this fits into your setup

```
Your Frontend (dashboard + HeyGen avatar + bid overlay)
        │
        ├── REST API calls  ──────────────▶  This backend (Express)
        │   (edit product, AI instructions,
        │    bid rules, start/stop stream)
        │
        └── WebSocket connection  ◀────────  This backend (ws)
            (receives: speak, bidUpdate,
             comment, connectionStatus,
             stateChanged)

Your Frontend page is captured by OBS Studio (Browser Source)
        │
        ▼
   OBS encodes + streams via RTMP
        │
        ▼
   TikTok Live
```

Your frontend never talks to TikTok directly. This backend listens to TikTok
Live chat (via the unofficial `tiktok-live-connector` library), and your
frontend is just a regular webpage that OBS captures and streams. TikTok has
no native "cast a webpage" feature — OBS Browser Source → RTMP is the
standard path.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in:
   - `OPENAI_API_KEY` — required
   - `EULER_API_KEY` — required for TikTok to actually connect. Free tier at
     https://www.eulerstream.com (`tiktok-live-connector` v2 needs this to
     sign WebSocket connections — no way around it, even on the free tier).
   - `ALLOWED_ORIGINS` — your dashboard's URL once deployed (CORS)

3. Run locally:
   ```
   npm start
   ```
   You'll see both servers come up:
   ```
   WebSocket server listening on ws://localhost:8080
   API server listening on http://localhost:3000
   ```
   Nothing connects to TikTok yet — that only happens when your dashboard
   calls `POST /api/connection/start`.

## REST API reference

All endpoints are under `http://localhost:3000` locally (or your Railway URL
in production).

### State
- `GET /api/state` — full snapshot (product, AI instructions, bid, idle talk
  settings, connection status). Good for your dashboard's initial page load.

### Product
- `GET /api/product`
- `PUT /api/product` — body: any subset of `{ name, features, price,
  shipping, imageUrl, videoUrl }`. Partial updates merge with existing values.

### AI instructions
- `GET /api/ai-instructions`
- `PUT /api/ai-instructions` — body: `{ personality, extraRules }`. These get
  woven into the system prompt on every GPT call — edits apply to the very
  next response, no restart needed.

### Bidding
- `GET /api/bid` — current bid, bidder, total bid count, rules
- `PUT /api/bid/rules` — body: `{ startingBid, minIncrement }`. Setting
  `startingBid` also resets the current bid to that value. `minIncrement`
  (optional, default 0) requires each new bid to beat the current bid by at
  least that amount — e.g. `minIncrement: 10` means bids must jump by $10+.
- `POST /api/bid/reset` — resets bid back to `startingBid`, clears history

### Idle talk (Phase 9 — keeps the avatar talking when chat is quiet)
- `GET /api/idle-talk`
- `PUT /api/idle-talk` — body: any subset of `{ enabled, minSeconds,
  maxSeconds, inactivityResetSeconds }`

### Connection (going live)
- `GET /api/connection` — `{ tiktokUsername, isLive, roomId, lastError }`
- `POST /api/connection/start` — body: `{ tiktokUsername }`. Connects to that
  account's TikTok Live chat. **The TikTok stream must already be live** —
  this can't pre-connect to an offline account. If it fails (account not
  live yet, wrong username), `lastError` in the state reflects why, and you
  can call `start` again without needing to call `stop` first.
- `POST /api/connection/stop` — disconnects and resets connection state

### Manual override
- `POST /api/speak` — body: `{ text }`. Makes the avatar say something right
  now, bypassing GPT — useful for a "say this" box on your dashboard for
  manual control during the stream.

## WebSocket messages (what your frontend listens for)

Connect to `ws://localhost:8080` (or `wss://your-railway-url` in production).

```javascript
const ws = new WebSocket("wss://your-app.up.railway.app");

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case "speak":
      // msg.text — send to your HeyGen streaming avatar
      break;
    case "bidUpdate":
      // msg.currentBid, msg.currentBidder, msg.totalBids
      break;
    case "comment":
      // msg.username, msg.comment — raw chat, if you want a feed on screen
      break;
    case "connectionStatus":
      // msg.isLive, msg.roomId, msg.lastError, msg.tiktokUsername
      break;
    case "stateChanged":
      // msg.section ("product" | "aiInstructions" | "idleTalk"), msg.data
      // Fires when product/AI/idle settings are edited via the API —
      // keeps multiple open dashboard tabs/devices in sync.
      break;
  }
};
```

## Demo day sequence

1. Open your dashboard, configure product info + AI personality + bid rules
   (via the dashboard UI, which calls the API endpoints above).
2. Start the TikTok Live stream itself (TikTok app, or via TikTok Live
   Studio/OBS — the stream needs to be live before step 3 will work).
3. Set up OBS: add a Browser Source pointed at your dashboard's URL, make
   sure it's the layout you want visible (avatar + bid overlay + product).
4. Click "Go Live" on your dashboard (calls `POST /api/connection/start`
   with the TikTok username) — this is when the backend starts listening to
   chat and the avatar starts talking.
5. When done, click "Stop" (calls `POST /api/connection/stop`), then end the
   OBS/TikTok stream.

## Deploying to Railway

1. Push to GitHub, deploy from repo in Railway.
2. Add env vars from `.env.example` in Railway's Variables tab.
3. Railway auto-detects `npm start`.
4. Your dashboard's WebSocket/API base URL becomes your Railway domain —
   remember `wss://` and `https://` (not `ws://`/`http://`) since Railway
   terminates TLS for you.

## Testing without a live TikTok stream

Simulate chat comments by POSTing to your own backend's logic directly, or
temporarily add this to `src/server.js` (remove before the real demo):

```javascript
setInterval(() => {
  handleComment({ username: "test_user", comment: "is it waterproof?" });
}, 15000);
```

You can test the full API + WebSocket pipeline (product edits, bid rules,
manual speak) entirely without TikTok — only `POST /api/connection/start`
actually needs a live TikTok stream to succeed.

## Files

- `src/config.js` — secrets/infra only (API keys, ports, CORS)
- `src/store.js` — **dashboard-editable live state**: product, AI
  instructions, bid rules/state, idle talk settings, connection status
- `src/apiServer.js` — REST API the dashboard calls to read/edit everything
  and start/stop the TikTok connection
- `src/bidParser.js` — parses bid amounts out of raw chat text
- `src/gptHandler.js` — builds prompts from current store state, calls
  OpenAI, has a fallback string if the API call fails
- `src/tiktokListener.js` — TikTok Live chat connection (per-connection
  signing key, auto-reconnect after a successful connection later drops)
- `src/wsServer.js` — WebSocket broadcast server for the frontend
- `src/idleTalk.js` — idle chatter scheduler, settings read live from store
- `src/server.js` — wires it all together, exposes `startStream`/`stopStream`
  to the API layer

## Known limitations (fine for a demo, not production)

- All state is in-memory — restarting the backend resets product info, AI
  instructions, and the current bid back to defaults. Add a real DB if you
  need persistence across restarts.
- `tiktok-live-connector` is an unofficial, reverse-engineered library — it
  can break if TikTok changes their internal API.
- The TikTok stream must be live before `POST /api/connection/start` will
  succeed — there's no polling/waiting built in (you control that timing
  from the dashboard instead).
