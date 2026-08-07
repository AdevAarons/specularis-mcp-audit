// ── Specularis AI Visibility Audit — MCP server (remote, Streamable HTTP) ──
// Exposes the free GEO/AEO audit as a tool inside Claude / ChatGPT / any MCP client.
// Reuses the existing n8n audit webhook as the backend engine.

import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// SDK 1.30 relies on the Web Crypto global (crypto.randomUUID); Node 18 on Railway
// doesn't expose it globally. Set it before any request is handled.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const __dirname = dirname(fileURLToPath(import.meta.url));
// Static marketing asset: the public sample audit report, served for iframe embedding
// on the Specularis site (Framer's HTML embed can't sandbox a full document).
let SAMPLE_REPORT_HTML = "";
try { SAMPLE_REPORT_HTML = readFileSync(join(__dirname, "public", "sample-report.html"), "utf8"); } catch (e) {}
let HERO_PREVIEW_HTML = "";
try { HERO_PREVIEW_HTML = readFileSync(join(__dirname, "public", "hero-preview.html"), "utf8"); } catch (e) {}
let TAMPA_ARTICLE_HTML = "";
try { TAMPA_ARTICLE_HTML = readFileSync(join(__dirname, "public", "tampa-article.html"), "utf8"); } catch (e) {}
let MINERAL_ARTICLE_HTML = "";
try { MINERAL_ARTICLE_HTML = readFileSync(join(__dirname, "public", "mineral-article.html"), "utf8"); } catch (e) {}
let CITATION_FINDER_HTML = "";
try { CITATION_FINDER_HTML = readFileSync(join(__dirname, "public", "citation-finder-demo.html"), "utf8"); } catch (e) {}
let ADDONS_SWITCHER_HTML = "";
try { ADDONS_SWITCHER_HTML = readFileSync(join(__dirname, "public", "addons-switcher.html"), "utf8"); } catch (e) {}
let STATS_BAR_HTML = "";
try { STATS_BAR_HTML = readFileSync(join(__dirname, "public", "stats-bar.html"), "utf8"); } catch (e) {}
// Brand assets (served for schema logo/image + og); binary buffers loaded once
let LOGO_PNG = null, HEADSHOT_PNG = null;
try { LOGO_PNG = readFileSync(join(__dirname, "public", "assets", "specularis-logo.png")); } catch (e) {}
try { HEADSHOT_PNG = readFileSync(join(__dirname, "public", "assets", "adev-headshot.png")); } catch (e) {}

// ---- config (set these as env vars on the host; safe defaults below) ----
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "https://primary-production-4d44.up.railway.app/webhook/free-audit";
const CONTACT_URL = process.env.CONTACT_URL || "https://specularisinc.com/contact";
const AUDIT_URL = process.env.AUDIT_URL || "https://specularisinc.com/free-audit";
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || ""; // set in Railway Variables
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

// ---- AI Citation Source Finder helpers ----
const classifySource = (url) => {
  const h = (String(url).match(/^https?:\/\/([^\/]+)/i)?.[1] || "").toLowerCase().replace(/^www\./, "");
  if (/reddit\.com/.test(h)) return "Reddit thread";
  if (/youtube\.com|youtu\.be/.test(h)) return "YouTube video";
  if (/quora\.com/.test(h)) return "Q&A platform (Quora)";
  if (/(wikipedia|wikidata)\.org/.test(h)) return "Knowledge base";
  if (/(yelp|expertise|fastexpert|homelight|effectiveagents|thumbtack|angi|clutch|g2|capterra|trustpilot|bbb|zillow|realtor|avvo|justia|findlaw|nolo|houzz|tripadvisor|glassdoor)\./.test(h)) return "Directory / review platform";
  if (/(medium|substack|linkedin|forbes|inc|entrepreneur)\.com/.test(h)) return "Publishing / press platform";
  return "Website / blog";
};

const callPerplexity = async (query) => {
  if (!PERPLEXITY_API_KEY) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST", signal: ctrl.signal,
      headers: { "Authorization": "Bearer " + PERPLEXITY_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: query }] }),
    });
    if (!r.ok) return { error: "perplexity " + r.status };
    return await r.json();
  } catch (e) { return { error: "perplexity fetch failed" }; }
  finally { clearTimeout(t); }
};

// server identity (surfaced in the MCP handshake + directory listings)
const SERVER_INFO = {
  name: "specularis-ai-visibility-audit",
  title: "Specularis AI Visibility Audit",
  version: "1.0.1",
  websiteUrl: "https://specularisinc.com/free-audit",
  icons: [
    { src: "https://framerusercontent.com/images/LXIyg0KiJbKOgwh3fUcQRcHXg.png", mimeType: "image/png", theme: "light" },
    { src: "https://framerusercontent.com/images/0m77vnbFvbPOhmqCzxed7R4dugk.png", mimeType: "image/png", theme: "dark" },
  ],
};

