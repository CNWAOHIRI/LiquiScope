// LiquiScope landing page — plain JS, no build step, no framework.
// Talks directly to the public Worker endpoints (CORS-allowlisted for this
// page's origin — see src/index.ts's CORS_ALLOWED_ORIGINS).

const API_BASE = "https://liquiscope.liquiscope.workers.dev";

// --- OKX ASP listing link -------------------------------------------------
// TODO(user): no public marketplace URL for Agent #5074 is confirmed yet —
// placeholder only. Replace OKX_LISTING_URL once the real listing link
// exists (do not guess it).
const OKX_LISTING_URL = null;

function tierClass(tier) {
  if (!tier) return "tier-none";
  return `tier-${tier}`;
}

function fmtUsd(n) {
  if (n === null || n === undefined) return "—";
  return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// --- Wallet check (item 1) ------------------------------------------------
const form = document.getElementById("check-form");
const addressInput = document.getElementById("address-input");
const chainSelect = document.getElementById("chain-select");
const resultEl = document.getElementById("result");
const submitBtn = document.getElementById("submit-btn");

function renderLoading() {
  resultEl.innerHTML = `<div class="empty-box"><span class="spinner"></span>Checking on-chain positions…</div>`;
}

function renderError(message) {
  resultEl.innerHTML = `<div class="error-box">${escapeHtml(message)}</div>`;
}

function renderResult(data) {
  const positions = data.positions || [];
  const okxCta = OKX_LISTING_URL
    ? `<a href="${OKX_LISTING_URL}" target="_blank" rel="noopener">Want the full report + alerts? →</a>`
    : `<span style="color:var(--text-dim)">Want the full report + alerts? POST /report ($0.15) &middot; POST /watch ($0.02/day)</span>`;

  if (positions.length === 0) {
    resultEl.innerHTML = `
      <div class="stat-row"><span class="label">Risk tier</span><span class="tier-badge ${tierClass(data.riskTier)}">${data.riskTier || "none"}</span></div>
      <div class="empty-box">${escapeHtml(data.note || "No lending positions found on this chain.")}</div>
      <div class="cta">${okxCta}</div>
    `;
    return;
  }

  const rows = positions
    .map((p) => {
      const hf = p.healthFactor === null ? "∞" : Number(p.healthFactor).toFixed(3);
      return `<div class="position-row">
        <span>${escapeHtml(p.protocol)} · ${escapeHtml(p.market)}</span>
        <span class="tier-badge ${tierClass(p.tier)}">${p.tier}</span>
        <span>HF ${hf}</span>
      </div>`;
    })
    .join("");

  resultEl.innerHTML = `
    <div class="stat-row"><span class="label">Overall risk</span><span class="tier-badge ${tierClass(data.riskTier)}">${data.riskTier}</span></div>
    <div class="stat-row"><span class="label">Chain</span><span>${escapeHtml(data.chain)}</span></div>
    <div class="positions-list">${rows}</div>
    <div class="cta">${okxCta}</div>
  `;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = String(s ?? "");
  return div.innerHTML;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const address = addressInput.value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    renderError("That doesn't look like a valid EVM address — expected 0x followed by 40 hex characters.");
    return;
  }

  submitBtn.disabled = true;
  renderLoading();

  try {
    const res = await fetch(`${API_BASE}/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, chain: chainSelect.value }),
    });
    const data = await res.json().catch(() => null);

    if (!data) {
      renderError("Got an unreadable response from the API — please try again in a moment.");
    } else if (!res.ok) {
      renderError(data.error || `Request failed (HTTP ${res.status}).`);
    } else {
      renderResult(data);
    }
  } catch (err) {
    renderError("Couldn't reach the API — check your connection and try again. (RPC/network hiccups happen; this is read-only, nothing to worry about.)");
  } finally {
    submitBtn.disabled = false;
  }
});

// --- Agents Calling Now counter (item 2) ----------------------------------
// Cumulative-since-launch framing, not a live tick: at low real traffic
// volumes a live counter reads as embarrassing ("3 calls today") rather
// than informative. A cumulative total plus a clear "since <date>" anchor
// is honest either way and doesn't need to be reframed as the number grows.
const statsBig = document.getElementById("stats-big");
const statsSub = document.getElementById("stats-sub");

async function pollStats() {
  try {
    const res = await fetch(`${API_BASE}/stats`);
    const data = await res.json();
    statsBig.textContent = data.total_calls.toLocaleString();
    const since = new Date(data.since).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    statsSub.textContent = `calls since ${since} · ${data.external_calls} external, ${data.self_calls} self-test, ${data.unclassified_calls} unclassified`;
  } catch {
    statsBig.textContent = "—";
    statsSub.textContent = "stats temporarily unavailable";
  }
}
pollStats();
setInterval(pollStats, 60_000);

// --- Public status (item 6) -------------------------------------------------
// Deliberately not a new UptimeRobot account or new Worker infrastructure:
// this pings the same GET /health endpoint the Worker already serves, live,
// on page load — a direct real-time proof the API judges would call is up
// right now, rather than a cached "last cron result" number.
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");

async function pollHealth() {
  try {
    const t0 = performance.now();
    const res = await fetch(`${API_BASE}/health`);
    const ms = Math.round(performance.now() - t0);
    if (res.ok) {
      statusDot.className = "status-dot status-online";
      statusText.textContent = `API online (${ms}ms)`;
    } else {
      statusDot.className = "status-dot status-offline";
      statusText.textContent = `API returned HTTP ${res.status}`;
    }
  } catch {
    statusDot.className = "status-dot status-offline";
    statusText.textContent = "API unreachable";
  }
}
pollHealth();
setInterval(pollHealth, 60_000);
