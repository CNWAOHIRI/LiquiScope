import type { RiskTier } from "@/lib/engine";

const STYLES: Record<RiskTier | "none", { label: string; classes: string }> = {
  safe: { label: "SAFE", classes: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/40" },
  watch: { label: "WATCH", classes: "bg-yellow-500/15 text-yellow-400 ring-yellow-500/40" },
  danger: { label: "DANGER", classes: "bg-amber-500/15 text-amber-400 ring-amber-500/40" },
  critical: { label: "CRITICAL", classes: "bg-red-500/15 text-red-400 ring-red-500/40" },
  liquidatable: { label: "LIQUIDATABLE", classes: "bg-red-600/25 text-red-300 ring-red-600/60" },
  none: { label: "NO POSITIONS", classes: "bg-zinc-500/15 text-zinc-400 ring-zinc-500/40" },
};

export function RiskBadge({ tier }: { tier: RiskTier | "none" }) {
  const s = STYLES[tier];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-2xl font-bold tracking-wide ring-2 ${s.classes}`}
    >
      {s.label}
    </span>
  );
}
