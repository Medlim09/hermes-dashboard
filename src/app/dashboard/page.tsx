"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getAlerts, getWallets, getScannerStatus, getScannerInsights,
  getFeedbackStats, getPerformance, getRegimes,
  type Alert, type WalletSummary, type ScannerStatus,
  type Insight, type FeedbackIntelligence, type Benchmark, type RegimeInfo,
} from "@/lib/api";

// ── Helpers ──────────────────────────────────────────────────────────── //

function pct(v: number | null | undefined, digits = 1) {
  if (v == null) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function confColor(c: number) {
  if (c >= 0.80) return "text-emerald-400";
  if (c >= 0.75) return "text-yellow-400";
  return "text-zinc-400";
}

function verdictColor(v: string) {
  if (v === "HALT")     return "text-red-400";
  if (v === "TIGHTEN")  return "text-orange-400";
  if (v === "FILTER")   return "text-yellow-400";
  if (v === "MAINTAIN") return "text-emerald-400";
  return "text-zinc-400";
}

function scoreBar(score: number) {
  const w = Math.round(score * 100);
  const color = score >= 0.7 ? "bg-emerald-500" : score >= 0.5 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
      </div>
      <span className="text-xs text-zinc-400 w-8 text-right">{score.toFixed(2)}</span>
    </div>
  );
}

function categoryDot(cat: string) {
  const colors: Record<string, string> = {
    wallet:   "bg-blue-400",
    pattern:  "bg-purple-400",
    trend:    "bg-yellow-400",
    feedback: "bg-orange-400",
  };
  return <span className={`inline-block w-1.5 h-1.5 rounded-full mt-0.5 shrink-0 ${colors[cat] ?? "bg-zinc-400"}`} />;
}

// ── Card wrapper ──────────────────────────────────────────────────────── //
function Card({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-widest text-zinc-400 uppercase">{title}</h2>
        {badge && <span className="text-xs text-zinc-500">{badge}</span>}
      </div>
      {children}
    </div>
  );
}

// ── Pulse dot ────────────────────────────────────────────────────────── //
function Live({ active }: { active: boolean }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${active ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"}`} />
  );
}

// ── Backend URL config ────────────────────────────────────────────────── //
function ApiConfig({ onSave }: { onSave: (url: string) => void }) {
  const [val, setVal] = useState(
    typeof window !== "undefined"
      ? localStorage.getItem("hermes_api_url") ?? ""
      : "",
  );
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); localStorage.setItem("hermes_api_url", val); onSave(val); }}
      className="flex gap-2"
    >
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="Backend URL (e.g. https://xxx.railway.app)"
        className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm
                   text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
      />
      <button
        type="submit"
        className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-sm text-zinc-200 transition-colors"
      >
        Connect
      </button>
    </form>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────── //
