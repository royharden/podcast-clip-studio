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
const MODEL = "jev-1.13.0";

interface ScoreInput {
  key: string; // e.g. "s12"
  text: string;
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

async function callJev(apiKey: string, items: ScoreInput[], show: string) {
  const state: Record<string, unknown> = { show };
  const segments: Record<string, string> = {};
  for (const item of items) segments[item.key] = item.text;
  state.segments = segments;
  const built = buildQuestions(items);
  if (show) state.show = show;

  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, state, questions: built.questions }),
  });
  const latency_ms = Date.now() - 0;
  return { res, latency_ms };
}

async function callJevWithRetry(apiKey: string, items: ScoreInput[], show: string) {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const started = Date.now();
    const { res } = await callJev(apiKey, items, show);
    const latency_ms = Date.now() - started;

    if (res.status === 429 || res.status === 529) {
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      return { error: `Jev rate-limited after retries (status ${res.status})`, latency_ms };
    }
    if (!res.ok) {
      const detail = await res.text();
      return { error: `Jev request failed: ${res.status} ${detail.slice(0, 200)}`, latency_ms };
    }
    const data = await res.json();
    return { data, latency_ms };
  }
  return { error: "unreachable", latency_ms: 0 };
}

// Recursive: split batch in half on validation failure / question limit.
async function scoreBatch(apiKey: string, items: ScoreInput[], show: string, depth = 0): Promise<{
  answers: unknown[];
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
  splits: number;
  error?: string;
}> {
  if (items.length === 0) return { answers: [], usage: { input_tokens: 0, output_tokens: 0 }, latency_ms: 0, splits: 0 };
  if (items.length === 1) {
    const r = await callJevWithRetry(apiKey, items, show);
    if (r.error) return { answers: [], usage: { input_tokens: 0, output_tokens: 0 }, latency_ms: r.latency_ms ?? 0, splits: depth, error: r.error };
    return { answers: [{ key: items[0].key, response: r.data }], usage: r.data?.usage ?? { input_tokens: 0, output_tokens: 0 }, latency_ms: r.latency_ms ?? 0, splits: depth };
  }

  const r = await callJevWithRetry(apiKey, items, show);
  if (r.error) {
    // Split in half and retry
    const mid = Math.floor(items.length / 2);
    const left = await scoreBatch(apiKey, items.slice(0, mid), show, depth + 1);
    const right = await scoreBatch(apiKey, items.slice(mid), show, depth + 1);
    return {
      answers: [...left.answers, ...right.answers],
      usage: {
        input_tokens: (left.usage?.input_tokens ?? 0) + (right.usage?.input_tokens ?? 0),
        output_tokens: (left.usage?.output_tokens ?? 0) + (right.usage?.output_tokens ?? 0),
      },
      latency_ms: (left.latency_ms ?? 0) + (right.latency_ms ?? 0),
      splits: depth + 1,
      error: left.error ?? right.error,
    };
  }
  return { answers: [{ batch: items.map((i) => i.key), response: r.data }], usage: r.data?.usage ?? { input_tokens: 0, output_tokens: 0 }, latency_ms: r.latency_ms ?? 0, splits: depth };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const typesafeKey = Deno.env.get("TYPESAFE_API_KEY") ?? "";

    const { segments, show, episode_id, mock: mockFlag } = await req.json();
    if (!Array.isArray(segments) || segments.length === 0) {
      return json({ error: "segments array required" }, 400);
    }

    const calls = await checkAndCountUsage(serviceKey, supabaseUrl, "jev-score");
    if (calls > DAILY_CAP) return json({ error: "daily_cap" }, 429);

    const items: ScoreInput[] = segments.map((s: { idx: number; text: string }, i: number) => ({
      key: `s${i}`,
      text: String(s.text ?? "").slice(0, 4000),
    }));

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

    const t0 = Date.now();
    const result = await scoreBatch(typesafeKey, items, typeof show === "string" ? show : "");
    const totalLatency = Date.now() - t0;

    const model = result.answers?.[0]?.response?.model ?? result.answers?.[0]?.response?.model;
    const usage = result.usage ?? { input_tokens: 0, output_tokens: 0 };
    const cost_usd = (usage.input_tokens * 0.042) / 1_000_000;

    if (result.error) {
      console.log(`[jev-score] batch split retries=${result.splits} error=${result.error}`);
      return json({ error: result.error, model: MODEL, usage, latency_ms: totalLatency, cost_usd, answers: result.answers }, 502);
    }

    console.log(`[jev-score] model=${model} segments=${segments.length} splits=${result.splits} input_tokens=${usage.input_tokens} cost_usd=${cost_usd.toFixed(6)} latency_ms=${totalLatency}`);

    return json({
      episode_id: episode_id ?? null,
      answers: result.answers,
      model,
      usage,
      latency_ms: totalLatency,
      cost_usd,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

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
  if (rpcRes.ok) {
    const val = await rpcRes.json();
    return typeof val === "number" ? val : 1;
  }
  return 1;
}
