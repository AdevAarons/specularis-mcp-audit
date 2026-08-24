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
let FINDER_HTML = "";
try { FINDER_HTML = readFileSync(join(__dirname, "public", "finder.html"), "utf8"); } catch (e) {}
let ADDONS_SWITCHER_HTML = "";
try { ADDONS_SWITCHER_HTML = readFileSync(join(__dirname, "public", "addons-switcher.html"), "utf8"); } catch (e) {}
let STATS_BAR_HTML = "";
try { STATS_BAR_HTML = readFileSync(join(__dirname, "public", "stats-bar.html"), "utf8"); } catch (e) {}
let DASHBOARD_HTML = "";
try { DASHBOARD_HTML = readFileSync(join(__dirname, "public", "dashboard.html"), "utf8"); } catch (e) {}
let WHAT_WE_DO_HTML = "";
try { WHAT_WE_DO_HTML = readFileSync(join(__dirname, "public", "what-we-do.html"), "utf8"); } catch (e) {}
let SCHEMA_V3_TXT = "";
try { SCHEMA_V3_TXT = readFileSync(join(__dirname, "public", "schema-v3.txt"), "utf8"); } catch (e) {}
let SCAN_HTML = "";
try { SCAN_HTML = readFileSync(join(__dirname, "public", "scan.html"), "utf8"); } catch (e) {}
let REPORT_V2_HTML = "";
try { REPORT_V2_HTML = readFileSync(join(__dirname, "public", "report-v2.html"), "utf8"); } catch (e) {}
let PROOF_CARD_HTML = "";
try { PROOF_CARD_HTML = readFileSync(join(__dirname, "public", "proof-card.html"), "utf8"); } catch (e) {}
let PRICING_SWITCHER_HTML = "";
try { PRICING_SWITCHER_HTML = readFileSync(join(__dirname, "public", "pricing-switcher.html"), "utf8"); } catch (e) {}
let SAVAGE_FLIGHT_HTML = "";
try { SAVAGE_FLIGHT_HTML = readFileSync(join(__dirname, "public", "savage-flight.html"), "utf8"); } catch (e) {}
// Brand assets (served for schema logo/image + og); binary buffers loaded once
let LOGO_PNG = null, HEADSHOT_PNG = null;
try { LOGO_PNG = readFileSync(join(__dirname, "public", "assets", "specularis-logo.png")); } catch (e) {}
try { HEADSHOT_PNG = readFileSync(join(__dirname, "public", "assets", "adev-headshot.png")); } catch (e) {}
let MINERAL_COVER_PNG=null, MINERAL_COVER_ALT_PNG=null;
try { MINERAL_COVER_PNG = readFileSync(join(__dirname, "public", "assets", "mineral-cover.png")); } catch (e) {}
try { MINERAL_COVER_ALT_PNG = readFileSync(join(__dirname, "public", "assets", "mineral-cover-alt.png")); } catch (e) {}

// ---- config (set these as env vars on the host; safe defaults below) ----
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "https://primary-production-4d44.up.railway.app/webhook/free-audit";
const CONTACT_URL = process.env.CONTACT_URL || "https://specularisinc.com/contact";
const AUDIT_URL = process.env.AUDIT_URL || "https://specularisinc.com/free-audit";
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || ""; // set in Railway Variables
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ""; // set in Railway Variables — adds Claude as a 2nd engine in the citation finder
const NOTION_TOKEN = process.env.NOTION_TOKEN || "";       // Notion internal-integration token — logs finder leads
const NOTION_LEADS_DB = process.env.NOTION_LEADS_DB || ""; // Notion database id that receives finder leads
// finder rate limits (cost guard for the public tool)
const FINDER_IP_MAX = Number(process.env.FINDER_IP_MAX || 6);                    // requests per IP per window
const FINDER_IP_WINDOW_MS = Number(process.env.FINDER_IP_WINDOW_MS || 15 * 60 * 1000); // 15 min
const FINDER_DAY_MAX = Number(process.env.FINDER_DAY_MAX || 250);                // global runs per day
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


