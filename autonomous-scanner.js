/**
 * Hermes Autonomous Scanner
 *
 * Runs a periodic analysis cycle without user input.
 *
 * Each cycle:
 *   1. Scan wallet behavior — score drift, tier drops, win-rate collapse
 *   2. Scan pattern stats  — below-chance combos, calibration drift
 *   3. Scan regime state   — macro convergence, trend emergence
 *   4. Scan feedback ledger — loss clusters, drawdown signals
 *
 * When something unusual is found:
 *   • score anomaly against ANOMALY_THRESHOLD
 *   • deduplicate within DEDUP_WINDOW_H hours (no repeat noise)
 *   • log structured insight to insights.json
 *   • attempt alert only when score ≥ CONF_THRESHOLD + Tier A + regime valid
 *
 * Silence is the default output. Noise = failure.
 */

"use strict";

const fs       = require("fs");
const path     = require("path");
const wallets  = require("./wallet-tracker");
const regime   = require("./regime-validator");
const alerts   = require("./alert-engine");
const feedback = require("./feedback-loop");

// ── Config ───────────────────────────────────────────────────────────── //

const INSIGHTS_PATH = path.join(__dirname, "insights.json");
const STATE_PATH    = path.join(__dirname, "scanner-state.json");

const SCAN_INTERVAL_MS  = (parseInt(process.env.SCANNER_INTERVAL_MIN ?? "15", 10)) * 60_000;
const ANOMALY_THRESHOLD = 0.60;   // minimum score to log an insight
const CONF_THRESHOLD    = 0.75;   // minimum score to attempt an alert
const DEDUP_WINDOW_H    = 24;     // hours before same anomaly can re-surface
const DEDUP_WINDOW_MS   = DEDUP_WINDOW_H * 3_600_000;
const WIN_COLLAPSE_RATE = 0.40;   // ema_win_rate below this = collapse
const SCORE_DROP_ALERT  = 0.12;   // wallet score drop that triggers anomaly
const CALIB_GAP_ALERT   = 0.15;   // predicted vs actual confidence gap
const REGIME_CONSENSUS  = 0.70;   // fraction of assets on same regime = convergence
const LOSS_CLUSTER_N    = 3;      // losses in last 5 resolved signals = cluster
const MAX_INSIGHTS      = 500;

// ── Persistence ──────────────────────────────────────────────────────── //

function load(p, fallback) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { /* ignore */ }
  return fallback;
}

