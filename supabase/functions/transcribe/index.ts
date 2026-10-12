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
const MAX_BODY_BYTES = 512 * 1024;
const MAX_MOCK_SEGMENTS = 2000;
const MAX_SEGMENT_TEXT_CHARS = 4000;
const MAX_EPISODE_ID_CHARS = 64;
const MAX_AUDIO_PATH_CHARS = 256;

// Uploads are stored as "<uuid>.<ext>": exactly one path segment, so no "/", "\", "..",
// "%", "?" or "#" can steer the storage request outside the episodes bucket. The
// storage client concatenates the path into the URL unencoded, so this check is the guard.
const AUDIO_PATH_RE = /^[A-Za-z0-9-]{1,64}\.[A-Za-z0-9]{1,5}$/;
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

interface RawSegment {
  start: number;
  end: number;
  text: string;
}

// Mock segments come from the client (demo episode), so bound their count and size.
function parseMockSegments(value: unknown): RawSegment[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_MOCK_SEGMENTS) return null;
  const out: RawSegment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { start, end, text } = item as Record<string, unknown>;
    if (typeof start !== "number" || !Number.isFinite(start)) return null;
    if (typeof end !== "number" || !Number.isFinite(end)) return null;
    if (typeof text !== "string" || text.length > MAX_SEGMENT_TEXT_CHARS) return null;
    out.push({ start, end, text });
  }
  return out;
}

// Merge raw whisper segments into ~20-40s segments that break at sentence ends.
function mergeSegments(raw: RawSegment[]): RawSegment[] {
  const out: RawSegment[] = [];
  let cur: RawSegment | null = null;

  const endsSentence = (t: string) => /[.!?…]["')\]]?\s*$/.test(t.trim());

  for (const seg of raw) {
    if (!cur) {
      cur = { ...seg };
      continue;
    }
    const curLen = cur.end - cur.start;
    const nextLen = seg.end - seg.start;

    if (curLen >= 40) {
      out.push(cur);
      cur = { ...seg };
      continue;
    }
    if (curLen >= 20 && endsSentence(cur.text)) {
      out.push(cur);
      cur = { ...seg };
      continue;
    }
    if (curLen + nextLen > 60) {
      out.push(cur);
      cur = { ...seg };
      continue;
    }
    cur = { start: cur.start, end: seg.end, text: `${cur.text} ${seg.text}`.trim() };
  }
  if (cur) out.push(cur);
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.error("[transcribe] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
      return json({ error: "service_unavailable" }, 503);
    }
    const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    const baseUrl = Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
    const model = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") ?? "whisper-1";

    const parsed = await readJsonBody(req, MAX_BODY_BYTES);
    if ("res" in parsed) return parsed.res;
    const { episode_id, audio_path, mock, mock_segments } = parsed.body;
    const useMock = mock === true;

    if (!useMock && !openaiKey) {
      return json({ error: "OPENAI_API_KEY not configured" }, 500);
    }
    if (!episode_id || !audio_path) {
      return json({ error: "episode_id and audio_path required" }, 400);
    }
    if (
      typeof episode_id !== "string" || episode_id.length > MAX_EPISODE_ID_CHARS ||
      typeof audio_path !== "string" || audio_path.length > MAX_AUDIO_PATH_CHARS
    ) {
      return json({ error: "invalid episode_id or audio_path" }, 400);
    }

    let mockRaw: RawSegment[] = [];
    if (useMock) {
      const segs = parseMockSegments(mock_segments);
      if (!segs) return json({ error: "invalid_mock_segments" }, 422);
      mockRaw = segs;
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (!useMock) {
      if (!AUDIO_PATH_RE.test(audio_path)) {
        return json({ error: "invalid_audio_path" }, 400);
      }
      // Only transcribe a file that its episode row actually points at.
      if (!UUID_RE.test(episode_id)) {
        return json({ error: "episode_not_found" }, 404);
      }
      const { data: episode, error: epErr } = await supabase
        .from("episodes")
        .select("audio_path")
        .eq("id", episode_id)
        .maybeSingle();
      if (epErr) console.error("[transcribe] episode lookup failed", epErr);
      if (epErr || !episode || episode.audio_path !== audio_path) {
        return json({ error: "episode_not_found" }, 404);
      }
    }

    const usage = await checkAndCountUsage(supabase, "transcribe");
    if (usage !== "ok") return usageBlocked(usage);

    let rawSegments: RawSegment[];
    let durationS = 0;
    let language = "unknown";
    let text = "";

    if (useMock) {
      // Mock mode never touches Storage: the audio bytes are unused.
      rawSegments = mockRaw;
      durationS = rawSegments.length > 0 ? rawSegments[rawSegments.length - 1].end : 0;
      language = "en";
      text = rawSegments.map((s) => s.text).join(" ");
    } else {
      // Download from Storage
      const { data: fileBlob, error: dlErr } = await supabase.storage.from("episodes").download(audio_path);
      if (dlErr || !fileBlob) {
        console.error("[transcribe] audio download failed", dlErr);
        return json({ error: "failed to fetch audio" }, 500);
      }

      const formData = new FormData();
      formData.append("file", fileBlob, audio_path.split("/").pop() ?? "audio.mp3");
      formData.append("model", model);
      formData.append("response_format", "verbose_json");
      formData.append("timestamp_granularities[]", "segment");

      const apiRes = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: formData,
      });
      if (!apiRes.ok) {
        const detail = await apiRes.text();
        console.error(`[transcribe] transcription failed: ${apiRes.status} ${detail.slice(0, 500)}`);
        return json({ error: "transcription failed" }, 502);
      }
      const data = await apiRes.json();
      rawSegments = (data.segments ?? []).map((s: RawSegment) => ({ start: s.start, end: s.end, text: s.text }));
      durationS = data.duration ?? rawSegments[rawSegments.length - 1]?.end ?? 0;
      language = data.language ?? "unknown";
      text = data.text ?? "";

      // The browser has no UPDATE on episodes, so record progress here with the service
      // role: whitelisted columns only, on the verified row, while it is still transcribing.
      const safeDuration = typeof durationS === "number" && Number.isFinite(durationS) && durationS >= 0 && durationS < 1e6
        ? durationS
        : 0;
      const { error: progressErr } = await supabase
        .from("episodes")
        .update({ status: "scoring", duration_s: safeDuration })
        .eq("id", episode_id)
        .eq("audio_path", audio_path)
        .in("status", ["uploading", "transcribing"]);
      if (progressErr) console.error("[transcribe] episode progress update failed", progressErr);
    }

    const merged = mergeSegments(rawSegments);

    return json({
      episode_id,
      merged_segments: merged,
      duration_s: durationS,
      language,
      full_text: text,
    });
  } catch (err) {
    console.error("[transcribe] unhandled error", err);
    return json({ error: "internal_error" }, 500);
  }
});
