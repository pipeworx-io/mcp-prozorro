# mcp-prozorro

ProZorro MCP — Ukraine government procurement (keyless).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1715+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

| Tool | Description |
|------|-------------|
| `prozorro_recent_tenders` | Most recently updated tenders from Ukraine's ProZorro national procurement system (via the keyless OpenProcurement public feed). Returns each tender with id, tenderID, title, value (amount+currency, usually UAH), buyer (procuring entity), status, and procurement method. Titles and buyer names are in Ukrainian. Use for browsing current Ukrainian public tenders; for a specific tender use prozorro_get_tender. |
| `prozorro_search_tenders` | Full-text search over ALL Ukraine ProZorro tenders back to 2015 (keyless). Searches ProZorro's own analyzed index, so Ukrainian queries stem correctly ("школа" also matches "школи", "шкільний") — pass Ukrainian keywords for best recall. Filter by buyer EDRPOU, by SUPPLIER/bidder EDRPOU (`tenderer` — this is the one for supplier due diligence: every tender a company has bid on or won), CPV code, status, value range, and date. Returns tenderID, title, value, buyer name + EDRPOU + region, status, and an `id` field (internal 32-hex id) that is NULL unless `resolve_ids` is passed — the search index itself never carries it (verified live); prozorro_get_tender with just the tenderID now attempts the same resolution automatically, so you usually don't need `resolve_ids` here. Use prozorro_get_tender for the full detail of one result. |
| `prozorro_search_organizations` | Resolve a Ukrainian company or public buyer NAME to its EDRPOU code, using ProZorro's organization index (keyless). This is the entry point for supplier due diligence: a user knows the company's name, but prozorro_search_tenders filters by EDRPOU — call this first, then pass the returned `edrpou` as `tenderer` (supplier side) or `buyer` to get that company's full tender history. |
| `prozorro_get_tender` | Full detail for a single Ukraine ProZorro tender by id (via the keyless OpenProcurement public API). Returns tenderID, title, description, status, procurementMethod + procurementMethodType (raw OCDS fields — broad method vs ProZorro's specific type, e.g. aboveThresholdUA/aboveThresholdEU), tender_value (the ORIGINAL ASKING PRICE — not money spent), the buyer/procuring entity (name, EDR identifier, region, contact), tender period (start/end), enquiry period, number of bids, line items (description, CPV classification, quantity, unit, relatedLot), `lots` (id/title/status/value, when the tender is lotted), and the OCDS award/contract stage: `award` (operative award: status, date, value, winning supplier, lotID, bid_id — null if none) plus the full `awards` history (each with the FULL `suppliers[]` array — name + identifier scheme/id — alongside the single-supplier `supplier` field kept for backward compatibility), and `contract` (signed contract value/date). An `interpretation` line states plainly whether the tender_value was ever actually spent. Pass `raw:true` to also get the complete, unshaped upstream OCDS tender object under `raw`, for any field not shaped above. Text is largely Ukrainian. Accepts the internal 32-char tender id OR a human tenderID ("UA-2026-09-20-000012-a") — for a tenderID this now tries to resolve the internal id by scanning the most-recently-modified feed records first (cheap, usually one call for anything modified in the last few hours) and returns FULL detail when that succeeds; it falls back to the search index's summary (detail_available:false, no awards) only when the tender wasn't modified recently enough to be found that way. |

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

Both URLs reach the same gateway and the same 1715+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/prozorro_recent_tenders \
  -H 'Content-Type: application/json' \
  -d '{"limit":20}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/prozorro_recent_tenders`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

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

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-prozorro
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

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
