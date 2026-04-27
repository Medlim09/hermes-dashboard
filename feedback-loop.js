/**
 * Hermes Feedback Loop
 *
 * Closes the Prediction → Outcome → Compare → Learn → Update cycle.
 *
 * After each resolved signal:
 *   1. Compare: was regime right? pattern right? confidence calibrated?
 *   2. Identify: extract which factors drove the win or failure
 *   3. Learn: EMA-update pattern weights, factor lift, calibration buckets
 *   4. Update: adjust internal scoring — gradually, never abruptly
 *   5. Reflect: store a structured reflection for future decisions
 *
 * Anti-overfit guards:
 *   - EMA alpha = 0.08 (slow — resists noise)
 *   - Minimum MIN_SAMPLE outcomes before any weight moves
 *   - Per-update weight delta capped at MAX_DELTA
 *   - All weights bounded [WEIGHT_MIN, WEIGHT_MAX]
 *   - Reflections rolling-capped at MAX_REFLECTIONS
 */

"use strict";

const fs      = require("fs");
const path    = require("path");
const wallets = require("./wallet-tracker");

// ── Constants ───────────────────────────────────────────────────────── //

const LEDGER_PATH      = path.join(__dirname, "signal-ledger.json");
const WEIGHTS_PATH     = path.join(__dirname, "weight-store.json");
const REFLECTIONS_PATH = path.join(__dirname, "reflections.json");

const EMA_ALPHA        = 0.08;   // slow — resists recent-outcome bias
const MIN_SAMPLE       = 5;      // outcomes needed before weight moves
const MAX_DELTA        = 0.05;   // max weight shift per update
const WEIGHT_MIN       = 0.05;
const WEIGHT_MAX       = 0.60;
const MAX_REFLECTIONS  = 200;

// ── Persistence helpers ──────────────────────────────────────────────── //

function load(p, fallback) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { /* ignore */ }
  return fallback;
}

function save(p, data) {
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
  catch (e) { console.warn(`[FeedbackLoop] save failed (${path.basename(p)}):`, e.message); }
}

// ── EMA helper ───────────────────────────────────────────────────────── //

