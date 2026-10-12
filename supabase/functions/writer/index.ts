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
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_CLIP_TEXT_CHARS = 12000;
const MAX_CLIP_TYPE_CHARS = 32;
const MAX_CHAPTER_SEGMENTS = 1000;
const MAX_SEGMENT_TEXT_CHARS = 4000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

interface ClipInput {
  text: string;
  hook: number;
  risky: number;
  clip_type: string;
}

interface ChapterSegment {
  idx: number;
  start_s: number;
  text: string;
}

// Validates the fields of `clip` that reach the prompt; returns an error response on failure.
function parseClip(value: unknown): ClipInput | Response {
  if (!value || typeof value !== "object") return json({ error: "clip required" }, 400);
  const { text, hook, risky, clip_type } = value as Record<string, unknown>;
  if (typeof text !== "string" || !isFiniteNumber(hook) || !isFiniteNumber(risky) || typeof clip_type !== "string") {
    return json({ error: "clip needs text, hook, risky and clip_type" }, 400);
  }
  if (text.length > MAX_CLIP_TEXT_CHARS || clip_type.length > MAX_CLIP_TYPE_CHARS) {
    return json({ error: `clip text must be at most ${MAX_CLIP_TEXT_CHARS} characters` }, 422);
  }
  return { text, hook, risky, clip_type };
}

function parseChapterSegments(value: unknown): ChapterSegment[] | Response {
  if (!Array.isArray(value) || value.length === 0) return json({ error: "segments required" }, 400);
  if (value.length > MAX_CHAPTER_SEGMENTS) {
    return json({ error: `at most ${MAX_CHAPTER_SEGMENTS} segments` }, 422);
  }
  const out: ChapterSegment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return json({ error: "invalid segment" }, 400);
    const { idx, start_s, text } = item as Record<string, unknown>;
    if (!isFiniteNumber(idx) || !isFiniteNumber(start_s) || typeof text !== "string") {
      return json({ error: "each segment needs idx, start_s and text" }, 400);
    }
    if (text.length > MAX_SEGMENT_TEXT_CHARS) {
      return json({ error: `segment text must be at most ${MAX_SEGMENT_TEXT_CHARS} characters` }, 422);
    }
    out.push({ idx, start_s, text });
  }
  return out;
}

function tokenCount(v: unknown): number {
  return isFiniteNumber(v) && v > 0 ? v : 0;
}

