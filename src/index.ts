interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    throw err;
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
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
 * Search: `prozorro_search_tenders` queries ProZorro's real full-text index at
 * POST https://prozorro.gov.ua/api/search/tenders — keyless, full history back
 * to 2015, Ukrainian stemming (школа matches школи/шкільний), and filterable by
 * buyer or SUPPLIER EDRPOU, CPV, status, value range and date.
 *
 * This header used to say that endpoint was "not reachable from datacenter/CF
 * egress (returns 400/405)", and the whole tool was built as a client-side
 * filter over the last ~100 feed records on the strength of that sentence. The
 * 405 was not an egress block. It is a POST endpoint and we were sending GET —
 * the response says so in plain English ("The GET method is not supported for
 * route api/search/tenders. Supported methods: POST."). One misread status code
 * cost this pack its entire search capability, and a paying customer running
 * Ukrainian supplier due diligence roughly a 50% empty-result rate, because a
 * 100-record window cannot answer a question about history.
 *
 * The OpenProcurement feed (BASE, below) is a change-feed only: it accepts a
 * `text` parameter and SILENTLY IGNORES it — a nonsense query returns
 * byte-identical results to no query at all. Never filter with it.
 *
 * All tools return shaped, LLM-friendly objects (not raw API passthrough) and
 * never throw — fetch/parse failures resolve to { error }.
 */


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'ProZorro');
}

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
      "Full-text search over ALL Ukraine ProZorro tenders back to 2015 (keyless). Searches ProZorro's own analyzed index, so Ukrainian queries stem correctly (\"школа\" also matches \"школи\", \"шкільний\") — pass Ukrainian keywords for best recall. Filter by buyer EDRPOU, by SUPPLIER/bidder EDRPOU (`tenderer` — this is the one for supplier due diligence: every tender a company has bid on or won), CPV code, status, value range, and date. Returns tenderID, title, value, buyer name + EDRPOU + region, and status, plus a total match count. Use prozorro_get_tender for the full detail of one result.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text query, Ukrainian recommended (e.g. "вугілля", "школа"). Optional if you pass a filter such as tenderer or buyer.' },
        tenderer: { type: 'string', description: 'Supplier/bidder EDRPOU code (8 digits, e.g. "00131305") — returns every tender this company bid on or won. The primary supplier due-diligence filter.' },
        buyer: { type: 'string', description: 'Buyer/procuring-entity EDRPOU code (8 digits).' },
        cpv: { type: 'string', description: 'Exact CPV classification code, e.g. "09111100-1".' },
        status: { type: 'string', description: 'Tender status: complete, active.tendering, cancelled, unsuccessful, …' },
        date_from: { type: 'string', description: 'Start date YYYY-MM-DD. NOTE: date filtering DROPS records that have no tender period — leave both dates off unless you need them.' },
        date_to: { type: 'string', description: 'End date YYYY-MM-DD. Same caveat as date_from.' },
        sort_by: { type: 'string', description: '"dateCreated" (default) or "value.amount".' },
        order: { type: 'string', description: '"desc" (default) or "asc".' },
        page: { type: ['number', 'string'], description: 'Page number, 1-500. Fixed 20 results per page.' },
      },
    },
  },
  {
    name: 'prozorro_search_organizations',
    description:
      "Resolve a Ukrainian company or public buyer NAME to its EDRPOU code, using ProZorro's organization index (keyless). This is the entry point for supplier due diligence: a user knows the company's name, but prozorro_search_tenders filters by EDRPOU — call this first, then pass the returned `edrpou` as `tenderer` (supplier side) or `buyer` to get that company's full tender history.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Company or buyer name, Ukrainian recommended.' },
        role: { type: 'string', description: '"tenderer" for suppliers/bidders (default), or "buyer" for procuring entities.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'prozorro_get_tender',
    description:
      "Full detail for a single Ukraine ProZorro tender by id (via the keyless OpenProcurement public API). Returns tenderID, title, description, status, procurement method, tender_value (the ORIGINAL ASKING PRICE — not money spent), the buyer/procuring entity (name, EDR identifier, region, contact), tender period (start/end), enquiry period, number of bids, line items (description, CPV classification, quantity, unit), and the OCDS award/contract stage: `award` (operative award: status, date, value, winning supplier — null if none) plus the full `awards` history, and `contract` (signed contract value/date). An `interpretation` line states plainly whether the tender_value was ever actually spent — a cancelled or unsuccessful tender still carries a populated tender_value even though zero money moved. Text is largely Ukrainian. Accepts the 32-char tender id from prozorro_recent_tenders / prozorro_search_tenders.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Tender id — normally the internal 32-hex id (e.g. "156db6e773ba4b6e925d00f9ad3b13f4") from prozorro_recent_tenders, which is the only form that returns full detail. A human tenderID ("UA-2026-09-20-000012-a") is also accepted and returns the summary ProZorro\'s search index holds, with detail_available:false — prozorro_search_tenders returns only that form, and the index carries no 32-hex id to convert it to.' },
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
      case 'prozorro_search_organizations':
        return await searchOrganizations(args);
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

const SEARCH_BASE = 'https://prozorro.gov.ua/api/search';

/**
 * ProZorro's real search index. POST, not GET — sending GET returns 405, which
 * a previous version of this pack read as "blocked from datacenter egress" and
 * built a 100-record client-side filter around.
 */
async function searchPost(path: string, params: URLSearchParams): Promise<any> {
  const res = await pwFetch(`${SEARCH_BASE}${path}?${params.toString()}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) {
    const body = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
    if (res.status === 429) throw new Error(`upstream_throttled: ProZorro search rate limit (HTTP 429). ${body}`.trim());
    if (res.status >= 500) throw new Error(`upstream_down: ProZorro search ${res.status}. ${body}`.trim());
    throw new Error(`ProZorro search: ${res.status} ${body}`.trim());
  }
  return res.json();
}

async function searchTenders(args: Record<string, unknown>): Promise<unknown> {
  const query = strArg(args.query);
  const tenderer = strArg(args.tenderer);
  const buyer = strArg(args.buyer);
  const cpv = strArg(args.cpv);
  const status = strArg(args.status);
  const dateFrom = strArg(args.date_from);
  const dateTo = strArg(args.date_to);
  if (!query && !tenderer && !buyer && !cpv) {
    throw new Error(
      'prozorro_search_tenders needs at least one of: query (free text, Ukrainian recommended), ' +
      'tenderer (supplier EDRPOU), buyer (buyer EDRPOU), or cpv. ' +
      'Use tenderer to list every tender a company has bid on or won.',
    );
  }

  const p = new URLSearchParams();
  if (query) p.set('text', query);
  if (tenderer) p.set('tenderer[0]', tenderer);
  if (buyer) p.set('buyer[0]', buyer);
  if (cpv) p.set('cpv[0]', cpv);
  if (status) p.set('status[0]', status);
  if (dateFrom || dateTo) {
    // Supplier-side records index dateSigned, NOT the tender period. Filtering a
    // `tenderer` query by date[tender] returns a clean, wrong `total: 0` — 4,033
    // matches become 0 on a range that provably contains them. Pick the field
    // that matches the side being queried.
    const field = tenderer ? 'dateSigned' : 'tender';
    if (dateFrom) p.set(`date[${field}][start]`, dateFrom);
    if (dateTo) p.set(`date[${field}][end]`, dateTo);
  }
  p.set('sort_by', strArg(args.sort_by) ?? 'dateCreated');
  p.set('order', strArg(args.order) ?? 'desc');
  p.set('page', String(clampNum(numArg(args.page), 1, 1, 500)));

  const data = await searchPost('/tenders', p);
  const rows: any[] = Array.isArray(data?.data) ? data.data : [];
  const tenders = rows.map((d) => ({
    tenderID: d.tenderID ?? null,
    title: d.title ?? null,
    status: d.status ?? null,
    // ProZorro's search index does not return awards/contracts, so this
    // stays the tender-stage asking price — interpretation says so
    // explicitly instead of leaving a cancelled/unsuccessful row looking
    // like a confirmed spend. Use prozorro_get_tender for the real award.
    tender_value: d.value ? { amount: d.value.amount ?? null, currency: d.value.currency ?? null } : null,
    interpretation: statusInterpretation(d.status),
    buyer: d.procuringEntity?.identifier?.legalName ?? d.procuringEntity?.name ?? null,
    buyer_edrpou: d.procuringEntity?.identifier?.id ?? null,
    region: d.procuringEntity?.address?.region ?? null,
    tender_period: d.tenderPeriod ?? null,
  }));

  const total = Number(data?.total ?? 0);
  const notes: string[] = [];
  if (total >= 10000) notes.push('total is capped at 10000 — the true count is at least this; narrow with cpv, buyer, tenderer or a date range.');
  if (tenderer) {
    // Measured: a deliberately nonsense EDRPOU (99999999) still returns 9 rows,
    // where a real one returns 4,033. So this filter is fuzzy, not exact — a
    // small result set may be near-misses rather than that company's record.
    notes.push('The tenderer/buyer filter is fuzzy, not an exact code match — check buyer_edrpou on each result before treating a small result set as that company\'s history.');
  }
  if ((dateFrom || dateTo) && !tenderer) {
    notes.push('A date filter drops tenders that have no tender period, so it can hide real matches — re-run without dates to see the full count.');
  }
  return {
    query: query ?? null,
    filters: { tenderer: tenderer ?? null, buyer: buyer ?? null, cpv: cpv ?? null, status: status ?? null },
    total,
    page: Number(data?.page ?? 1),
    per_page: Number(data?.per_page ?? 20),
    returned: tenders.length,
    source: 'ProZorro full-text search (prozorro.gov.ua), full history from 2015',
    ...(notes.length ? { notes } : {}),
    tenders,
  };
}

/**
 * Resolve a company NAME to its EDRPOU code, which is what every buyer/tenderer
 * filter needs. Without this you cannot start a supplier due-diligence query
 * from the only thing a user actually knows — the company's name.
 */
async function searchOrganizations(args: Record<string, unknown>): Promise<unknown> {
  const name = strArg(args.name);
  if (!name) throw new Error('prozorro_search_organizations requires "name" — a company or buyer name (Ukrainian recommended).');
  const role = strArg(args.role) === 'buyer' ? 'buyer' : 'tenderer';
  const p = new URLSearchParams({ type: role, value: name });
  const data = await searchPost('/organizations', p);
  const rows: any[] = Array.isArray(data?.data) ? data.data : [];
  return {
    name,
    role,
    count: rows.length,
    note:
      `Pass an "edrpou" below as the ${role === 'buyer' ? 'buyer' : 'tenderer'} argument of ` +
      `prozorro_search_tenders. Two cautions: these are several DISTINCT legal entities, not one ` +
      `company (a group like ДТЕК has many), so pick the one whose name matches the entity you mean; ` +
      `and this index is filer-entered, so codes are dirty — check edrpou_confidence, where "exact" ` +
      `means a well-formed 8-digit EDRPOU and anything else means the filer typed something odd.`,
    organizations: rows.map((o) => {
      // The code lives in a bare `id`, NOT `identifier.id` — the first cut of
      // this tool read the latter and returned edrpou: null for every row,
      // which is the one field the tool exists to produce. It also sometimes
      // arrives with a tax number appended ("00131305, ІПН 00131302657"), so
      // take the leading code.
      const raw = typeof o.id === 'string' ? o.id.split(',')[0].trim() : String(o.id ?? '');
      // This index is filer-entered and dirty. A single "Київенерго" search
      // returns 0000131305 (10 digits), 0013130 and 0013135 (7, and differing
      // from each other), and a row whose "code" is the company's full legal
      // name. A real EDRPOU is 8 digits. Flag what does not look like one
      // rather than handing a due-diligence caller a code we cannot stand up.
      const looksValid = /^\d{6,10}$/.test(raw);
      return {
        name: o.name ?? null,
        edrpou: looksValid ? raw : null,
        edrpou_confidence: looksValid ? (raw.length === 8 ? 'exact' : 'malformed-length') : 'not-a-code',
        raw_id: o.id ?? null,
      };
    }),
  };
}

/**
 * The human tenderID (`UA-2025-04-23-008781-a`) and the internal 32-hex id are
 * different id spaces, and only the second one fetches a tender.
 *
 * That would be a footnote except for where the two meet: `prozorro_search_tenders`
 * returns ONLY `tenderID`. ProZorro's search index does not carry the 32-hex id
 * at all — measured 2026-09-19, a search row has exactly five keys
 * (procuringEntity, status, tenderID, title, value). So the tool a caller uses
 * to FIND a tender cannot produce the key the tool that FETCHES one requires,
 * and no keyless resolution exists: the OpenProcurement feed ignores a
 * `?tenderID=` filter and returns its next 100 changes regardless.
 *
 * What made it costly is what the failure LOOKED like. `/tenders/UA-...` 404s
 * with `{"name":"tender_id","description":"Not Found"}`, which reads as *this
 * tender does not exist*. On 2026-09-19 one external caller worked through 23
 * different real tenderIDs and got that answer 23 times — 77% of the tool's
 * traffic, every call external. Looping is the correct behaviour when an error
 * blames your data instead of your key format.
 *
 * So a `UA-` id no longer 404s. We confirm the tender against the search index
 * and hand back what that index has — title, status, value, buyer — with
 * `detail_available: false` and a plain statement of why. Partial and true
 * beats an error that is false.
 */
const TENDER_ID_RE = /^UA-\d{4}-\d{2}-\d{2}-\d{6}(-[a-z])?$/i;

async function getTenderByHumanId(tenderID: string): Promise<unknown> {
  const p = new URLSearchParams();
  p.set('text', tenderID);
  let rows: any[] = [];
  try {
    const found = await searchPost('/tenders', p);
    rows = Array.isArray(found?.data) ? found.data : [];
  } catch {
    // Search is a second upstream and can be down on its own. Say that, rather
    // than letting its outage read as "no such tender".
    return {
      error:
        `"${tenderID}" is a ProZorro tenderID, and this tool needs the internal 32-character id instead. ` +
        'I could not reach the search index to look it up just now, so I cannot tell you whether the tender exists. Try again shortly.',
      tenderID,
      detail_available: false,
    };
  }

  // The index is full-text, so a query can match neighbours. Only an exact
  // tenderID match is this tender; anything else is a different one.
  const hit = rows.find((r) => String(r?.tenderID ?? '').toUpperCase() === tenderID.toUpperCase());
  if (!hit) {
    return {
      found: false,
      error:
        `No ProZorro tender with tenderID "${tenderID}". Note this tool normally takes the internal ` +
        '32-character id (e.g. "156db6e773ba4b6e925d00f9ad3b13f4"), not the UA-… form; I searched the ' +
        'ProZorro index for this one and it returned no exact match, so the tenderID itself looks wrong.',
      tenderID,
      detail_available: false,
    };
  }

  const pe = hit.procuringEntity ?? {};
  return {
    tenderID: hit.tenderID ?? tenderID,
    title: hit.title ?? null,
    status: hit.status ?? null,
    interpretation: statusInterpretation(hit.status),
    tender_value: hit.value ? { amount: hit.value.amount ?? null, currency: hit.value.currency ?? null } : null,
    buyer: pe.identifier?.legalName ?? pe.name ?? null,
    buyer_edrpou: pe.identifier?.id ?? null,
    region: pe.address?.region ?? null,
    detail_available: false,
    note:
      'This tender EXISTS and the fields above are real, but they are everything ProZorro\'s search index ' +
      'carries. Full detail (description, line items, bids, awards, contract) needs the internal 32-character ' +
      'tender id, which the search index does not return, so it cannot be fetched from a UA-… tenderID alone. ' +
      'prozorro_recent_tenders returns both ids together for currently-active tenders.',
  };
}

async function getTender(args: Record<string, unknown>): Promise<unknown> {
  const id = reqIdArg(args, 'id', '156db6e773ba4b6e925d00f9ad3b13f4');
  if (TENDER_ID_RE.test(id.trim())) return getTenderByHumanId(id.trim());
  const data = (await opGet(`/tenders/${encodeURIComponent(id)}`)) as { data?: any };
  const d = data.data;
  if (!d) return { error: 'tender not found', id };
  const pe = d.procuringEntity ?? {};
  // OpenProcurement's tender object already carries `awards` and `contracts` at
  // the top level once the process moves past tendering — this pack simply
  // never read them. That means a cancelled/unsuccessful tender's `value`
  // (the asking price) was the ONLY number returned, indistinguishable from
  // money actually spent, and a complete tender's award amount (which can
  // differ from the ask) was silently dropped. Fixed 2026-09 (fleet #1166).
  const award = pickOperativeAward(d.awards);
  const contract = pickOperativeContract(d.contracts);
  return {
    id: d.id,
    tenderID: d.tenderID,
    title: d.title,
    description: d.description,
    status: d.status,
    interpretation: statusInterpretation(d.status),
    procurementMethod: d.procurementMethodType,
    // The ORIGINAL ASKING PRICE at tender stage — not what was spent. See
    // `award`/`contract` below for the amount actually committed, and
    // `interpretation` for whether this tender resulted in any spend at all.
    tender_value: shapeValue(d.value),
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
    // The operative award: the ACTIVE one if any, else the most recent
    // (an award can be cancelled/unsuccessful and superseded by a later one).
    // Explicitly null — never omitted — when no award has happened, so a
    // caller cannot mistake "field absent" for "not checked".
    award: award ? shapeAward(award) : null,
    // Full award history, including cancelled/unsuccessful attempts, in case
    // a caller needs to see how the process actually played out.
    awards: Array.isArray(d.awards) ? d.awards.map(shapeAward) : [],
    contract: contract ? shapeContract(contract) : null,
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
// in small concurrent batches so we don't hammer the API. `opGet` already
// returns the full tender object including `awards`, so surfacing the
// operative award here costs nothing extra — no additional fetch.
async function enrichMany(ids: string[]): Promise<Array<{ id: string; tenderID?: string; title?: string; tender_value?: unknown; buyer?: string; status?: string; interpretation?: string; procurementMethod?: string; award_value?: unknown }>> {
  const out: Array<{ id: string; tenderID?: string; title?: string; tender_value?: unknown; buyer?: string; status?: string; interpretation?: string; procurementMethod?: string; award_value?: unknown }> = [];
  const BATCH = 8;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map(async (id) => {
        try {
          const data = (await opGet(`/tenders/${id}`)) as { data?: any };
          const d = data.data;
          if (!d) return null;
          const award = pickOperativeAward(d.awards);
          return {
            id: d.id,
            tenderID: d.tenderID,
            title: d.title,
            tender_value: shapeValue(d.value),
            buyer: d.procuringEntity?.name ?? d.procuringEntity?.identifier?.legalName,
            status: d.status,
            interpretation: statusInterpretation(d.status),
            procurementMethod: d.procurementMethodType,
            award_value: award ? shapeValue(award.value) : null,
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

// OCDS lifecycle: a tender is proposed, then awarded, then contracted. Reading
// only the tender-stage `value` conflates "asked for" with "spent" — a
// cancelled/unsuccessful tender still carries a fully populated tender value
// even though zero money moved, and a complete tender's real spend lives on
// the award/contract, not here. This tells a caller which is which.
function statusInterpretation(status: string | undefined): string {
  switch (status) {
    case 'cancelled':
      return 'Tender CANCELLED before any award — no money was ever committed. tender_value above is the original asking price, not spend.';
    case 'unsuccessful':
      return 'Tender UNSUCCESSFUL — no qualifying bid; no award, no contract, no money spent. tender_value above is the original asking price, not spend.';
    case 'complete':
      return 'Tender COMPLETE — see award/contract for the amount actually spent and to whom; it can differ from tender_value.';
    default:
      if (status && status.startsWith('active')) {
        return 'Tender still IN PROGRESS — no final award yet. tender_value above is the asking price, not a settled amount.';
      }
      return '';
  }
}

// The operative award: prefer the currently ACTIVE one (an award can be
// cancelled/unsuccessful and superseded), else fall back to the most recent
// attempt so a caller still sees why nothing was awarded.
function pickOperativeAward(awards: any[] | undefined): any | null {
  if (!Array.isArray(awards) || awards.length === 0) return null;
  return awards.find((a) => a?.status === 'active') ?? awards[awards.length - 1];
}

function pickOperativeContract(contracts: any[] | undefined): any | null {
  if (!Array.isArray(contracts) || contracts.length === 0) return null;
  return contracts.find((c) => c?.status === 'active') ?? contracts[contracts.length - 1];
}

function shapeAward(a: any): Record<string, unknown> {
  const supplier = Array.isArray(a?.suppliers) ? a.suppliers[0] : undefined;
  return {
    id: a?.id ?? null,
    status: a?.status ?? null, // pending | active | cancelled | unsuccessful
    date: a?.date ?? null,
    value: shapeValue(a?.value) ?? null,
    supplier: supplier
      ? { name: supplier.name ?? supplier.identifier?.legalName ?? null, edrpou: supplier.identifier?.id ?? null }
      : null,
    // Why there is no active award, when applicable (e.g. "unsuccessful" /
    // a cancellation reason) — present on non-active awards, absent on active.
    reason: a?.status !== 'active' ? (a?.statusDetails ?? a?.title ?? null) : undefined,
  };
}

function shapeContract(c: any): Record<string, unknown> {
  return {
    id: c?.id ?? null,
    status: c?.status ?? null,
    date: c?.dateSigned ?? c?.date ?? null,
    value: shapeValue(c?.value) ?? null,
  };
}

async function opGet(path: string): Promise<unknown> {
  const res = await pwFetch(`${BASE}${path}`, {
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
