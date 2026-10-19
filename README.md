# Specularis AI Visibility Audit — MCP Server

Run a free AI visibility (GEO/AEO) audit on any website from inside Claude, ChatGPT, or any MCP client — check whether ChatGPT, Claude, Perplexity and Gemini can reach, read and cite it, and find the sources they cite instead.

**Hosted endpoint (Streamable HTTP):**

```
https://specularis-mcp-audit-production.up.railway.app/mcp
```

No installation needed — it's a remote MCP server. Add the URL above and you're done.

## Connect it

**Claude (claude.ai or Claude Desktop):** Settings → Connectors → Add custom connector → paste the URL above.

**Claude Code:**

```bash
claude mcp add --transport http specularis-audit https://specularis-mcp-audit-production.up.railway.app/mcp
```

Then in any chat: *"Audit example.com for AI visibility"* — the tool runs.

## Tools

| Tool | What it does |
|------|--------------|
| `run_ai_visibility_audit(website_url, email?, name?, role?)` | Instant in-chat snapshot: AI crawler access (GPTBot, ClaudeBot, PerplexityBot, CCBot, Google-Extended), JSON-LD structured data, and `llms.txt`. Include an email to also receive the full scored report — 0–100 across six pillars — as a PDF. `role` accepts `Real Estate Agent`, `Attorney`, `Founder` or `Other` and tilts the scoring toward local entity signals, reviews and directories. |
| `find_ai_citations(query, domain)` | Given a buyer question (*"best personal injury lawyer in Miami"*) and a domain, returns the sources AI engines actually cite when answering it, tagged by engine, plus an `appears in X of N` count for the domain. The ranked source list is the off-site target list. |
| `book_strategy_call()` | Returns a link to book a strategy call with Specularis. |

Passing `email` to `run_ai_visibility_audit` sends a report and registers the person as a Specularis lead. Omit it for the snapshot alone.

## Without an MCP client

The same scan engine is reachable over plain HTTP, with no key and no connector:

```bash
curl -s "https://specularis-mcp-audit-production.up.railway.app/api/scan?d=example.com"
```

Pass a bare hostname — no scheme, no path. It returns the full structured scan: per-bot fetch results, browser-vs-bot word counts for render-gap detection, parsed schema types, `llms.txt`, sitemap, and the six pillar scores. Useful for scanning domains in bulk.

If `inconclusive` is `true`, the scan could not complete — read `inconclusiveReason` and don't report a score.

## What the full audit measures

Each bot is fetched with its real published user agent, so the result is what the engine itself would receive — not what a browser sees.

The report scores six pillars out of 100:

| Pillar | Max | What it covers |
|---|---|---|
| `access` | 20 | Whether GPTBot, ClaudeBot and PerplexityBot can actually reach and receive the page |
| `entity` | 15 | Organization / Person / LocalBusiness schema, `sameAs`, address |
| `content` | 15 | Whether the text answers the questions buyers actually ask |
| `offsite` | 30 | The directories, review platforms and threads AI engines cite |
| `freshness` | 10 | Whether the content is maintained |
| `technical` | 10 | Sitemap, `llms.txt`, render gaps, crawlability |

`offsite` is deliberately the largest pillar — more than `access` and `entity` combined. That reflects how the engines behave: they cite third-party corroboration far more often than a company's own marketing pages, so a technically flawless site can still be invisible.

**A note on measuring "blocked".** A real block is a 403, or a genuine interstitial with under 80 words of page text. Bot-protection layers return challenge pages intermittently, and counting those as blocks inflates the result — we published numbers once that were wrong for exactly this reason, and corrected them. Re-run before reporting a block.

Across 561 US businesses scanned in 2026, roughly half were effectively invisible to AI engines.

## Use it as an agent skill

[`SKILL.md`](SKILL.md) packages this as a portable agent skill in the open `SKILL.md` format — when to run an audit, how to read every field it returns, and the order to apply the fixes in. It works against either the MCP tools or the HTTP endpoint above.

## Self-hosting

The server is a single-file Node app (Streamable HTTP transport).

```bash
npm install
npm start
```

Point any MCP client at `http://localhost:3000/mcp`.

| Variable | Purpose |
|----------|---------|
| `N8N_WEBHOOK_URL` | Backend audit engine endpoint for the full PDF report |
| `CONTACT_URL` | Booking link returned by `book_strategy_call` |
| `AUDIT_URL` | Web-form fallback link included in responses |
| `PORT` | Listen port (default 3000) |
| `PERPLEXITY_API_KEY` | Primary engine for `find_ai_citations` |
| `ANTHROPIC_API_KEY` | Adds Claude as a second engine |
| `GEMINI_API_KEY` | Adds Gemini as a third engine |
| `OPENAI_API_KEY` | Adds ChatGPT as a fourth engine |
| `OPENAI_MODEL` | Model for the ChatGPT engine (default `gpt-5-mini`) |
| `FINDER_DAY_MAX` | Global daily cap on citation-finder runs (default 250) |

`find_ai_citations` needs at least one engine key. The `engines` array in each response reports which ones actually ran, so only claim the engines it names.

## Who's behind it

Built by [Specularis](https://specularisinc.com) — a GEO/AEO agency helping businesses get found and cited by AI engines. The audit is free; the report is the real deliverable.

- Free audit (web form): https://specularisinc.com/free-audit
- Contact: https://specularisinc.com/contact

## License

MIT