function ema(prev, next, alpha = EMA_ALPHA) {
  return prev == null ? next : prev * (1 - alpha) + next * alpha;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ── State ────────────────────────────────────────────────────────────── //

let _ledger      = load(LEDGER_PATH,      {});
let _weights     = load(WEIGHTS_PATH,     _defaultWeights());
let _reflections = load(REFLECTIONS_PATH, []);

function _defaultWeights() {
  return {
    // Win-rate EMA per pattern+regime combo — key: "pattern__regime"
    // { ema_win_rate, ema_return_7d, n }
    pattern_regime: {},

    // Lift contributed by each binary factor (above base win rate)
    // { ema_lift, n }
    factor_lift: {
      tier_a_wallet:  { ema_lift: null, n: 0 },
      volume_confirm: { ema_lift: null, n: 0 },
    },

    // Confidence calibration — are predicted confidence values accurate?
    // Buckets: "0.75", "0.80", "0.85", "0.90", "0.95"
    // { predicted_avg, actual_win_rate, n }
    calibration: {},

    // Regime accuracy — was the regime label correct?
    // Regime is "correct" when signal direction matches actual outcome
    // { ema_accuracy, n }
    regime_accuracy: {
      trending_up:   { ema_accuracy: null, n: 0 },
      trending_down: { ema_accuracy: null, n: 0 },
      range:         { ema_accuracy: null, n: 0 },
    },
  };
}

// ── Ledger ───────────────────────────────────────────────────────────── //

/**
 * Register a newly issued alert so we can match outcomes to it later.
 *
 * @param {object} alert    Alert object from alert-engine.evaluate()
 * @param {string[]} walletAddresses  Wallet addresses involved (optional)
 */
function register(alert, walletAddresses = []) {
  _ledger[alert.id] = {
    id:            alert.id,
    asset:         alert.asset,
    decision:      alert.decision,
    confidence:    alert.confidence,
    entry_zone:    alert.entry_zone,
    invalidation:  alert.invalidation,
    targets:       alert.targets,
    pattern:       alert.pattern,
    regime:        alert.regime,
    issued_at:     alert.issued_at,
    wallets:       walletAddresses,
    outcome:       null,   // filled by resolve()
  };
  save(LEDGER_PATH, _ledger);
  console.log(`[FeedbackLoop] Registered signal ${alert.id} (${alert.asset} ${alert.decision})`);
  return _ledger[alert.id];
}

// ── Compare ──────────────────────────────────────────────────────────── //

/**
 * Compare a prediction against its outcome and extract structured insight.
 *
 * @param {object} signal   Ledger entry
 * @param {object} outcome  Raw outcome from caller
 * @returns {object}        { win, return_24h, return_7d, analysis }
 */
function _compare(signal, outcome) {
  const {
    entry_price      = null,
    price_24h        = null,
    price_7d         = null,
    hit_target       = null,
    hit_invalidation = false,
    has_volume       = false,
    tier_a_count     = 0,
  } = outcome;

  const return_24h = (entry_price && price_24h != null)
    ? (price_24h - entry_price) / entry_price : null;
  const return_7d  = (entry_price && price_7d  != null)
    ? (price_7d  - entry_price) / entry_price : null;

  // Determine win — priority: explicit flags > return threshold
  let win;
  if      (hit_target === true)       win = true;
  else if (hit_invalidation === true) win = false;
  else if (return_7d  !== null)       win = return_7d  > 0.02;
  else if (return_24h !== null)       win = return_24h > 0.005;
  else                                win = null;

  // Regime was "correct" when decision direction matched the actual move
  const direction_correct =
    win === null ? null :
    (signal.decision === "LONG"  && win)  ? true  :
    (signal.decision === "SHORT" && win)  ? true  :
    (signal.decision === "WAIT")          ? null  : false;

  // Was pattern appropriate for regime? (already validated at issue time — check if the gate held)
  const pattern_valid = direction_correct;  // if it won, the pattern read was right

  // Confidence calibration error (predicted - actual binary outcome)
  const confidence_error = win === null ? null : signal.confidence - (win ? 1 : 0);

  // Key win / failure factor
  const key_win_factor  = win ? _dominantFactor(tier_a_count, has_volume, return_7d) : null;
  const key_miss_factor = !win && win !== null ? _missFactor(tier_a_count, has_volume, signal.confidence, return_7d) : null;

  return {
    win,
    return_24h,
    return_7d,
    has_volume,
    tier_a_count,
    analysis: {
      regime_correct:    direction_correct,
      pattern_valid,
      confidence_error:  confidence_error != null ? +confidence_error.toFixed(4) : null,
      key_win_factor,
      key_miss_factor,
    },
  };
}

function _dominantFactor(tier_a_count, has_volume, return_7d) {
  if (tier_a_count > 0 && has_volume)  return "tier_a_wallet + volume";
  if (tier_a_count > 0)                return "tier_a_wallet";
  if (has_volume)                      return "volume_confirmation";
  if (return_7d > 0.05)                return "strong_momentum";
  return "regime_alignment";
}

function _missFactor(tier_a_count, has_volume, confidence, return_7d) {
  if (!has_volume)                     return "no_volume_confirmation";
  if (tier_a_count === 0)              return "no_tier_a_wallet";
  if (confidence > 0.85)              return "overconfidence";
  if (return_7d < -0.05)              return "regime_reversal";
  return "macro_headwind";
}

// ── Learn ────────────────────────────────────────────────────────────── //

/**
 * Apply EMA updates to pattern weights, factor lift, calibration, regime accuracy.
 * All updates are bounded and capped per-step.
 *
 * @returns {object}  Deltas applied this update
 */
function _learn(signal, compared) {
  const { win, return_7d, has_volume, tier_a_count, analysis } = compared;
  const deltas = {};

  if (win === null) return deltas;  // can't learn from ambiguous outcomes

  const prKey = `${signal.pattern}__${signal.regime}`;

  // 1. Pattern × regime win rate
  const pr = _weights.pattern_regime[prKey] ||
    (_weights.pattern_regime[prKey] = { ema_win_rate: null, ema_return_7d: null, n: 0 });
  pr.n += 1;
  if (pr.n >= MIN_SAMPLE) {
    const prev_wr = pr.ema_win_rate;
    pr.ema_win_rate   = ema(pr.ema_win_rate,   win ? 1 : 0);
    pr.ema_return_7d  = ema(pr.ema_return_7d,  return_7d ?? 0);
    deltas[`pattern_regime.${prKey}.ema_win_rate`] = _delta(prev_wr, pr.ema_win_rate);
  }

  // 2. Factor lift (Tier A wallet)
  const fl_wallet = _weights.factor_lift.tier_a_wallet;
  fl_wallet.n += 1;
  if (fl_wallet.n >= MIN_SAMPLE) {
    const base = 0.50;  // neutral baseline
    const lift = tier_a_count > 0 ? (win ? 1 : 0) - base : 0;
    const prev = fl_wallet.ema_lift;
    fl_wallet.ema_lift = ema(fl_wallet.ema_lift, lift);
    deltas["factor_lift.tier_a_wallet"] = _delta(prev, fl_wallet.ema_lift);
  }

  // 3. Factor lift (volume confirmation)
  const fl_vol = _weights.factor_lift.volume_confirm;
  fl_vol.n += 1;
  if (fl_vol.n >= MIN_SAMPLE) {
    const base = 0.50;
    const lift = has_volume ? (win ? 1 : 0) - base : 0;
    const prev = fl_vol.ema_lift;
    fl_vol.ema_lift = ema(fl_vol.ema_lift, lift);
    deltas["factor_lift.volume_confirm"] = _delta(prev, fl_vol.ema_lift);
  }

  // 4. Confidence calibration bucket
  const bucket = _calibBucket(signal.confidence);
  const cal = _weights.calibration[bucket] ||
    (_weights.calibration[bucket] = { predicted_avg: signal.confidence, actual_win_rate: null, n: 0 });
  cal.n += 1;
  cal.predicted_avg = ema(cal.predicted_avg, signal.confidence, 0.20);
  if (cal.n >= MIN_SAMPLE) {
    cal.actual_win_rate = ema(cal.actual_win_rate, win ? 1 : 0);
  }
  deltas[`calibration.${bucket}`] = cal.actual_win_rate != null
    ? +(cal.predicted_avg - cal.actual_win_rate).toFixed(4) : null;

  // 5. Regime accuracy
  const ra = _weights.regime_accuracy[signal.regime];
  if (ra) {
    ra.n += 1;
    if (ra.n >= MIN_SAMPLE && analysis.regime_correct !== null) {
      ra.ema_accuracy = ema(ra.ema_accuracy, analysis.regime_correct ? 1 : 0);
    }
    deltas[`regime_accuracy.${signal.regime}`] = ra.ema_accuracy;
  }

  return deltas;
}

function _delta(prev, next) {
  if (prev == null || next == null) return null;
  return clamp(+(next - prev).toFixed(5), -MAX_DELTA, MAX_DELTA);
}

function _calibBucket(confidence) {
  const b = Math.floor(confidence * 20) / 20;  // round down to nearest 0.05
  return b.toFixed(2);
}

// ── Reflect ──────────────────────────────────────────────────────────── //

function _reflect(signal, compared, deltas) {
  const reflection = {
    signal_id:   signal.id,
    asset:       signal.asset,
    issued_at:   signal.issued_at,
    resolved_at: new Date().toISOString(),
    prediction: {
      decision:   signal.decision,
      confidence: signal.confidence,
      pattern:    signal.pattern,
      regime:     signal.regime,
    },
    outcome: {
      win:        compared.win,
      return_24h: compared.return_24h != null ? +compared.return_24h.toFixed(4) : null,
      return_7d:  compared.return_7d  != null ? +compared.return_7d.toFixed(4)  : null,
    },
    analysis:       compared.analysis,
    weight_deltas:  deltas,
  };

  _reflections.unshift(reflection);
  if (_reflections.length > MAX_REFLECTIONS) _reflections.length = MAX_REFLECTIONS;
  save(REFLECTIONS_PATH, _reflections);
  return reflection;
}

// ── Public: resolve ──────────────────────────────────────────────────── //

/**
 * Submit an outcome for a previously registered signal.
 * Runs compare → learn → update → reflect in one call.
 *
 * @param {string} id       Signal ID (alert.id from register())
 * @param {object} outcome
 *   entry_price      {number}   price at signal time (for return calc)
 *   price_24h        {number}   price 24h after signal
 *   price_7d         {number}   price 7d after signal
 *   hit_target       {bool}     reached a target level
 *   hit_invalidation {bool}     hit invalidation → loss
 *   has_volume       {bool}     volume confirmation at entry
 *   tier_a_count     {number}   Tier A wallets involved
 *   wallet_addresses {string[]} wallets to update in wallet-tracker
 *
 * @returns {{ signal, compared, learned, reflection }}
 */
function resolve(id, outcome) {
  const signal = _ledger[id];
  if (!signal)           throw new Error(`Signal "${id}" not found`);
  if (signal.outcome)    throw new Error(`Signal "${id}" already resolved`);

  // Step 1 & 2: Compare + identify
  const compared = _compare(signal, outcome);

  // Step 3 & 4: Learn + update weights (gradual, capped)
  const deltas = _learn(signal, compared);
  save(WEIGHTS_PATH, _weights);

  // Persist resolved outcome
  signal.outcome = {
    resolved_at:     new Date().toISOString(),
    entry_price:     outcome.entry_price ?? null,
    price_24h:       outcome.price_24h  ?? null,
    price_7d:        outcome.price_7d   ?? null,
    return_24h:      compared.return_24h,
    return_7d:       compared.return_7d,
    hit_target:      outcome.hit_target       ?? null,
    hit_invalidation: outcome.hit_invalidation ?? false,
    win:             compared.win,
  };
  save(LEDGER_PATH, _ledger);

  // Update wallet-tracker scores for involved wallets
  const addresses = (outcome.wallet_addresses || []).concat(signal.wallets || []);
  const seen = new Set();
  for (const addr of addresses) {
    if (seen.has(addr)) continue;
    seen.add(addr);
    wallets.record(
      addr,
      { asset: signal.asset, type: signal.pattern, regime: _walletRegime(signal.regime) },
      {
        win:        compared.win   ?? undefined,
        return_24h: compared.return_24h ?? undefined,
        return_7d:  compared.return_7d  ?? undefined,
      },
    );
  }

  // Step 5: Store reflection
  const reflection = _reflect(signal, compared, deltas);

  const label = compared.win === true ? "WIN ✓" : compared.win === false ? "LOSS ✗" : "ambiguous";
  console.log(
    `[FeedbackLoop] ${id} → ${label}` +
    (compared.return_7d != null ? ` 7d=${(compared.return_7d * 100).toFixed(2)}%` : "") +
    ` | miss=${compared.analysis.key_miss_factor ?? "none"}` +
    ` | win=${compared.analysis.key_win_factor ?? "none"}`,
  );

  return { signal, compared, learned: deltas, reflection };
}

function _walletRegime(r) {
  if (r === "trending_up")   return "bull";
  if (r === "trending_down") return "bear";
  return "range";
}

// ── Public: read state ───────────────────────────────────────────────── //

/** All unresolved signals (awaiting outcome). */
function pending() {
  return Object.values(_ledger)
    .filter((s) => !s.outcome)
    .sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at));
}

