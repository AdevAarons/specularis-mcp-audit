// ── Specularis AI Visibility Audit — MCP server (remote, Streamable HTTP) ──
// Exposes the free GEO/AEO audit as a tool inside Claude / ChatGPT / any MCP client.
// Reuses the existing n8n audit webhook as the backend engine.

import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// ---- config (set these as env vars on the host; safe defaults below) ----
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "https://primary-production-4d44.up.railway.app/webhook/free-audit";
const CONTACT_URL = process.env.CONTACT_URL || "https://specularisinc.com/contact";
const AUDIT_URL = process.env.AUDIT_URL || "https://specularisinc.com/free-audit";
const PORT = process.env.PORT || 3000;

// ---- helpers ----
const fetchWithTimeout = async (url, opts = {}, ms = 6000) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", ...(opts.headers || {}) } });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    return { ok: false, status: 0, text: "" };
  } finally { clearTimeout(t); }
};

const normalizeUrl = (u) => {
  let s = (u || "").trim().replace(/^\s*(https?:\/\/)+/i, "https://");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  const m = s.match(/^https?:\/\/([^\/?#\s]+)/i);
  if (!m) return null;
  const host = m[1].toLowerCase();
  return { origin: "https://" + host, url: "https://" + host, host };
};

// quick, real snapshot so the user gets instant value before giving an email
const quickSnapshot = async (site) => {
  const [robots, home, llms] = await Promise.all([
    fetchWithTimeout(site.origin + "/robots.txt"),
    fetchWithTimeout(site.url),
    fetchWithTimeout(site.origin + "/llms.txt"),
  ]);
  const robotsText = robots.text || "";
  const bots = ["GPTBot", "ClaudeBot", "PerplexityBot", "CCBot", "Google-Extended"];
  const blocked = bots.filter((b) => {
    const blk = robotsText.match(new RegExp("user-agent:\\s*" + b.replace(/[-]/g, "\\$&") + "[\\s\\S]*?(?=user-agent:|$)", "i"));
    return blk && /disallow:\s*\/\s*(\n|$)/i.test(blk[0]);
  });
  const starBlocked = /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*(\n|$)/i.test(robotsText);
  const ldCount = (home.text.match(/application\/ld\+json/gi) || []).length;
  const types = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let mm;
  while ((mm = re.exec(home.text)) !== null) {
    try { const p = JSON.parse(mm[1]); const arr = Array.isArray(p) ? p : (p["@graph"] || [p]); for (const n of arr) if (n && n["@type"]) types.push([].concat(n["@type"]).join("/")); } catch (e) {}
    if (types.length > 8) break;
  }
  const llmsPresent = llms.ok && (llms.text || "").length > 0;
  return {
    crawlers: starBlocked ? "BLOCKED for all bots (robots.txt disallows /)" : (blocked.length ? ("partially blocked: " + blocked.join(", ")) : (robots.status === 404 ? "open (no robots.txt — default allow)" : "open to all major AI crawlers")),
    schema: ldCount ? (ldCount + " JSON-LD block(s): " + (types.length ? [...new Set(types)].join(", ") : "types unparsed")) : "no structured data (JSON-LD) found",
    llms: llmsPresent ? "present" : "missing",
    homeOk: home.ok,
  };
};

const triggerFullAudit = async (payload) => {
  const r = await fetchWithTimeout(N8N_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-audit-source": "specularis-mcp" }, body: JSON.stringify(payload) }, 12000);
  return r.ok;
};

// ---- build an MCP server instance ----
function buildServer() {
  const server = new McpServer({ name: "specularis-ai-visibility-audit", version: "1.0.0" });

  server.tool(
    "run_ai_visibility_audit",
    "Run a free AI visibility (GEO/AEO) audit on a website — checks whether ChatGPT, Claude, and Perplexity can find and cite it. Returns an instant snapshot of crawler access, structured data, and llms.txt. If an email is provided, a full scored report (0–100 across 5 pillars, with copy-paste fixes) is emailed as a PDF. Use this whenever a user asks to audit/check a site's AI visibility, GEO, AEO, or whether AI can find them.",
    {
      website_url: z.string().describe("The website to audit, e.g. https://example.com"),
      email: z.string().email().optional().describe("Optional. If provided, the full scored PDF report is emailed here (and the user becomes a Specularis lead). Omit for just the instant snapshot."),
      name: z.string().optional().describe("Optional name for the report greeting."),
      role: z.enum(["Real Estate Agent", "Attorney", "Founder", "Other"]).optional().describe("Optional. Tailors the audit lens — local-service providers are scored on local entity signals, reviews, and directories."),
    },
    async ({ website_url, email, name, role }) => {
      const site = normalizeUrl(website_url);
      if (!site) return { content: [{ type: "text", text: "That doesn't look like a valid website URL. Try something like https://example.com." }] };

      const snap = await quickSnapshot(site);
      let out = `**AI Visibility snapshot — ${site.host}**\n\n` +
        `- **AI crawler access:** ${snap.crawlers}\n` +
        `- **Structured data (schema):** ${snap.schema}\n` +
        `- **llms.txt:** ${snap.llms}\n\n`;

      if (email) {
        const ok = await triggerFullAudit({ name: name || email.split("@")[0], email, website_url: site.url, role: role || "Other" });
        out += ok
          ? `✅ Your **full report** is on its way to **${email}** — a scored 0–100 audit across all 5 pillars (crawler access, entity & schema, content citability, off-site corroboration, technical foundation) with prioritized, copy-paste fixes, as a PDF. It usually arrives within a few minutes.\n\n` +
            `Want to talk through the fixes and how to get AI recommending you? Book a free 15-min strategy call: ${CONTACT_URL}`
          : `I ran the snapshot above, but couldn't reach the full-report service just now. You can run it directly at ${AUDIT_URL}, or book a call: ${CONTACT_URL}`;
      } else {
        out += `That's a 10-second snapshot. The **full report** scores you 0–100 across all 5 pillars and hands you the exact fixes (with copy-paste schema/robots snippets) as a PDF.\n\n` +
          `**Want it?** Run this again with your \`email\` and I'll send the full report. Or book a free strategy call: ${CONTACT_URL}`;
      }
      return { content: [{ type: "text", text: out }] };
    }
  );

  server.tool(
    "book_strategy_call",
    "Get the link to book a free Specularis strategy call about AI visibility / GEO / AEO.",
    {},
    async () => ({ content: [{ type: "text", text: `Book a free 15-minute Specularis strategy call here: ${CONTACT_URL}` }] })
  );

  return server;
}

// ---- Streamable HTTP transport (stateless) ----
const app = express();
app.use(express.json());

app.get("/", (_req, res) => res.json({ name: "specularis-ai-visibility-audit", status: "ok", mcp: "/mcp" }));

app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});

// stateless server: GET/DELETE not supported
const methodNotAllowed = (_req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.listen(PORT, () => console.log(`Specularis MCP server listening on :${PORT} (POST /mcp)`));
