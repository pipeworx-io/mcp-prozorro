# mcp-prozorro

ProZorro MCP — Ukraine government procurement (keyless).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Prozorro data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
