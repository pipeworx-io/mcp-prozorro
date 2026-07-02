interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * ProZorro MCP — Ukraine government procurement (keyless).
 *
 * Wraps the public OpenProcurement/ProZorro API at
 * https://public.api.openprocurement.org/api/2.5. This is the open, no-auth
 * public feed behind ProZorro (prozorro.gov.ua), Ukraine's national e-procurement
 * system. Covers the paginated public change-feed of tenders and full tender
 * detail (title, value, procuring entity/buyer, status, periods, line items).
 *
 * Tender text is largely Ukrainian (titles, buyer names, item descriptions);
 * field LABELS are kept in English. Monetary values are usually in UAH.
 *
 * Note on search: ProZorro's front-end CDB full-text search
 * (prozorro.gov.ua/api/search/tenders) is not reachable from datacenter/CF
 * egress (returns 400/405). So prozorro_search_tenders does a best-effort
 * keyword filter over the recent public feed rather than a true full-text query.
 * For pinpoint lookups use prozorro_get_tender with a known tender id.
 *
 * All tools return shaped, LLM-friendly objects (not raw API passthrough) and
 * never throw — fetch/parse failures resolve to { error }.
 */


const BASE = 'https://public.api.openprocurement.org/api/2.5';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'prozorro_recent_tenders',
    description:
      "Most recently updated tenders from Ukraine's ProZorro national procurement system (via the keyless OpenProcurement public feed). Returns each tender with id, tenderID, title, value (amount+currency, usually UAH), buyer (procuring entity), status, and procurement method. Titles and buyer names are in Ukrainian. Use for browsing current Ukrainian public tenders; for a specific tender use prozorro_get_tender.",
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: ['number', 'string'], description: 'How many recent tenders to return (1-50). Default 20.' },
      },
    },
  },
  {
    name: 'prozorro_search_tenders',
    description:
      "Keyword search over recent Ukraine ProZorro tenders (keyless OpenProcurement public feed). Best-effort: scans the recent public feed and returns tenders whose title/buyer/tenderID match the query (case-insensitive substring; Ukrainian text supported — pass Ukrainian keywords for best recall). Returns id, tenderID, title, value, buyer, status. NOTE: this is not a full-text index of all history — ProZorro's front-end search API is not reachable from datacenter egress, so this filters the recent feed only. For older or exact tenders use prozorro_get_tender with a known id.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword(s) to match against title/buyer/tenderID. Ukrainian recommended (e.g. "комп\'ютер", "школа"). Matches by substring.' },
        scan: { type: ['number', 'string'], description: 'How many recent tenders to scan (1-200). Default 100. Higher = deeper but slower.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'prozorro_get_tender',
    description:
      "Full detail for a single Ukraine ProZorro tender by id (via the keyless OpenProcurement public API). Returns tenderID, title, description, status, procurement method, value (amount+currency), the buyer/procuring entity (name, EDR identifier, region, contact), tender period (start/end), enquiry period, number of bids, and line items (description, CPV classification, quantity, unit). Text is largely Ukrainian. Accepts the 32-char tender id from prozorro_recent_tenders / prozorro_search_tenders.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Tender id (32-hex, e.g. "156db6e773ba4b6e925d00f9ad3b13f4"). Not the human tenderID like "UA-2026-...".' },
      },
      required: ['id'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'prozorro_recent_tenders':
        return await recentTenders(args);
      case 'prozorro_search_tenders':
        return await searchTenders(args);
      case 'prozorro_get_tender':
        return await getTender(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// --- tools -----------------------------------------------------------------

async function recentTenders(args: Record<string, unknown>): Promise<unknown> {
  const limit = clampNum(numArg(args.limit), 20, 1, 50);
  const ids = await recentIds(limit);
  const tenders = await enrichMany(ids);
  return { count: tenders.length, tenders };
}

async function searchTenders(args: Record<string, unknown>): Promise<unknown> {
  const query = strArg(args.query);
  if (!query) throw new Error('prozorro_search_tenders requires "query" — a keyword to match (Ukrainian recommended, e.g. "школа").');
  const scan = clampNum(numArg(args.scan), 100, 1, 200);
  const ids = await recentIds(scan);
  const enriched = await enrichMany(ids);
  const q = query.toLowerCase();
  const matches = enriched.filter((t) => {
    const hay = `${t.title ?? ''} ${t.buyer ?? ''} ${t.tenderID ?? ''}`.toLowerCase();
    return hay.includes(q);
  });
  return {
    query,
    scanned: enriched.length,
    count: matches.length,
    note: 'Best-effort keyword filter over the recent ProZorro feed (not full history). Increase "scan" for deeper matching; use prozorro_get_tender for a known tender id.',
    tenders: matches,
  };
}

async function getTender(args: Record<string, unknown>): Promise<unknown> {
  const id = reqIdArg(args, 'id', '156db6e773ba4b6e925d00f9ad3b13f4');
  const data = (await opGet(`/tenders/${encodeURIComponent(id)}`)) as { data?: any };
  const d = data.data;
  if (!d) return { error: 'tender not found', id };
  const pe = d.procuringEntity ?? {};
  return {
    id: d.id,
    tenderID: d.tenderID,
    title: d.title,
    description: d.description,
    status: d.status,
    procurementMethod: d.procurementMethodType,
    value: shapeValue(d.value),
    buyer: {
      name: pe.name ?? pe.identifier?.legalName,
      edr: pe.identifier?.id,
      region: pe.address?.region,
      locality: pe.address?.locality,
      email: pe.contactPoint?.email,
      telephone: pe.contactPoint?.telephone,
    },
    tenderPeriod: shapePeriod(d.tenderPeriod),
    enquiryPeriod: shapePeriod(d.enquiryPeriod),
    numberOfBids: d.numberOfBids ?? (Array.isArray(d.bids) ? d.bids.length : undefined),
    dateModified: d.dateModified,
    items: (d.items ?? []).map((it: any) => ({
      description: it.description,
      cpv: it.classification?.id,
      cpvDescription: it.classification?.description,
      quantity: it.quantity,
      unit: it.unit?.name ?? it.unit?.code,
    })),
  };
}

// --- helpers ---------------------------------------------------------------

// Fetch the N most-recently-modified tender ids from the descending public feed.
async function recentIds(n: number): Promise<string[]> {
  const ids: string[] = [];
  let path = `/tenders?descending=1&limit=${Math.min(n, 100)}`;
  while (ids.length < n) {
    const page = (await opGet(path)) as { data?: any[]; next_page?: { path?: string } };
    const rows = page.data ?? [];
    for (const r of rows) {
      if (r?.id) ids.push(r.id);
      if (ids.length >= n) break;
    }
    const next = page.next_page?.path;
    if (ids.length >= n || !next || !rows.length) break;
    path = next.startsWith('/api/2.5') ? next.slice('/api/2.5'.length) : next;
  }
  return ids.slice(0, n);
}

// Enrich a list of ids into shaped summaries (title/value/buyer/status), fetched
// in small concurrent batches so we don't hammer the API.
async function enrichMany(ids: string[]): Promise<Array<{ id: string; tenderID?: string; title?: string; value?: unknown; buyer?: string; status?: string; procurementMethod?: string }>> {
  const out: Array<{ id: string; tenderID?: string; title?: string; value?: unknown; buyer?: string; status?: string; procurementMethod?: string }> = [];
  const BATCH = 8;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map(async (id) => {
        try {
          const data = (await opGet(`/tenders/${id}`)) as { data?: any };
          const d = data.data;
          if (!d) return null;
          return {
            id: d.id,
            tenderID: d.tenderID,
            title: d.title,
            value: shapeValue(d.value),
            buyer: d.procuringEntity?.name ?? d.procuringEntity?.identifier?.legalName,
            status: d.status,
            procurementMethod: d.procurementMethodType,
          };
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) if (r) out.push(r);
  }
  return out;
}

function shapeValue(v: any): unknown {
  if (!v || typeof v !== 'object') return undefined;
  return { amount: v.amount, currency: v.currency, vatIncluded: v.valueAddedTaxIncluded };
}

function shapePeriod(p: any): unknown {
  if (!p || typeof p !== 'object') return undefined;
  return { startDate: p.startDate, endDate: p.endDate };
}

async function opGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) {
    const body = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
    throw new Error(`ProZorro/OpenProcurement API: ${res.status} ${body}`.trim());
  }
  return res.json();
}

function strArg(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function numArg(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function clampNum(v: number | undefined, def: number, min: number, max: number): number {
  const n = v ?? def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function reqIdArg(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.trim()) return v.trim();
  throw new Error(`Required argument "${key}" is missing. Pass a tender id string like ${example}.`);
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
