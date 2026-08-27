// ── Specularis AI Visibility Audit — MCP server (remote, Streamable HTTP) ──
// Exposes the free GEO/AEO audit as a tool inside Claude / ChatGPT / any MCP client.
// Reuses the existing n8n audit webhook as the backend engine.

import { webcrypto, createHmac } from "node:crypto";
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
const BADGE_SECRET = process.env.BADGE_SECRET || "specularis-badge-dev-secret";
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


// Can this prospect realistically get INTO a cited source, or is it a rival's own
// property? That distinction is what turns a competitor list into an action plan.
// Reuses classifySource below, which already names the source type.
const isJoinable = (host) => {
  const t = classifySource("https://" + host);
  return t !== "Website / blog";
};

// ---- Deep audit: the comprehensive version, for prospect meetings ----
// Differs from the free scan in three ways that cost real money and time, which
// is exactly why it is not on the public page:
//   1. tests pages across the site, not just the homepage
//   2. asks several buyer questions across intent stages, not one
//   3. routes through a residential proxy when PROXY_URL is set
const DEEP_KEY = process.env.DEEP_KEY || process.env.DASHBOARD_KEY || "";
const PROXY_URL = process.env.PROXY_URL || "";   // unset = datacenter IP, and we say so

// A homepage can be wide open while /blog is refused. Free scan cannot afford to
// look; this one must, because it is the single most common real-world pattern.
const probePage = async (url) => {
  const [asBrowser, asBot] = await Promise.all([
    fetchWithTimeout(url, {}, 12000),
    fetchWithTimeout(url, { headers: { "User-Agent": BOT_UAS.GPTBot } }, 12000),
  ]);
  const words = (t) => (String(t || "").replace(/<[^>]+>/g, " ").match(/\S+/g) || []).length;
  const bw = words(asBrowser.text), gw = words(asBot.text);
  const challenged = CHALLENGE_RX.test(asBot.text || "");
  return {
    url,
    browser: { status: asBrowser.status, words: bw },
    gptbot: { status: asBot.status, words: gw, challenged },
    served: asBot.ok && !challenged && gw > 40,
    thin: asBrowser.ok && bw > 300 && gw < bw * 0.4,
  };
};

const pagesFromSitemap = async (site, n = 8) => {
  const sm = await fetchWithTimeout(site.origin + "/sitemap.xml", {}, 12000);
  const locs = [...String(sm.text || "").matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]);
  const same = locs.filter(u => { try { return new URL(u).host.replace(/^www\./, "") === site.host.replace(/^www\./, ""); } catch (e) { return false; } });
  const home = site.url.replace(/\/$/, "");
  const rest = same.filter(u => u.replace(/\/$/, "") !== home);
  // spread across the sitemap rather than taking the first n, which are usually
  // all top-level nav and tell you nothing about the deep pages
  const step = Math.max(1, Math.floor(rest.length / (n - 1)));
  const spread = [];
  for (let i = 0; i < rest.length && spread.length < n - 1; i += step) spread.push(rest[i]);
  return [site.url, ...spread];
};

