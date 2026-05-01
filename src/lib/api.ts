const BASE = () =>
  (typeof window !== "undefined"
    ? (localStorage.getItem("hermes_api_url") ?? "")
    : "") ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3001";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json();
}

// ── Chat ──────────────────────────────────────────────────────────────── //
export const sendMessage = (message: string) =>
  post<{ reply: string }>("/chat", { message });

// ── Health ────────────────────────────────────────────────────────────── //
export const getHealth = () => get<Record<string, unknown>>("/health");

// ── Alerts ────────────────────────────────────────────────────────────── //
export const getAlerts = () =>
  get<{
    date: string;
    issued: number;
    remaining: number;
    cap: number;
    threshold: number;
    alerts: Alert[];
  }>("/alerts");

export const evaluateAlert = (candidate: Record<string, unknown>) =>
  post<{ issued: boolean; alert?: Alert; reason?: string }>(
    "/alerts/evaluate",
    candidate,
  );

// ── Wallets ───────────────────────────────────────────────────────────── //
export const getWallets = () =>
  get<{
    total_wallets: number;
    eligible_wallets: number;
    tier_a_count: number;
    min_observations: number;
    top_wallets: WalletSummary[];
  }>("/wallets");

export const getWallet = (address: string) =>
  get<WalletStats>(`/wallets/${address}`);

export const recordWallet = (
  address: string,
  signal: Record<string, unknown>,
  outcome: Record<string, unknown>,
) => post<{ ok: boolean; tier: string; stats: WalletStats }>("/wallets/record", { address, signal, outcome });

// ── Regime ────────────────────────────────────────────────────────────── //
export const getRegimes = () =>
  get<{ regimes: RegimeInfo[] }>("/regime");

export const setRegime = (asset: string, regime: string, confidence?: number) =>
  post<{ ok: boolean }>("/regime", { asset, regime, confidence });

// ── Scanner ───────────────────────────────────────────────────────────── //
export const getScannerStatus = () =>
  get<ScannerStatus>("/scanner/status");

export const getScannerInsights = (limit = 50) =>
  get<Insight[]>(`/scanner/insights?limit=${limit}`);

// ── Feedback ──────────────────────────────────────────────────────────── //
export const getFeedbackStats = () =>
  get<FeedbackIntelligence>("/feedback/stats");

export const getFeedbackPending = () =>
  get<Signal[]>("/feedback/pending");

export const getFeedbackReflections = (limit = 20) =>
  get<Reflection[]>(`/feedback/reflections?limit=${limit}`);

export const resolveSignal = (id: string, outcome: Record<string, unknown>) =>
  post<{ signal: Signal; compared: unknown; learned: unknown; reflection: Reflection }>(
    `/feedback/${encodeURIComponent(id)}`,
    outcome,
  );

// ── Performance ───────────────────────────────────────────────────────── //
export const getPerformance = () =>
  get<{ total: number; latest: Benchmark | null; history: Benchmark[] }>("/performance");

export const submitPerformance = (snap: {
  win_rate: number;
  false_positive_rate: number;
  avg_return: number;
  n?: number;
  period?: string;
  source?: string;
}) => post<Benchmark>("/performance", snap);

// ── Types ─────────────────────────────────────────────────────────────── //
export interface Alert {
  id: string;
  asset: string;
  decision: string;
  confidence: number;
  entry_zone: string;
  invalidation: string;
  targets: string[];
  pattern: string;
  regime: string;
  reason: string;
  issued_at: string;
  message: string;
}

export interface WalletSummary {
  address: string;
  score: number;
  win_rate: number;
  avg_return_7d: number;
  total_signals: number;
}

export interface WalletStats extends WalletSummary {
  tier: string;
  ema_win_rate: number | null;
  avg_return_24h: number;
  ema_return_7d: number | null;
  avg_max_adverse: number;
  best_regime: string | null;
  worst_regime: string | null;
  regime_perf: Record<string, { avg_return: number; n: number }>;
  last_signal: string | null;
}

export interface RegimeInfo {
  asset: string;
  regime: string;
  confidence: number;
  source: string;
  updated_at?: string;
}

export interface ScannerStatus {
  running: boolean;
  cycles: number;
  last_run: string | null;
  next_run_in_s: number | null;
  interval_min: number;
  insights_total: number;
  anomaly_threshold: number;
  conf_threshold: number;
  dedup_window_h: number;
}

export interface Insight {
  type: string;
  category: string;
  score: number;
  description: string;
  detected_at: string;
  logged_at: string;
  address?: string;
  asset?: string;
  pattern?: string;
  regime?: string;
  context?: Record<string, unknown>;
}

export interface FeedbackIntelligence {
  resolved_signals: number;
  pending_signals: number;
  overall_win_rate: number | null;
  factor_lift: Record<string, { ema_lift: number | null; n: number }>;
  regime_accuracy: Record<string, { ema_accuracy: number | null; n: number }>;
  calibration: Record<string, { predicted_avg: number; actual_win_rate: number | null; n: number }>;
  pattern_stats: PatternStat[];
  min_sample: number;
  ema_alpha: number;
}

export interface PatternStat {
  pattern: string;
  regime: string;
  n: number;
  ema_win_rate: number | null;
  ema_return_7d: number | null;
  mature: boolean;
}

export interface Signal {
  id: string;
  asset: string;
  decision: string;
  confidence: number;
  pattern: string;
  regime: string;
  issued_at: string;
  outcome: null | {
    win: boolean | null;
    return_7d: number | null;
    resolved_at: string;
  };
}

export interface Reflection {
  signal_id: string;
  asset: string;
  issued_at: string;
  resolved_at: string;
  prediction: { decision: string; confidence: number; pattern: string; regime: string };
  outcome: { win: boolean | null; return_24h: number | null; return_7d: number | null };
  analysis: {
    regime_correct: boolean | null;
    pattern_valid: boolean | null;
    confidence_error: number | null;
    key_win_factor: string | null;
    key_miss_factor: string | null;
  };
}

export interface Benchmark {
  win_rate: number;
  false_positive_rate: number;
  avg_return: number;
  n?: number;
  period?: string;
  source?: string;
  recorded_at: string;
  analysis: {
    verdict: string;
    findings: { flag: string; detail: string }[];
    actions: string[];
    sample_note: string;
  };
}