const SERVER_INSTRUCTIONS =
  "Specularis runs free AI visibility (GEO/AEO) audits. Call run_ai_visibility_audit with a website_url to get an " +
  "instant snapshot of whether ChatGPT, Claude, and Perplexity can find and cite a site (AI crawler access, structured " +
  "data, llms.txt). Pass an email to also trigger the full scored 0–100 PDF report across all 5 pillars. Use " +
  "book_strategy_call to share the Specularis booking link.";

// ---- build an MCP server instance ----
function buildServer() {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool(
    "run_ai_visibility_audit",
    {
      title: "Run AI Visibility Audit",
      description:
        "Run a free AI visibility (GEO/AEO) audit on a website — checks whether ChatGPT, Claude, and Perplexity can find and cite it. Returns an instant snapshot of crawler access, structured data, and llms.txt. If an email is provided, a full scored report (0–100 across 5 pillars, with copy-paste fixes) is emailed as a PDF. Use this whenever a user asks to audit/check a site's AI visibility, GEO, AEO, or whether AI can find them.",
      inputSchema: {
        website_url: z.string().describe("The website to audit, e.g. https://example.com"),
        email: z.string().email().optional().describe("Optional. If provided, the full scored PDF report is emailed here (and the user becomes a Specularis lead). Omit for just the instant snapshot."),
        name: z.string().optional().describe("Optional name for the report greeting."),
        role: z.enum(["Real Estate Agent", "Attorney", "Founder", "Other"]).optional().describe("Optional. Tailors the audit lens — local-service providers are scored on local entity signals, reviews, and directories."),
      },
      outputSchema: {
        website: z.string().describe("The normalized website that was audited."),
        ai_crawler_access: z.string().describe("Whether major AI crawlers (GPTBot, ClaudeBot, PerplexityBot) can access the site."),
        structured_data: z.string().describe("Summary of JSON-LD structured data found on the homepage."),
        llms_txt: z.string().describe("Whether an llms.txt file is present."),
        full_report_status: z.enum(["sent", "failed", "not_requested"]).describe("Status of the full scored PDF report."),
        report_email: z.string().optional().describe("The email the full report was sent to, if requested."),
        booking_url: z.string().describe("Link to book a Specularis strategy call."),
      },
      annotations: {
        title: "Run AI Visibility Audit",
        readOnlyHint: false, // providing an email creates a lead and sends a report
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true, // fetches arbitrary external websites
      },
    },
    async ({ website_url, email, name, role }) => {
      const site = normalizeUrl(website_url);
      if (!site) return { content: [{ type: "text", text: "That doesn't look like a valid website URL. Try something like https://example.com." }], isError: true };

      const snap = await quickSnapshot(site);
      let out = `**AI Visibility snapshot — ${site.host}**\n\n` +
        `- **AI crawler access:** ${snap.crawlers}\n` +
        `- **Structured data (schema):** ${snap.schema}\n` +
        `- **llms.txt:** ${snap.llms}\n\n`;

      let reportStatus = "not_requested";
      if (email) {
        const ok = await triggerFullAudit({ name: name || email.split("@")[0], email, website_url: site.url, role: role || "Other" });
        reportStatus = ok ? "sent" : "failed";
        out += ok
          ? `✅ Your **full report** is on its way to **${email}** — a scored 0–100 audit across all 5 pillars (crawler access, entity & schema, content citability, off-site corroboration, technical foundation) with prioritized, copy-paste fixes, as a PDF. It usually arrives within a few minutes.\n\n` +
            `Want to talk through the fixes and how to get AI recommending you? Book a free 15-min strategy call: ${CONTACT_URL}`
          : `I ran the snapshot above, but couldn't reach the full-report service just now. You can run it directly at ${AUDIT_URL}, or book a call: ${CONTACT_URL}`;
      } else {
        out += `That's a 10-second snapshot. The **full report** scores you 0–100 across all 5 pillars and hands you the exact fixes (with copy-paste schema/robots snippets) as a PDF.\n\n` +
          `**Want it?** Run this again with your \`email\` and I'll send the full report. Or book a free strategy call: ${CONTACT_URL}`;
      }

      return {
        content: [{ type: "text", text: out }],
        structuredContent: {
          website: site.url,
          ai_crawler_access: snap.crawlers,
          structured_data: snap.schema,
          llms_txt: snap.llms,
          full_report_status: reportStatus,
          ...(email ? { report_email: email } : {}),
          booking_url: CONTACT_URL,
        },
      };
    }
  );

  server.registerTool(
    "book_strategy_call",
    {
      title: "Book a Strategy Call",
      description: "Get the link to book a free Specularis strategy call about AI visibility / GEO / AEO.",
      outputSchema: {
        booking_url: z.string().describe("Link to book a free 15-minute Specularis strategy call."),
      },
      annotations: {
        title: "Book a Strategy Call",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [{ type: "text", text: `Book a free 15-minute Specularis strategy call here: ${CONTACT_URL}` }],
      structuredContent: { booking_url: CONTACT_URL },
    })
  );

  return server;
}

