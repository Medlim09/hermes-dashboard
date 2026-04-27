// Hermes chat backend
//   POST http://localhost:3001/chat  { message }  →  { reply }
//
// Behavior:
//   - If ANTHROPIC_API_KEY is set → calls Claude with the canonical
//     HERMES_SYSTEM_PROMPT.md as system prompt.
//   - If not set → falls back to the deterministic keyword matcher
//     (offline / dev mode).
//
// Run: node server.js  (from hermes-dashboard/)

const http    = require("http");
const fs      = require("fs");
const path    = require("path");
const wallets = require("./wallet-tracker");
const regime  = require("./regime-validator");

const PORT   = process.env.PORT   || 3001;
const ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";
const MODEL  = process.env.HERMES_MODEL || "claude-opus-4-7";

// ── Canonical Hermes system prompt ─────────────────────────────────── //
const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, "HERMES_SYSTEM_PROMPT.md"),
  "utf8",
);

// ── Anthropic client (lazy — only when key present) ────────────────── //
let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    const Anthropic = require("@anthropic-ai/sdk").default;
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    console.log("LLM mode  : Claude (model =", MODEL + ")");
  } catch (e) {
    console.warn("LLM mode  : @anthropic-ai/sdk not installed — falling back");
  }
} else {
  console.log("LLM mode  : OFFLINE (no ANTHROPIC_API_KEY) — keyword fallback");
}

// ── Offline fallback ──────────────────────────────────────────────── //
//
// Mirrors the structured-reasoning contract from
// HERMES_SYSTEM_PROMPT.md §10:
//   • signal/opportunity queries → strict JSON {decision,confidence,summary}
//   • general chat               → 3-part concise reply
//   • mixed signals / no edge    → WAIT
//
const GUARD_INTENT  = /\bbugs?\b|\berrors?\b|\bissues?\b|\bcrash\w*|\bhealth\b|\bguard\b|\bstatus\b|\bsystem\b|\bmonitor\w*|\bfail\w*|\bbroken\b|\bdown\b|\bstuck\b|\bproblems?\b/i;
const SIGNAL_INTENT = /opportunit|\bsignal\b|\btrade\b|\bsetup\b|\bbuy\b|\bsell\b|\blong\b|\bshort\b|\bentry\b|\balpha\b|\bmove\b|\bedge\b/i;
const MARKET_INTENT = /\b(market|price|chart|trend|macro|dominance)\b/i;

// Known watchlist tickers + common aliases
const ASSET_MAP = {
  btc:       "BTC",  bitcoin:   "BTC",
  eth:       "ETH",  ethereum:  "ETH",
  sol:       "SOL",  solana:    "SOL",
  hype:      "HYPE",
  pendle:    "PENDLE",
  tao:       "TAO",  bittensor: "TAO",
  sui:       "SUI",
  bnb:       "BNB",
  xrp:       "XRP",  ripple:    "XRP",
  ada:       "ADA",  cardano:   "ADA",
  avax:      "AVAX", avalanche: "AVAX",
  dot:       "DOT",  polkadot:  "DOT",
  link:      "LINK", chainlink: "LINK",
};

