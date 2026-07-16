import type { Position } from "@/lib/engine";

const TIER_COLOR: Record<Position["tier"], string> = {
  safe: "text-emerald-400",
  watch: "text-yellow-400",
  danger: "text-amber-400",
  critical: "text-red-400",
  liquidatable: "text-red-300",
};

const TIER_RING: Record<Position["tier"], string> = {
  safe: "border-emerald-500/30",
  watch: "border-yellow-500/30",
  danger: "border-amber-500/40",
  critical: "border-red-500/40",
  liquidatable: "border-red-600/60",
};

function fmtUsd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function PositionCard({ position }: { position: Position }) {
  const { protocol, chain, market, healthFactor, tier, totalCollateralUsd, totalDebtUsd, dominantCollateral } =
    position;
  const max = Math.max(totalCollateralUsd, totalDebtUsd, 1);
  const collateralPct = Math.min(100, (totalCollateralUsd / max) * 100);
  const debtPct = Math.min(100, (totalDebtUsd / max) * 100);
  const dropPct = dominantCollateral.dropToLiquidation * 100;

  return (
    <article className={`rounded-2xl border bg-zinc-900/40 p-6 ${TIER_RING[tier]}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-200">
            {protocol.startsWith("Aave") ? "AV3" : "CV3"}
          </span>
          <div>
            <div className="font-semibold text-zinc-100">
              {protocol}
              {market ? ` — ${market}` : ""}
            </div>
            <div className="text-xs text-zinc-400">{chain}</div>
          </div>
        </div>
        <div className={`text-right ${TIER_COLOR[tier]}`}>
          <div className="text-xs uppercase tracking-wide opacity-80">Health Factor</div>
          <div className="text-2xl font-bold tabular-nums">{healthFactor.toFixed(3)}</div>
        </div>
      </div>

      <div className="mb-5 space-y-1.5">
        <div className="flex justify-between text-xs text-zinc-400">
          <span>Collateral {fmtUsd(totalCollateralUsd)}</span>
          <span>Debt {fmtUsd(totalDebtUsd)}</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full bg-sky-500" style={{ width: `${collateralPct}%` }} />
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full bg-red-500" style={{ width: `${debtPct}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-zinc-800 pt-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            {dominantCollateral.symbol} liquidation price
          </div>
          <div className="mt-0.5 text-sm text-zinc-300">
            {fmtUsd(dominantCollateral.liquidationPriceUsd)}{" "}
            <span className="text-zinc-500">
              (now {fmtUsd(dominantCollateral.currentPriceUsd)})
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Drop to liquidation</div>
          <div className={`text-3xl font-extrabold tabular-nums ${TIER_COLOR[tier]}`}>
            {dropPct.toFixed(1)}%
          </div>
        </div>
      </div>
    </article>
  );
}
