/**
 * Hermes Regime Validator
 *
 * Steps before any signal is issued:
 *   1. Identify market regime: trending_up | trending_down | range
 *   2. Identify the setup pattern from context
 *   3. Validate compatibility — mismatch → REJECT (caller must return WAIT)
 *
 * Regimes can be:
 *   • set explicitly via setRegime() (e.g. from POST /regime)
 *   • inferred heuristically from asset summary text (offline fallback)
 *
 * Rules:
 *   • accumulation   → range only (downtrend requires reversal evidence)
 *   • breakout long  → range or uptrend + volume expansion required
 *   • distribution   → range or downtrend
 *   • reversal long  → only valid in trending_down with supporting evidence
 *   • continuation   → must align with current trend direction
 */

"use strict";

// ── Regime constants ───────────────────────────────────────────────── //

const REGIMES = ["trending_up", "trending_down", "range"];

// ── Pattern ↔ Regime compatibility matrix ─────────────────────────── //
//
// Each entry: { ok: bool, note: string }
//   ok = false → caller MUST return WAIT (hard reject)
//   ok = true  → signal may proceed (confidence may be capped per pattern)

const COMPAT = {
  accumulation: {
    range:         { ok: true,  note: "Accumulation in range — ideal. Wait for range boundary confirmation." },
    trending_up:   { ok: true,  note: "Accumulation in uptrend — continuation bias; watch for exhaustion near resistance." },
    trending_down: { ok: false, note: "Accumulation in downtrend — insufficient reversal evidence. Signal rejected." },
  },
  distribution: {
    range:         { ok: true,  note: "Distribution in range — valid short setup. Confirm at upper boundary." },
    trending_down: { ok: true,  note: "Distribution in downtrend — continuation; confirms directional bias." },
    trending_up:   { ok: false, note: "Distribution against uptrend — counter-trend, no confluence. Signal rejected." },
  },
  breakout: {
    range:         { ok: true,  note: "Breakout from range — valid. Require volume expansion before entry." },
    trending_up:   { ok: true,  note: "Continuation breakout in uptrend — weaker setup; use tighter stops." },
    trending_down: { ok: false, note: "Long breakout in downtrend — high failure rate. Signal rejected." },
  },
  reversal: {
    trending_down: { ok: true,  note: "Reversal long in downtrend — valid if structure + volume confirm. High bar." },
    trending_up:   { ok: true,  note: "Reversal short in uptrend — valid. Confirm with distribution signal." },
    range:         { ok: false, note: "Reversal in range — no clear trend to reverse. Signal rejected." },
  },
  continuation: {
    trending_up:   { ok: true,  note: "Long continuation in uptrend — aligned." },
    trending_down: { ok: true,  note: "Short continuation in downtrend — aligned." },
    range:         { ok: false, note: "Continuation in range — no trend. Signals will chop. Signal rejected." },
  },
};

// ── Volume requirement flags ───────────────────────────────────────── //
// Patterns that REQUIRE volume expansion regardless of regime

const REQUIRES_VOLUME = new Set(["breakout"]);

// ── Asset regime store (in-memory, updated via setRegime) ──────────── //

const _assetRegimes = {};

// ── Heuristic regime inference ─────────────────────────────────────── //

const TRENDING_UP_RE   = /strong bull|uptrend|trending up|all[- ]?time high|\bATH\b|rally|breaks? (?:above|out)|higher high/i;
const TRENDING_DOWN_RE = /downtrend|trending down|strong bear|sell[- ]?off|distribution phase|lower high|breaks? (?:below|down)|compressing/i;

function inferRegimeFromText(text) {
  if (TRENDING_UP_RE.test(text))   return "trending_up";
  if (TRENDING_DOWN_RE.test(text)) return "trending_down";
  return "range";
}

// ── Pattern detection from message text ───────────────────────────── //

function detectPattern(message) {
  const m = String(message).toLowerCase();
  if (/accumulat/.test(m))               return "accumulation";
  if (/distribut/.test(m))               return "distribution";
  if (/break\s?out|break\s?above/.test(m)) return "breakout";
  if (/reversal|revert|reverse/.test(m)) return "reversal";
  if (/continuation|continued/.test(m)) return "continuation";
  // Fallback: infer from long/short bias
  if (/\blong\b|\bbuy\b|\bentry\b/.test(m)) return "accumulation";
  if (/\bshort\b|\bsell\b/.test(m))         return "distribution";
  return null;
}

// ── Public API ─────────────────────────────────────────────────────── //

/**
 * Validate a pattern against a regime before issuing a signal.
 *
 * @param {string|null} pattern  e.g. "accumulation"
 * @param {string}      regime   e.g. "trending_down"
 * @param {object}      opts     { hasVolumeExpansion: bool }
 * @returns {{ valid: bool, reason: string, pattern: string, regime: string }}
 */
function validate(pattern, regime, opts = {}) {
  // Unknown pattern — pass through with warning
  if (!pattern || !COMPAT[pattern]) {
    return {
      valid:   true,
      reason:  "Pattern not classified — proceeding with caution. Apply manual regime check.",
      pattern: pattern || "unknown",
      regime,
    };
  }

  const rule = COMPAT[pattern]?.[regime];

  // Missing rule combo — permissive but flagged
  if (!rule) {
    return {
      valid:   true,
      reason:  `No rule defined for ${pattern} in ${regime} — proceeding with reduced confidence.`,
      pattern,
      regime,
    };
  }

  // Hard reject on mismatch
  if (!rule.ok) {
    return { valid: false, reason: rule.note, pattern, regime };
  }

  // Volume check for breakout patterns
  if (REQUIRES_VOLUME.has(pattern) && opts.hasVolumeExpansion === false) {
    return {
      valid:   false,
      reason:  `${pattern} requires volume expansion — none detected. Signal rejected.`,
      pattern,
      regime,
    };
  }

  return { valid: true, reason: rule.note, pattern, regime };
}

/**
 * Get current regime for an asset.
 * Falls back to heuristic inference from optional text.
 *
 * @returns {{ regime, confidence, source }}
 */
function getRegime(asset, fallbackText = "") {
  if (_assetRegimes[asset]) return _assetRegimes[asset];
  const regime = inferRegimeFromText(fallbackText);
  return { regime, confidence: 0.50, source: "inferred" };
}

/**
 * Set regime for an asset explicitly (e.g. from POST /regime).
 */
function setRegime(asset, regime, confidence = 0.80, source = "manual") {
  if (!REGIMES.includes(regime)) {
    throw new Error(`Unknown regime "${regime}". Valid: ${REGIMES.join(", ")}`);
  }
  _assetRegimes[asset] = {
    regime,
    confidence,
    source,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Dump all explicitly set regimes.
 */
function allRegimes() {
  return Object.entries(_assetRegimes).map(([asset, r]) => ({ asset, ...r }));
}

module.exports = {
  validate,
  getRegime,
  setRegime,
  allRegimes,
  detectPattern,
  inferRegimeFromText,
  REGIMES,
  COMPAT,
};