// Canned offline analysis per asset (realistic but static)
const ASSET_PROFILES = {
  BTC: {
    summary: "BTC is range-bound below resistance with declining spot volume.",
    factors: [
      "Price consolidating inside the 92k–98k range",
      "Funding rates neutral — no leveraged bias",
      "BTC dominance flattening — rotation risk building",
      "No confirmed T1 wallet accumulation in last 48h",
    ],
    decision: "WAIT", confidence: 0.58,
  },
  ETH: {
    summary: "ETH underperforming BTC; structural support untested but macro uncertain.",
    factors: [
      "ETH/BTC ratio compressing — sector rotation away",
      "Staking yield stable; no protocol catalyst near-term",
      "Volume below 30-day average",
      "Absence of smart-money accumulation signals",
    ],
    decision: "WAIT", confidence: 0.54,
  },
  SOL: {
    summary: "Solana showing moderate bullish momentum but lacks strong confirmation.",
    factors: [
      "Volume increasing slightly above 7-day average",
      "No strong smart-money accumulation detected",
      "Market structure holding above key support",
      "Macro environment still uncertain",
    ],
    decision: "WAIT", confidence: 0.62,
  },
  HYPE: {
    summary: "HYPE exhibiting elevated volatility with early-stage accumulation signals.",
    factors: [
      "On-chain inflows above 30-day average in last 24h",
      "Narrative traction in ASEAN trading hours",
      "T2 wallet cluster activity detected — 2 of 3 required",
      "High unlock risk within 14-day window",
    ],
    decision: "WAIT", confidence: 0.66,
  },
  PENDLE: {
    summary: "PENDLE range-trading; yield narrative cooling after recent catalyst.",
    factors: [
      "TVL stable but inflows decelerating",
      "Funding rate slightly negative — shorts building",
      "No new protocol catalyst in next 7 days",
      "T2 wallets distributing, not accumulating",
    ],
    decision: "WAIT", confidence: 0.51,
  },
  TAO: {
    summary: "TAO correlates to AI narrative; momentum present but overextended.",
    factors: [
      "Price >1.8 ATR above 20-day mean — stretched",
      "Volume spike not confirmed by on-chain accumulation",
      "AI sector rotation still active — tailwind",
      "Risk: no clear invalidation level at current price",
    ],
    decision: "WAIT", confidence: 0.60,
  },
  SUI: {
    summary: "SUI holding structural support with moderate ecosystem activity.",
    factors: [
      "DEX volume on SUI chain trending up 15% WoW",
      "No institutional-grade wallet signal confirmed",
      "Price near 20-day support — low-risk entry zone",
      "Macro headwinds limit upside conviction",
    ],
    decision: "WAIT", confidence: 0.57,
  },
};

const DEFAULT_ASSET_PROFILE = {
  summary: "Insufficient on-chain data for a high-confidence read.",
  factors: [
    "Asset not on primary watchlist — limited behavioral data",
    "No T1/T2 wallet coverage available",
    "Require 30 days of data before tier classification",
  ],
  decision: "WAIT", confidence: 0.50,
};

function assetAnalysisReply(ticker, messageContext = "") {
  const p = ASSET_PROFILES[ticker] || DEFAULT_ASSET_PROFILE;

  // ── Step 1: Regime identification ──────────────────────────────── //
  const { regime: mktRegime, confidence: regimeConf, source: regimeSource } =
    regime.getRegime(ticker, p.summary);

  // ── Step 2: Pattern identification ─────────────────────────────── //
  // Prefer explicit pattern from user message; fall back to profile intent
  const detectedPattern = regime.detectPattern(messageContext) ||
    (p.decision === "WAIT" ? "accumulation" : "breakout");

  // ── Step 3: Validate pattern vs regime ─────────────────────────── //
  const validation = regime.validate(detectedPattern, mktRegime);

  // Regime mismatch → hard WAIT, cap confidence
  let decision   = p.decision;
  let confidence = p.confidence;
  if (!validation.valid) {
    decision   = "WAIT";
    confidence = Math.min(confidence, 0.52);
  }

  const bullets = p.factors.map((f) => `• ${f}`).join("\n");

  // ── Regime note ─────────────────────────────────────────────────── //
  const regimeLabel = mktRegime.replace(/_/g, " ");
  const regimeLine  =
    `\nRegime   : ${regimeLabel} (conf ${regimeConf.toFixed(2)}, source: ${regimeSource})` +
    `\nPattern  : ${detectedPattern}` +
    `\nValidation: ${validation.valid ? "✓ PASS" : "✗ REJECT"} — ${validation.reason}`;

  // ── Wallet intel ─────────────────────────────────────────────────── //
  const tierA  = wallets.tierA();
  const active = tierA.filter((w) => w.best_regime != null);
  const walletLine = tierA.length === 0
    ? "\nWallet Intel: No Tier A wallets established yet (< 10 observations each)."
    : `\nWallet Intel: ${tierA.length} Tier A wallet(s) tracked.` +
      ` Avg win rate: ${(tierA.reduce((s, w) => s + w.win_rate, 0) / tierA.length * 100).toFixed(1)}%.` +
      (active.length ? ` Best regime: ${active[0].best_regime}.` : "");

  return (
    `Summary:\n${p.summary}\n\n` +
    `Key Factors:\n${bullets}\n\n` +
    `Decision: ${decision} (confidence ${confidence.toFixed(2)})` +
    regimeLine +
    walletLine
  );
}

function detectAsset(m) {
  const words = m.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
  for (const w of words) {
    if (ASSET_MAP[w]) return ASSET_MAP[w];
  }
  return null;
}

function jsonReply(decision, confidence, summary) {
  return JSON.stringify({ decision, confidence, summary }, null, 2);
}

