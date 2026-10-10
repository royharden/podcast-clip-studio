import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Coins, Timer, Zap, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { WaveformPlayer } from "@/components/WaveformPlayer";
import { TranscriptView } from "@/components/TranscriptView";
import { HookHeatmap } from "@/components/HookHeatmap";
import { ClipCard } from "@/components/ClipCard";
import type { Chapter, Clip, Episode, Segment } from "@/types";

interface Props {
  episodeId: string;
  onBack: () => void;
}

export function StudioPage({ episodeId, onBack }: Props) {
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data: ep, error: epErr } = await supabase
        .from("episodes")
        .select("*")
        .eq("id", episodeId)
        .maybeSingle();
      if (cancelled) return;
      if (epErr || !ep) {
        setError("Episode not found.");
        setLoading(false);
        return;
      }
      setEpisode(ep as Episode);
      if (ep.audio_path) {
        const { data } = supabase.storage.from("episodes").getPublicUrl(ep.audio_path);
        setAudioUrl(data.publicUrl);
      }
      const [segRes, clipRes, chapRes] = await Promise.all([
        supabase.from("segments").select("*").eq("episode_id", episodeId).order("idx"),
        supabase.from("clips").select("*").eq("episode_id", episodeId).order("start_s"),
        supabase.from("chapters").select("*").eq("episode_id", episodeId).order("start_s"),
      ]);
      if (cancelled) return;
      setSegments((segRes.data as Segment[]) ?? []);
      setClips((clipRes.data as Clip[]) ?? []);
      setChapters((chapRes.data as Chapter[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [episodeId]);

  const stats = useMemo(() => {
    if (!episode) return null;
    const jevCalls = episode.jev_calls ?? 0;
    const jevAvg = jevCalls > 0 ? Number(episode.jev_latency_ms_sum) / jevCalls : 0;
    return {
      jevCalls,
      cost: Number(episode.jev_cost_usd ?? 0) + Number(episode.writer_cost_usd ?? 0),
      jevAvg,
    };
  }, [episode]);

  const seek = (t: number) => {
    setCurrentTime(t);
    window.dispatchEvent(new CustomEvent("pcs-seek", { detail: t }));
  };

  useEffect(() => {
    const onSeek = (e: Event) => {
      const t = (e as CustomEvent<number>).detail;
      setCurrentTime(t);
    };
    window.addEventListener("pcs-seek", onSeek);
    return () => window.removeEventListener("pcs-seek", onSeek);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-zinc-500">
        Loading studio…
      </div>
    );
  }

  if (error || !episode) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-sm text-zinc-400">
        <p>{error ?? "Episode not found."}</p>
        <button onClick={onBack} className="text-amber-300 hover:text-amber-200">
          Back to upload
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="rounded-lg border border-zinc-800 p-2 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
            aria-label="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">{episode.title}</h1>
            <p className="text-xs text-zinc-500">{segments.length} segments · {clips.length} clips</p>
          </div>
        </div>
        {stats && (
          <div className="flex gap-4 text-xs text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <Zap size={13} className="text-amber-400" />
              {stats.jevCalls} Jev calls
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Coins size={13} className="text-emerald-400" />
              ${stats.cost.toFixed(4)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Timer size={13} className="text-sky-400" />
              {(stats.jevAvg / 1000).toFixed(1)}s avg
            </span>
          </div>
        )}
      </header>

      <WaveformPlayer
        key={audioUrl ?? "demo"}
        episode={episode}
        clips={clips}
        chapters={chapters}
        audioUrl={audioUrl}
        onTimeUpdate={(t) => {
          setCurrentTime(t);
          window.dispatchEvent(new CustomEvent("pcs-time", { detail: t }));
        }}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div>
            <h2 className="mb-3 text-sm font-semibold text-zinc-200">Top clips</h2>
            <div className="space-y-4">
              {clips.length === 0 && (
                <p className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 text-sm text-zinc-500">
                  No clips picked for this episode.
                </p>
              )}
              {clips.map((clip, i) => {
                const anchor = segments.find((s) => s.idx === clip.segment_ids[0]);
                return (
                  <ClipCard
                    key={clip.id}
                    clip={clip}
                    index={i}
                    onPlay={seek}
                    hook={anchor?.hook}
                    hookConf={anchor?.hook_conf}
                    standalone={anchor?.standalone}
                    risky={anchor?.risky}
                    rawJev={anchor?.jev}
                  />
                );
              })}
            </div>
          </div>
          <TranscriptView segments={segments} currentTime={currentTime} onSeek={seek} />
        </div>
        <div className="space-y-6">
          <HookHeatmap segments={segments} currentTime={currentTime} onSeek={seek} />
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <h2 className="mb-3 text-sm font-semibold text-zinc-200">How this works</h2>
            <p className="text-xs leading-relaxed text-zinc-500">
              Jev (TypeSafe AI's fast decision model) scores every segment for hook, standalone-ness,
              and risk. Code ranks segments and cuts clips. The LLM only writes titles, captions,
              and chapter names — Jev scores, code cuts, the LLM writes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