// ---- Instant scan: score a site from cheap signals only (no LLM calls) ----
const scoreSnapshot = async (site) => {
  const [robots, home, llms] = await Promise.all([
    fetchWithTimeout(site.origin + "/robots.txt"),
    fetchWithTimeout(site.url),
    fetchWithTimeout(site.origin + "/llms.txt"),
  ]);
  // browser control: what a normal browser gets vs what GPTBot gets
  const asBot = await fetchWithTimeout(site.url, { headers: { "User-Agent":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot" } });

  const robotsText = robots.text || "";
  const starBlocked = /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*(\n|$)/i.test(robotsText);
  const named = ["GPTBot","ClaudeBot","PerplexityBot"].filter((b) => {
    const blk = robotsText.match(new RegExp("user-agent:\\s*" + b + "[\\s\\S]*?(?=user-agent:|$)", "i"));
    return blk && /disallow:\s*\/\s*(\n|$)/i.test(blk[0]);
  });
  const botBlocked = !asBot.ok && home.ok;           // serves a browser, refuses the bot
  const text = (asBot.text || home.text || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ");
  const words = text.split(/\s+/).filter(Boolean).length;

  const types = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let mm; const src = home.text || "";
  while ((mm = re.exec(src)) !== null) {
    try { const j = JSON.parse(mm[1]); const arr = Array.isArray(j) ? j : (j["@graph"] || [j]);
      for (const n of arr) if (n && n["@type"]) types.push([].concat(n["@type"]).join("/")); } catch (e) {}
  }
  const uniq = [...new Set(types)];
  const hasOrg = uniq.some(t => /Organization|LocalBusiness/i.test(t));
  const hasPerson = uniq.some(t => /Person/i.test(t));
  const llmsPresent = llms.ok && (llms.text || "").length > 20;

  // ---- scoring (0-100), transparent and cheap ----
  let access = 40;
  if (starBlocked) access = 0; else if (named.length) access = 12; else if (botBlocked) access = 8;
  let identity = 0;
  if (uniq.length) identity += 12;
  if (hasOrg) identity += 10;
  if (hasPerson) identity += 5;
  if (llmsPresent) identity += 3;
  let content = 0;
  if (words >= 1200) content = 30; else if (words >= 600) content = 22;
  else if (words >= 250) content = 14; else if (words >= 60) content = 7;
  const total = Math.max(0, Math.min(100, access + identity + content));
  const grade = total >= 85 ? "A" : total >= 70 ? "B" : total >= 55 ? "C" : total >= 40 ? "D" : "F";

  return { host: site.host, total, grade,
    access, identity, content,
    starBlocked, named, botBlocked, words, uniq, hasOrg, hasPerson, llmsPresent,
    reachable: home.ok };
};

const esc = (v) => String(v == null ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

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

// Ask Claude the same buyer query WITH web search on, so it returns the sources
// it actually pulled its answer from — the Claude-side view of "where AI cites."
const callClaude = async (query) => {
  if (!ANTHROPIC_API_KEY) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: query }],
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      }),
    });
    if (!r.ok) return { error: "claude " + r.status };
    return await r.json();
  } catch (e) { return { error: "claude fetch failed" }; }
  finally { clearTimeout(t); }
};

// Pull cited sources out of a Claude Messages response: prefer the citations
// attached to the answer text (what Claude actually referenced), and fall back
// to the raw web_search results it retrieved.
const extractClaudeSources = (data) => {
  const out = [];
  const content = Array.isArray(data?.content) ? data.content : [];
  for (const block of content) {
    if (block?.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations) if (c?.url) out.push({ url: c.url, title: c.title || "" });
    }
    if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const s of block.content) if (s?.type === "web_search_result" && s.url) out.push({ url: s.url, title: s.title || "" });
    }
  }
  return out;
};

// ---- rate limiting (in-memory; single Railway instance) ----
const RL = { perIp: new Map(), day: { count: 0, resetAt: 0 } };
const rateLimitFinder = (ip) => {
  const now = Date.now();
  if (now > RL.day.resetAt) { RL.day.count = 0; RL.day.resetAt = now + 24 * 60 * 60 * 1000; }
  if (RL.day.count >= FINDER_DAY_MAX) return { ok: false, reason: "daily" };
  if (RL.perIp.size > 5000) { for (const [k, v] of RL.perIp) if (now > v.resetAt) RL.perIp.delete(k); } // prune
  let e = RL.perIp.get(ip);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + FINDER_IP_WINDOW_MS }; RL.perIp.set(ip, e); }
  if (e.count >= FINDER_IP_MAX) return { ok: false, reason: "ip" };
  e.count++; RL.day.count++;
  return { ok: true };
};

