export const CAPTURE_GAP_SEC = 3.0;

export class CaptureGuard {
  constructor({ gapSec = CAPTURE_GAP_SEC } = {}) {
    this.gapSec = gapSec;
    this.inMatch = false;
    this.lastFrameAt = null;
    this.interrupted = null;
  }

  _mark(reason, nowMs, gapSec = 0) {
    if (!this.interrupted) {
      this.interrupted = { reason, at: nowMs, gapSec };
      return this.interrupted;
    }
    if (this.interrupted.reason === 'stall' && reason === 'stall') {
      if (gapSec > this.interrupted.gapSec) {
        this.interrupted.gapSec = gapSec;
      }
    }
    return null;
  }

  battleStart(nowMs) {
    this.inMatch = true;
    this.interrupted = null;
    this.lastFrameAt = nowMs;
  }

  battleDiscard() {
    this.inMatch = false;
    this.interrupted = null;
    this.lastFrameAt = null;
  }

  frame(nowMs) {
    let newlyMarked = null;
    if (this.inMatch && this.lastFrameAt !== null) {
      const gapSec = (nowMs - this.lastFrameAt) / 1000;
      if (gapSec >= this.gapSec) {
        newlyMarked = this._mark('stall', nowMs, gapSec);
      }
    }
    this.lastFrameAt = nowMs;
    return newlyMarked;
  }

  tick(nowMs) {
    if (this.inMatch && this.lastFrameAt !== null) {
      const gapSec = (nowMs - this.lastFrameAt) / 1000;
      if (gapSec >= this.gapSec) {
        return this._mark('stall', nowMs, gapSec);
      }
    }
    return null;
  }

  visibility(hidden, nowMs) {
    if (hidden === true && this.inMatch) {
      return this._mark('hidden', nowMs, 0);
    }
    return null;
  }

  matchEnd() {
    const interrupted = this.interrupted;
    const save = !interrupted;
    this.inMatch = false;
    this.interrupted = null;
    this.lastFrameAt = null;
    return { save, interrupted };
  }
}
