import { useCallback, useState } from "react";
import { supabase, callEdgeFunction } from "@/lib/supabase";
import { DEMO_SHOW, DEMO_SEGMENTS, DEMO_PEAKS, DEMO_DURATION_S } from "@/lib/demoEpisode";
import { pickClips } from "@/lib/clips";
import type { Clip, ClipType, Episode, Step } from "@/types";

export interface PipelineState {
  step: Step;
  error: string | null;
  scoredCount: number;
  totalSegments: number;
  episode: Episode | null;
  clips: Clip[];
  dailyCapReached: boolean;
}

const INITIAL: PipelineState = {
  step: "upload",
  error: null,
  scoredCount: 0,
  totalSegments: 0,
  episode: null,
  clips: [],
  dailyCapReached: false,
};

interface TranscribeResponse {
  merged_segments: { start: number; end: number; text: string }[];
  duration_s: number;
}

interface JevAnswer {
  key: string;
  batch?: string[];
  response?: Record<string, any>;
}

interface JevScoreResponse {
  answers: JevAnswer[];
  model: string | null;
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
  cost_usd: number;
}

interface WriterClipCopyResponse {
  title: string;
  caption: string;
  hashtags: string[];
  cost_usd: number;
  latency_ms: number;
}

interface WriterChaptersResponse {
  chapters: { start_s: number; title: string }[];
  cost_usd: number;
  latency_ms: number;
}

function isDailyCap(err: unknown): boolean {
  return (err as { body?: { error?: string } }).body?.error === "daily_limit";
}

