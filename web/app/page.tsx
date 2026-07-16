"use client";

import { useState } from "react";
import { isAddress } from "viem";
import { RiskBadge } from "./components/RiskBadge";
import { SummaryPanel } from "./components/SummaryPanel";
import { PositionCard } from "./components/PositionCard";
import { ReportSkeleton } from "./components/Skeleton";
import type { Report } from "@/lib/engine";

// Live Aave V3 Arbitrum addresses, screened from recent on-chain Borrow
// events on 2026-07-16 — real positions, tiers can drift as prices/debt move.
const EXAMPLES = [
  { label: "Critical example", address: "0x496b0Da20E553cC4B1879D54e57283b8C9fDfbB4" },
  { label: "Warning example", address: "0x25b1364B6DC48eAE81Fc601c77b29788cF8ab665" },
  { label: "Safe example", address: "0xDA0f0194fD03f0AdD719ad810b1D8b6ab26832b5" },
];

type MonitoredReport = Report & { monitored: boolean; lastMonitorCheck: number | null };

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "success"; report: MonitoredReport };

function timeAgo(ms: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return "just now";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

export default function Home() {
  const [address, setAddress] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function runAnalysis(rawAddress: string) {
    const trimmed = rawAddress.trim();
    if (!isAddress(trimmed, { strict: true })) {
      setInputError("That doesn't look like a checksummed EVM address (0x + 40 hex chars).");
      return;
    }
    setInputError(null);
    setStatus({ kind: "loading" });

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: trimmed }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus({ kind: "error", message: data.error ?? "Something went wrong. Please try again." });
        return;
      }
      setStatus({ kind: "success", report: data as MonitoredReport });
    } catch {
      setStatus({
        kind: "error",
        message: "Couldn't reach the scanner. Check your connection and try again.",
      });
    }
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-950">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:py-16">
        <header className="mb-10 text-center">
          <h1 className="text-3xl font-bold text-zinc-50 sm:text-4xl">LiquiScope</h1>
          <p className="mt-2 text-zinc-400">
            Live liquidation-risk reports for Aave V3 &amp; Compound V3 — Ethereum, Arbitrum, Base
          </p>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runAnalysis(address);
          }}
          className="mb-4 flex flex-col gap-3 sm:flex-row"
        >
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x… wallet address"
            spellCheck={false}
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={status.kind === "loading"}
            className="rounded-xl bg-violet-600 px-6 py-3 font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status.kind === "loading" ? "Scanning…" : "Analyze"}
          </button>
        </form>

        {inputError && <p className="mb-4 text-sm text-red-400">{inputError}</p>}

        <div className="mb-10 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.address}
              type="button"
              onClick={() => {
                setAddress(ex.address);
                void runAnalysis(ex.address);
              }}
              className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-violet-500 hover:text-violet-300"
            >
              {ex.label}
            </button>
          ))}
        </div>

        {status.kind === "loading" && <ReportSkeleton />}

        {status.kind === "error" && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
            <p className="text-red-300">{status.message}</p>
          </div>
        )}

        {status.kind === "success" && (
          <div className="space-y-6">
            <div className="flex flex-col items-center gap-2">
              <RiskBadge tier={status.report.overallRiskTier} />
              {status.report.monitored && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs text-sky-300">
                  👁 Monitored
                  {status.report.lastMonitorCheck && (
                    <span className="text-sky-400/70">
                      · last checked {timeAgo(status.report.lastMonitorCheck)}
                    </span>
                  )}
                </span>
              )}
            </div>

            <SummaryPanel summary={status.report.summary} summarySource={status.report.summarySource} />

            {status.report.positions.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {status.report.positions.map((p, i) => (
                  <PositionCard key={`${p.protocol}-${p.chain}-${i}`} position={p} />
                ))}
              </div>
            )}

            <p className="text-center text-xs text-zinc-600">
              Scanned in {(status.report.scan.durationMs / 1000).toFixed(1)}s ·{" "}
              {status.report.scan.chains.filter((c) => c.status === "error").length > 0
                ? `${status.report.scan.chains.filter((c) => c.status === "error").length} chain read(s) failed and were skipped`
                : "all chain reads succeeded"}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