// ---- Notion lead logging (no-op until NOTION_TOKEN + NOTION_LEADS_DB are set) ----
const logLeadToNotion = async (lead) => {
  if (!NOTION_TOKEN || !NOTION_LEADS_DB) return;
  const t = (s) => [{ text: { content: String(s || "").slice(0, 1900) } }];
  try {
    await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: { "Authorization": "Bearer " + NOTION_TOKEN, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
      body: JSON.stringify({
        parent: { database_id: NOTION_LEADS_DB },
        properties: {
          "Email": { title: t(lead.email) },
          "Website": { rich_text: t(lead.domain) },
          "Query": { rich_text: t(lead.query) },
          "Result": { rich_text: t(lead.inCount != null ? lead.inCount + " / " + lead.total : "") },
          "Source": { select: { name: "AI Citation Finder" } },
        },
      }),
    });
  } catch (e) { /* non-blocking — never break the response over lead logging */ }
};

// shared global daily cap for the MCP tool (draws the same budget as the web tool)
const mcpAllow = () => {
  const now = Date.now();
  if (now > RL.day.resetAt) { RL.day.count = 0; RL.day.resetAt = now + 24 * 60 * 60 * 1000; }
  if (RL.day.count >= FINDER_DAY_MAX) return false;
  RL.day.count++; return true;
};

// Core of the citation finder — used by both the web endpoint and the MCP tool.
// Queries Perplexity + Claude, merges cited sources, and checks whether `domain` appears in each.

// Derive a buyer-intent query from the site itself (cheap: no LLM, reads the page)
const inferBuyerQuery = async (site) => {
  const home = await fetchWithTimeout(site.url);
  const h = home.text || "";
  const title = (h.match(/<title[^>]*>([^<]{3,140})<\/title>/i)?.[1] || "").trim();
  const desc  = (h.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,240})/i)?.[1] || "").trim();
  let city = "";
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(h)) !== null) {
    try {
      const j = JSON.parse(m[1]); const arr = Array.isArray(j) ? j : (j["@graph"] || [j]);
      for (const n of arr) { const a = (n && n.address) || {}; if (a.addressLocality) { city = a.addressLocality; break; } }
    } catch (e) {}
  }

  // Ask Claude for one buyer-intent query. It is one short call and far better than string slicing.
  if (ANTHROPIC_API_KEY) {
    const prompt = "A business has this homepage.\n\nTitle: " + title + "\nDescription: " + desc +
      (city ? "\nCity: " + city : "") +
      "\n\nWrite the ONE search question a potential customer would ask an AI assistant when looking for a business like this, " +
      "without knowing this company exists. Use the category of service, never the brand name. " +
      "Format it like a real question, for example: who are the best real estate agents in Tampa. " +
      "Reply with the question only, no quotes, no preamble, under 90 characters.";
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-opus-5", max_tokens: 60, messages: [{ role: "user", content: prompt }] }),
      });
      if (r.ok) {
        const j = await r.json();
        const t = (j.content || []).filter(b => b.type === "text").map(b => b.text).join(" ").trim()
          .replace(/^["'\s]+|["'\s.]+$/g, "");
        const brand = site.host.replace(/^www\./, "").split(".")[0].toLowerCase();
        if (t && t.length > 8 && t.length < 130 && !t.toLowerCase().includes(brand)) {
          return { query: t, title, city, via: "claude" };
        }
      }
    } catch (e) {}
  }

  // fallback: crude but safe
  const noun = (desc || title).replace(/\s+/g, " ").split(/[|\u2013\u2014\-·,.]/)[0].trim().slice(0, 48);
  return { query: ("who are the best " + (noun || "providers") + (city ? " in " + city : "")).slice(0, 120), title, city, via: "fallback" };
};

