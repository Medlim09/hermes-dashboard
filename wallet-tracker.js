/**
 * Hermes Wallet Performance Tracker
 *
 * Records per-wallet signal outcomes and computes tiered scores.
 * Scores update incrementally — no sudden jumps.
 * Wallets with < MIN_OBS observations are ignored entirely.
 * Only the top decile by composite score earns Tier A.
 *
 * Storage: wallet-store.json (write-through; resets on cold deploy).
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "wallet-store.json");
const MIN_OBS    = 10;   // minimum observations before scoring
const MAX_HIST   = 200;  // rolling window cap per metric array

// ── Math helpers ──────────────────────────────────────────────────── //

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
}

// Exponential moving average — alpha controls update speed (smaller = slower)
function ema(prev, next, alpha = 0.15) {
  return prev == null ? next : prev * (1 - alpha) + next * alpha;
}

// ── WalletTracker ─────────────────────────────────────────────────── //

class WalletTracker {
  constructor() {
    this.wallets = {};
    this._load();
    // Periodic flush every 5 min (backup for high-frequency scenarios)
    setInterval(() => this._save(), 5 * 60 * 1000).unref();
  }

  // ── Persistence ────────────────────────────────────────────────── //

  _load() {
    try {
      if (fs.existsSync(STORE_PATH)) {
        this.wallets = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
        const n = Object.keys(this.wallets).length;
        console.log(`[WalletTracker] Loaded ${n} wallet(s) from store`);
      }
    } catch (e) {
      console.warn("[WalletTracker] Load failed — starting fresh:", e.message);
      this.wallets = {};
    }
  }

  _save() {
    try {
      fs.writeFileSync(STORE_PATH, JSON.stringify(this.wallets));
    } catch (e) {
      console.warn("[WalletTracker] Save failed:", e.message);
    }
  }

  // ── Internal helpers ───────────────────────────────────────────── //

  _init(address) {
    if (!this.wallets[address]) {
      this.wallets[address] = {
        total_signals:       0,
        wins:                0,
        returns_24h:         [],   // rolling forward returns
        returns_7d:          [],
        max_adverse:         [],   // max adverse excursion per trade
        regime_returns: {
          bull:  [],
          bear:  [],
          range: [],
        },
        ema_win_rate:        null, // smoothed metrics
        ema_return_7d:       null,
        last_signal:         null,
      };
    }
    return this.wallets[address];
  }

  _push(arr, val) {
    arr.push(val);
    if (arr.length > MAX_HIST) arr.shift();
  }

  // ── Public API ─────────────────────────────────────────────────── //

  /**
   * Record a signal observation (and optional outcome).
   *
   * @param {string} address   Wallet address
   * @param {object} signal    { asset, type: 'accumulation'|'distribution', regime: 'bull'|'bear'|'range' }
   * @param {object} outcome   { win: bool, return_24h: float, return_7d: float, max_adverse: float }
   *                           All outcome fields are optional (e.g., record signal now, outcome later).
   */
  record(address, signal = {}, outcome = {}) {
    const w = this._init(address);
    const regime = signal.regime || "range";

    w.total_signals += 1;
    w.last_signal = new Date().toISOString();

    // Outcome fields (may arrive in a second call when trade closes)
    if (typeof outcome.win === "boolean") {
      w.wins += outcome.win ? 1 : 0;
      w.ema_win_rate = ema(w.ema_win_rate, outcome.win ? 1 : 0);
    }

    if (outcome.return_24h != null) {
      this._push(w.returns_24h, outcome.return_24h);
    }

    if (outcome.return_7d != null) {
      this._push(w.returns_7d, outcome.return_7d);
      w.ema_return_7d = ema(w.ema_return_7d, outcome.return_7d);
      if (regime in w.regime_returns) {
        this._push(w.regime_returns[regime], outcome.return_7d);
      }
    }

    if (outcome.max_adverse != null) {
      this._push(w.max_adverse, outcome.max_adverse);
    }

    this._save();
  }

  /**
   * Compute composite score [0, 1] for a wallet.
   * Returns null if wallet has < MIN_OBS observations.
   */
  score(address) {
    const w = this.wallets[address];
    if (!w || w.total_signals < MIN_OBS) return null;

    const win_rate = w.wins / w.total_signals;

    // Normalize 7d return: 0% → 0.5, +10% → 1.0, -10% → 0.0
    const avg_7d   = mean(w.returns_7d);
    const ret_score = clamp(avg_7d / 0.10 * 0.5 + 0.5, 0, 1);

    // Consistency: lower stddev of returns = higher score
    const vol       = stddev(w.returns_7d);
    const consistency = clamp(1 - vol / 0.20, 0, 1);

    // Sample weight: saturates at 50 observations
    const sample_wt = clamp(w.total_signals / 50, 0, 1);

    // Use EMA where available (more stable than raw mean for win_rate)
    const wr = w.ema_win_rate != null ? w.ema_win_rate : win_rate;

    // Weights (must sum to 1.0):
    //   wr         0.25 — EMA-smoothed win rate (trend-sensitive, recency-aware)
    //   win_rate   0.20 — raw historical win rate (anchors EMA against drift)
    //   ret_score  0.25 — normalised 7d return (outcome quality)
    //   consistency 0.20 — return stability (lower vol = higher score)
    //   sample_wt  0.10 — observation depth (saturates at 50)
    return clamp(
      wr          * 0.25 +
      win_rate    * 0.20 +
      ret_score   * 0.25 +
      consistency * 0.20 +
      sample_wt   * 0.10,
      0, 1,
    );
  }

  /**
   * Returns full stats object for a wallet, or null if ineligible.
   */
  stats(address) {
    const w = this.wallets[address];
    if (!w || w.total_signals < MIN_OBS) return null;

    const regime_perf = {};
    for (const [r, returns] of Object.entries(w.regime_returns)) {
      if (returns.length >= 3) {
        regime_perf[r] = { avg_return: +mean(returns).toFixed(4), n: returns.length };
      }
    }

    const sorted_regimes = Object.entries(regime_perf).sort(
      (a, b) => b[1].avg_return - a[1].avg_return,
    );

    return {
      address,
      total_signals:   w.total_signals,
      win_rate:        +(w.wins / w.total_signals).toFixed(3),
      ema_win_rate:    w.ema_win_rate != null ? +w.ema_win_rate.toFixed(3) : null,
      avg_return_24h:  +mean(w.returns_24h).toFixed(4),
      avg_return_7d:   +mean(w.returns_7d).toFixed(4),
      ema_return_7d:   w.ema_return_7d != null ? +w.ema_return_7d.toFixed(4) : null,
      avg_max_adverse: +mean(w.max_adverse).toFixed(4),
      best_regime:     sorted_regimes[0]?.[0] ?? null,
      worst_regime:    sorted_regimes[sorted_regimes.length - 1]?.[0] ?? null,
      regime_perf,
      score:           +this.score(address).toFixed(3),
      last_signal:     w.last_signal,
    };
  }

  /**
   * Tier a single wallet based on the current population distribution.
   * Returns 'A' | 'B' | 'C' | null (null = not enough data).
   */
  tier(address) {
    const s = this.score(address);
    if (s === null) return null;

    const all = this._allEligibleScores();
    if (!all.length) return "C";

    const p90 = all[Math.floor(all.length * 0.90)];
    const p50 = all[Math.floor(all.length * 0.50)];

    if (s >= p90) return "A";
    if (s >= p50) return "B";
    return "C";
  }

  _allEligibleScores() {
    return Object.keys(this.wallets)
      .map((a) => this.score(a))
      .filter((s) => s !== null)
      .sort((a, b) => a - b);
  }

  /**
   * Returns all Tier A wallet stats, sorted by score descending.
   */
  tierA() {
    const scores = this._allEligibleScores();
    if (!scores.length) return [];

    const p90 = scores[Math.floor(scores.length * 0.90)];

    return Object.keys(this.wallets)
      .filter((a) => {
        const s = this.score(a);
        return s !== null && s >= p90;
      })
      .map((a) => this.stats(a))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Compact summary for health checks and system context.
   */
  summary() {
    const all      = Object.keys(this.wallets);
    const eligible = all.filter((a) => this.wallets[a].total_signals >= MIN_OBS);
    const tierA    = this.tierA();

    return {
      total_wallets:    all.length,
      eligible_wallets: eligible.length,
      tier_a_count:     tierA.length,
      min_observations: MIN_OBS,
      top_wallets:      tierA.slice(0, 5).map((s) => ({
        address:      s.address,
        score:        s.score,
        win_rate:     s.win_rate,
        avg_return_7d: s.avg_return_7d,
        total_signals: s.total_signals,
      })),
    };
  }
}

module.exports = new WalletTracker();
