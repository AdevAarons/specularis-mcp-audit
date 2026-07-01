# Specularis AI Visibility Audit — MCP Server

Puts the free GEO/AEO audit inside Claude / ChatGPT / any MCP client. It reuses your existing n8n audit webhook as the engine.

**Tools exposed**
- `run_ai_visibility_audit(website_url, email?, name?, role?)` — instant free snapshot (crawler access, schema, llms.txt); with an email, triggers the full n8n audit → emails the PDF + logs the lead in Notion.
- `book_strategy_call()` — returns the /contact booking link.

The funnel: instant value in-chat → email captures the lead + sends the full report → CTA to book a call.

---

## Deploy on Railway (same account as n8n)

1. Push this `mcp-server/` folder to a GitHub repo (or use Railway's "Deploy from local").
2. Railway → **New → Deploy from GitHub repo** → pick this folder/repo.
3. Railway auto-detects Node and runs `npm start`.
4. Set env vars on the service (Variables tab):
   - `N8N_WEBHOOK_URL` = `https://primary-production-4d44.up.railway.app/webhook/free-audit` (your production webhook)
   - `CONTACT_URL` = `https://specularisinc.com/contact`
   - `AUDIT_URL` = `https://specularisinc.com/free-audit`
5. **Settings → Networking → Generate Domain.** Your MCP endpoint is: `https://<that-domain>/mcp`

Test it's alive: open `https://<domain>/` in a browser → should return `{"name":"specularis-ai-visibility-audit","status":"ok","mcp":"/mcp"}`.

---

## Connect it in Claude

**Claude Desktop / claude.ai → Settings → Connectors → Add custom connector:**
- URL: `https://<your-domain>/mcp`

Then in a chat: *"Audit specularisinc.com for AI visibility"* → the tool runs.

---

## List it in MCP directories (distribution)
- https://mcp.so (submit)
- https://smithery.ai
- https://glama.ai/mcp/servers
Use the same listing copy as `offsite-launch-pack.md`.

---

## Run locally (test before deploy)
```
cd mcp-server
npm install
N8N_WEBHOOK_URL="https://primary-production-4d44.up.railway.app/webhook/free-audit" npm start
```
Then point any MCP client at `http://localhost:3000/mcp`.
