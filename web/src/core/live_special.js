// 純粋なライブスペシャル判定クラス（DOM・Analyzer 非依存）
const r1 = v => Math.round(v * 10) / 10;

export class LiveSpecialTracker {
  constructor(opts = {}) {
    this.gap = opts.gap ?? 3.0;
    this.minLen = opts.minLen ?? 0.3;
    // ライブのデス（DeathLatch）は最初のデス信号のフレームで出るため、試合後の数え方のデスの始まり（信号の区間の始まり）より
    // 最大 1 秒ほど早いことがある（23-23-22_match02 の 219.0 秒：ライブ 219.0／試合後 220.0、ゲージの区間の終わり 219.8）。
    // そのため区間の終わりの 1.0 秒前（ただし区間の始まりより後）からのデスを「使う前にやられた」とみなす（D51）。
    this.deathBefore = opts.deathBefore ?? 1.0;
    this.deathAfter = opts.deathAfter ?? 1.5;
    this.endTol = opts.endTol ?? 1.0;
    this.reset();
  }

  reset() {
    this.buf = [];
    this.deaths = [];
    this.cur = null;
    this.pending = null;
  }

  death(t) {
    this.deaths.push(t);
  }

  _resolveInterval(interval) {
    const { a, b } = interval;
    if (b - a < this.minLen - 1e-6) {
      return null;
    }
    const hasDeath = this.deaths.some(
      dt => dt >= Math.max(a, b - this.deathBefore) - 1e-6 && dt <= b + this.deathAfter + 1e-6
    );
    if (hasDeath) {
      return { type: 'special_lost', t: r1(b), ready: r1(a) };
    }
    return { type: 'special', t: r1(b), ready: r1(a) };
  }

  _feedReady(t, ready, events) {
    if (ready) {
      if (this.pending) {
        if (t - this.pending.b <= this.gap + 1e-6) {
          this.cur = { a: this.pending.a, b: t };
          this.pending = null;
        } else {
          const ev = this._resolveInterval(this.pending);
          this.pending = null;
          if (ev) events.push(ev);
          this.cur = { a: t, b: t };
        }
      } else if (this.cur) {
        this.cur.b = t;
      } else {
        this.cur = { a: t, b: t };
      }
    } else {
      if (this.cur) {
        this.pending = { a: this.cur.a, b: this.cur.b };
        this.cur = null;
      }
    }
  }

  frame({ t, gw, ok, map, dead }) {
    const raw = Boolean(gw > 0.2 && ok && !map && !dead);
    const events = [];

    this.buf.push({ t, raw });
    if (this.buf.length === 1) {
      this._feedReady(this.buf[0].t, this.buf[0].raw, events);
    } else {
      while (this.buf.length >= 3) {
        const smoothed = (this.buf[0].raw ? 1 : 0) + (this.buf[1].raw ? 1 : 0) + (this.buf[2].raw ? 1 : 0) >= 2;
        this._feedReady(this.buf[1].t, smoothed, events);
        this.buf.shift();
      }
    }

    if (this.pending && t >= this.pending.b + this.gap - 1e-6) {
      const ev = this._resolveInterval(this.pending);
      this.pending = null;
      if (ev) events.push(ev);
    }

    return events;
  }

  end(tEnd) {
    const events = [];
    if (this.buf.length >= 2) {
      const last = this.buf[this.buf.length - 1];
      this._feedReady(last.t, last.raw, events);
    }
    this.buf = [];

    const int = this.cur || this.pending;
    if (int) {
      if (int.b >= tEnd - this.endTol - 1e-6) {
        // 未使用のまま終了
      } else {
        const ev = this._resolveInterval(int);
        if (ev) events.push(ev);
      }
    }
    this.reset();
    return events;
  }
}
