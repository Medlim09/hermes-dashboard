/**
 * Hermes Alert Engine
 *
 * Issues a structured alert ONLY when all three gates pass:
 *   1. confidence > CONF_THRESHOLD (0.75)
 *   2. At least one Tier A wallet is involved
 *   3. Pattern and market confirmation are aligned (regime validation passed)
 *
 * Daily cap: MAX_DAILY alerts (default 3).
 * When cap is reached, subsequent candidates are scored and queued —
 * the day's final roster is the top MAX_DAILY by confidence.
 *
 * Format:
 *   "ASSET LONG | Conf: 0.78 | Entry: x–y | Invalidation: z | Reason: ..."
 */

"use strict";

const CONF_THRESHOLD = 0.75;
const MAX_DAILY      = 3;

// ── Helpers ──────────────────────────────────────────────────────────── //

function todayUTC() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function formatMessage(a) {
  return (
    `${a.asset} ${a.decision}` +
    ` | Conf: ${a.confidence.toFixed(2)}` +
    ` | Entry: ${a.entry_zone}` +
    ` | Invalidation: ${a.invalidation}` +
    ` | Reason: ${a.reason}`
  );
}

// ── AlertEngine ───────────────────────────────────────────────────────── //

class AlertEngine {
  constructor() {
    this._date     = null;  // current trading day (UTC)
    this._issued   = [];    // confirmed alerts for the day
    this._queue    = [];    // candidates that passed gates but are awaiting rank
  }

  // Reset state when the UTC date rolls over
  _tick() {
    const today = todayUTC();
    if (this._date !== today) {
      this._date   = today;
      this._issued = [];
      this._queue  = [];
    }
  }

  // Re-rank queue and promote top MAX_DAILY to issued
  _promote() {
    const all = [...this._issued, ...this._queue]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_DAILY);

    this._issued = all;
    this._queue  = [];
  }

  /**
   * Evaluate a candidate signal against all gates.
   *
   * @param {object} candidate
   *   asset           {string}  e.g. "SOL"
   *   decision        {string}  "LONG" | "SHORT"
   *   confidence      {number}  0–1
   *   entry_zone      {string}  e.g. "138–142"
   *   invalidation    {string}  e.g. "below 130"
   *   targets         {string[]} e.g. ["155", "170"]
   *   pattern         {string}  e.g. "accumulation"
   *   regime          {string}  e.g. "range"
   *   regime_valid    {bool}    result of regime-validator.validate()
   *   tier_a_count    {number}  Tier A wallets active (0 = none)
   *   wallet_win_rate {number}  avg Tier A win rate (0–1)
   *   has_volume      {bool}    volume expansion confirmed
   *   extra_reason    {string}  optional context to append to reason
   *
   * @returns {object|null}  The alert object if issued/queued, null if rejected.
   */
  evaluate(candidate) {
    this._tick();

    const {
      asset,
      decision,
      confidence      = 0,
      entry_zone      = "–",
      invalidation    = "–",
      targets         = [],
      pattern         = "unknown",
      regime          = "unknown",
      regime_valid    = false,
      tier_a_count    = 0,
      wallet_win_rate = 0,
      has_volume      = false,
      extra_reason    = "",
    } = candidate;

    const rejections = [];

    // Gate 1: confidence threshold
    if (confidence <= CONF_THRESHOLD) {
      rejections.push(`confidence ${confidence.toFixed(2)} ≤ ${CONF_THRESHOLD}`);
    }

    // Gate 2: Tier A wallet required
    if (tier_a_count < 1) {
      rejections.push("no Tier A wallet involvement");
    }

    // Gate 3: pattern-regime alignment
    if (!regime_valid) {
      rejections.push(`pattern "${pattern}" rejected in ${regime} regime`);
    }

    if (rejections.length) {
      return { issued: false, reason: rejections.join("; "), candidate };
    }

    // Build reason string
    const reasonParts = [];
    if (tier_a_count > 0) {
      const wr = (wallet_win_rate * 100).toFixed(0);
      reasonParts.push(
        `${tier_a_count} Tier A wallet${tier_a_count > 1 ? "s" : ""} ${pattern}` +
        (wallet_win_rate > 0 ? ` (${wr}% win rate)` : ""),
      );
    }
    if (has_volume)  reasonParts.push("volume confirmation");
    if (extra_reason) reasonParts.push(extra_reason);
    reasonParts.push(`${regime.replace(/_/g, " ")} regime`);

    const alert = {
      id:          `${asset}-${Date.now()}`,
      asset,
      decision:    decision.toUpperCase(),
      confidence,
      entry_zone,
      invalidation,
      targets,
      pattern,
      regime,
      reason:      reasonParts.join(" + "),
      issued_at:   new Date().toISOString(),
      message:     "",   // filled below
    };
    alert.message = formatMessage(alert);

    // Slot the alert
    if (this._issued.length < MAX_DAILY) {
      this._issued.push(alert);
    } else {
      // Day is full — queue this candidate and re-rank
      this._queue.push(alert);
      this._promote();
    }

    return { issued: true, alert };
  }

  /**
   * Today's confirmed alerts.
   */
  today() {
    this._tick();
    return {
      date:      this._date,
      issued:    this._issued.length,
      remaining: Math.max(0, MAX_DAILY - this._issued.length),
      cap:       MAX_DAILY,
      threshold: CONF_THRESHOLD,
      alerts:    [...this._issued].sort((a, b) => b.confidence - a.confidence),
    };
  }

  /**
   * All-time list (current day only — resets at midnight UTC).
   */
  latest() {
    this._tick();
    return this._issued[this._issued.length - 1] ?? null;
  }
}

module.exports = new AlertEngine();
