export function SummaryPanel({
  summary,
  summarySource,
}: {
  summary: string;
  summarySource: "ai" | "template";
}) {
  return (
    <section className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 via-transparent to-transparent p-6 sm:p-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-violet-300">
          Risk Summary &amp; Action Plan
        </h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            summarySource === "ai"
              ? "bg-violet-500/20 text-violet-300"
              : "bg-zinc-600/20 text-zinc-400"
          }`}
        >
          {summarySource === "ai" ? "AI-generated" : "template"}
        </span>
      </div>
      <p className="whitespace-pre-line text-lg leading-relaxed text-zinc-100">{summary}</p>
    </section>
  );
}
