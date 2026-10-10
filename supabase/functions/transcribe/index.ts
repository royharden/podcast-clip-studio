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

const DAILY_CAP = 200;

// Fail-closed usage counter: if the RPC errors or returns a non-number,
// return DAILY_CAP+1 so the caller blocks the request with 429 daily_cap.
async function checkAndCountUsage(serviceKey: string, supabaseUrl: string, fn: string): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/pcs_increment_usage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_fn: fn, p_day: day }),
  });
  if (!rpcRes.ok) {
    return DAILY_CAP + 1;
  }
  const val = await rpcRes.json();
  return typeof val === "number" ? val : DAILY_CAP + 1;
}

interface RawSegment {
  start: number;
  end: number;
  text: string;
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    const baseUrl = Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
    const model = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") ?? "whisper-1";

    const { episode_id, audio_path, mock, mock_segments } = await req.json();
    const useMock = mock === true;

    if (!useMock && !openaiKey) {
      return json({ error: "OPENAI_API_KEY not configured" }, 500);
    }
    if (!episode_id || !audio_path) {
      return json({ error: "episode_id and audio_path required" }, 400);
    }

    const calls = await checkAndCountUsage(serviceKey, supabaseUrl, "transcribe");
    if (calls > DAILY_CAP) {
      return json({ error: "daily_cap" }, 429);
    }

    // Download from Storage
    const fileRes = await fetch(`${supabaseUrl}/storage/v1/object/episodes/${audio_path}`, {
      headers: { Authorization: `Bearer ${serviceKey}` },
    });
    if (!fileRes.ok) {
      return json({ error: `failed to fetch audio: ${fileRes.status}` }, 500);
    }
    const fileBuffer = await fileRes.arrayBuffer();

    let rawSegments: RawSegment[];
    let durationS = 0;
    let language = "unknown";
    let text = "";

    if (useMock) {
      const mockRaw = Array.isArray(mock_segments)
        ? (mock_segments as RawSegment[])
        : [];
      rawSegments = mockRaw;
      durationS = rawSegments.length > 0 ? rawSegments[rawSegments.length - 1].end : 0;
      language = "en";
      text = rawSegments.map((s) => s.text).join(" ");
    } else {
      const formData = new FormData();
      formData.append("file", new Blob([fileBuffer]), audio_path.split("/").pop() ?? "audio.mp3");
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
        return json({ error: `transcription failed: ${apiRes.status} ${detail.slice(0, 200)}` }, 502);
      }
      const data = await apiRes.json();
      rawSegments = (data.segments ?? []).map((s: RawSegment) => ({ start: s.start, end: s.end, text: s.text }));
      durationS = data.duration ?? rawSegments[rawSegments.length - 1]?.end ?? 0;
      language = data.language ?? "unknown";
      text = data.text ?? "";
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
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