function save(p, data) {
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
  catch (e) { console.warn(`[Scanner] save failed (${path.basename(p)}):`, e.message); }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── Scanner ──────────────────────────────────────────────────────────── //

class AutonomousScanner {
  constructor() {
    this._insights = load(INSIGHTS_PATH, []);
    this._state    = load(STATE_PATH, {
      cycles:           0,
      last_run:         null,
      wallet_snapshots: {},   // address → { score, tier, snapped_at }
    });
    this._timer = null;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────── //

  start() {
    if (this._timer) return;
    const mins = SCAN_INTERVAL_MS / 60_000;
    console.log(`[Scanner] Autonomous scan enabled — every ${mins} min`);
    // First cycle after server settles (30 s delay)
    setTimeout(() => this._cycle(), 30_000).unref();
    this._timer = setInterval(() => this._cycle(), SCAN_INTERVAL_MS);
    this._timer.unref();
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  // ── Main cycle ──────────────────────────────────────────────────────── //

  _cycle() {
    this._state.cycles  += 1;
    this._state.last_run = new Date().toISOString();

    const candidates = [
      ...this._scanWallets(),
      ...this._scanPatterns(),
      ...this._scanRegimes(),
      ...this._scanFeedback(),
    ];

    // Filter: score must clear threshold
    const anomalies = candidates.filter((a) => a.score >= ANOMALY_THRESHOLD);

    // Deduplicate: suppress repeats within window
    const fresh = anomalies.filter((a) => !this._isDuplicate(a));

    // Process each fresh anomaly
    for (const anomaly of fresh) {
      this._log(anomaly);
      this._maybeAlert(anomaly);
    }

    // Snapshot wallet state for next cycle's diff
    this._snapshotWallets();
    save(STATE_PATH, this._state);

    // Only log if something was found — silence is the default
    if (fresh.length > 0) {
      console.log(
        `[Scanner] Cycle ${this._state.cycles}: ` +
        `${fresh.length} anomal${fresh.length === 1 ? "y" : "ies"} logged ` +
        `(${anomalies.length - fresh.length} deduplicated)`,
      );
    }
  }

  // ── Scan 1: Wallet behaviour ─────────────────────────────────────────── //

  _scanWallets() {
    const found = [];
    const now   = new Date().toISOString();

    for (const [address, data] of Object.entries(wallets.wallets)) {
      if (data.total_signals < 10) continue;   // not enough history

      const score = wallets.score(address);
      if (score === null) continue;

      const tier  = wallets.tier(address);
      const stats = wallets.stats(address);
      const snap  = this._state.wallet_snapshots[address];
      const tag   = address.slice(0, 8) + "…";

      // ── Score degradation ──────────────────────────────────────────── //
      if (snap && score < snap.score - SCORE_DROP_ALERT) {
        const drop = snap.score - score;
        found.push({
          type:        "wallet_score_degradation",
          category:    "wallet",
          address,
          score:       clamp(drop / 0.25, ANOMALY_THRESHOLD, 1.0),
          context:     { from: +snap.score.toFixed(3), to: +score.toFixed(3), drop: +drop.toFixed(3), tier },
          description: `Wallet ${tag} score dropped ${(drop * 100).toFixed(1)}pp (${snap.score.toFixed(2)} → ${score.toFixed(2)})`,
          detected_at: now,
        });
      }

      // ── Tier A → lower tier ─────────────────────────────────────────── //
      if (snap?.tier === "A" && tier !== "A") {
        found.push({
          type:        "tier_drop",
          category:    "wallet",
          address,
          score:       tier === "C" ? 0.90 : 0.72,
          context:     { from: "A", to: tier, score: +score.toFixed(3) },
          description: `Wallet ${tag} dropped from Tier A → Tier ${tier} (score ${score.toFixed(2)})`,
          detected_at: now,
        });
      }

      // ── Win-rate collapse ───────────────────────────────────────────── //
      if (stats?.ema_win_rate !== null && stats.ema_win_rate < WIN_COLLAPSE_RATE) {
        found.push({
          type:        "win_rate_collapse",
          category:    "wallet",
          address,
          score:       clamp(1 - stats.ema_win_rate / WIN_COLLAPSE_RATE, 0, 1),
          context:     { ema_win_rate: stats.ema_win_rate, total_signals: stats.total_signals, tier },
          description: `Wallet ${tag} win rate collapsed to ${(stats.ema_win_rate * 100).toFixed(1)}% (n=${stats.total_signals})`,
          detected_at: now,
        });
      }

      // ── Unusual burst: new signals >> snapshot ──────────────────────── //
      if (snap && data.total_signals - (snap.total_signals ?? data.total_signals) > 20) {
        const burst = data.total_signals - snap.total_signals;
        found.push({
          type:        "signal_burst",
          category:    "wallet",
          address,
          score:       clamp(burst / 40, ANOMALY_THRESHOLD, 0.85),
          context:     { burst, total: data.total_signals, tier },
          description: `Wallet ${tag} unusual activity: +${burst} signals since last cycle`,
          detected_at: now,
        });
      }
    }

    return found;
  }

  // ── Scan 2: Pattern × regime stats ───────────────────────────────────── //

  _scanPatterns() {
    const found = [];
    const now   = new Date().toISOString();
    const intel = feedback.intelligence();
    const stats = feedback.patternStats();

    for (const ps of stats) {
      if (!ps.mature || ps.ema_win_rate === null) continue;

      // Below-chance win rate
      if (ps.ema_win_rate < 0.45) {
        found.push({
          type:        "pattern_below_chance",
          category:    "pattern",
          pattern:     ps.pattern,
          regime:      ps.regime,
          score:       clamp(1 - ps.ema_win_rate / 0.45, ANOMALY_THRESHOLD, 1.0),
          context:     ps,
          description: `${ps.pattern}/${ps.regime}: win rate ${(ps.ema_win_rate * 100).toFixed(1)}% (n=${ps.n}) — below chance`,
          detected_at: now,
        });
      }

      // Persistent negative return
      if (ps.ema_return_7d !== null && ps.ema_return_7d < -0.03) {
        found.push({
          type:        "pattern_negative_return",
          category:    "pattern",
          pattern:     ps.pattern,
          regime:      ps.regime,
          score:       clamp(Math.abs(ps.ema_return_7d) / 0.10, ANOMALY_THRESHOLD, 1.0),
          context:     ps,
          description: `${ps.pattern}/${ps.regime}: avg 7d return ${(ps.ema_return_7d * 100).toFixed(2)}% — persistent loss`,
          detected_at: now,
        });
      }
    }

    // Confidence calibration drift
    for (const [bucket, cal] of Object.entries(intel.calibration ?? {})) {
      if (!cal || cal.n < 8 || cal.actual_win_rate == null) continue;
      const gap = cal.predicted_avg - cal.actual_win_rate;  // positive = overconfident
      if (Math.abs(gap) > CALIB_GAP_ALERT) {
        found.push({
          type:        "calibration_drift",
          category:    "pattern",
          bucket,
          score:       clamp(Math.abs(gap) / 0.30, ANOMALY_THRESHOLD, 1.0),
          context:     {
            bucket,
            predicted:  +cal.predicted_avg.toFixed(3),
            actual:     +cal.actual_win_rate.toFixed(3),
            gap:        +gap.toFixed(3),
            n:          cal.n,
          },
          description:
            `Confidence bucket [${bucket}]: predicted ${(cal.predicted_avg * 100).toFixed(1)}% ` +
            `but actual ${(cal.actual_win_rate * 100).toFixed(1)}% — ` +
            `${gap > 0 ? "overconfident" : "underconfident"} by ${(Math.abs(gap) * 100).toFixed(1)}pp`,
          detected_at: now,
        });
      }
    }

    return found;
  }

  // ── Scan 3: Regime state — macro convergence ───────────────────────── //

  _scanRegimes() {
    const found = [];
    const now   = new Date().toISOString();

    const known = regime.allRegimes();
    if (known.length < 3) return found;   // need ≥ 3 assets to call a macro move

    const counts = {};
    for (const r of known) counts[r.regime] = (counts[r.regime] ?? 0) + 1;

    const [[dominant, count]] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const fraction = count / known.length;

    if (fraction >= REGIME_CONSENSUS) {
      found.push({
        type:        "regime_convergence",
        category:    "trend",
        regime:      dominant,
        score:       clamp(fraction, ANOMALY_THRESHOLD, 1.0),
        context:     { dominant, count, total: known.length, fraction: +fraction.toFixed(2), counts },
        description: `${count}/${known.length} tracked assets converging on ${dominant.replace(/_/g, " ")} — macro trend forming`,
        detected_at: now,
      });
    }

    // Detect a regime that recently flipped vs snapshot
    const snap = this._state.regime_snapshot ?? {};
    for (const { asset, regime: current } of known) {
      if (snap[asset] && snap[asset] !== current) {
        found.push({
          type:        "regime_flip",
          category:    "trend",
          asset,
          score:       0.72,
          context:     { from: snap[asset], to: current },
          description: `${asset} regime flipped: ${snap[asset].replace(/_/g, " ")} → ${current.replace(/_/g, " ")}`,
          detected_at: now,
        });
      }
    }

    // Save snapshot for next cycle
    this._state.regime_snapshot = Object.fromEntries(known.map((r) => [r.asset, r.regime]));

    return found;
  }

  // ── Scan 4: Feedback ledger — drawdown clusters ───────────────────────── //

  _scanFeedback() {
    const found = [];
    const now   = new Date().toISOString();

    const resolved = feedback.allSignals()
      .filter((s) => s.outcome)
      .slice(0, 5);   // last 5 resolved

    if (resolved.length < 5) return found;

    const losses = resolved.filter((s) => s.outcome.win === false).length;

    if (losses >= LOSS_CLUSTER_N) {
      found.push({
        type:        "loss_cluster",
        category:    "feedback",
        score:       clamp(losses / 5, ANOMALY_THRESHOLD, 1.0),
        context:     {
          losses,
          window:  resolved.length,
          signals: resolved.map((s) => ({ id: s.id, asset: s.asset, win: s.outcome.win })),
        },
        description: `${losses} of last ${resolved.length} resolved signals were losses — drawdown cluster`,
        detected_at: now,
      });
    }

    return found;
  }

  // ── Deduplication ────────────────────────────────────────────────────── //

  _isDuplicate(anomaly) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    return this._insights.some((i) =>
      i.type    === anomaly.type    &&
      i.address === anomaly.address &&
      i.pattern === anomaly.pattern &&
      i.regime  === anomaly.regime  &&
      i.bucket  === anomaly.bucket  &&
      i.asset   === anomaly.asset   &&
      new Date(i.detected_at).getTime() > cutoff,
    );
  }

  // ── Logging ───────────────────────────────────────────────────────────── //

  _log(insight) {
    const entry = { ...insight, logged_at: new Date().toISOString() };
    this._insights.unshift(entry);
    if (this._insights.length > MAX_INSIGHTS) this._insights.length = MAX_INSIGHTS;
    save(INSIGHTS_PATH, this._insights);

    console.log(
      `[Scanner] INSIGHT [${insight.category}/${insight.type}]` +
      ` score=${insight.score.toFixed(2)} — ${insight.description}`,
    );
  }

  // ── Alert gate ────────────────────────────────────────────────────────── //

  _maybeAlert(insight) {
    // Only fire for asset-specific, high-confidence insights with Tier A backing
    if (!insight.asset)           return;
    if (insight.score < CONF_THRESHOLD) return;

    const tierA = wallets.tierA();
    if (tierA.length === 0)       return;   // Tier A required

    const regimeInfo   = regime.getRegime(insight.asset);
    const detectedPat  = insight.pattern ?? "accumulation";
    const validation   = regime.validate(detectedPat, regimeInfo.regime);
    if (!validation.valid)        return;   // regime gate

    const avgWinRate = tierA.reduce((s, w) => s + w.win_rate, 0) / tierA.length;

    const result = alerts.evaluate({
      asset:           insight.asset,
      decision:        insight.decision ?? "LONG",
      confidence:      insight.score,
      entry_zone:      "–",
      invalidation:    "–",
      targets:         [],
      pattern:         detectedPat,
      regime:          regimeInfo.regime,
      regime_valid:    true,
      tier_a_count:    tierA.length,
      wallet_win_rate: avgWinRate,
      has_volume:      false,
      extra_reason:    `autonomous scan: ${insight.type}`,
    });

    if (result.issued) {
      feedback.register(result.alert, tierA.map((w) => w.address));
      console.log(`[Scanner] Alert issued: ${result.alert.message}`);
    }
  }

  // ── Wallet snapshot (for next cycle's diff) ───────────────────────────── //

  _snapshotWallets() {
    for (const [address, data] of Object.entries(wallets.wallets)) {
      const score = wallets.score(address);
      if (score === null) continue;
      this._state.wallet_snapshots[address] = {
        score,
        tier:          wallets.tier(address),
        total_signals: data.total_signals,
        snapped_at:    new Date().toISOString(),
      };
    }
  }

  // ── Public API ────────────────────────────────────────────────────────── //

  /** Recent logged insights, newest first. */
  insights(limit = 50) {
    return this._insights.slice(0, limit);
  }

  /** Scanner health and config. */
  status() {
    return {
      running:           !!this._timer,
      cycles:            this._state.cycles,
      last_run:          this._state.last_run,
      next_run_in_s:     this._timer
        ? Math.round((SCAN_INTERVAL_MS - ((Date.now() - new Date(this._state.last_run ?? 0).getTime()) % SCAN_INTERVAL_MS)) / 1000)
        : null,
      interval_min:      SCAN_INTERVAL_MS / 60_000,
      insights_total:    this._insights.length,
      anomaly_threshold: ANOMALY_THRESHOLD,
      conf_threshold:    CONF_THRESHOLD,
      dedup_window_h:    DEDUP_WINDOW_H,
    };
  }
}

module.exports = new AutonomousScanner();
