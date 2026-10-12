import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const DEFAULT_DAILY_CALL_LIMIT = 200;
const MODEL = "jev-1.13.0";
const MAX_BODY_BYTES = 256 * 1024;
const MAX_SEGMENTS = 10; // the client scores in batches of 10
const MAX_SEGMENT_TEXT_CHARS = 4000;
const MAX_SHOW_CHARS = 2000;
// Retry only on 429 / 529 / network errors, at most 2 attempts in total.
const MAX_ATTEMPTS = 2;
// TypeSafe validation / question-limit rejections: worth retrying as two smaller batches.
const SPLITTABLE_STATUSES = new Set([400, 413, 422]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ScoreInput {
  key: string; // e.g. "s12"
  text: string;
}

interface JevUsage {
  input_tokens: number;
  output_tokens: number;
}

type JevResponse = Record<string, unknown> & { model?: string; usage?: Partial<JevUsage> };

interface JevAnswer {
  key?: string;
  batch?: string[];
  response: JevResponse;
}

function dailyCallLimit(): number {
  const raw = Deno.env.get("DAILY_CALL_LIMIT")?.trim();
  return raw && /^\d{1,9}$/.test(raw) ? Number(raw) : DEFAULT_DAILY_CALL_LIMIT;
}

type UsageCheck = "ok" | "daily_limit" | "unavailable";

// Fail-closed usage counter: an RPC error, a thrown error, or a missing / non-integer
// result is reported as "unavailable" so the caller blocks the request.
async function checkAndCountUsage(supabase: SupabaseClient, fn: string): Promise<UsageCheck> {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const { data, error } = await supabase.rpc("pcs_increment_usage", { p_fn: fn, p_day: day });
    if (error) {
      console.error(`[${fn}] usage counter failed`, error);
      return "unavailable";
    }
    if (typeof data !== "number" || !Number.isInteger(data)) {
      console.error(`[${fn}] usage counter returned a non-integer`, data);
      return "unavailable";
    }
    return data > dailyCallLimit() ? "daily_limit" : "ok";
  } catch (err) {
    console.error(`[${fn}] usage counter threw`, err);
    return "unavailable";
  }
}

function usageBlocked(check: Exclude<UsageCheck, "ok">) {
  return check === "daily_limit"
    ? json({ error: "daily_limit" }, 429)
    : json({ error: "usage_unavailable" }, 503);
}

// Reads the request body with a hard byte cap (413) and parses it as a JSON object (400).
async function readJsonBody(
  req: Request,
  maxBytes: number,
): Promise<{ body: Record<string, unknown> } | { res: Response }> {
  const tooLarge = { res: json({ error: "payload_too_large" }, 413) };
  const invalid = { res: json({ error: "invalid_json" }, 400) };
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) return tooLarge;
  if (!req.body) return invalid;

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return tooLarge;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalid;
    return { body: parsed as Record<string, unknown> };
  } catch {
    return invalid;
  }
}

function buildQuestions(items: ScoreInput[]): { state: Record<string, unknown>; questions: Record<string, unknown> } {
  const state: Record<string, unknown> = { show: "A podcast about startups and AI tools" };
  const segments: Record<string, string> = {};
  const questions: Record<string, unknown> = {};

  for (const item of items) {
    segments[item.key] = item.text;
    questions[`${item.key}__hook`] = {
      type: "score",
      instructions: `How strongly would \`segments.${item.key}\` grab a scrolling listener in the first few seconds as a short social clip?`,
      criteria: [
        "None: filler or housekeeping.",
        "Weak: mildly interesting.",
        "Decent: a clear point.",
        "Strong: surprising, emotional, or quotable.",
        "Viral: an instantly compelling story, claim, or line.",
      ],
    };
    questions[`${item.key}__standalone`] = {
      type: "noul",
      instructions: `Does \`segments.${item.key}\` make sense on its own, without the rest of the episode?`,
      criteria: { true: "Understandable on its own.", false: "Needs earlier context." },
    };
    questions[`${item.key}__clip_type`] = {
      type: "choice",
      instructions: `What kind of moment is \`segments.${item.key}\`?`,
      criteria: {
        story: "A personal story or anecdote.",
        hot_take: "A bold or contrarian opinion.",
        tip: "Practical, actionable advice.",
        stat: "A surprising number or fact.",
        funny: "A joke or funny exchange.",
        filler: "Intro, ads, housekeeping, or small talk.",
        uncertain: "Can't tell.",
      },
    };
    questions[`${item.key}__risky`] = {
      type: "noul",
      instructions: `Could \`segments.${item.key}\` be harmful, defamatory, or embarrassing to share out of context?`,
      criteria: { true: "Risky to share.", false: "Safe to share." },
    };
  }
  state.segments = segments;
  return { state, questions };
}

const ZERO_USAGE: JevUsage = { input_tokens: 0, output_tokens: 0 };