export function usePipeline() {
  const [state, setState] = useState<PipelineState>(INITIAL);

  const reset = useCallback(() => setState(INITIAL), []);

  const run = useCallback(async (opts: { file?: File; title: string; showDescription: string; demo: boolean }) => {
    setState({ ...INITIAL, step: "transcribe" });
    const { file, title, showDescription, demo } = opts;

    try {
      let audioPath: string | null = null;
      let peaks: number[] | null = null;
      let duration = 0;
      let mergedSegments: { start: number; end: number; text: string }[] = [];
      // Upload episodes are inserted up front (transcribe checks the row); their progress and
      // stats are then recorded by the edge functions. Demo episodes are inserted once at the end.
      let uploadEpisode: Episode | null = null;

      if (demo) {
        duration = DEMO_DURATION_S;
        peaks = DEMO_PEAKS;
        // The demo transcript is already merged-sized (~20-40s), pass it through
        // the real merge endpoint in mock mode so the pipeline shape is identical.
        const res = await callEdgeFunction<TranscribeResponse>("transcribe", {
          episode_id: "demo",
          audio_path: "demo/mock.mp3",
          mock: true,
          mock_segments: DEMO_SEGMENTS.map((s) => ({ start: s.start_s, end: s.end_s, text: s.text })),
        });
        mergedSegments = res.merged_segments;
      } else if (file) {
        if (file.size > 25 * 1024 * 1024) {
          throw new Error("File is larger than 25 MB.");
        }
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "mp3";
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("episodes")
          .upload(path, file, { upsert: false });
        if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
        audioPath = path;

        const { data: ep, error: epErr } = await supabase
          .from("episodes")
          .insert({ title, show_description: showDescription, audio_path: audioPath, status: "transcribing", source: "upload", duration_s: 0 })
          .select()
          .single();
        if (epErr || !ep) throw new Error(`Could not create episode: ${epErr?.message ?? "unknown"}`);
        uploadEpisode = ep as Episode;
        setState((s) => ({ ...s, episode: ep as Episode }));

        const res = await callEdgeFunction<TranscribeResponse>("transcribe", {
          episode_id: ep.id,
          audio_path: audioPath,
        });
        mergedSegments = res.merged_segments;
        duration = res.duration_s;
      } else {
        throw new Error("No file provided.");
      }

      if (mergedSegments.length === 0) throw new Error("Transcription returned no segments.");

      setState((s) => ({ ...s, step: "scoring", totalSegments: mergedSegments.length, scoredCount: 0 }));

      // --- Jev scoring: batch up to 10 segments per request ---
      const showDesc = demo ? DEMO_SHOW : showDescription || DEMO_SHOW;
      const uploadEpisodeId = uploadEpisode?.id ?? null;

      let jevCalls = 0;
      let jevCost = 0;
      let jevLatency = 0;
      const scored: {
        idx: number;
        start_s: number;
        end_s: number;
        text: string;
        jev: Record<string, unknown>;
        hook: number;
        hook_conf: number;
        standalone: number;
        risky: number;
        clip_type: string;
      }[] = [];

      for (let i = 0; i < mergedSegments.length; i += 10) {
        const batch = mergedSegments.slice(i, i + 10);
        let jevRes: JevScoreResponse;
        try {
          jevRes = await callEdgeFunction<JevScoreResponse>("jev-score", {
            episode_id: uploadEpisodeId,
            show: showDesc,
            mock: demo,
            segments: batch.map((s, j) => ({ idx: i + j, text: s.text })),
          });
        } catch (err) {
          if (isDailyCap(err)) {
            setState((s) => ({ ...s, dailyCapReached: true }));
            throw new Error("Daily demo limit reached. Try again tomorrow.");
          }
          throw err;
        }
        jevCalls += 1;
        jevCost += jevRes.cost_usd ?? 0;
        jevLatency += jevRes.latency_ms ?? 0;

        // Flatten per-question Jev answers (keyed `s{idx}__{q}`) into per-segment objects
        const flat: Record<string, Record<string, any>> = {};
        for (const ans of jevRes.answers ?? []) {
          if (!ans.response) continue;
          for (const [qk, qv] of Object.entries(ans.response)) {
            const m = qk.match(/^(s\d+)__(\w+)$/);
            if (m) {
              const segKey = m[1];
              flat[segKey] = flat[segKey] ?? {};
              flat[segKey][m[2]] = qv;
            }
          }
        }

        batch.forEach((seg, j) => {
          const key = `s${j}`;
          const r = flat[key] ?? {};
          const hook = typeof r.hook?.score === "number" ? r.hook.score : 0;
          const hookConf = typeof r.hook?.confidence === "number" ? r.hook.confidence : 0;
          const standaloneP = typeof r.standalone?.noul === "number" ? r.standalone.noul : 0;
          const riskyP = typeof r.risky?.noul === "number" ? r.risky.noul : 0;
          scored.push({
            idx: i + j,
            start_s: seg.start,
            end_s: seg.end,
            text: seg.text,
            jev: r,
            hook,
            hook_conf: hookConf,
            standalone: Math.abs(2 * standaloneP - 1),
            risky: riskyP,
            clip_type: typeof r.clip_type?.choice === "string" ? r.clip_type.choice : "uncertain",
          });
        });

        setState((s) => ({ ...s, scoredCount: scored.length }));
      }

      // --- Clip picking in code ---
      const picked = pickClips(scored.map((s) => ({ ...s, clip_type: s.clip_type as ClipType })), 5);
      setState((s) => ({ ...s, step: "writing" }));

      // --- Writer: clip copy + chapters ---
      let writerCalls = 0;
      let writerCost = 0;
      let writerLatency = 0;
      const clipRows: Partial<Clip>[] = [];

      for (const clip of picked) {
        let title = "";
        let caption = "";
        let hashtags: string[] = [];
        try {
          const w = await callEdgeFunction<WriterClipCopyResponse>("writer", {
            mode: "clip_copy",
            mock: demo,
            episode_id: uploadEpisodeId,
            clip: {
              clip_id: "pending",
              text: clip.text,
              hook: clip.hook,
              hook_conf: clip.hookConf,
              standalone: clip.standalone,
              risky: clip.risky,
              clip_type: clip.clipType,
              clip_score: clip.clipScore,
            },
          });
          writerCalls += 1;
          writerCost += w.cost_usd ?? 0;
          writerLatency += w.latency_ms ?? 0;
          title = w.title;
          caption = w.caption;
          hashtags = w.hashtags;
        } catch {
          const firstSentence = clip.text.split(/(?<=[.!?])\s/)[0] ?? clip.text;
          title = firstSentence.slice(0, 60);
          caption = clip.text.slice(0, 200);
          hashtags = ["#podcast", "#clip", "#listen"];
        }
        clipRows.push({
          start_s: clip.startS,
          end_s: clip.endS,
          segment_ids: clip.segmentIds,
          clip_score: clip.clipScore,
          title,
          caption,
          hashtags,
          low_confidence: clip.lowConfidence,
        });
      }

      // Chapters
      let chapterRows: { start_s: number; title: string }[] = [];
      try {
        const ch = await callEdgeFunction<WriterChaptersResponse>("writer", {
          mode: "chapters",
          mock: demo,
          episode_id: uploadEpisodeId,
          segments: scored.map((s) => ({ idx: s.idx, start_s: s.start_s, text: s.text })),
        });
        writerCalls += 1;
        writerCost += ch.cost_usd ?? 0;
        writerLatency += ch.latency_ms ?? 0;
        chapterRows = ch.chapters.map((c) => ({ start_s: c.start_s, title: c.title }));
      } catch {
        // Fallback: chapters every ~5 minutes at real segment starts
        const segs = scored.map((s) => ({ idx: s.idx, start_s: s.start_s, text: s.text }));
        let curStart = 0;
        let n = 1;
        for (const s of segs) {
          if (s.start_s >= curStart) {
            chapterRows.push({ start_s: s.start_s, title: `Chapter ${n}` });
            curStart += 300;
            n += 1;
          }
        }
      }

      // --- Persist (insert-only: the browser has no UPDATE on these tables) ---
      let savedEpisode = uploadEpisode;
      if (!savedEpisode) {
        const { data: ep, error } = await supabase
          .from("episodes")
          .insert({
            title,
            show_description: showDesc,
            audio_path: audioPath,
            status: "ready",
            source: demo ? "demo" : "upload",
            duration_s: duration,
            waveform_peaks: peaks,
            jev_calls: jevCalls,
            jev_cost_usd: jevCost,
            jev_latency_ms_sum: jevLatency,
            writer_calls: writerCalls,
            writer_cost_usd: writerCost,
            writer_latency_ms_sum: writerLatency,
          })
          .select()
          .single();
        if (error || !ep) throw new Error(`Could not save episode: ${error?.message ?? "unknown"}`);
        savedEpisode = ep as Episode;
      }
      const finalEpisodeId = savedEpisode.id;

      const { error: segErr } = await supabase
        .from("segments")
        .insert(scored.map((s) => ({ ...s, episode_id: finalEpisodeId })));
      if (segErr) throw new Error(`Could not save segments: ${segErr.message}`);

      const { data: savedClips, error: clipErr } = await supabase
        .from("clips")
        .insert(clipRows.map((c) => ({ ...c, episode_id: finalEpisodeId })))
        .select();
      if (clipErr) throw new Error(`Could not save clips: ${clipErr.message}`);

      const { error: chapErr } = await supabase
        .from("chapters")
        .insert(chapterRows.map((c) => ({ ...c, episode_id: finalEpisodeId })));
      if (chapErr) throw new Error(`Could not save chapters: ${chapErr.message}`);

      const { data: epFinal } = await supabase
        .from("episodes")
        .select()
        .eq("id", finalEpisodeId)
        .maybeSingle();

      setState({
        step: "done",
        error: null,
        scoredCount: scored.length,
        totalSegments: mergedSegments.length,
        episode: (epFinal as Episode | null) ?? savedEpisode,
        clips: (savedClips as Clip[]) ?? [],
        dailyCapReached: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, step: "upload", error: message }));
    }
  }, []);

  return { state, run, reset };
}