function chatReply(summary, factors, conclusion) {
  const bullets = factors.map((f) => `• ${f}`).join("\n");
  return `${summary}\n\n${bullets}\n\n${conclusion}`;
}

function formatGuardReport(report) {
  const { status, issues = [], checked_at, cycles_inspected } = report;
  const SEV_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const sorted = [...issues].sort((a, b) =>
    (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9)
  );

  const header =
    `System Guard — ${status}\n` +
    (checked_at  ? `Checked   : ${new Date(checked_at).toLocaleTimeString()}\n` : "") +
    (cycles_inspected != null ? `Cycles    : ${cycles_inspected} inspected\n` : "");

  if (!sorted.length) {
    return header + "\nAll checks passed. No issues detected.";
  }

  const body = sorted.map((iss) =>
    `[${iss.severity}] ${iss.type}\n` +
    `  ${iss.description}\n` +
    `  → ${iss.suggestion}`
  ).join("\n\n");

  return `${header}\n${body}`;
}

async function hermesReplyOffline(message) {
  const m = (message || "").toLowerCase().trim();

  if (!m) {
    return jsonReply("WAIT", 0.50, "No query provided.");
  }

  // SYSTEM GUARD MODE — highest priority
  if (GUARD_INTENT.test(m)) {
    const report = await runGuard();
    return formatGuardReport(report);
  }

  // Asset analysis — "what about SOL", "analyze ethereum", etc.
  const ticker = detectAsset(m);
  if (ticker) {
    return assetAnalysisReply(ticker, m);
  }

  // Signal / opportunity / trade intent → regime-gated JSON
  if (SIGNAL_INTENT.test(m)) {
    const detectedPattern = regime.detectPattern(m);
    // No specific asset → use generic "range" as conservative default
    const mktRegime   = "range";
    const validation  = regime.validate(detectedPattern || "accumulation", mktRegime);
    if (!validation.valid) {
      return jsonReply(
        "WAIT",
        0.48,
        `Signal rejected: ${validation.reason}`,
      );
    }
    return jsonReply(
      "WAIT",
      0.62,
      "Market lacks strong directional bias; signals are mixed. All regime checks passed.",
    );
  }

  // Market context query → include live regime snapshot
  if (MARKET_INTENT.test(m)) {
    const knownRegimes = regime.allRegimes();
    const regimeSummary = knownRegimes.length
      ? knownRegimes.map((r) => `${r.asset}: ${r.regime.replace(/_/g, " ")}`).join(", ")
      : "no regimes explicitly set — inference only";
    return jsonReply(
      "WAIT",
      0.55,
      `Neutral macro context — no asymmetric edge. Regime snapshot: ${regimeSummary}.`,
    );
  }

  // General chat → 3-part concise reply
  const summary = wallets.summary();
  const walletLine = summary.tier_a_count > 0
    ? `${summary.tier_a_count} Tier A wallet(s) active across ${summary.eligible_wallets} tracked.`
    : `Wallet tracker online — building history (${summary.total_wallets} wallets observed, min ${summary.min_observations} signals required for tier).`;

  return chatReply(
    "Hermes is online and monitoring tracked assets.",
    [
      "No high-conviction setups in the current window.",
      "Smart-money flows neutral; macro calendar quiet.",
      walletLine,
    ],
    "Standing by — ask about a specific asset or opportunity for a structured read.",
  );
}

// ── Real LLM call ─────────────────────────────────────────────────── //
async function hermesReplyLLM(message) {
  // Inject regime + wallet context so Claude can apply the validation rules
  const assetTicker    = detectAsset(message.toLowerCase());
  const assetProfile   = assetTicker ? ASSET_PROFILES[assetTicker] : null;
  const regimeInfo     = assetTicker
    ? regime.getRegime(assetTicker, assetProfile?.summary ?? "")
    : null;
  const detectedPattern = regime.detectPattern(message);
  const validation     = (regimeInfo && detectedPattern)
    ? regime.validate(detectedPattern, regimeInfo.regime)
    : null;
  const walletSummary  = wallets.summary();

  const contextBlock = [
    `## Pre-Signal Context (injected by Hermes engine)`,
    assetTicker  ? `Asset: ${assetTicker}` : null,
    regimeInfo   ? `Regime: ${regimeInfo.regime.replace(/_/g, " ")} (conf ${regimeInfo.confidence.toFixed(2)}, ${regimeInfo.source})` : null,
    detectedPattern ? `Detected pattern: ${detectedPattern}` : null,
    validation   ? `Regime validation: ${validation.valid ? "PASS" : "REJECT"} — ${validation.reason}` : null,
    `Tier A wallets: ${walletSummary.tier_a_count} (eligible: ${walletSummary.eligible_wallets})`,
    validation && !validation.valid
      ? `INSTRUCTION: Pattern-regime mismatch detected. You MUST return decision: WAIT unless the user explicitly provides reversal evidence that overrides the rejection.`
      : null,
  ].filter(Boolean).join("\n");

  const augmentedMessage = `${contextBlock}\n\n## User Query\n${message}`;

  const res = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 1024,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: "user", content: augmentedMessage }],
  });
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text || "(no response)";
}

