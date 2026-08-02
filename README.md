# Specularis AI Visibility Audit — MCP Server

Run a free AI visibility (GEO/AEO) audit on any website from inside Claude, ChatGPT, or any MCP client — checks whether ChatGPT, Claude & Perplexity can find and cite it, with an instant snapshot and an optional full scored PDF report.

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
| `run_ai_visibility_audit(website_url, email?, name?, role?)` | Instant in-chat snapshot: AI crawler access (GPTBot, ClaudeBot, PerplexityBot), schema markup, `llms.txt`, content signals. Include an email to receive the full scored audit — a 0–100 AI-visibility score across 5 pillars, delivered as a PDF report. |
| `book_strategy_call()` | Returns a link to book a strategy call with Specularis. |

## What the full audit measures

The full report scores 5 pillars (20 points each): AI crawler accessibility, structured data & entity clarity, content quality signals, off-site presence (the sources AI engines actually cite), and live AI-answer visibility — including real Perplexity queries to test whether AI recommends the business today.

Validated against 14 sites across 4 niches: businesses AI recommends average 64.5/100; businesses AI ignores average 44.7. Notably, 8 of 12 audited businesses were unknowingly blocking AI crawlers at the network level.

## Who's behind it

Built by [Specularis](https://specularisinc.com) — a GEO/AEO agency helping businesses get found and cited by AI engines. The audit is free; the report is the real deliverable.

- Free audit (web form): https://specularisinc.com/free-audit
- Contact: https://specularisinc.com/contact

## Self-hosting

The server is a single-file Node app (Streamable HTTP transport).

```bash
npm install
npm start
```

Environment variables:

| Variable | Purpose |
|----------|---------|
| `N8N_WEBHOOK_URL` | Backend audit engine endpoint (the hosted version uses Specularis's audit pipeline) |
| `CONTACT_URL` | Booking link returned by `book_strategy_call` |
| `AUDIT_URL` | Web-form fallback link included in responses |
| `PORT` | Listen port (default 3000) |

Point any MCP client at `http://localhost:3000/mcp`.

## License

MIT
