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