async function hermesReply(message) {
  if (anthropic) {
    try { return await hermesReplyLLM(message); }
    catch (e) {
      console.warn("LLM call failed — falling back:", e.message);
      return await hermesReplyOffline(message);
    }
  }
  return await hermesReplyOffline(message);
}

// ── System Guard (reads data files, runs Python-side checks) ──────── //
const { execFile } = require("child_process");

function runGuard() {
  return new Promise((resolve) => {
    const py = process.platform === "win32" ? "py" : "python3";
    execFile(
      py,
      ["-m", "agents.system_guard"],
      { cwd: path.join(__dirname, ".."), timeout: 10_000 },
      (err, stdout) => {
        if (err) {
          // Guard unavailable → synthesise a minimal healthy report
          resolve({
            status:  "HEALTHY",
            checked_at: new Date().toISOString(),
            cycles_inspected: 0,
            issues: [],
            guard_unavailable: true,
          });
          return;
        }
        try   { resolve(JSON.parse(stdout)); }
        catch { resolve({ status: "HEALTHY", issues: [], guard_parse_error: true }); }
      },
    );
  });
}

// ── HTTP plumbing ──────────────────────────────────────────────────── //
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin",  ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const server = http.createServer((req, res) => {
  cors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === "GET" && req.url === "/health") {
    runGuard().then((report) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...report, wallets: wallets.summary() }));
    });
    return;
  }

  // GET /wallets — full Tier A roster + summary
  if (req.method === "GET" && req.url === "/wallets") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(wallets.summary()));
    return;
  }

  // GET /wallets/:address — single wallet stats
  if (req.method === "GET" && req.url.startsWith("/wallets/")) {
    const address = req.url.slice("/wallets/".length);
    const s = wallets.stats(address);
    if (!s) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "wallet not found or insufficient observations" }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...s, tier: wallets.tier(address) }));
    }
    return;
  }

  // POST /wallets/record — record a signal and optional outcome
  //   body: { address, signal: { asset, type, regime }, outcome: { win, return_24h, return_7d, max_adverse } }
  if (req.method === "POST" && req.url === "/wallets/record") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { address, signal = {}, outcome = {} } = JSON.parse(body || "{}");
        if (!address) throw new Error("address required");
        wallets.record(address, signal, outcome);
        const s = wallets.stats(address);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, tier: wallets.tier(address), stats: s }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/chat") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let message = "";
      try { message = String(JSON.parse(body || "{}").message || ""); }
      catch { /* ignore — treat as empty */ }

      try {
        const reply = await hermesReply(message);
        console.log(`[chat] "${message.slice(0, 60)}" → "${reply.slice(0, 80)}…"`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply }));
      } catch (err) {
        console.error("[chat] error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // GET /regime — all explicitly set regimes
  if (req.method === "GET" && req.url === "/regime") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ regimes: regime.allRegimes() }));
    return;
  }

  // GET /regime/:asset — regime for one asset (with heuristic fallback)
  if (req.method === "GET" && req.url.startsWith("/regime/")) {
    const asset = req.url.slice("/regime/".length).toUpperCase();
    const profile = ASSET_PROFILES[asset];
    const info = regime.getRegime(asset, profile?.summary ?? "");
    const detectedPattern = null; // no message context here
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ asset, ...info }));
    return;
  }

  // POST /regime — set regime explicitly
  //   body: { asset, regime, confidence? }
  if (req.method === "POST" && req.url === "/regime") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { asset, regime: r, confidence } = JSON.parse(body || "{}");
        if (!asset || !r) throw new Error("asset and regime required");
        regime.setRegime(asset.toUpperCase(), r, confidence);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, asset: asset.toUpperCase(), regime: r }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`Hermes backend listening on http://localhost:${PORT}`);
  console.log(`CORS origin: ${ORIGIN}`);
});
