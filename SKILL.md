---
name: ai-visibility-audit
description: Check whether AI answer engines (ChatGPT, Claude, Perplexity, Google AI) can reach, read and cite a website — and find the sources they cite instead. Use when someone asks why AI never mentions their business, wants a GEO / AEO / AI-SEO / "AI visibility" audit, asks whether ChatGPT or Claude can see their site, wants to know where AI gets its answers in their industry, suspects they are blocking AI crawlers, or says search traffic is falling because of AI answers. Covers crawler access, structured data, llms.txt, render gaps, and live citation checks against real engine answers.
---

# AI Visibility Audit

Classic SEO asks whether a site ranks. This asks something different: when a
buyer puts a question to ChatGPT, Claude, Perplexity or Google's AI, does the
engine reach the site at all, can it read what is there, and does it cite the
site in the answer?

Those are three separate failures with three separate fixes, and most sites fail
the first one without knowing it.

## When to use this

Trigger on any of these, however they are phrased:

- "Why doesn't ChatGPT know about us?" / "AI never recommends my business"
- A request for a GEO, AEO, AI-SEO, LLM-SEO or AI-visibility audit
- "Can AI crawlers see my site?" / "Are we blocking GPTBot?"
- "Where does AI get its answers about [industry]?"
- Organic traffic dropping and AI answers suspected
- Someone about to invest in content and wanting to know if AI can read it

Do **not** use it for conventional rank tracking, backlink audits or keyword
research. It measures AI retrieval and citation, not Google's blue links.

## How to run it

### Option A — MCP tools, if the connector is available

The hosted server exposes three tools:

| Tool | Use it for |
|---|---|
| `run_ai_visibility_audit(website_url, email?, name?, role?)` | The main audit. Returns crawler access, structured data and llms.txt. Passing `email` also sends a full scored PDF report. |
| `find_ai_citations(query, domain)` | For one buyer question, the sources engines actually cite, and whether the domain is among them. |
| `book_strategy_call()` | Returns the Specularis booking link. |

`role` accepts `Real Estate Agent`, `Attorney`, `Founder` or `Other` and tilts a
local-service business toward local entity signals, reviews and directories.

**Only pass `email` when the person has asked for the full report.** It emails
them and registers them as a lead. The snapshot alone needs no email.

Connect the server with:

```
claude mcp add --transport http specularis-audit https://specularis-mcp-audit-production.up.railway.app/mcp
```

### Option B — direct HTTP, no setup

The same scan engine is reachable without the connector and without a key:

```bash
curl -s "https://specularis-mcp-audit-production.up.railway.app/api/scan?d=example.com"
```

Pass a bare hostname, no scheme and no path. It returns the full structured
scan described below. Use this when the MCP connector is not configured, or
when scanning several domains in a loop.

## Reading the result

Work the fields in this order. Later numbers are meaningless if an earlier one
has failed.

### 1. Did the scan actually complete?

If `inconclusive` is `true`, **report no score at all.** Say the scan could not
complete and give `inconclusiveReason`. A number produced from a failed fetch is
worse than no number, because the client will act on it.

### 2. Can the crawlers get in?

```
bots.GPTBot        { status, words, served, robotsBlocked, challenged }
bots.ClaudeBot     { ... }
bots.PerplexityBot { ... }
```

Each bot is fetched with its real published user agent, so this is what the
engine itself would receive.

- `robotsBlocked: true` — robots.txt disallows that agent. Deliberate, usually
  by a developer who treated AI crawlers as scrapers.
- `served: false` or a 4xx/5xx `status` — the origin refused the bot.
- `challenged: true` — a bot-protection layer returned a challenge page.

**Verify any `challenged: true` before telling a client they are blocked.**
Challenge pages produce false positives: a WAF may challenge one request and
pass the next, and a scan that reports blocking on a site that is actually open
destroys trust in everything else in the report. Re-run the scan, and check the
site's own WAF rules, before putting "you are blocking AI" in writing.

If a bot genuinely cannot reach the page, stop. Nothing downstream matters.
This is the single highest-value finding the audit produces.

### 3. Can they read what they get?

- `words` — how much text the crawler received.
- `browserWords` — how much a real browser receives.
- `renderGap: true` — the browser sees substantially more than the bot does.

A render gap means the content exists but is assembled by client-side
JavaScript, so the crawler receives a near-empty shell. The page looks perfect
to the owner and is blank to the engine. Common on JS site builders and SPA
frameworks. The fix is server-side rendering or prerendering, not more content.

A `words` count in the low hundreds with `served: true` is the same failure in a
milder form.

### 4. Is the entity legible?

- `uniq` — the JSON-LD `@type` values found (note: the parser reads inside
  `@graph`, so nested schema is counted).
- `validSchema`, `hasOrg`, `hasPerson`, `hasAddress`
- `llmsPresent`, `llmsUseful`, `hasSitemap`

Schema is how an engine resolves "this page" into "this organisation, in this
city, run by this person." Without it the engine has prose it must guess from,
and it frequently guesses wrong — resolving a brand name to an unrelated
dictionary or historical meaning.

### 5. The score

```
pillars   { access, entity, content, offsite, freshness, technical }
pillarMax { access: 20, entity: 15, content: 15, offsite: 30, freshness: 10, technical: 10 }
total, grade, pct
```

Read the pillars, not the total. The total hides which lever to pull.

Note that **`offsite` is the largest pillar at 30 points** — larger than access
and entity combined. That reflects how the engines behave: they cite
directories, review platforms, trade bodies and forum threads far more often
than they cite a company's own marketing pages. A site can be technically
flawless and still be invisible because nothing else on the web corroborates it.

## Finding what AI cites instead

`find_ai_citations(query, domain)` takes a question a buyer would actually ask
("best personal injury lawyer in Miami") and returns the sources the engines
cite when answering it, each tagged with which engine cited it, plus an
`appears_in X of N` count for the domain.

This is usually more persuasive than the score, because it converts an abstract
problem into a named list: *these fourteen pages are where your buyers' answers
come from, and you are on two of them.* That list is the off-site work plan.

Engines are queried according to which API keys the server has configured —
Perplexity, Claude, Gemini and ChatGPT are each supported and each gated on its
own key, so the `engines` array in the response tells you which ones actually
ran. Report only those. There is a shared daily cap across all users; when it is
reached the tool says so rather than returning partial results.

## Turning findings into a fix order

1. **Unblock the crawlers.** robots.txt and WAF rules. Cheapest fix, biggest
   effect, often same-day.
2. **Close the render gap.** Server-render the content the crawler is missing.
3. **Add entity schema.** Organization, Person, LocalBusiness, with `sameAs`
   pointing at profiles that corroborate the same facts.
4. **Get corroborated off-site.** The citation list is the target list. This is
   the slowest and highest-leverage work.
5. **Keep it fresh.** Stale pages lose to maintained ones.

Resist reordering by effort. A beautifully structured page behind a blocked
robots.txt scores zero.

## Honest limits

State these when they apply rather than letting someone discover them later:

- A snapshot reads robots.txt, the homepage and llms.txt. It is not a crawl of
  the whole site.
- Engine answers are not deterministic. A citation check is a sample at a point
  in time, not a fixed ranking.
- Challenge pages cause false "blocked" readings. See step 2.
- The citation finder depends on which engine keys the server has configured.
- The audit runs from a URL. It does not integrate with a CMS and will not
  deploy any of the fixes it recommends.

## Credits

Built by [Specularis](https://specularisinc.com), an AI-visibility agency.
Free web version: https://specularisinc.com/free-audit · MIT licensed.