const runCitationFinder = async (query, domain) => {
  const site = normalizeUrl(domain);
  const bare = site ? site.host.replace(/^www\./, "") : String(domain).toLowerCase().replace(/^www\./, "");
  const q = String(query).slice(0, 300);
  const [pplx, claude] = await Promise.all([callPerplexity(q), callClaude(q)]);
  if ((!pplx || pplx.error) && (!claude || claude.error)) return { error: pplx?.error || claude?.error || "AI query failed" };

  const raw = [];
  if (pplx && !pplx.error) {
    let p = [];
    if (Array.isArray(pplx.search_results)) p = pplx.search_results.map((s) => ({ url: s.url, title: s.title || "" }));
    else if (Array.isArray(pplx.citations)) p = pplx.citations.map((u) => ({ url: u, title: "" }));
    for (const c of p) raw.push({ url: c.url, title: c.title, engine: "Perplexity" });
  }
  if (claude && !claude.error) for (const c of extractClaudeSources(claude)) raw.push({ url: c.url, title: c.title, engine: "Claude" });

  const byHost = new Map();
  for (const c of raw) {
    if (!c.url) continue;
    const host = (String(c.url).match(/^https?:\/\/([^\/]+)/i)?.[1] || "").toLowerCase().replace(/^www\./, "");
    if (!host) continue;
    if (byHost.has(host)) {
      const ex = byHost.get(host);
      if (!ex.engines.includes(c.engine)) ex.engines.push(c.engine);
      if (!ex.title && c.title) ex.title = c.title;
    } else if (byHost.size < 12) {
      byHost.set(host, { url: c.url, host, title: c.title, type: classifySource(c.url), engines: [c.engine] });
    }
  }
  const sources = [...byHost.values()];

  await Promise.all(sources.map(async (s) => {
    if (s.host === bare || s.host.endsWith("." + bare)) { s.isYou = true; s.appearsYou = true; return; }
    const f = await fetchWithTimeout(s.url, {}, 8000);
    s.appearsYou = (f.text || "").toLowerCase().includes(bare);
  }));

  const total = sources.length;
  const inCount = sources.filter((s) => s.appearsYou).length;
  const enginesUsed = [];
  if (pplx && !pplx.error) enginesUsed.push("Perplexity");
  if (claude && !claude.error) enginesUsed.push("Claude");
  const answer = (pplx && !pplx.error && pplx.choices?.[0]?.message?.content) || "";
  return { query: q, domain: bare, answer: answer.slice(0, 1200), total, inCount, engines: enginesUsed, sources };
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
  "data, llms.txt). Pass an email to also trigger the full scored 0–100 PDF report across all 5 pillars. Call " +
  "find_ai_citations with a buyer query + a website to see the exact sources ChatGPT/Perplexity/Claude cite for that " +
  "query and whether the site appears in any of them. Use book_strategy_call to share the Specularis booking link.";

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

  server.registerTool(
    "find_ai_citations",
    {
      title: "Find AI Citation Sources",
      description:
        "Given a buyer query (e.g. 'best real estate agent in Tampa') and a website domain, find the exact sources ChatGPT, Perplexity, and Claude cite when answering that query — and whether the domain appears in any of them. Returns the ranked source list (with which engine cites each) and an 'appears in X of N' gap. Use this whenever a user wants to know where AI gets its answers about their industry, which pages AI trusts for a query, or whether their business shows up in AI recommendations.",
      inputSchema: {
        query: z.string().describe("The question a customer would ask AI, e.g. 'best personal injury lawyer in Miami'."),
        domain: z.string().describe("The website to check for, e.g. example.com"),
      },
      outputSchema: {
        query: z.string(),
        domain: z.string(),
        total_sources: z.number().describe("How many distinct sources AI cites for this query."),
        appears_in: z.number().describe("How many of those sources the domain currently appears in."),
        sources: z.array(z.object({
          rank: z.number(),
          name: z.string(),
          host: z.string(),
          type: z.string().describe("Source type, e.g. Directory / review platform, Reddit thread, Website / blog."),
          engines: z.array(z.string()).describe("Which AI engines cite this source (Perplexity, Claude)."),
          you_appear: z.boolean(),
        })),
        booking_url: z.string(),
      },
      annotations: {
        title: "Find AI Citation Sources",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true, // queries live AI engines + fetches external pages
      },
    },
    async ({ query, domain }) => {
      if (!query || !domain) return { content: [{ type: "text", text: "Please provide both a buyer query and a website domain." }], isError: true };
      if (!PERPLEXITY_API_KEY && !ANTHROPIC_API_KEY) return { content: [{ type: "text", text: "The citation finder isn't configured on the server yet." }], isError: true };
      if (!mcpAllow()) return { content: [{ type: "text", text: `The free citation finder has hit today's usage limit. Try again tomorrow, or run the full audit: ${AUDIT_URL}` }], isError: true };

      const r = await runCitationFinder(query, domain);
      if (r.error) return { content: [{ type: "text", text: `Couldn't complete the citation check: ${r.error}` }], isError: true };

      const lines = r.sources.map((s, i) =>
        `${i + 1}. ${s.title || s.host} (${s.host}) — ${s.type} — cited by ${s.engines.join(" & ")} — ${s.appearsYou ? "✅ YOU APPEAR" : "not listed"}`).join("\n");
      const text =
        `**Where AI cites for "${r.query}"**\n\n` +
        `AI (${r.engines.join(" + ")}) cites **${r.total} sources** for this query. **${r.domain} appears in ${r.inCount} of ${r.total}.**\n\n` +
        `${lines}\n\n` +
        `These sources are the target list — getting cited *in* them is how ${r.domain} starts showing up in AI answers. ` +
        `Run a full AI visibility audit: ${AUDIT_URL}`;

      return {
        content: [{ type: "text", text }],
        structuredContent: {
          query: r.query,
          domain: r.domain,
          total_sources: r.total,
          appears_in: r.inCount,
          sources: r.sources.map((s, i) => ({ rank: i + 1, name: s.title || s.host, host: s.host, type: s.type, engines: s.engines, you_appear: !!s.appearsYou })),
          booking_url: AUDIT_URL,
        },
      };
    }
  );

  return server;
}

