# mcp-prozorro

ProZorro MCP — Ukraine government procurement (keyless).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1679+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `prozorro_recent_tenders` | Most recently updated tenders from Ukraine's ProZorro national procurement system (via the keyless OpenProcurement public feed). Returns each tender with id, tenderID, title, value (amount+currency, usually UAH), buyer (procuring entity), status, and procurement method. Titles and buyer names are in Ukrainian. Use for browsing current Ukrainian public tenders; for a specific tender use prozorro_get_tender. |
| `prozorro_search_tenders` | Full-text search over ALL Ukraine ProZorro tenders back to 2015 (keyless). Searches ProZorro's own analyzed index, so Ukrainian queries stem correctly ("школа" also matches "школи", "шкільний") — pass Ukrainian keywords for best recall. Filter by buyer EDRPOU, by SUPPLIER/bidder EDRPOU (`tenderer` — this is the one for supplier due diligence: every tender a company has bid on or won), CPV code, status, value range, and date. Returns tenderID, title, value, buyer name + EDRPOU + region, and status, plus a total match count. Use prozorro_get_tender for the full detail of one result. |
| `prozorro_search_organizations` | Resolve a Ukrainian company or public buyer NAME to its EDRPOU code, using ProZorro's organization index (keyless). This is the entry point for supplier due diligence: a user knows the company's name, but prozorro_search_tenders filters by EDRPOU — call this first, then pass the returned `edrpou` as `tenderer` (supplier side) or `buyer` to get that company's full tender history. |
| `prozorro_get_tender` | Full detail for a single Ukraine ProZorro tender by id (via the keyless OpenProcurement public API). Returns tenderID, title, description, status, procurement method, tender_value (the ORIGINAL ASKING PRICE — not money spent), the buyer/procuring entity (name, EDR identifier, region, contact), tender period (start/end), enquiry period, number of bids, line items (description, CPV classification, quantity, unit), and the OCDS award/contract stage: `award` (operative award: status, date, value, winning supplier — null if none) plus the full `awards` history, and `contract` (signed contract value/date). An `interpretation` line states plainly whether the tender_value was ever actually spent — a cancelled or unsuccessful tender still carries a populated tender_value even though zero money moved. Text is largely Ukrainian. Accepts the 32-char tender id from prozorro_recent_tenders / prozorro_search_tenders. |

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

Both URLs reach the same gateway and the same 1679+ data sources. The
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