// Upload episodes get their writer stats / status written here with the service role (the
// browser has no UPDATE on episodes). Best effort: a failure is logged, never surfaced.
async function recordEpisodeUsage(
  supabase: SupabaseClient,
  episodeId: string,
  costUsd: number,
  latencyMs: number,
  status: "writing" | "ready",
) {
  try {
    const { error } = await supabase.rpc("pcs_record_episode_usage", {
      p_episode_id: episodeId,
      p_fn: "writer",
      p_cost_usd: costUsd,
      p_latency_ms: latencyMs,
      p_status: status,
    });
    if (error) console.error("[writer] episode usage update failed", error);
  } catch (err) {
    console.error("[writer] episode usage update threw", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.error("[writer] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
      return json({ error: "service_unavailable" }, 503);
    }
    const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    const baseUrl = Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
    const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-6-luna";

    const parsed = await readJsonBody(req, MAX_BODY_BYTES);
    if ("res" in parsed) return parsed.res;
    const body = parsed.body;
    const mode = body.mode as "clip_copy" | "chapters";
    const mock = body.mock === true;
    const episodeId = body.episode_id;
    if (episodeId !== undefined && episodeId !== null && (typeof episodeId !== "string" || !UUID_RE.test(episodeId))) {
      return json({ error: "invalid episode_id" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (mode === "clip_copy") {
      const clip = parseClip(body.clip);
      if (clip instanceof Response) return clip;

      if (mock || !openaiKey) {
        const firstSentence = clip.text.split(/(?<=[.!?])\s/)[0] ?? clip.text;
        const title = firstSentence.length > 60 ? `${firstSentence.slice(0, 57)}...` : firstSentence;
        const caption = clip.text.length > 200 ? `${clip.text.slice(0, 197)}...` : clip.text;
        const tagMap: Record<string, string> = {
          story: "#story",
          hot_take: "#hottake",
          tip: "#tip",
          stat: "#didyouknow",
          funny: "#funny",
        };
        const tags = [Object.hasOwn(tagMap, clip.clip_type) ? tagMap[clip.clip_type] : "#podcast", "#clip", "#listen"];
        return json({ mock: true, title, caption, hashtags: tags, model: "mock", latency_ms: 0, cost_usd: 0 });
      }

      const usageCheck = await checkAndCountUsage(supabase, "writer");
      if (usageCheck !== "ok") return usageBlocked(usageCheck);

      const prompt = `You write social copy for podcast clips. Given the clip transcript and its scoring, return JSON only.
Return: {"title": string <= 60 chars, "caption": string <= 200 chars, "hashtags": [3 strings]}.
Clip type: ${clip.clip_type}. Hook score (1-4): ${clip.hook}. Risky (0-1): ${clip.risky}.
Transcript:
"""
${clip.text}
"""`;

      const started = Date.now();
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a social media copywriter. Always respond with valid JSON only." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
        }),
      });
      const latency_ms = Date.now() - started;

      if (!res.ok) {
        const detail = await res.text();
        console.error(`[writer] clip_copy failed: ${res.status} ${detail.slice(0, 500)}`);
        return json({ error: "writer failed" }, 502);
      }
      const data = await res.json();
      const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
      const content = data.choices?.[0]?.message?.content ?? "{}";
      let parsed: { title?: string; caption?: string; hashtags?: string[] };
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = { title: content.slice(0, 60), caption: content.slice(0, 200), hashtags: ["#podcast"] };
      }
      const inTok = tokenCount(usage.prompt_tokens);
      const outTok = tokenCount(usage.completion_tokens);
      // Approximate cost: same formula style, $0.42/M input and $0.42/M output for the writer.
      const cost_usd = (inTok * 0.42 + outTok * 0.42) / 1_000_000;

      if (typeof episodeId === "string") {
        await recordEpisodeUsage(supabase, episodeId, cost_usd, latency_ms, "writing");
      }

      return json({
        title: String(parsed.title ?? "").slice(0, 60),
        caption: String(parsed.caption ?? "").slice(0, 200),
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, 3).map(String) : ["#podcast"],
        model,
        usage: { input_tokens: inTok, output_tokens: outTok },
        latency_ms,
        cost_usd,
      });
    }

    if (mode === "chapters") {
      const segs = parseChapterSegments(body.segments);
      if (segs instanceof Response) return segs;

      if (mock || !openaiKey) {
        const chapters = [];
        const chapterLen = 300; // ~5 min
        let curStart = 0;
        let idx = 1;
        for (const s of segs) {
          if (s.start_s >= curStart) {
            chapters.push({ start_s: s.start_s, title: `Chapter ${idx}` });
            curStart += chapterLen;
            idx += 1;
          }
        }
        return json({ mock: true, chapters, model: "mock", latency_ms: 0, cost_usd: 0 });
      }

      const usageCheck = await checkAndCountUsage(supabase, "writer");
      if (usageCheck !== "ok") return usageBlocked(usageCheck);

      const lines = segs.map((s) => `[${Math.floor(s.start_s / 60)}:${String(Math.floor(s.start_s % 60)).padStart(2, "0")}] idx=${s.idx} ${s.text}`).join("\n");

      const prompt = `Group these podcast transcript segments into 4-10 chapters. Return JSON only:
{"chapters": [{"start_idx": <segment idx where chapter starts>, "title": "<short chapter name>"}]}
Chapters must start at a real segment idx, first chapter starts at idx 0, in order.

${lines}`;

      const started = Date.now();
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You segment podcasts into chapters. Always respond with valid JSON only." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
        }),
      });
      const latency_ms = Date.now() - started;

      if (!res.ok) {
        const detail = await res.text();
        console.error(`[writer] chapters failed: ${res.status} ${detail.slice(0, 500)}`);
        return json({ error: "writer failed" }, 502);
      }
      const data = await res.json();
      const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
      const content = data.choices?.[0]?.message?.content ?? "{}";
      let parsed: { chapters?: { start_idx?: number; title?: string }[] };
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = { chapters: [] };
      }

      const idxToStart = new Map<number, number>();
      for (const s of segs) idxToStart.set(s.idx, s.start_s);

      const chapters = [];
      for (const c of Array.isArray(parsed.chapters) ? parsed.chapters : []) {
        const idx = Number(c?.start_idx);
        if (idxToStart.has(idx)) {
          chapters.push({ start_s: idxToStart.get(idx), title: String(c.title ?? "").slice(0, 60) });
        }
      }
      // Ensure first chapter starts at first segment
      if (chapters.length === 0 || chapters[0].start_s !== segs[0].start_s) {
        chapters.unshift({ start_s: segs[0].start_s, title: "Intro" });
      }

      const inTok = tokenCount(usage.prompt_tokens);
      const outTok = tokenCount(usage.completion_tokens);
      const cost_usd = (inTok * 0.42 + outTok * 0.42) / 1_000_000;

      if (typeof episodeId === "string") {
        await recordEpisodeUsage(supabase, episodeId, cost_usd, latency_ms, "ready");
      }

      return json({ chapters, model, usage: { input_tokens: inTok, output_tokens: outTok }, latency_ms, cost_usd });
    }

    return json({ error: "mode must be clip_copy or chapters" }, 400);
  } catch (err) {
    console.error("[writer] unhandled error", err);
    return json({ error: "internal_error" }, 500);
  }
});
