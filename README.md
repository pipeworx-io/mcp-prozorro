# @pipeworx/prozorro

Ukraine's national public procurement system — tender search, full OCDS
detail (buyer, value, awards, contracts), and best-effort resolution for
historical tenders too old for the live feed to reach directly.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1856+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

- `prozorro_recent_tenders(limit?)` — the most recently updated tenders from the live change-feed.
- `prozorro_search_tenders(query?, tenderer?, buyer?, cpv?, status?, date_from?, date_to?, sort_by?, order?, page?, resolve_ids?)` — full-text search over all tenders back to 2015, keyless. A date range ALONE (no other filter) is a valid call and is the only live way to browse tenders by historical date — e.g. `date_from:"2015-03-01", date_to:"2015-03-10"`.
- `prozorro_search_organizations(name, role?)` — resolve a company/buyer name to its EDRPOU code.
- `prozorro_get_tender(id, raw?)` — full detail for one tender (title, value, buyer, periods, line items, awards, contract). Fast for an internal 32-hex id; bounded for a human tenderID (recently-modified window only — see `prozorro_historical_release` for a second attempt on an older one).
- `prozorro_get_contract(id, as_of?)` — the authoritative post-award contract record(s), since a tender's own embedded copy goes stale after signing.
- `prozorro_historical_release(id)` — for a human tenderID `prozorro_get_tender` can't resolve, tries a second live strategy (see Notes) before honestly reporting a search-index summary only.

Every response is classified (`not_found` / `upstream_throttled` / `upstream_down` / `user_error`) on an upstream failure, and a tender id that can't be resolved to full detail always carries `detail_available: false` with whatever summary fields ARE known — never a bare empty object.

## Auth

Keyless.

## Data sources

- ProZorro / OpenProcurement, Ukraine public procurement register — tender and contract detail, and the full-text search index.

## Notes for the next person

**The 60 req/min search budget is shared** between `prozorro_search_tenders` and `prozorro_search_organizations` on the same upstream host — see the file header for the KV cache-aside and bounded retry that absorb it.

**`prozorro_get_tender`'s tenderID→internal-id resolution is bounded to recently-modified tenders** (it scans the change-feed, which has no date-seek for an arbitrary bulk walk). An OLD tenderID — one found via `prozorro_search_tenders`'s date-range browsing, say — comes back `detail_available:false` from that tool.

**`prozorro_historical_release` adds a SECOND, independent live attempt for exactly that case, with no stored data at all (fleet #3244):** it seeks the same feed to the date the tenderID ITSELF ENCODES ("UA-2015-02-16-..." → search from 2015-02-16) and scans forward a bounded distance for an exact match. This works when the tender's last modification happened reasonably soon after that date, and misses when a later amendment moved it far down the feed — there is no live way to know that drift in advance, so this is a genuinely unreliable-by-design second attempt, cheap when it hits, honestly reported as a miss when it doesn't (`detail_available: false`, never a crash, never empty). A CONSTRUCTED feed offset — not one the API itself handed back — in the shape `<unix_ts>.0.1.<32-char suffix>` IS honoured as a real date seek (verified live); a garbage-shaped offset is rejected outright (HTTP 400). This capability was found and used here specifically because it does NOT require persisting anything.

**A date filter on `prozorro_search_tenders` drops any matching record with no tender period** — combined with a keyword/tenderer/buyer it can hide real matches; used alone it is reliable (verified live: a bare 10-day 2015 window returns a correctly-dated, narrow result set, not the unfiltered corpus — the upstream's own silent-ignore trap applies to a MISSHAPED param, not a present one).

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "prozorro": {
      "url": "https://gateway.pipeworx.io/prozorro/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/prozorro/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1856+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/prozorro_recent_tenders \
  -H 'Content-Type: application/json' \
  -d '{"limit":20}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/prozorro_recent_tenders`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Run it from npm

`@pipeworx/mcp-prozorro` is a local stdio bridge to the Pipeworx gateway: your MCP client
starts it with `npx`, and it forwards every call to the same
`https://gateway.pipeworx.io/prozorro/mcp` endpoint shown above. It needs network access;
there is no offline mode.

```json
{
  "mcpServers": {
    "prozorro": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-prozorro"]
    }
  }
}
```

Without a key it calls anonymously, capped at 50 calls a day. A free account
raises that to 200 a day: get a key at https://pipeworx.io/signup and add
`"env": { "PIPEWORX_API_KEY": "<your key>" }` to the server entry.
The key is sent as a Bearer token, the same way a hosted connection sends it,
so calls are metered and billed exactly as they are there.

It lists **only** this pack's tools by default. Set `PIPEWORX_META_TOOLS=1` to
also list `ask_pipeworx` and the other gateway-wide tools.

Behind an HTTPS proxy: Node's built-in `fetch` does not read `HTTPS_PROXY` by
default. Newer Node releases honour it when `NODE_USE_ENV_PROXY=1` is set; check
your Node version's documentation.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Prozorro data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