/** Full ledger (resolved + pending), newest first. */
function allSignals() {
  return Object.values(_ledger)
    .sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at));
}

/** Current learned weights snapshot. */
function weights() {
  return JSON.parse(JSON.stringify(_weights));
}

/** Recent reflections (newest first). */
function reflections(limit = 50) {
  return _reflections.slice(0, limit);
}

/**
 * Summary of pattern accuracy across all resolved signals.
 * Sorted by win rate descending.
 */
function patternStats() {
  return Object.entries(_weights.pattern_regime)
    .map(([key, v]) => {
      const [pattern, regime] = key.split("__");
      return {
        pattern,
        regime,
        n:             v.n,
        ema_win_rate:  v.ema_win_rate  != null ? +v.ema_win_rate.toFixed(3)  : null,
        ema_return_7d: v.ema_return_7d != null ? +v.ema_return_7d.toFixed(4) : null,
        mature:        v.n >= MIN_SAMPLE,
      };
    })
    .sort((a, b) => (b.ema_win_rate ?? -1) - (a.ema_win_rate ?? -1));
}

/**
 * Full system intelligence snapshot — weights, calibration, factor lift,
 * regime accuracy, and pattern stats.
 */
function intelligence() {
  const resolved = Object.values(_ledger).filter((s) => s.outcome);
  const wins     = resolved.filter((s) => s.outcome.win === true).length;

  return {
    resolved_signals:   resolved.length,
    pending_signals:    Object.values(_ledger).filter((s) => !s.outcome).length,
    overall_win_rate:   resolved.length ? +(wins / resolved.length).toFixed(3) : null,
    factor_lift:        _weights.factor_lift,
    regime_accuracy:    _weights.regime_accuracy,
    calibration:        _weights.calibration,
    pattern_stats:      patternStats(),
    min_sample:         MIN_SAMPLE,
    ema_alpha:          EMA_ALPHA,
  };
}

module.exports = {
  register,
  resolve,
  pending,
  allSignals,
  weights,
  reflections,
  patternStats,
  intelligence,
};
