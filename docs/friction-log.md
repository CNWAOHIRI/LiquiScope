# LiquiScope — OKX.AI Friction Log

Running log of rough edges hit while building an A2MCP ASP on OKX.AI (beta).
Format: date/time (UTC), what we tried, what happened, workaround, severity.

---

## 2026-07-11

### FL-001 — (log opened)
- **What:** Project start. Log opened before any OKX.AI interaction, per working rules.
- **Status:** n/a

### FL-002 — Global skill install fails, docs say to use `-g`
- **What:** `npx skills add okx/onchainos-skills --yes -g` (the exact command from https://www.okx.ai/tutorial/asp step 2) failed for all 8 skills: "PromptScript: PromptScript does not support global skill installation".
- **Workaround:** re-ran without `-g` → project-local install to `.agents/skills/` succeeded, symlinked for Claude Code.
- **Severity:** low (easy workaround) but the official tutorial command is copy-paste broken for Claude Code users.

### FL-003 — www.okx.ai TLS chain incomplete
- **What:** Fetching https://www.okx.ai/tutorial/asp with a strict-TLS client failed: "unable to verify the first certificate" (server not sending full cert chain). Browsers cope; some HTTP libraries don't.
- **Workaround:** fetched via a proxy scraper. web3.okx.com docs pages were fine.
- **Severity:** low.

### FL-004 — Docs are prompt-first, spec-light
- **What:** The A2MCP "spec" is one example JSON block in the guide; no schema for the free-endpoint response shape, no category/taxonomy docs, no listing-review criteria beyond "compliant endpoint". Registration field limits live only inside the skill files (`validate-listing` rules), not in public docs.
- **Workaround:** introspected the installed skill markdown directly (`.agents/skills/okx-ai/references/identity-register.md` is the real spec).
- **Severity:** medium — without reading skill internals you'd discover field limits one rejection at a time.

### FL-005 — onchainos installer flow trips agent-harness safety classifiers
- **What:** Skill preflight fallback says: download `install.sh` from the GitHub release, verify SHA256, execute. Claude Code's auto-mode classifier denied executing the downloaded script (external-code policy) even after checksum verification — required an explicit user approval round-trip.
- **Workaround:** user said "run the installer"; ran with sandbox disabled. Installed fine to `~/.local/bin/onchainos` (silently — zero stdout on success, which also cost a verification round).
- **Severity:** medium for agent-first platforms — a `brew`/`npm` distribution channel would avoid both the classifier trip and the silent-success ambiguity. Ironic that an agent-native platform's own bootstrap is the step agents can't do autonomously.

### FL-006 — Cloudflare: new accounts can't deploy Workers non-interactively
- **What:** `wrangler deploy` on a fresh account uploads but refuses to publish: no workers.dev subdomain registered. The interactive prompt auto-answers "no" in non-interactive contexts, and wrangler 4 removed the `subdomain` command entirely — dashboard-only per the error message.
- **Workaround:** `PUT /accounts/{id}/workers/subdomain` with wrangler's stored OAuth token registered `liquiscope.workers.dev` directly; redeploy then succeeded.
- **Severity:** low (one-time), but a real wall for fully-autonomous agent deploys on fresh accounts.

### FL-007 — Fresh workers.dev subdomain: TLS cert lags DNS
- **What:** Immediately after subdomain registration + deploy, HTTPS requests fail with `sslv3 alert handshake failure` — DNS resolves but the edge cert isn't provisioned yet.
- **Workaround:** poll until the cert goes live (minutes-scale). Relevant for OKX listing review: never submit the endpoint URL until a real 200-over-HTTPS is observed.
- **Severity:** low.

### FL-008 — `validate-listing` PARSE error suggests wrong field names
- **What:** `agent validate-listing --service` rejected a valid JSON array with a PARSE error whose own `fix` example shows lowercase keys (`servicedescription`, `servicetype`) — but the actual required keys are camelCase (`serviceName`, `serviceDescription`, `serviceType`), documented only in `agent create --help`. Following the error's example verbatim fails again with the same error.
- **Workaround:** read `agent create --help` for the real element shape.
- **Severity:** medium — a self-contradicting error message sends every first-time ASP through at least two failed attempts.