export default function Dashboard() {
  const [alerts,    setAlerts]    = useState<Awaited<ReturnType<typeof getAlerts>>   | null>(null);
  const [walletSum, setWalletSum] = useState<Awaited<ReturnType<typeof getWallets>>  | null>(null);
  const [scanner,   setScanner]   = useState<ScannerStatus | null>(null);
  const [insights,  setInsights]  = useState<Insight[]>([]);
  const [feedback,  setFeedback]  = useState<FeedbackIntelligence | null>(null);
  const [perf,      setPerf]      = useState<Benchmark | null>(null);
  const [regimes,   setRegimes]   = useState<RegimeInfo[]>([]);
  const [lastSync,  setLastSync]  = useState<Date | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [, forceRefresh] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [a, w, sc, si, fb, pf, rg] = await Promise.allSettled([
        getAlerts(),
        getWallets(),
        getScannerStatus(),
        getScannerInsights(10),
        getFeedbackStats(),
        getPerformance().then((r) => r.latest),
        getRegimes().then((r) => r.regimes),
      ]);

      if (a.status  === "fulfilled") setAlerts(a.value);
      if (w.status  === "fulfilled") setWalletSum(w.value);
      if (sc.status === "fulfilled") setScanner(sc.value);
      if (si.status === "fulfilled") setInsights(si.value);
      if (fb.status === "fulfilled") setFeedback(fb.value);
      if (pf.status === "fulfilled") setPerf(pf.value as Benchmark | null);
      if (rg.status === "fulfilled") setRegimes(rg.value);

      setLastSync(new Date());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">

      {/* Top bar */}
      <header className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur border-b border-zinc-800
                         px-4 sm:px-6 h-12 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-zinc-500 hover:text-zinc-300 text-xs">← Chat</Link>
          <span className="text-zinc-700">|</span>
          <div className="flex items-center gap-2">
            <Live active={scanner?.running ?? false} />
            <span className="text-sm font-semibold tracking-wide">HERMES</span>
            <span className="text-xs text-zinc-500 hidden sm:inline">Intelligence</span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          {error && <span className="text-red-400 font-medium">⚠ backend unreachable</span>}
          {!error && lastSync && <span className="text-emerald-500">● connected</span>}
          {lastSync && <span>synced {ago(lastSync.toISOString())}</span>}
          <button
            onClick={refresh}
            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
          >
            ↻
          </button>
        </div>
      </header>

      {/* Connection config — always visible so user can point to Railway backend */}
      <div className="px-4 sm:px-6 py-3 border-b border-zinc-800 bg-zinc-900/50">
        <ApiConfig onSave={() => { forceRefresh((n) => n + 1); }} />
        {error && (
          <p className="mt-2 text-xs text-red-400">
            Could not reach backend. Paste your Railway backend URL above and click Connect.
          </p>
        )}
      </div>

      <main className="flex-1 px-4 sm:px-6 py-6 grid gap-4
                       grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 auto-rows-min">

        {/* ── Alerts ─────────────────────────────────────────────────── */}
        <Card
          title="Today's Alerts"
          badge={alerts ? `${alerts.issued}/${alerts.cap} used` : undefined}
        >
          {alerts ? (
            <>
              <div className="flex gap-4 text-sm">
                <div>
                  <div className="text-zinc-500 text-xs">Issued</div>
                  <div className="font-mono font-semibold">{alerts.issued}</div>
                </div>
                <div>
                  <div className="text-zinc-500 text-xs">Remaining</div>
                  <div className="font-mono font-semibold">{alerts.remaining}</div>
                </div>
                <div>
                  <div className="text-zinc-500 text-xs">Threshold</div>
                  <div className="font-mono font-semibold">{pct(alerts.threshold)}</div>
                </div>
              </div>

              {alerts.alerts.length === 0 ? (
                <p className="text-xs text-zinc-600 italic">No alerts issued today — gates not met.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {alerts.alerts.map((a: Alert) => (
                    <div key={a.id} className="bg-zinc-800/60 rounded-lg p-3 flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{a.asset}</span>
                          <span className={`text-xs font-mono px-1.5 py-0.5 rounded
                            ${a.decision === "LONG" ? "bg-emerald-900/60 text-emerald-300" : "bg-red-900/60 text-red-300"}`}>
                            {a.decision}
                          </span>
                        </div>
                        <span className={`text-sm font-mono font-semibold ${confColor(a.confidence)}`}>
                          {pct(a.confidence)}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-400">Entry: {a.entry_zone} · Inv: {a.invalidation}</div>
                      <div className="text-xs text-zinc-500">{a.reason}</div>
                      <div className="text-xs text-zinc-600">{ago(a.issued_at)}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-zinc-600 animate-pulse">Loading…</p>
          )}
        </Card>

        {/* ── Scanner ────────────────────────────────────────────────── */}
        <Card
          title="Autonomous Scanner"
          badge={scanner ? `every ${scanner.interval_min}m` : undefined}
        >
          {scanner ? (
            <>
              <div className="flex gap-4 text-sm">
                <div>
                  <div className="text-zinc-500 text-xs">Status</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Live active={scanner.running} />
                    <span className="text-xs">{scanner.running ? "Running" : "Stopped"}</span>
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500 text-xs">Cycles</div>
                  <div className="font-mono font-semibold">{scanner.cycles}</div>
                </div>
                <div>
                  <div className="text-zinc-500 text-xs">Insights</div>
                  <div className="font-mono font-semibold">{scanner.insights_total}</div>
                </div>
                {scanner.next_run_in_s != null && (
                  <div>
                    <div className="text-zinc-500 text-xs">Next</div>
                    <div className="font-mono font-semibold">{scanner.next_run_in_s}s</div>
                  </div>
                )}
              </div>
              <div className="text-xs text-zinc-600">
                Last run: {ago(scanner.last_run)} · threshold {scanner.anomaly_threshold}
              </div>

              {insights.length === 0 ? (
                <p className="text-xs text-zinc-600 italic">No anomalies detected yet.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {insights.slice(0, 5).map((ins, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      {categoryDot(ins.category)}
                      <div className="flex-1 min-w-0">
                        <div className="text-zinc-300 leading-snug">{ins.description}</div>
                        <div className="text-zinc-600">{ago(ins.detected_at)} · score {ins.score.toFixed(2)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-zinc-600 animate-pulse">Loading…</p>
          )}
        </Card>

        {/* ── Wallets ────────────────────────────────────────────────── */}
        <Card
          title="Wallet Tracker"
          badge={walletSum ? `${walletSum.total_wallets} wallets` : undefined}
        >
          {walletSum ? (
            <>
              <div className="flex gap-4 text-sm">
                <div>
                  <div className="text-zinc-500 text-xs">Tier A</div>
                  <div className="font-mono font-semibold text-emerald-400">{walletSum.tier_a_count}</div>
                </div>
                <div>
                  <div className="text-zinc-500 text-xs">Eligible</div>
                  <div className="font-mono font-semibold">{walletSum.eligible_wallets}</div>
                </div>
                <div>
                  <div className="text-zinc-500 text-xs">Min obs</div>
                  <div className="font-mono font-semibold">{walletSum.min_observations}</div>
                </div>
              </div>

              {walletSum.top_wallets.length === 0 ? (
                <p className="text-xs text-zinc-600 italic">
                  No Tier A wallets yet — need ≥{walletSum.min_observations} signals each.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {walletSum.top_wallets.map((w: WalletSummary) => (
                    <div key={w.address} className="bg-zinc-800/60 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-mono text-zinc-400">
                          {w.address.slice(0, 6)}…{w.address.slice(-4)}
                        </span>
                        <span className="text-xs text-zinc-500">
                          wr {pct(w.win_rate)} · {w.total_signals} sig
                        </span>
                      </div>
                      {scoreBar(w.score)}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-zinc-600 animate-pulse">Loading…</p>
          )}
        </Card>

        {/* ── Feedback / Learning ────────────────────────────────────── */}
        <Card
          title="Learning Loop"
          badge={feedback ? `${feedback.resolved_signals} resolved` : undefined}
        >
          {feedback ? (
            <>
              <div className="flex gap-4 text-sm">
                <div>
                  <div className="text-zinc-500 text-xs">Win rate</div>
                  <div className="font-mono font-semibold">
                    {feedback.overall_win_rate != null ? pct(feedback.overall_win_rate) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500 text-xs">Pending</div>
                  <div className="font-mono font-semibold">{feedback.pending_signals}</div>
                </div>
                <div>
                  <div className="text-zinc-500 text-xs">EMA α</div>
                  <div className="font-mono font-semibold">{feedback.ema_alpha}</div>
                </div>
              </div>

              {/* Factor lift */}
              <div>
                <div className="text-xs text-zinc-500 mb-1.5">Factor lift</div>
                <div className="flex flex-col gap-1">
                  {Object.entries(feedback.factor_lift).map(([factor, v]) => (
                    <div key={factor} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">{factor.replace(/_/g, " ")}</span>
                      <span className="font-mono">
                        {v.ema_lift != null
                          ? <span className={v.ema_lift >= 0 ? "text-emerald-400" : "text-red-400"}>
                              {v.ema_lift >= 0 ? "+" : ""}{(v.ema_lift * 100).toFixed(1)}pp
                            </span>
                          : <span className="text-zinc-600">n={v.n} (building)</span>
                        }
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pattern stats — top 3 mature */}
              {feedback.pattern_stats.filter((p) => p.mature).length > 0 && (
                <div>
                  <div className="text-xs text-zinc-500 mb-1.5">Pattern accuracy</div>
                  <div className="flex flex-col gap-1">
                    {feedback.pattern_stats.filter((p) => p.mature).slice(0, 4).map((ps) => (
                      <div key={`${ps.pattern}/${ps.regime}`} className="flex items-center justify-between text-xs">
                        <span className="text-zinc-400">{ps.pattern}/{ps.regime.replace(/_/g, " ")}</span>
                        <span className={`font-mono ${
                          ps.ema_win_rate != null && ps.ema_win_rate >= 0.60 ? "text-emerald-400" :
                          ps.ema_win_rate != null && ps.ema_win_rate >= 0.45 ? "text-yellow-400" : "text-red-400"
                        }`}>
                          {pct(ps.ema_win_rate)} (n={ps.n})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-zinc-600 animate-pulse">Loading…</p>
          )}
        </Card>

        {/* ── Regimes ────────────────────────────────────────────────── */}
        <Card title="Regime State" badge={`${regimes.length} assets`}>
          {regimes.length === 0 ? (
            <p className="text-xs text-zinc-600 italic">
              No regimes set yet. Use POST /regime or ask Hermes about an asset.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {regimes.map((r) => {
                const color =
                  r.regime === "trending_up"   ? "text-emerald-400" :
                  r.regime === "trending_down" ? "text-red-400"     : "text-yellow-400";
                return (
                  <div key={r.asset} className="flex items-center justify-between text-xs">
                    <span className="font-mono font-semibold w-16">{r.asset}</span>
                    <span className={`${color} font-mono`}>{r.regime.replace(/_/g, " ")}</span>
                    <span className="text-zinc-600">
                      {pct(r.confidence)} · {r.source}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* ── Performance ────────────────────────────────────────────── */}
        <Card title="Performance Benchmark" badge={perf ? ago(perf.recorded_at) : undefined}>
          {perf ? (
            <>
              <div className="flex gap-4 text-sm">
                <div>
                  <div className="text-zinc-500 text-xs">Win rate</div>
                  <div className="font-mono font-semibold">{pct(perf.win_rate)}</div>
                </div>
                <div>
                  <div className="text-zinc-500 text-xs">False pos</div>
                  <div className="font-mono font-semibold">{pct(perf.false_positive_rate)}</div>
                </div>
                <div>
                  <div className="text-zinc-500 text-xs">Avg return</div>
                  <div className={`font-mono font-semibold ${perf.avg_return >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {pct(perf.avg_return)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Verdict</span>
                <span className={`text-sm font-semibold ${verdictColor(perf.analysis.verdict)}`}>
                  {perf.analysis.verdict}
                </span>
              </div>

              <div className="flex flex-col gap-1">
                {perf.analysis.findings.map((f, i) => (
                  <div key={i} className="text-xs text-zinc-500 leading-snug">
                    <span className="text-zinc-400 font-mono">{f.flag}</span>
                    {" — "}
                    {f.detail}
                  </div>
                ))}
              </div>

              {perf.analysis.actions.length > 0 && (
                <div className="text-xs text-zinc-500 border-t border-zinc-800 pt-2">
                  {perf.analysis.actions.map((a, i) => (
                    <div key={i} className="flex gap-1"><span className="text-zinc-600">→</span>{a}</div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-zinc-600 italic">
              No benchmark yet. POST /performance with win_rate, false_positive_rate, avg_return.
            </p>
          )}
        </Card>

      </main>

      <footer className="border-t border-zinc-800 px-6 py-3 text-xs text-zinc-700 flex justify-between">
        <span>Hermes · autonomous mode</span>
        <span>auto-refresh 30s</span>
      </footer>
    </div>
  );
}