// ---- Streamable HTTP transport (stateless) ----
const app = express();
app.use(express.json());

app.get("/", (_req, res) => res.json({ name: "specularis-ai-visibility-audit", status: "ok", mcp: "/mcp" }));

// Public sample audit report (embedded by URL on specularisinc.com/sample-report)
app.get("/sample-report", (_req, res) => {
  if (!SAMPLE_REPORT_HTML) return res.status(404).send("Not found");
  res.type("html").send(SAMPLE_REPORT_HTML);
});

// Design reference for the homepage redesign (not linked publicly; visual spec only)
app.get("/hero-preview", (_req, res) => {
  if (!HERO_PREVIEW_HTML) return res.status(404).send("Not found");
  res.type("html").send(HERO_PREVIEW_HTML);
});

// Copy-source for restoring the Tampa study article body into the Framer CMS
app.get("/tampa-article", (_req, res) => {
  if (!TAMPA_ARTICLE_HTML) return res.status(404).send("Not found");
  res.type("html").send(TAMPA_ARTICLE_HTML);
});

// Copy-source for the "Roman mineral" disambiguation article body
app.get("/mineral-article", (_req, res) => {
  if (!MINERAL_ARTICLE_HTML) return res.status(404).send("Not found");
  res.type("html").send(MINERAL_ARTICLE_HTML);
});

// Demo of the AI Citation Source Finder lead-magnet results page
app.get("/citation-finder-demo", (_req, res) => {
  if (!CITATION_FINDER_HTML) return res.status(404).send("Not found");
  res.type("html").send(CITATION_FINDER_HTML);
});

// AI Citation Source Finder — core endpoint. POST { query, domain } -> real cited sources + presence.
app.post("/citation-finder", async (req, res) => {
  try {
    const { query, domain } = req.body || {};
    if (!query || !domain) return res.status(400).json({ error: "query and domain are required" });
    if (!PERPLEXITY_API_KEY) return res.status(503).json({ error: "PERPLEXITY_API_KEY not set on the server" });
    const site = normalizeUrl(domain);
    const bare = site ? site.host.replace(/^www\./, "") : String(domain).toLowerCase().replace(/^www\./, "");

    const data = await callPerplexity(String(query).slice(0, 300));
    if (!data || data.error) return res.status(502).json({ error: data?.error || "AI query failed" });

    // extract cited sources (support both response shapes)
    let raw = [];
    if (Array.isArray(data.search_results)) raw = data.search_results.map((s) => ({ url: s.url, title: s.title || "" }));
    else if (Array.isArray(data.citations)) raw = data.citations.map((u) => ({ url: u, title: "" }));

    // dedupe by host, cap at 10
    const seen = new Set(); const sources = [];
    for (const c of raw) {
      if (!c.url) continue;
      const host = (String(c.url).match(/^https?:\/\/([^\/]+)/i)?.[1] || "").toLowerCase().replace(/^www\./, "");
      if (!host || seen.has(host)) continue;
      seen.add(host);
      sources.push({ url: c.url, host, title: c.title, type: classifySource(c.url) });
      if (sources.length >= 10) break;
    }

    // presence check: does the user's domain appear in each cited source?
    await Promise.all(sources.map(async (s) => {
      if (s.host === bare || s.host.endsWith("." + bare)) { s.isYou = true; s.appearsYou = true; return; }
      const f = await fetchWithTimeout(s.url, {}, 8000);
      s.appearsYou = (f.text || "").toLowerCase().includes(bare);
    }));

    const total = sources.length;
    const inCount = sources.filter((s) => s.appearsYou).length;
    res.json({ query, domain: bare, answer: (data.choices?.[0]?.message?.content || "").slice(0, 1200), total, inCount, sources });
  } catch (e) {
    res.status(500).json({ error: "internal error" });
  }
});

// Add-ons tab switcher — embedded by URL on the pricing section (interactive)
app.get("/addons-switcher", (_req, res) => {
  if (!ADDONS_SWITCHER_HTML) return res.status(404).send("Not found");
  res.type("html").send(ADDONS_SWITCHER_HTML);
});

// Animated stats bar — count-up numbers on scroll-in (embedded by URL)
app.get("/stats-bar", (_req, res) => {
  if (!STATS_BAR_HTML) return res.status(404).send("Not found");
  res.type("html").send(STATS_BAR_HTML);
});

// Brand assets (used as schema logo/image URLs)
app.get("/assets/specularis-logo.png", (_req, res) => {
  if (!LOGO_PNG) return res.status(404).send("Not found");
  res.type("png").set("Cache-Control", "public, max-age=86400").send(LOGO_PNG);
});
app.get("/assets/adev-headshot.png", (_req, res) => {
  if (!HEADSHOT_PNG) return res.status(404).send("Not found");
  res.type("png").set("Cache-Control", "public, max-age=86400").send(HEADSHOT_PNG);
});

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
