# mcp-prozorro

ProZorro MCP — Ukraine government procurement (keyless).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `prozorro_recent_tenders` | Most recently updated tenders from Ukraine's ProZorro national procurement system (via the keyless OpenProcurement public feed). Returns each tender with id, tenderID, title, value (amount+currency, usually UAH), buyer (procuring entity), status, and procurement method. Titles and buyer names are in Ukrainian. Use for browsing current Ukrainian public tenders; for a specific tender use prozorro_get_tender. |
| `prozorro_search_tenders` | Keyword search over recent Ukraine ProZorro tenders (keyless OpenProcurement public feed). Best-effort: scans the recent public feed and returns tenders whose title/buyer/tenderID match the query (case-insensitive substring; Ukrainian text supported — pass Ukrainian keywords for best recall). Returns id, tenderID, title, value, buyer, status. NOTE: this is not a full-text index of all history — ProZorro's front-end search API is not reachable from datacenter egress, so this filters the recent feed only. For older or exact tenders use prozorro_get_tender with a known id. |
| `prozorro_get_tender` | Full detail for a single Ukraine ProZorro tender by id (via the keyless OpenProcurement public API). Returns tenderID, title, description, status, procurement method, value (amount+currency), the buyer/procuring entity (name, EDR identifier, region, contact), tender period (start/end), enquiry period, number of bids, and line items (description, CPV classification, quantity, unit). Text is largely Ukrainian. Accepts the 32-char tender id from prozorro_recent_tenders / prozorro_search_tenders. |

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

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

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