// ---- Streamable HTTP transport (stateless) ----
const app = express();
app.set("trust proxy", true); // Railway sits behind a proxy — trust X-Forwarded-For for real client IPs
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

// Client scoreboard — Savage Flight (self-contained; shareable + embeddable)
app.get("/savage-flight", (_req, res) => {
  if (!SAVAGE_FLIGHT_HTML) return res.status(404).send("Not found");
  res.type("html").send(SAVAGE_FLIGHT_HTML);
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

// The live AI Citation Source Finder tool (input form -> results)
app.get("/finder", (_req, res) => {
  if (!FINDER_HTML) return res.status(404).send("Not found");
  res.type("html").send(FINDER_HTML);
});

// AI Citation Source Finder — core endpoint. POST { query, domain } -> real cited sources + presence.
app.post("/citation-finder", async (req, res) => {
  try {
    const { query, domain, email } = req.body || {};
    if (!query || !domain) return res.status(400).json({ error: "query and domain are required" });
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "unknown";
    const rl = rateLimitFinder(ip);
    if (!rl.ok) return res.status(429).json({ error: rl.reason === "daily"
      ? "This free tool has hit today's usage limit. Please try again tomorrow — or run the full audit."
      : "You've run a few checks in a short window. Give it a few minutes and try again." });
    if (!PERPLEXITY_API_KEY && !ANTHROPIC_API_KEY) return res.status(503).json({ error: "PERPLEXITY_API_KEY not set on the server" });
    if (email) console.log("CITATION-FINDER LEAD:", JSON.stringify({ email, domain, query, at: new Date().toISOString() }));

    const r = await runCitationFinder(query, domain);
    if (r.error) return res.status(502).json({ error: r.error });
    if (email) logLeadToNotion({ email, domain: r.domain, query: r.query, inCount: r.inCount, total: r.total }); // fire-and-forget
    res.json({ query: r.query, domain: r.domain, answer: r.answer, total: r.total, inCount: r.inCount, engines: r.engines, sources: r.sources });
  } catch (e) {
    res.status(500).json({ error: "internal error" });
  }
});


// Instant scan API — cheap signals only, no LLM cost
app.get("/api/scan", async (req, res) => {
  try {
    const site = normalizeUrl(String(req.query.d || ""));
    if (!site) return res.status(400).json({ error: "Give me a domain, like example.com" });
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "unknown";
    const rl = rateLimitFinder(ip);
    if (!rl.ok) return res.status(429).json({ error: rl.reason === "daily"
      ? "This free tool has hit today's limit. Try again tomorrow, or run the full audit."
      : "That's a few checks in a short window. Give it a minute." });
    const r = await scoreSnapshot(site);
    if (!r.reachable && !r.botBlocked) return res.status(502).json({ error: "Could not reach that site. Check the domain and try again." });
    res.json(r);
  } catch (e) { res.status(500).json({ error: "Something went wrong on our side." }); }
});

app.get("/scan", (_req, res) => {
  if (!SCAN_HTML) return res.status(404).send("Not found");
  res.type("html").send(SCAN_HTML);
});

// Hand off to the existing n8n audit for the full scored report
app.post("/api/full-report", async (req, res) => {
  try {
    const { email, domain } = req.body || {};
    if (!email || !domain) return res.status(400).json({ error: "email and domain required" });
    const site = normalizeUrl(domain);
    if (!site) return res.status(400).json({ error: "bad domain" });
    const bare = site.host.replace(/^www\./, "");

    // 1) kick off the full n8n audit so the PDF still lands in their inbox
    triggerFullAudit({ name: String(email).split("@")[0], email, website_url: site.url, role: "Other" })
      .catch(() => {});

    if (!PERPLEXITY_API_KEY && !ANTHROPIC_API_KEY) {
      return res.json({ emailed: true, live: false, note: "Full report is on its way by email." });
    }

    // 2) run the two locked checks live so the page can unlock in place
    const inferred = await inferBuyerQuery(site);
    const [ident, rec] = await Promise.all([
      runCitationFinder("What is " + bare + "? Who runs it and what do they do?", bare),
      runCitationFinder(inferred.query, bare),
    ]);

    const identOk = !ident.error;
    const recOk = !rec.error;
    const answer = (identOk && ident.answer) || "";
    const namedInAnswer = answer.toLowerCase().includes(bare.split(".")[0].toLowerCase());

    res.json({
      emailed: true, live: true,
      backing: identOk ? {
        sources: ident.total, mentioning: ident.inCount,
        recognised: namedInAnswer,
        answer: answer.slice(0, 400),
        engines: ident.engines
      } : null,
      recommended: recOk ? {
        query: rec.query, sources: rec.total, named: rec.inCount,
        engines: rec.engines,
        cited: rec.sources.slice(0, 6).map(s => ({ host: s.host, type: s.type, you: !!s.appearsYou }))
      } : null
    });
  } catch (e) { res.status(500).json({ error: "internal error" }); }
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

// Internal client results dashboard — password-gated via ?k= or DASHBOARD_KEY env
app.get("/dashboard", (req, res) => {
  const key = process.env.DASHBOARD_KEY || "";
  if (key && req.query.k !== key) return res.status(401).send("Unauthorized");
  if (!DASHBOARD_HTML) return res.status(404).send("Not found");
  res.type("html").send(DASHBOARD_HTML);
});

// "What we do" service cards with platform badges
app.get("/what-we-do", (_req, res) => {
  if (!WHAT_WE_DO_HTML) return res.status(404).send("Not found");
  res.type("html").send(WHAT_WE_DO_HTML);
});

// Schema v3 served as PLAIN TEXT so it can be selected and copied verbatim
app.get("/schema-v3.txt", (_req, res) => {
  if (!SCHEMA_V3_TXT) return res.status(404).send("Not found");
  res.type("text/plain; charset=utf-8").send(SCHEMA_V3_TXT);
});

// Ora-style audit report v2 (goal-framed, with badge export)
app.get("/report-v2", (_req, res) => {
  if (!REPORT_V2_HTML) return res.status(404).send("Not found");
  res.type("html").send(REPORT_V2_HTML);
});

// Social-proof result card (screenshot for LinkedIn)
app.get("/proof-card", (_req, res) => {
  if (!PROOF_CARD_HTML) return res.status(404).send("Not found");
  res.type("html").send(PROOF_CARD_HTML);
});

// Pricing plan switcher (Local / Enterprise) — embedded by URL
app.get("/pricing-switcher", (_req, res) => {
  if (!PRICING_SWITCHER_HTML) return res.status(404).send("Not found");
  res.type("html").send(PRICING_SWITCHER_HTML);
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
app.get("/assets/mineral-cover.png", (_req, res) => { if (!MINERAL_COVER_PNG) return res.status(404).send("Not found"); res.type("png").set("Cache-Control","public, max-age=86400").send(MINERAL_COVER_PNG); });
app.get("/assets/mineral-cover-alt.png", (_req, res) => { if (!MINERAL_COVER_ALT_PNG) return res.status(404).send("Not found"); res.type("png").set("Cache-Control","public, max-age=86400").send(MINERAL_COVER_ALT_PNG); });

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
