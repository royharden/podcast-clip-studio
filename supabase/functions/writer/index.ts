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

interface ClipInput {
  clip_id: string;
  text: string;
  hook: number;
  hook_conf: number;
  standalone: number;
  risky: number;
  clip_type: string;
  clip_score: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    const baseUrl = Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
    const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-6-luna";

    const body = await req.json();
    const mode = body.mode as "clip_copy" | "chapters";
    const mock = body.mock === true;

    const calls = await checkAndCountUsage(serviceKey, supabaseUrl, "writer");
    if (calls > DAILY_CAP) return json({ error: "daily_cap" }, 429);

    if (mode === "clip_copy") {
      const clip: ClipInput = body.clip;
      if (!clip) return json({ error: "clip required" }, 400);

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
        const tags = [tagMap[clip.clip_type] ?? "#podcast", "#clip", "#listen"];
        return json({ mock: true, title, caption, hashtags: tags, model: "mock", latency_ms: 0, cost_usd: 0 });
      }

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
        return json({ error: `writer failed: ${res.status} ${detail.slice(0, 200)}` }, 502);
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
      const inTok = usage.prompt_tokens ?? 0;
      const outTok = usage.completion_tokens ?? 0;
      // Approximate cost: same formula style, $0.42/M input and $0.42/M output for the writer.
      const cost_usd = (inTok * 0.42 + outTok * 0.42) / 1_000_000;

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
      const segs = body.segments as { idx: number; start_s: number; text: string }[];
      if (!Array.isArray(segs) || segs.length === 0) return json({ error: "segments required" }, 400);

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
        return json({ error: `writer failed: ${res.status} ${detail.slice(0, 200)}` }, 502);
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
      for (const c of parsed.chapters ?? []) {
        const idx = Number(c.start_idx);
        if (idxToStart.has(idx)) {
          chapters.push({ start_s: idxToStart.get(idx), title: String(c.title ?? "").slice(0, 60) });
        }
      }
      // Ensure first chapter starts at first segment
      if (chapters.length === 0 || chapters[0].start_s !== segs[0].start_s) {
        chapters.unshift({ start_s: segs[0].start_s, title: "Intro" });
      }

      const inTok = usage.prompt_tokens ?? 0;
      const outTok = usage.completion_tokens ?? 0;
      const cost_usd = (inTok * 0.42 + outTok * 0.42) / 1_000_000;

      return json({ chapters, model, usage: { input_tokens: inTok, output_tokens: outTok }, latency_ms, cost_usd });
    }

    return json({ error: "mode must be clip_copy or chapters" }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