function toUsage(u: Partial<JevUsage> | undefined): JevUsage {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  return { input_tokens: n(u?.input_tokens), output_tokens: n(u?.output_tokens) };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type JevAttempt =
  | { kind: "ok"; data: JevResponse; latency_ms: number }
  | { kind: "blocked"; reason: Exclude<UsageCheck, "ok">; latency_ms: number }
  | { kind: "error"; status: number; latency_ms: number };

async function callJevWithRetry(
  supabase: SupabaseClient,
  apiKey: string,
  items: ScoreInput[],
  show: string,
): Promise<JevAttempt> {
  const state: Record<string, unknown> = { show };
  const segments: Record<string, string> = {};
  for (const item of items) segments[item.key] = item.text;
  state.segments = segments;
  const built = buildQuestions(items);
  if (show) state.show = show;

  let latency_ms = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Count each TypeSafe fetch attempt (retries and split sub-batches each count).
    // A daily_limit or counter failure is never retried.
    const usage = await checkAndCountUsage(supabase, "jev-score");
    if (usage !== "ok") return { kind: "blocked", reason: usage, latency_ms };

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, state, questions: built.questions }),
      });
    } catch (err) {
      latency_ms = Date.now() - started;
      console.error(`[jev-score] network error (attempt ${attempt}/${MAX_ATTEMPTS})`, err);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000);
        continue;
      }
      return { kind: "error", status: 0, latency_ms };
    }
    latency_ms = Date.now() - started;

    if (res.status === 429 || res.status === 529) {
      await res.body?.cancel();
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000);
        continue;
      }
      console.error(`[jev-score] rate-limited after ${MAX_ATTEMPTS} attempts (status ${res.status})`);
      return { kind: "error", status: res.status, latency_ms };
    }
    if (!res.ok) {
      const detail = await res.text();
      console.error(`[jev-score] request failed: ${res.status} ${detail.slice(0, 500)}`);
      return { kind: "error", status: res.status, latency_ms };
    }
    try {
      return { kind: "ok", data: (await res.json()) as JevResponse, latency_ms };
    } catch (err) {
      console.error("[jev-score] invalid JSON from TypeSafe", err);
      return { kind: "error", status: 502, latency_ms };
    }
  }
  return { kind: "error", status: 0, latency_ms };
}

interface BatchResult {
  answers: JevAnswer[];
  usage: JevUsage;
  latency_ms: number;
  splits: number;
  error?: string;
  blocked?: Exclude<UsageCheck, "ok">;
}

// Recursive: split batch in half on validation failure / question limit.
// daily_limit / counter failures are NOT split or retried — they propagate immediately.
async function scoreBatch(
  supabase: SupabaseClient,
  apiKey: string,
  items: ScoreInput[],
  show: string,
  depth = 0,
): Promise<BatchResult> {
  if (items.length === 0) return { answers: [], usage: ZERO_USAGE, latency_ms: 0, splits: 0 };

  const r = await callJevWithRetry(supabase, apiKey, items, show);
  if (r.kind === "blocked") {
    return { answers: [], usage: ZERO_USAGE, latency_ms: r.latency_ms, splits: depth, blocked: r.reason };
  }
  if (r.kind === "error") {
    if (items.length === 1 || !SPLITTABLE_STATUSES.has(r.status)) {
      return { answers: [], usage: ZERO_USAGE, latency_ms: r.latency_ms, splits: depth, error: `status ${r.status}` };
    }
    // Split in half and retry
    const mid = Math.floor(items.length / 2);
    const left = await scoreBatch(supabase, apiKey, items.slice(0, mid), show, depth + 1);
    if (left.blocked) return left;
    const right = await scoreBatch(supabase, apiKey, items.slice(mid), show, depth + 1);
    return {
      answers: [...left.answers, ...right.answers],
      usage: {
        input_tokens: left.usage.input_tokens + right.usage.input_tokens,
        output_tokens: left.usage.output_tokens + right.usage.output_tokens,
      },
      latency_ms: left.latency_ms + right.latency_ms,
      splits: depth + 1,
      error: left.error ?? right.error,
      blocked: right.blocked,
    };
  }
  const usage = toUsage(r.data.usage);
  if (items.length === 1) {
    return { answers: [{ key: items[0].key, response: r.data }], usage, latency_ms: r.latency_ms, splits: depth };
  }
  return { answers: [{ batch: items.map((i) => i.key), response: r.data }], usage, latency_ms: r.latency_ms, splits: depth };
}

