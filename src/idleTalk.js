import { generateIdleChatter, nextIdleTopic } from "./gptHandler.js";
import { getIdleTalkSettings, getBidState } from "./store.js";

/**
 * Manages the idle talk loop. Call `notifyActivity()` whenever a real comment
 * or bid happens, so idle chatter doesn't talk over genuine interactions.
 *
 * Settings (enabled, min/max seconds, inactivity threshold) are read fresh
 * from the store on every cycle, so dashboard edits apply immediately.
 */
export class IdleTalkManager {
  constructor({ onSpeak }) {
    this.onSpeak = onSpeak;
    this.lastActivityTime = Date.now();
    this.timer = null;
    this.busy = false; // true while a GPT call / speak is in flight
    this.running = false;
  }

  start() {
    this.running = true;
    this.scheduleNext();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  notifyActivity() {
    this.lastActivityTime = Date.now();
  }

  scheduleNext() {
    if (!this.running) return;

    const settings = getIdleTalkSettings();
    const min = settings.minSeconds * 1000;
    const max = settings.maxSeconds * 1000;
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;

    this.timer = setTimeout(() => this.tick(), delay);
  }

  async tick() {
    if (!this.running) return;

    const settings = getIdleTalkSettings();
    const timeSinceActivity = Date.now() - this.lastActivityTime;
    const inactivityThreshold = settings.inactivityResetSeconds * 1000;

    // Only speak idle chatter if: idle talk is enabled, nothing real has
    // happened recently, and we're not already mid-response to something else.
    if (settings.enabled && timeSinceActivity >= inactivityThreshold && !this.busy) {
      this.busy = true;
      try {
        const topic = nextIdleTopic();
        const bidState = getBidState();
        const text = await generateIdleChatter(bidState, topic);
        this.onSpeak(text);
      } catch (err) {
        console.error("Idle chatter generation failed:", err.message);
      } finally {
        this.busy = false;
      }
    }

    this.scheduleNext();
  }
}
