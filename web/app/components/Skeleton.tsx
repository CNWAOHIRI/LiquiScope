const CHAINS = ["Ethereum", "Arbitrum", "Base"];
const PROTOCOLS = ["Aave V3", "Compound V3"];

function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-zinc-800 ${className}`} />;
}

export function ReportSkeleton() {
  return (
    <div className="space-y-6" aria-live="polite" aria-busy="true">
      <div className="flex justify-center">
        <Bar className="h-12 w-40" />
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 sm:p-8">
        <Bar className="mb-3 h-4 w-48" />
        <Bar className="mb-2 h-4 w-full" />
        <Bar className="mb-2 h-4 w-5/6" />
        <Bar className="h-4 w-2/3" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
            <div className="mb-4 flex items-center justify-between">
              <Bar className="h-8 w-24" />
              <Bar className="h-8 w-16" />
            </div>
            <Bar className="mb-2 h-2.5 w-full" />
            <Bar className="mb-4 h-2.5 w-full" />
            <div className="flex justify-between">
              <Bar className="h-8 w-24" />
              <Bar className="h-8 w-16" />
            </div>
          </div>
        ))}
      </div>

      <p className="text-center text-sm text-zinc-500">
        Scanning {CHAINS.join(", ")} across {PROTOCOLS.join(" and ")}
        &nbsp;— live on-chain reads, this can take a few seconds…
      </p>
    </div>
  );
}