// Upload episodes get their Jev stats written here with the service role (the browser has
// no UPDATE on episodes). Best effort: a failure is logged, never surfaced to the client.
async function recordEpisodeUsage(supabase: SupabaseClient, episodeId: string, costUsd: number, latencyMs: number) {
  try {
    const { error } = await supabase.rpc("pcs_record_episode_usage", {
      p_episode_id: episodeId,
      p_fn: "jev-score",
      p_cost_usd: costUsd,
      p_latency_ms: latencyMs,
      p_status: null,
    });
    if (error) console.error("[jev-score] episode usage update failed", error);
  } catch (err) {
    console.error("[jev-score] episode usage update threw", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.error("[jev-score] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
      return json({ error: "service_unavailable" }, 503);
    }
    const typesafeKey = Deno.env.get("TYPESAFE_API_KEY") ?? "";

    const parsed = await readJsonBody(req, MAX_BODY_BYTES);
    if ("res" in parsed) return parsed.res;
    const { segments, show, episode_id, mock: mockFlag } = parsed.body;

    if (!Array.isArray(segments) || segments.length === 0) {
      return json({ error: "segments array required" }, 400);
    }
    if (segments.length > MAX_SEGMENTS) {
      return json({ error: `at most ${MAX_SEGMENTS} segments per request` }, 422);
    }
    if (episode_id !== undefined && episode_id !== null && (typeof episode_id !== "string" || !UUID_RE.test(episode_id))) {
      return json({ error: "invalid episode_id" }, 400);
    }
    const showText = typeof show === "string" ? show : "";
    if (showText.length > MAX_SHOW_CHARS) {
      return json({ error: `show must be at most ${MAX_SHOW_CHARS} characters` }, 422);
    }

    const items: ScoreInput[] = [];
    for (const [i, s] of segments.entries()) {
      const text = s && typeof s === "object" ? (s as { text?: unknown }).text : undefined;
      if (typeof text !== "string") return json({ error: "each segment needs a text string" }, 400);
      if (text.length > MAX_SEGMENT_TEXT_CHARS) {
        return json({ error: `segment text must be at most ${MAX_SEGMENT_TEXT_CHARS} characters` }, 422);
      }
      items.push({ key: `s${i}`, text });
    }

    const mock = mockFlag === true;
    if (!typesafeKey && !mock) {
      return json({ error: "TYPESAFE_API_KEY not configured" }, 500);
    }

    if (!typesafeKey) {
      // No key: deterministic mock scoring so the demo still works.
      const answers = items.map((item) => {
        const text = item.text.toLowerCase();
        const filler = /welcome|sponsor|rate us|thanks for listening|find me at|subscribe/.test(text);
        const story = /mistake|burned|almost died|fired|walk me through|turned it around/.test(text);
        const stat = /\d+%|\d+ (hours|months|customers|percent)/.test(text);
        const tip = /advice|my rule|concretely|first|build the/.test(text);
        const hot = /hot take|overrated|underrated|nobody|never/.test(text);
        const clip_type = filler ? "filler" : story ? "story" : stat ? "stat" : tip ? "tip" : hot ? "hot_take" : "uncertain";
        const hook = filler ? 1 : story ? 3.8 : stat ? 3.2 : hot ? 3.4 : tip ? 2.8 : 1.8;
        return {
          key: item.key,
          response: {
            model: "mock",
            [`${item.key}__hook`]: { type: "score", score: hook, confidence: 0.6 },
            [`${item.key}__standalone`]: { type: "noul", noul: filler ? 0.9 : 0.7 },
            [`${item.key}__clip_type`]: { type: "choice", choice: clip_type, confidence: 0.7 },
            [`${item.key}__risky`]: { type: "noul", noul: 0.05 },
          },
        };
      });
      console.log("[jev-score] mock mode (no TYPESAFE_API_KEY)");
      return json({
        episode_id: episode_id ?? null,
        answers,
        model: "mock",
        usage: { input_tokens: 0, output_tokens: 0 },
        latency_ms: 0,
        cost_usd: 0,
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const t0 = Date.now();
    const result = await scoreBatch(supabase, typesafeKey, items, showText);
    const totalLatency = Date.now() - t0;

    if (result.blocked) return usageBlocked(result.blocked);

    const model = result.answers[0]?.response?.model;
    const usage = result.usage;
    const cost_usd = (usage.input_tokens * 0.042) / 1_000_000;

    if (result.error) {
      console.error(`[jev-score] batch split retries=${result.splits} error=${result.error}`);
      return json({ error: "scoring_failed", model: MODEL, usage, latency_ms: totalLatency, cost_usd, answers: result.answers }, 502);
    }

    console.log(`[jev-score] model=${model} segments=${segments.length} splits=${result.splits} input_tokens=${usage.input_tokens} cost_usd=${cost_usd.toFixed(6)} latency_ms=${totalLatency}`);

    if (typeof episode_id === "string") {
      await recordEpisodeUsage(supabase, episode_id, cost_usd, totalLatency);
    }

    return json({
      episode_id: episode_id ?? null,
      answers: result.answers,
      model,
      usage,
      latency_ms: totalLatency,
      cost_usd,
    });
  } catch (err) {
    console.error("[jev-score] unhandled error", err);
    return json({ error: "internal_error" }, 500);
  }
});