const inferBuyerQueries = async (site) => {
  const one = await inferBuyerQuery(site);
  if (!ANTHROPIC_API_KEY) return [one.query];
  const prompt = "A business at " + site.host + ". Write three different questions a potential customer " +
    "would type into ChatGPT when they do NOT know this company exists: one ready-to-buy question, one " +
    "comparing-options question, one early-research question. Use the category and location, never the brand " +
    "name. One per line, no numbering, no quotes, each under 90 characters.";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 200, messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) return [one.query];
    const j = await r.json();
    const lines = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("\n")
      .split("\n").map(x => x.replace(/^[-*\d.\s]+/, "").replace(/^["']|["']$/g, "").trim())
      .filter(x => x.length > 12 && x.length < 120 && !x.toLowerCase().includes(site.host.split(".")[0].toLowerCase()));
    return lines.length >= 2 ? lines.slice(0, 3) : [one.query];
  } catch (e) { return [one.query]; }
};

// ---- Free corroboration signals ----
// Everything here is a plain HTTP fetch against a public endpoint: no API keys, no
// per-call cost. These are the sources answer engines lean on most heavily, so they
// belong in the off-site pillar alongside the one paid citation query.
const freeCorroboration = async (site) => {
  const bare = site.host.replace(/^www\./, "");
  const brand = bare.split(".")[0].replace(/[^a-z0-9]/gi, "");
  const pretty = brand.replace(/([a-z])([A-Z])/g, "$1 $2");
  const out = { wikipedia: false, wikidata: false, wikiLinks: 0, news: 0, reddit: 0, hn: 0,
                newsTitles: [], checked: [] };

  const jget = async (u, ms = 8000) => {
    const r = await fetchWithTimeout(u, { headers: { "User-Agent": "SpecularisAudit/1.0 (+https://specularisinc.com)" } }, ms);
    if (!r.ok) return null;
    try { return JSON.parse(r.text); } catch (e) { return { _raw: r.text }; }
  };

  await Promise.all([
    // Does any Wikipedia article link out to this domain? A real editorial citation,
    // and among the strongest corroboration signals that exists.
    (async () => {
      const j = await jget("https://en.wikipedia.org/w/api.php?action=query&list=exturlusage&format=json&eulimit=10&euquery=" + encodeURIComponent(bare));
      out.wikiLinks = ((j && j.query && j.query.exturlusage) || []).length;
      out.checked.push("wikilinks");
    })().catch(() => {}),
    // Hacker News, via the public Algolia index. No key, and a source engines quote.
    (async () => {
      const j = await jget("https://hn.algolia.com/api/v1/search?hitsPerPage=20&query=" + encodeURIComponent(bare));
      out.hn = ((j && j.hits) || []).filter(h => JSON.stringify(h).toLowerCase().includes(bare)).length;
      out.checked.push("hn");
    })().catch(() => {}),
    // Wikidata: the entity backbone most engines resolve names against.
    (async () => {
      const j = await jget("https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=5&search=" + encodeURIComponent(pretty));
      const hits = (j && j.search) || [];
      out.wikidata = hits.some(h => String(h.label || "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(brand.toLowerCase()));
      out.checked.push("wikidata");
    })().catch(() => {}),
    // Wikipedia: a page here is one of the single strongest citation signals there is.
    (async () => {
      const j = await jget("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=" + encodeURIComponent(pretty));
      const hits = (j && j.query && j.query.search) || [];
      out.wikipedia = hits.some(h => String(h.title || "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(brand.toLowerCase()));
      out.checked.push("wikipedia");
    })().catch(() => {}),
    // Press coverage, via the public news feed. Earned media is what engines quote.
    (async () => {
      const r = await fetchWithTimeout("https://news.google.com/rss/search?q=" + encodeURIComponent('"' + pretty + '"') + "&hl=en-US&gl=US&ceid=US:en", {}, 9000);
      const titles = [...String(r.text || "").matchAll(/<title>(?:<!\[CDATA\[)?([^<\]]{6,140})/g)].map(m => m[1]).slice(1, 12);
      out.newsTitles = titles.filter(t => t.toLowerCase().replace(/[^a-z0-9]/g, "").includes(brand.toLowerCase())).slice(0, 5);
      out.news = out.newsTitles.length;
      out.checked.push("news");
    })().catch(() => {}),
    // Community mentions. Reddit is disproportionately cited by answer engines.
    (async () => {
      const j = await jget("https://www.reddit.com/search.json?limit=15&q=" + encodeURIComponent(pretty));
      const kids = (j && j.data && j.data.children) || [];
      out.reddit = kids.filter(k => JSON.stringify(k.data || {}).toLowerCase().includes(bare)).length;
      out.checked.push("reddit");
    })().catch(() => {}),
  ]);
  return out;
};

// ---- Off-site corroboration, measured for real ----
// Being cited is the thing that actually predicts AI visibility, so it belongs in
// the score rather than behind the email gate. It costs two API calls, so cache it
// hard: a domain's citation footprint does not move hour to hour.
const CITE_TTL = 24 * 60 * 60 * 1000;   // a day. Earned citations move in weeks, not hours.
const CITE_MIN_REFRESH = 15 * 60 * 1000;  // but never let a forced re-check run more than 4x an hour
const CITE_CACHE = new Map();

const buyerQuerySet = async (site, wide = false) => {
  const one = await inferBuyerQuery(site);
  const city = one.city || "";
  // Pull the category out of the model's own question so the three stages stay
  // about the same business, not three unrelated searches.
  let cat = String(one.query || "")
    .replace(/^(who are|what are|which are|who is|what is)\s+(the\s+)?(best|top|leading)?\s*/i, "")
    .replace(new RegExp("\\s+in\\s+" + city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "i"), "")
    .replace(/\?+$/, "").trim();
  if (!cat || cat.length < 4) cat = "providers";
  const where = city ? " in " + city : "";
  const sing = cat.replace(/ies$/, "y").replace(/(companies|agencies)$/i, m => m.toLowerCase() === "companies" ? "company" : "agency").replace(/s$/, "");
  // "a AI visibility company" reads as machine-written, and these questions go to a
  // live engine and appear verbatim in the report someone reads.
  const article = /^[aeiou]/i.test(sing) ? "an" : "a";
  const core = [
    { stage: "decision",      query: "who are the best " + cat + where },
    { stage: "consideration", query: "how do I choose " + article + " " + sing + where },
    { stage: "awareness",     query: "what should I look for in " + cat + where },
  ];
  if (!wide) return core.map(q => ({ ...q, query: q.query.slice(0, 140) }));

  // Deep audit: ten questions across stage AND phrasing. Three tell you a
  // direction; ten tell you whether the pattern holds.
  return [
    ...core,
    { stage: "decision",      query: "top " + cat + where + " 2026" },
    { stage: "decision",      query: "best " + cat + " near me" },
    { stage: "comparison",    query: "compare " + cat + where },
    { stage: "comparison",    query: "is it worth hiring " + article + " " + sing },
    { stage: "problem",       query: "what does " + article + " " + sing + " actually do" },
    { stage: "problem",       query: "do I need " + article + " " + sing },
    { stage: "awareness",     query: "who are the best " + cat },   // no city: national view
  ].map(q => ({ ...q, query: q.query.replace(/\s{2,}/g, " ").slice(0, 140) }));
};

const getCitationSignal = async (site, force = false, paid = false, wide = false) => {
  const bare = site.host.replace(/^www\./, "");
  const key = bare + (wide ? "|deep" : paid ? "|paid" : "|free");
  const hit = CITE_CACHE.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  // A forced re-check bypasses the day-long cache but still cannot be spammed.
  const stale = force ? age > CITE_MIN_REFRESH : age > CITE_TTL;
  if (hit && !stale) return Object.assign({}, hit.v, { measuredAt: hit.at, fromCache: true });
  if (paid && !PERPLEXITY_API_KEY && !ANTHROPIC_API_KEY) return null;

  try {
    // Only build the question set when we are actually going to ask it. On the free
    // tier this was calling Claude to write three queries that were then discarded.
    const qset = paid ? await buyerQuerySet(site, wide) : [];
    // Sequential, not parallel. Two simultaneous calls to a rate-limited search API
    // means one of them 429s and half the measurement silently comes back empty.
    // The unbranded buyer query goes first because it carries most of the score.
    const free = await freeCorroboration(site);
    // The free tier costs nothing to run: no API keys, no per-scan billing. Asking
    // the engines directly is the better measurement, but it is a paid call, so it
    // belongs to the deep audit that a booked prospect gets.
    const runs = [];
    for (const q of (paid ? qset : [])) {
      const r = await runCitationFinder(q.query, bare);
      if (!r.error) runs.push({ stage: q.stage, query: q.query, sources: r.total, named: r.inCount,
        cited: r.sources.slice(0, 8).map(x => ({ host: x.host, you: !!x.appearsYou })) });
      await new Promise(z => setTimeout(z, 1500));
    }
    const rec = runs.length
      ? { total: runs.reduce((a, x) => a + x.sources, 0), inCount: runs.reduce((a, x) => a + x.named, 0),
          sources: runs[0].cited.map(c => ({ host: c.host, appearsYou: c.you })), engines: ["Perplexity"], error: null }
      : { error: "all queries failed", total: 0, inCount: 0, sources: [], engines: [] };
    const ident = { total: 0, inCount: 0, answer: "", engines: [], skipped: true };
    const answer = (!ident.error && ident.answer) || "";
    const v = {
      free,
      runs,
      queriesRun: runs.length,
      queriesCited: runs.filter(r => r.named > 0).length,
      query: (qset[0] && qset[0].query) || null,
      // unbranded: asked for the best in the category, was this business cited?
      buyerSources: rec.error ? 0 : rec.total,
      buyerCited: rec.error ? 0 : rec.inCount,
      // branded: asked about them by name, does the engine know them and do
      // independent sources confirm it?
      brandSources: ident.error ? 0 : ident.total,
      brandMentions: ident.error ? 0 : ident.inCount,
      recognised: answer.toLowerCase().includes(bare.split(".")[0].toLowerCase()),
      cited: rec.error ? [] : rec.sources.slice(0, 8).map(x => ({ host: x.host, you: !!x.appearsYou })),
      engines: [...new Set([...(ident.engines || []), ...(rec.engines || [])])],
      ok: !rec.error || !ident.error,
    };
    CITE_CACHE.set(key, { at: Date.now(), v });
    return Object.assign({}, v, { measuredAt: Date.now(), fromCache: false });
  } catch (e) { return null; }
};

// ---- Instant scan: score a site from cheap signals only (no LLM calls) ----
const BOT_UAS = {
  GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot",
  ClaudeBot: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  PerplexityBot: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
};
const CHALLENGE_RX = /just a moment|checking your browser|cf-browser-verification|enable javascript and cookies|attention required|captcha|are you a robot|access denied|request blocked/i;

const visibleWords = (html) => {
  const t = String(html || "")
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
  return t.split(/\s+/).filter(w => w.length > 1).length;
};

// robots.txt: honour Allow, wildcards, and the * group properly
const robotsBlocks = (robotsText, ua) => {
  const lines = String(robotsText || "").split(/\r?\n/).map(l => l.replace(/#.*$/, "").trim()).filter(Boolean);
  let groups = [], cur = null;
  for (const l of lines) {
    const m = l.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
    } else if (cur && (k === "disallow" || k === "allow")) cur.rules.push({ allow: k === "allow", path: v });
  }
  const pick = groups.find(g => g.agents.includes(ua.toLowerCase())) || groups.find(g => g.agents.includes("*"));
  if (!pick) return false;
  const root = pick.rules.filter(r => r.path === "/" || r.path === "");
  const disallowRoot = root.some(r => !r.allow && r.path === "/");
  const allowRoot = pick.rules.some(r => r.allow && (r.path === "/" || r.path === ""));
  return disallowRoot && !allowRoot;
};

const scoreSnapshot = async (site, cite = null) => {
  const [robots, browser, llms, sitemap] = await Promise.all([
    fetchWithTimeout(site.origin + "/robots.txt"),
    fetchWithTimeout(site.url),
    fetchWithTimeout(site.origin + "/llms.txt"),
    fetchWithTimeout(site.origin + "/sitemap.xml", {}, 5000),
  ]);
  // every major bot, not just GPTBot
  const botNames = Object.keys(BOT_UAS);
  const botRes = await Promise.all(botNames.map(n =>
    fetchWithTimeout(site.url, { headers: { "User-Agent": BOT_UAS[n] } }, 9000)));

  const robotsText = robots.text || "";
  const browserOk = browser.ok && !CHALLENGE_RX.test((browser.text || "").slice(0, 4000));
  const browserWords = visibleWords(browser.text);

  const bots = {};
  botNames.forEach((n, i) => {
    const r = botRes[i];
    const challenged = CHALLENGE_RX.test((r.text || "").slice(0, 4000));
    const words = visibleWords(r.text);
    const robotsBlocked = robotsBlocks(robotsText, n);
    // "served" means: 200, not a challenge page, and got a real amount of text
    const served = r.ok && !challenged && words >= Math.max(40, browserWords * 0.25);
    bots[n] = { status: r.status, words, challenged, robotsBlocked, served };
  });
  const blockedBots = botNames.filter(n => !bots[n].served || bots[n].robotsBlocked);
  const starBlocked = robotsBlocks(robotsText, "*");

  // JS-rendering gap: browser sees far more than the bot does
  const botBest = Math.max(...botNames.map(n => bots[n].words));
  const renderGap = browserOk && browserWords > 300 && botBest < browserWords * 0.4;

  // schema: must actually parse and carry a name
  let valid = 0; const types = []; const sameAs = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m; const src = browser.text || "";
  while ((m = re.exec(src)) !== null) {
    try {
      const j = JSON.parse(m[1].trim()); const arr = Array.isArray(j) ? j : (j["@graph"] || [j]);
      for (const n of arr) {
        if (!n || !n["@type"]) continue;
        types.push([].concat(n["@type"]).join("/"));
        if (n.name || n.headline) valid++;
        if (n.sameAs) [].concat(n.sameAs).forEach(u => { if (typeof u === "string" && /^https?:\/\//i.test(u)) sameAs.push(u); });
      }
    } catch (e) {}
  }
  const uniq = [...new Set(types)];
  const hasOrg = uniq.some(t => /Organization|LocalBusiness|ProfessionalService/i.test(t));
  const hasPerson = uniq.some(t => /Person/i.test(t));
  const hasAddress = /"addressLocality"|"streetAddress"/i.test(src);
  const llmsText = llms.ok ? (llms.text || "") : "";
  const llmsPresent = llmsText.length > 40;
  const llmsUseful = llmsPresent && /##|when to|use this|about/i.test(llmsText);
  const hasSitemap = sitemap.ok && /<urlset|<sitemapindex/i.test(sitemap.text || "");

  // A homepage can be wide open while /blog is refused, and scoring access from the
  // front door alone is how an audit tells someone 20/20 while half their site is
  // invisible. Two extra pages, spread through the sitemap, no API cost.
  const smLocs = [...String(sitemap.text || "").matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(x => x[1])
    .filter(u => { try { return new URL(u).host.replace(/^www\./, "") === site.host.replace(/^www\./, ""); } catch (e) { return false; } })
    .filter(u => u.replace(/\/$/, "") !== site.url.replace(/\/$/, ""));
  const sample = smLocs.length
    ? [smLocs[Math.floor(smLocs.length * 0.35)], smLocs[Math.floor(smLocs.length * 0.75)]].filter(Boolean)
    : [];
  const deepPages = sample.length
    ? await Promise.all([...new Set(sample)].map(async (u) => {
        const get = (ms) => fetchWithTimeout(u, { headers: { "User-Agent": BOT_UAS.GPTBot } }, ms);
        let r = await get(20000);
        // status 0 means WE failed - timeout, DNS, aborted - not that they refused.
        // Retry once, then give up and say we do not know rather than calling it a block.
        if (r.status === 0) r = await get(25000);
        const w = (String(r.text || "").replace(/<[^>]+>/g, " ").match(/\S+/g) || []).length;
        const challenged = CHALLENGE_RX.test(r.text || "");
        const refused = [401, 403, 404, 410, 429, 451].includes(r.status) || challenged;
        const unknown = r.status === 0;
        return { url: u, status: r.status, words: w,
                 served: r.ok && !challenged && w > 40, refused, unknown };
      }))
    : [];
  // Only an explicit refusal counts against the score. Our own timeouts never do.
  const deepBlocked = deepPages.filter(x => x.refused);
  const deepUnknown = deepPages.filter(x => x.unknown);
  const hasCanonical = /<link[^>]+rel=["']canonical["']/i.test(src);

  // Freshness. Engines lean hard on recently-updated sources, and most sites that
  // score well on the other pillars turn out to be three years stale. All of this
  // comes from bytes we already fetched, so it costs nothing.
  const now = Date.now();
  const dates = [];
  const pushDate = (d) => { const t = Date.parse(d); if (Number.isFinite(t) && t <= now + 864e5) dates.push(t); };
  ((sitemap.text || "").match(/<lastmod>([^<]+)<\/lastmod>/gi) || [])
    .slice(0, 400).forEach(m => pushDate(m.replace(/<\/?lastmod>/gi, "")));
  ((src.match(/"(?:datePublished|dateModified)"\s*:\s*"([^"]{8,40})"/gi) || []))
    .forEach(m => pushDate((m.match(/"([^"]{8,40})"\s*$/) || [])[1] || ""));
  ((src.match(/<(?:time|meta)[^>]+(?:datetime|content)=["']((?:19|20)\d\d-\d\d-\d\d[^"']*)["']/gi) || []))
    .forEach(m => pushDate((m.match(/["']((?:19|20)\d\d-\d\d-\d\d[^"']*)["']/) || [])[1] || ""));
  const newest = dates.length ? Math.max(...dates) : null;
  const daysSince = newest ? Math.round((now - newest) / 864e5) : null;
  const sitemapUrls = ((sitemap.text || "").match(/<loc>/gi) || []).length;
  const metaDesc = (src.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,400})["']/i) || [])[1] || "";
  const hasMetaDesc = metaDesc.trim().length >= 50;
  const hasTitle = /<title[^>]*>\s*\S[\s\S]{4,}?<\/title>/i.test(src);
  // Content citability: is any of this shaped like an answer, rather than just long?
  const headings = (src.match(/<h[23][^>]*>([\s\S]{3,160}?)<\/h[23]>/gi) || []);
  const questionHeads = headings.filter(h => /\?|^\s*<h[23][^>]*>\s*(how|what|why|when|where|who|can|does|is|do)\b/i.test(h)).length;
  const answerShaped = questionHeads >= 2 || uniq.some(t => /FAQPage|QAPage|HowTo/i.test(t));

  // Off-site: the schema declares external identities. Do they actually exist and name you?
  const brandToken = site.host.replace(/^www\./, "").split(".")[0].replace(/[^a-z0-9]/gi, "").toLowerCase();
  const profiles = [...new Set(sameAs)].slice(0, 4);
  let verifiedProfiles = 0;
  if (profiles.length) {
    const checks = await Promise.all(profiles.map(u => fetchWithTimeout(u, {}, 6000).catch(() => ({ ok: false, text: "" }))));
    verifiedProfiles = checks.filter((c, i) => {
      if (!c || !c.ok) return false;
      const body = (c.text || "").toLowerCase();
      // Many profile hosts refuse bots outright; a 2xx that names the brand is the only thing we count.
      return brandToken.length > 2 && body.includes(brandToken);
    }).length;
  }

  // ---- scoring: six weighted pillars summing to 100. Equal weights implied that
  // a canonical tag matters as much as being cited, which is not true. Off-site
  // carries the most because it is the only pillar that predicts citation. ----
  // access 20 · entity 15 · content 15 · off-site 30 · freshness 10 · technical 10
  let pAccess = 20;
  if (starBlocked) pAccess = 0;
  else if (blockedBots.length === botNames.length) pAccess = 2;
  else if (blockedBots.length) pAccess = Math.max(5, 20 - blockedBots.length * 6);
  // Deeper pages refused while the homepage is served is a genuine partial block,
  // and it is invisible to any audit that only looks at "/".
  if (pAccess > 2 && deepBlocked.length) pAccess = Math.max(4, pAccess - deepBlocked.length * 7);

  let pEntity = 0;                                   // out of 15
  if (valid > 0) pEntity += 4;
  if (hasOrg) pEntity += 4;
  if (hasPerson) pEntity += 2;
  if (hasAddress) pEntity += 2;
  if (verifiedProfiles >= 2) pEntity += 3; else if (verifiedProfiles === 1) pEntity += 1;

  let pContent = 0;                                  // out of 15
  if (botBest >= 1200) pContent += 6; else if (botBest >= 600) pContent += 4;
  else if (botBest >= 250) pContent += 3; else if (botBest >= 60) pContent += 1;
  if (answerShaped) pContent += 5;
  if (headings.length >= 3) pContent += 2;
  if (!renderGap && botBest >= 250) pContent += 2;

  // Off-site is scored on whether the engines actually cite this business, not on
  // whether it links to its own profiles. Unbranded discovery carries most of the
  // weight: that is where new customers come from.
  let pOffsite = 0;                                  // out of 30, the heaviest pillar
  let offsiteMeasured = false;
  if (cite && cite.ok) {
    offsiteMeasured = true;
    // Scored on unbranded discovery alone. Being describable when someone already
    // knows your name does not win you a customer; being in the sources an engine
    // cites when they do not is the entire game. Brand recognition is reported as
    // context but no longer earns points, so the pillar still reaches 30 without
    // paying for a second query on every scan.
    const fr = cite.free || {};
    // Free evidence, worth up to 30 on its own so the free tier is a real score
    // rather than a teaser: these are the sources answer engines lean on hardest.
    if (fr.wikipedia) pOffsite += 8;                      // an article is the strongest signal there is
    else if (fr.wikidata) pOffsite += 4;                  // entity resolves, no article yet
    if (fr.wikiLinks >= 3) pOffsite += 5; else if (fr.wikiLinks >= 1) pOffsite += 3;
    if (fr.news >= 3) pOffsite += 6; else if (fr.news >= 1) pOffsite += 3;
    if (fr.reddit >= 3) pOffsite += 4; else if (fr.reddit >= 1) pOffsite += 2;
    if (fr.hn >= 2) pOffsite += 2; else if (fr.hn >= 1) pOffsite += 1;
    if (verifiedProfiles >= 2) pOffsite += 5; else if (verifiedProfiles === 1) pOffsite += 2;

    // Paid ground truth, only present on the deep audit: asking the engines directly
    // beats every proxy, so when we have it, it replaces half the free estimate.
    const ran = cite.queriesRun || 0, hit = cite.queriesCited || 0;
    if (ran > 0) pOffsite = Math.round(pOffsite * 0.5) + Math.round(15 * (hit / ran));

    pOffsite = Math.min(30, pOffsite);
  } else if (cite && cite.free && (cite.free.checked || []).length >= 3) {
    // The paid query failed but the free signals answered. Score what we have and
    // cap it, rather than pretending we measured the whole pillar.
    offsiteMeasured = true;
    const fr = cite.free;
    if (fr.wikipedia) pOffsite += 5; else if (fr.wikidata) pOffsite += 3;
    if (fr.news >= 3) pOffsite += 4; else if (fr.news >= 1) pOffsite += 2;
    if (fr.reddit >= 3) pOffsite += 2; else if (fr.reddit >= 1) pOffsite += 1;
    if (verifiedProfiles >= 2) pOffsite += 3; else if (verifiedProfiles === 1) pOffsite += 1;
    pOffsite = Math.min(14, pOffsite);
  } else {
    // Nothing answered at all. Say so instead of inventing a low score.
    pOffsite = 0;
  }

  let pFresh = 0;                                    // out of 10
  if (daysSince != null) {
    if (daysSince <= 30) pFresh += 6; else if (daysSince <= 90) pFresh += 5;
    else if (daysSince <= 180) pFresh += 3; else if (daysSince <= 365) pFresh += 1;
  }
  if (sitemapUrls >= 25) pFresh += 2; else if (sitemapUrls >= 8) pFresh += 1;
  if (dates.length >= 5) pFresh += 2; else if (dates.length >= 1) pFresh += 1;
  pFresh = Math.min(10, pFresh);

  let pTechnical = 0;                                // out of 10
  if (hasSitemap) pTechnical += 3;
  if (hasCanonical) pTechnical += 2;
  if (hasMetaDesc) pTechnical += 2;
  if (hasTitle) pTechnical += 1;
  if (llmsPresent) pTechnical += 1;
  if (llmsUseful) pTechnical += 1;

  // Names kept for the three pillars the scan explains on screen.
  const access = pAccess, identity = pEntity, content = pContent;

  // If a normal browser is ALSO refused, we are the ones being blocked (datacenter IP, geo, WAF).
  // That is not an AI-visibility finding and must not be scored as one.
  const allBotsRefused = botNames.every(n => !bots[n].served);
  const inconclusive = !browserOk && allBotsRefused && !starBlocked;

  const total = inconclusive ? null
    : Math.max(0, Math.min(100, Math.round(pAccess + pEntity + pContent + pOffsite + pFresh + pTechnical)));
  const scoredOutOf = inconclusive ? null : (offsiteMeasured ? 100 : 70);
  // Grade on the scale we actually scored against, so a 62/70 is not read as a 62/100.
  const pct = inconclusive ? null : Math.round((total / scoredOutOf) * 100);
  const grade = inconclusive ? "?" : (pct >= 85 ? "A" : pct >= 70 ? "B" : pct >= 55 ? "C" : pct >= 40 ? "D" : "F");

  return { host: site.host, total, grade, inconclusive,
    inconclusiveReason: inconclusive ? "This site refused our request no matter who we said we were, including a normal browser. That usually means it blocks datacenter traffic, so we cannot tell what it does with AI crawlers from here." : null,
    access, identity, content,
    scoredOutOf, pct,
    pillars: { access: pAccess, entity: pEntity, content: pContent, offsite: pOffsite, freshness: pFresh, technical: pTechnical },
    pillarMax: { access: 20, entity: 15, content: 15, offsite: 30, freshness: 10, technical: 10 },
    daysSinceUpdate: daysSince, datedItems: dates.length, sitemapUrls,
    pagesTested: 1 + deepPages.length, pagesBlocked: deepBlocked.length,
    pagesUnknown: deepUnknown.length,
    deepPages: deepPages.map(x => ({ url: x.url, served: x.served, refused: x.refused,
                                     unknown: x.unknown, status: x.status, words: x.words })),
    hasCanonical, hasMetaDesc, hasTitle, answerShaped, questionHeads,
    profilesDeclared: profiles.length, profilesVerified: verifiedProfiles, sameAs: profiles,
    offsiteMeasured, citation: cite || null,
    corroboration: cite && cite.free ? cite.free : null,
    starBlocked, named: blockedBots, botBlocked: blockedBots.length > 0 && browserOk,
    bots, browserWords, words: botBest, renderGap,
    uniq, validSchema: valid, hasOrg, hasPerson, hasAddress,
    llmsPresent, llmsUseful, hasSitemap, reachable: browserOk || botBest > 0 };
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
        // Sonnet, not Opus: this is a web-search lookup with a short answer, and
        // it runs on every scan. Opus here was roughly five times the cost for no
        // gain in what we actually use, which is the list of cited sources.
        model: "claude-sonnet-5",
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

  const brandTok = site.host.replace(/^www\./, "").split(".")[0].toLowerCase();
  const clean = (t) => {
    let q = String(t || "").trim().replace(/^["'\s]+|["'\s.]+$/g, "").split("\n")[0];
    if (q.toLowerCase().includes(brandTok)) {
      q = q.replace(new RegExp(brandTok + "[a-z]*", "ig"), "").replace(/\s{2,}/g, " ")
           .replace(/\s+(is|are|was)\s+(a|an|the)\s+/i, " ").trim().replace(/^[,\-\s]+|[,\-\s]+$/g, "");
    }
    return (q.length > 12 && q.length < 130 && !q.toLowerCase().includes(brandTok)) ? q : "";
  };

  // Deliberately NOT Perplexity: it is the scarce, rate-limited resource doing the
  // actual citation work, and spending a call there to write a question is what
  // pushed it into 429s. Claude is cheap for this, and the fallback below is real.
  if (false && PERPLEXITY_API_KEY) {
    try {
      const ask = "Title: " + title + "\nDescription: " + desc + (city ? "\nCity: " + city : "") +
        "\n\nWrite the ONE question a customer would ask an AI assistant to find a business like this, " +
        "without knowing the company exists. Use the category and location, never the brand name. " +
        "Reply with the question only, under 90 characters.";
      const pr = await callPerplexity(ask);
      const t = pr && !pr.error ? (pr.choices?.[0]?.message?.content || "") : "";
      const q = clean(t);
      if (q) return { query: q, title, city, via: "perplexity" };
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
        // Haiku: this returns a single question under 90 characters. Opus was absurd here.
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 60, messages: [{ role: "user", content: prompt }] }),
      });
      if (r.ok) {
        const j = await r.json();
        const t = (j.content || []).filter(b => b.type === "text").map(b => b.text).join(" ").trim()
          .replace(/^["'\s]+|["'\s.]+$/g, "");
        const brand = site.host.replace(/^www\./, "").split(".")[0].toLowerCase();
        // If the model slipped the brand in, cut it out rather than discarding the
        // whole answer and falling back to string-slicing, which produced things
        // like "who are the best Specularis is an AI visibility company in Miami".
        let q = t;
        if (q && q.toLowerCase().includes(brand)) {
          q = q.replace(new RegExp(brand + "[a-z]*", "ig"), "").replace(/\s{2,}/g, " ")
               .replace(/\s+(is|are|was)\s+(a|an|the)\s+/i, " ").trim()
               .replace(/^[,\-\s]+|[,\-\s]+$/g, "");
        }
        if (q && q.length > 12 && q.length < 130 && !q.toLowerCase().includes(brand)) {
          return { query: q, title, city, via: t === q ? "claude" : "claude-debranded" };
        }
      }
    } catch (e) {}
  }

  // Deterministic fallback. Pull the category out of the copy and drop the brand,
  // rather than slicing a title and hoping. This runs whenever no model is reachable,
  // so it has to produce something a real buyer might actually type.
  const stop = /^(the|a|an|and|for|with|your|our|we|is|are|to|of|in|on|that|this|by|best|top|leading|premier)$/i;
  const text = (desc + " " + title).replace(/\s+/g, " ");
  const debranded = text.replace(new RegExp(brandTok + "[a-z]*", "ig"), " ").replace(/\s{2,}/g, " ");
  // longest run of words that reads like a category: "ai visibility agency", "real estate brokerage"
  const CATEGORY = /\b((?:[a-z][a-z&/-]{1,18}\s+){0,3}(agency|agencies|consultant|consultants|firm|company|studio|brokerage|broker|agent|agents|attorney|attorneys|lawyer|lawyers|dentist|clinic|contractor|marketing|services|service|software|platform|tool))\b/i;
  const m2 = debranded.match(CATEGORY);
  let category = m2 ? m2[1].trim() : "";
  category = category.split(/\s+/).filter(w => !stop.test(w)).join(" ").trim();
  if (category.length < 4) {
    category = debranded.split(/[|\u2013\u2014\-·,.]/).map(x => x.trim())
      .filter(x => x.length > 6 && x.length < 46 && !/^https?:/i.test(x))[0] || "";
    category = category.split(/\s+/).filter(w => !stop.test(w)).slice(0, 5).join(" ");
  }
  if (!category) category = "providers";
  // "the best AI visibility company in Miami" reads wrong; buyers type plurals.
  category = category.replace(/\b(company|agency|firm|studio|brokerage|consultancy)\b\s*$/i,
    (w) => ({ company: "companies", agency: "agencies", firm: "firms", studio: "studios",
              brokerage: "brokerages", consultancy: "consultancies" }[w.toLowerCase()] || w))
    .replace(/\b(consultant|attorney|lawyer|dentist|contractor|agent|broker|platform|tool|service)\b\s*$/i, "$1s");
  const q = ("who are the best " + category + (city ? " in " + city : "")).replace(/\s{2,}/g, " ").slice(0, 120);
  return { query: q, title, city, via: "deterministic" };
};

const runCitationFinder = async (query, domain) => {
  const site = normalizeUrl(domain);
  const bare = site ? site.host.replace(/^www\./, "") : String(domain).toLowerCase().replace(/^www\./, "");
  const q = String(query).slice(0, 300);
  // Perplexity first and usually alone: it returns the cited sources, which is all
  // this function consumes. Claude with web_search costs several times more and was
  // running on every single call for a second opinion we largely throw away.
  let pplx = await callPerplexity(q);
  let claude = null;
  // A 429 is "slow down", not "no". Waiting four seconds beats telling someone
  // their off-site score could not be measured.
  const rateLimited = (x) => x && x.error && /429/.test(String(x.error));
  if (rateLimited(pplx)) {
    await new Promise(r => setTimeout(r, 4000));
    pplx = await callPerplexity(q);
    if (rateLimited(pplx)) { await new Promise(r => setTimeout(r, 8000)); pplx = await callPerplexity(q); }
  }
  // Only pay for the expensive engine when the cheap one gave us nothing usable.
  const thin = !pplx || pplx.error ||
    (!Array.isArray(pplx.search_results) && !Array.isArray(pplx.citations)) ||
    ((pplx.search_results || pplx.citations || []).length < 3);
  if (thin && ANTHROPIC_API_KEY) claude = await callClaude(q);
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

app.get("/", (_req, res) => res.json({
  name: "specularis-ai-visibility-audit",
  status: "ok",
  mcp: "/mcp",
  // Whether the badge signing key is a real one or the public fallback baked into
  // the repo. A boolean only — never the value, and never a hash of it.
  badgeSecretSet: BADGE_SECRET !== "specularis-badge-dev-secret",
}));


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
    const fresh = String(req.query.fresh || "") === "1";
    const cite = await getCitationSignal(site, fresh);
    const r = await scoreSnapshot(site, cite);
    r.badge = badgeUrl(site.host.replace(/^www\./, ""), r.total, r.grade);
    // Pillars 4 and 5 are scored in the open but explained only after an email.
    // Strip the working: which query, which sources, what is missing technically.
    // Scores are public. The evidence behind them is what the email buys: the
    // buyer questions we asked, who got cited instead, the press and community
    // signals, and which pages we probed.
    delete r.citation;
    delete r.corroboration;
    delete r.sameAs;
    delete r.deepPages;
    delete r.datedItems;
    delete r.sitemapUrls;
    delete r.daysSinceUpdate;
    r.locked = {
      offsite: { measured: !!r.offsiteMeasured, score: r.pillars.offsite },
      technical: { score: r.pillars.technical },
    };
    delete r.hasCanonical; delete r.hasMetaDesc; delete r.hasTitle;
    if (r.inconclusive) return res.status(200).json({ inconclusive: true, host: r.host, error: r.inconclusiveReason });
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
    const { email, domain, name, role } = req.body || {};
    if (!email || !domain) return res.status(400).json({ error: "email and domain required" });
    const site = normalizeUrl(domain);
    if (!site) return res.status(400).json({ error: "bad domain" });
    const bare = site.host.replace(/^www\./, "");

    // The report is addressed to this name. Prefer what they typed; only fall back
    // to the email local part, tidied, so we never head a PDF with "adev.aarons".
    const tidy = String(email).split("@")[0].replace(/[._-]+/g, " ").trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const leadName = (name && String(name).trim()) || tidy || "there";

    // 1) kick off the full n8n audit so the PDF still lands in their inbox.
    //    The scan already scored this site; send those numbers along so the report
    //    explains them rather than grading it a second time and disagreeing.
    const citeForReport = await getCitationSignal(site).catch(() => null);
    const snap = await scoreSnapshot(site, citeForReport).catch(() => null);
    const authoritative = snap && !snap.inconclusive ? {
      total_score: snap.total,
      grade: snap.grade,
      scored_out_of: snap.scoredOutOf,
      offsite_measured: snap.offsiteMeasured,
      pillar_scores: {
        crawler_access: snap.pillars.access,
        entity_schema: snap.pillars.entity,
        content_citability: snap.pillars.content,
        off_site: snap.pillars.offsite,
        freshness: snap.pillars.freshness,
        technical: snap.pillars.technical,
      },
      pillar_max: snap.pillarMax,
    } : null;
    const auditPayload = { name: leadName, email, website_url: site.url,
                           role: role || "Other", scores: authoritative };
    triggerFullAudit(auditPayload).catch(() => {});

    if (!PERPLEXITY_API_KEY && !ANTHROPIC_API_KEY) {
      return res.json({ emailed: true, live: false, sentToN8n: auditPayload,
                        note: "Full report is on its way by email." });
    }

    // 2) the citation data is already measured and cached from the scan, so the
    //    page shows the same numbers the score was built from. Nothing moves.
    const c = citeForReport;
    res.json({
      emailed: true, live: !!(c && c.ok), sentToN8n: auditPayload,
      backing: c && c.ok ? {
        sources: c.brandSources, mentioning: c.brandMentions,
        recognised: c.recognised, engines: c.engines
      } : null,
      recommended: c && c.ok ? {
        query: c.query, sources: c.buyerSources, named: c.buyerCited,
        engines: c.engines, cited: c.cited.slice(0, 6)
      } : null,
      // the free corroboration signals behind the off-site score
      corroboration: c && c.free ? c.free : null,
      // every buyer question we asked and what came back
      queries: c && c.runs ? c.runs.map(r => ({ stage: r.stage, query: r.query,
        sources: r.sources, named: r.named, cited: (r.cited || []).slice(0, 6) })) : [],
      // who keeps getting cited instead, across the whole set
      competitors: c && c.runs ? (() => {
        const f = new Map();
        c.runs.forEach(run => (run.cited || []).forEach(x => {
          if (x.you) return; f.set(x.host, (f.get(x.host) || 0) + 1);
        }));
        return [...f.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
          .map(([host, n]) => ({ host, citedIn: n, ofQueries: c.runs.length }));
      })() : [],
      freshness: snap ? { daysSinceUpdate: snap.daysSinceUpdate, datedItems: snap.datedItems,
                          sitemapUrls: snap.sitemapUrls } : null,
      pages: snap && snap.deepPages ? snap.deepPages : [],
      // pillar 5's working, so the page can explain the technical score too
      technical: snap ? {
        score: snap.pillars.technical,
        sitemap: snap.hasSitemap, canonical: snap.hasCanonical,
        metaDescription: snap.hasMetaDesc, title: snap.hasTitle,
        llms: snap.llmsPresent, llmsUseful: snap.llmsUseful,
      } : null
    });
  } catch (e) { res.status(500).json({ error: "internal error" }); }
});


// ---- Badge: a frozen, signed snapshot. Score is in the URL and cannot be forged. ----
const badgeSign = (host, score, grade, dt) =>
  createHmac("sha256", BADGE_SECRET).update([host, score, grade, dt].join("|")).digest("base64url").slice(0, 16);

const badgeUrl = (host, score, grade) => {
  const dt = new Date().toISOString().slice(0, 7); // YYYY-MM, the "as of" stamp
  const sig = badgeSign(host, score, grade, dt);
  return `/badge.svg?d=${encodeURIComponent(host)}&s=${score}&g=${grade}&t=${dt}&k=${sig}`;
};

const badgeSvg = (host, score, grade, dt) => {
  const scored = Number.isFinite(score);
  const col = !scored ? "#5b6167" : score >= 85 ? "#2f9e5e" : score >= 60 ? "#e0952f" : "#b3402c";
  const w = 268, h = 66;
  const when = dt ? String(dt) : "";
  const label = scored ? `Site readiness ${score} of 100 for ${host}` : `Site readiness could not be measured for ${host}`;
  const value = scored
    ? `${score}<tspan fill="#5b6167" font-size="14"> / 100</tspan> <tspan fill="${col}" font-size="20">${grade}</tspan>`
    : `<tspan font-size="17">not measurable</tspan>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">
  <rect width="${w}" height="${h}" rx="6" fill="#111214"/>
  <rect x="0" y="0" width="4" height="${h}" rx="2" fill="${col}"/>
  <text x="20" y="24" fill="#8c9298" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="9" letter-spacing="2.2">SITE READINESS</text>
  <text x="20" y="50" fill="#ffffff" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="26" font-weight="700" letter-spacing="-0.8">${value}</text>
  <text x="${w - 20}" y="24" text-anchor="end" fill="#5b6167" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="9" letter-spacing="1.6">SPECULARIS</text>
  <text x="${w - 20}" y="43" text-anchor="end" fill="#8c9298" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="9.5">${String(host).slice(0, 28)}</text>
  <text x="${w - 20}" y="56" text-anchor="end" fill="#5b6167" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="8.5">as of ${when}</text>
</svg>`;
};

app.get("/badge.svg", async (req, res) => {
  res.set("Content-Type", "image/svg+xml").set("Cache-Control", "public, max-age=86400, immutable");
  try {
    const host = String(req.query.d || "").toLowerCase().replace(/^www\./, "");
    const score = parseInt(req.query.s, 10), grade = String(req.query.g || ""), dt = String(req.query.t || ""), k = String(req.query.k || "");
    // signed snapshot: frozen forever, verifiable, not re-scanned
    if (host && Number.isFinite(score) && grade && dt && k && k === badgeSign(host, score, grade, dt)) {
      return res.send(badgeSvg(host, score, grade, dt));
    }
    // unsigned request: scan live so the badge is never a lie, but do not pretend it is a snapshot
    const site = normalizeUrl(host || String(req.query.d || ""));
    if (!site) return res.send(badgeSvg("specularis", 0, "?", ""));
    const r = await scoreSnapshot(site);
    res.set("Cache-Control", "public, max-age=3600");
    // A site that refused us outright has no score. Say so on the badge rather
    // than rendering "null of 100", which reads as broken and scores nobody.
    if (r.inconclusive || !Number.isFinite(r.total)) {
      return res.send(badgeSvg(site.host, null, "?", ""));
    }
    return res.send(badgeSvg(site.host, r.total, r.grade, new Date().toISOString().slice(0, 7)));
  } catch (e) {
    return res.send(badgeSvg("unavailable", 0, "?", ""));
  }
});


// ---- Benchmarks: well-known sites, scored with the same scan, cached 24h ----
// We deliberately do NOT rank ourselves here. This list scores three on-site
// checks with a ceiling we built our own site to hit, so our 100 would top the
// table while our full five-pillar audit puts the same domain at 77. Publishing
// the flattering number next to everyone else's is not a benchmark, it is an ad.
// The honest self-score is stated in the note under the table instead.
const BENCH_LIST = [
  // Real estate — the niche the metro studies cover
  { d: "compass.com", cat: "Real estate" },
  { d: "redfin.com", cat: "Real estate" },
  { d: "realtor.com", cat: "Real estate" },
  { d: "remax.com", cat: "Real estate" },
  { d: "coldwellbanker.com", cat: "Real estate" },
  { d: "century21.com", cat: "Real estate" },
  { d: "sothebysrealty.com", cat: "Real estate" },
  { d: "douglaselliman.com", cat: "Real estate" },
  { d: "corcoran.com", cat: "Real estate" },
  { d: "kw.com", cat: "Real estate" },

  // Software and tools
  { d: "stripe.com", cat: "Software" },
  { d: "notion.so", cat: "Software" },
  { d: "shopify.com", cat: "Software" },
  { d: "hubspot.com", cat: "Software" },
  { d: "squarespace.com", cat: "Software" },
  { d: "salesforce.com", cat: "Software" },
  { d: "slack.com", cat: "Software" },
  { d: "dropbox.com", cat: "Software" },
  { d: "atlassian.com", cat: "Software" },
  { d: "figma.com", cat: "Software" },
  { d: "canva.com", cat: "Software" },
  { d: "mailchimp.com", cat: "Software" },
  { d: "webflow.com", cat: "Software" },
  { d: "wix.com", cat: "Software" },
  { d: "asana.com", cat: "Software" },
  { d: "intercom.com", cat: "Software" },
  { d: "twilio.com", cat: "Software" },
  { d: "github.com", cat: "Software" },
  { d: "zendesk.com", cat: "Software" },
  { d: "calendly.com", cat: "Software" },

  // Publishers and reference
  { d: "wikipedia.org", cat: "Reference" },
  { d: "nytimes.com", cat: "Publishing" },
  { d: "forbes.com", cat: "Publishing" },
  { d: "techcrunch.com", cat: "Publishing" },
  { d: "theverge.com", cat: "Publishing" },

  // Consumer and commerce
  { d: "etsy.com", cat: "Commerce" },
  { d: "wayfair.com", cat: "Commerce" },
  { d: "chewy.com", cat: "Commerce" },
  { d: "doordash.com", cat: "Commerce" },
  { d: "expedia.com", cat: "Travel" },
  { d: "booking.com", cat: "Travel" },
  { d: "target.com", cat: "Commerce" },
  { d: "bestbuy.com", cat: "Commerce" },

  // Finance
  { d: "paypal.com", cat: "Finance" },
  { d: "coinbase.com", cat: "Finance" },
  { d: "robinhood.com", cat: "Finance" },
  { d: "fidelity.com", cat: "Finance" },
];
const BENCH = { at: 0, rows: [], skipped: 0, busy: false, progress: 0, startedAt: 0 };

// Small pool: polite to the targets, but 50 sites sequentially takes too long to warm.
const mapPool = async (items, n, fn) => {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
};

const refreshBenchmarks = async () => {
  if (BENCH.busy) return;
  BENCH.busy = true;
  try {
    BENCH.startedAt = Date.now(); BENCH.progress = 0;
    // Concurrency 1: each site costs two calls to a rate-limited search API, and
    // anything higher turns the whole rebuild into a 429 storm that never lands.
    const settled = await mapPool(BENCH_LIST, 1, async (entry) => {
      try {
        const site = normalizeUrl(entry.d);
        if (!site) return null;
        // Leave headroom for real visitors: the rebuild is never urgent.
        await new Promise(r => setTimeout(r, 4000));
        const cite = await getCitationSignal(site);
        const r = await scoreSnapshot(site, cite);
        BENCH.progress++;
        if (r.inconclusive) return null;  // we were blocked, not the AI. Not a finding, do not publish.
        return {
          host: site.host.replace(/^www\./, ""),
          cat: entry.cat,
          us: !!entry.us,
          total: r.total,
          grade: r.grade,
          blocked: (r.named || []).length > 0 || r.starBlocked,
        };
      } catch (e) { return null; }
    });
    const rows = settled.filter(Boolean);
    if (rows.length) {
      // Honest sort, every row on the same footing. No pinning.
      BENCH.rows = rows.sort((a, b) => b.total - a.total || a.host.localeCompare(b.host));
      BENCH.skipped = BENCH_LIST.length - rows.length;
      BENCH.at = Date.now();
    }
  } finally { BENCH.busy = false; }
};

// Weekly, plus once shortly after boot. Never on a page view.
setTimeout(() => { refreshBenchmarks().catch(() => {}); }, 20000);
setInterval(() => { refreshBenchmarks().catch(() => {}); }, 30 * 86400000);  // monthly: a rebuild is ~94 engine calls

app.get("/api/benchmarks", (_req, res) => {
  try {
    // Deliberately does NOT trigger a rebuild. The refresh is a scheduled job, and
    // letting a page view start one meant a visitor's own scan then queued behind
    // 47 benchmark sites on the same rate-limited API.
    const scores = BENCH.rows.map(r => r.total).sort((a, b) => a - b);
    const med = scores.length ? scores[Math.floor(scores.length / 2)] : null;
    res.set("Cache-Control", "public, max-age=3600");
    res.json({
      rows: BENCH.rows,
      median: med,
      scanned: BENCH.rows.length,
      skipped: BENCH.skipped,
      building: !BENCH.rows.length,
      progress: BENCH.busy ? BENCH.progress + " of " + BENCH_LIST.length : null,
      checked: BENCH.at ? new Date(BENCH.at).toISOString().slice(0, 10) : null,
    });
  } catch (e) { res.status(500).json({ rows: [] }); }
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

// Deep audit API — key-gated, expensive, for prospect meetings and signing baselines
app.get("/api/deep-scan", async (req, res) => {
  if (DEEP_KEY && req.query.k !== DEEP_KEY) return res.status(401).json({ error: "Unauthorized" });
  const site = normalizeUrl(String(req.query.d || ""));
  if (!site) return res.status(400).json({ error: "Give me a domain" });
  try {
    const bare = site.host.replace(/^www\./, "");

    // 1) the normal five-signal scan, plus a forced-fresh citation read
    const cite = await getCitationSignal(site, true, true, true);   // paid + wide: ten questions
    const base = await scoreSnapshot(site, cite);
    if (base.inconclusive) return res.json({ inconclusive: true, host: bare, error: base.inconclusiveReason });

    // 2) does the whole site let crawlers in, or only the front door?
    const urls = await pagesFromSitemap(site, 25);   // deep: real coverage, not a spot check
    const pages = [];
    for (const u of urls) { pages.push(await probePage(u)); }   // sequential: polite
    const blockedPages = pages.filter(p => !p.served);
    const thinPages = pages.filter(p => p.thin);

    // 3) reuse the query set the scan already ran and paid for, rather than
    //    re-querying the same engine for the same answers.
    const runs = (cite && cite.runs) ? cite.runs.slice() : [];

    // 4) who keeps getting cited instead — this is the target list
    const freq = new Map();
    runs.forEach(run => run.cited.forEach(c => {
      if (c.you) return;
      freq.set(c.host, (freq.get(c.host) || 0) + 1);
    }));
    const competitors = [...freq.entries()].sort((a, b) => b[1] - a[1])
      .slice(0, 20).map(([host, n]) => ({
        host, citedIn: n, ofQueries: runs.length,
        type: classifySource("https://" + host),
        joinable: isJoinable(host),
      }));
    // The two lists a prospect actually needs: places to get into, and rivals to outrank.
    const targets = competitors.filter(c => c.joinable);
    const rivals = competitors.filter(c => !c.joinable);

    const citedQueries = runs.filter(r => r.named > 0).length;

    res.json({
      host: bare,
      measuredAt: new Date().toISOString(),
      proxy: PROXY_URL ? "residential" : "datacenter",
      total: base.total, grade: base.grade,
      pillars: base.pillars, pillarMax: base.pillarMax,
      siteWide: {
        pagesTested: pages.length,
        pagesBlocked: blockedPages.length,
        pagesThin: thinPages.length,
        homepageOnlyWouldHaveMissed: blockedPages.length > 0 && pages[0] && pages[0].served,
        pages,
      },
      citation: { queriesTested: runs.length, queriesWhereCited: citedQueries, runs },
      competitors, targets, rivals,
      byStage: (() => {
        const g = {};
        runs.forEach(r => { const k = r.stage || "other";
          g[k] = g[k] || { tested: 0, cited: 0 }; g[k].tested++; if (r.named > 0) g[k].cited++; });
        return g;
      })(),
      freshness: { daysSinceUpdate: base.daysSinceUpdate, datedItems: base.datedItems, sitemapUrls: base.sitemapUrls },
    });
  } catch (e) { res.status(500).json({ error: "deep scan failed: " + String(e).slice(0, 160) }); }
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

setTimeout(() => { refreshBenchmarks().catch(() => {}); }, 8000);
app.listen(PORT, () => console.log(`Specularis MCP server listening on :${PORT} (POST /mcp)`));
