import { getIdleTalkSettings } from "./store.js";

/**
 * Idle talk manager — calls onSpeak callback on a timer.
 * The actual speech content and queue logic lives in server.js —
 * this just handles the timing and activity tracking.
 */
export class IdleTalkManager {
  constructor({ onSpeak }) {
    this.onSpeak = onSpeak;
    this.lastActivityTime = Date.now();
    this.timer = null;
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
    const threshold = settings.inactivityResetSeconds * 1000;

    if (settings.enabled && timeSinceActivity >= threshold) {
      await this.onSpeak();
    }

    this.scheduleNext();
  }
}
