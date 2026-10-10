import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { formatTime } from "@/lib/clips";
import type { Chapter, Clip, Episode } from "@/types";

interface Props {
  episode: Episode;
  clips: Clip[];
  chapters: Chapter[];
  audioUrl: string | null;
  onTimeUpdate?: (t: number) => void;
}

export function WaveformPlayer({ episode, clips, chapters, audioUrl, onTimeUpdate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<InstanceType<typeof RegionsPlugin> | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(episode.duration_s ?? 0);

  useEffect(() => {
    if (!containerRef.current) return;
    const peaks = episode.waveform_peaks;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 88,
      waveColor: "#3f3f46",
      progressColor: "#fbbf24",
      cursorColor: "#a1a1aa",
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      ...(peaks && episode.duration_s
        ? { peaks: [peaks as number[]], duration: episode.duration_s }
        : {}),
      url: audioUrl ?? undefined,
    });
    wsRef.current = ws;

    ws.on("ready", () => {
      setReady(true);
      setDuration(ws.getDuration() || episode.duration_s || 0);
    });
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("timeupdate", (t: number) => {
      setCurrent(t);
      onTimeUpdate?.(t);
    });
    ws.on("finish", () => setPlaying(false));

    if (clips.length > 0 && episode.duration_s) {
      const regions = RegionsPlugin.create();
      ws.registerPlugin(regions);
      regionsRef.current = regions;
      clips.forEach((clip, i) => {
        regions.addRegion({
          start: clip.start_s,
          end: clip.end_s,
          content: `Clip ${i + 1}`,
          color: "rgba(52, 211, 153, 0.12)",
          drag: false,
          resize: false,
        });
      });
    }

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  const toggle = () => wsRef.current?.playPause();

  const seek = (t: number) => {
    const ws = wsRef.current;
    if (!ws || !ready) return;
    ws.setTime(t);
    if (!playing) ws.play();
  };

  useEffect(() => {
    const onSeek = (e: Event) => {
      seek((e as CustomEvent<number>).detail);
    };
    window.addEventListener("pcs-seek", onSeek);
    return () => window.removeEventListener("pcs-seek", onSeek);
  });

  const skip = (d: number) => {
    const ws = wsRef.current;
    if (!ws || !ready) return;
    seek(Math.max(0, Math.min(duration, ws.getCurrentTime() + d)));
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="mb-4 flex items-center gap-4">
        <button
          onClick={() => skip(-10)}
          disabled={!ready}
          className="rounded-full p-2 text-zinc-400 transition-colors hover:text-zinc-100 disabled:opacity-30"
          aria-label="Back 10 seconds"
        >
          <SkipBack size={18} />
        </button>
        <button
          onClick={toggle}
          disabled={!ready}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-400 text-zinc-950 transition-transform hover:scale-105 disabled:opacity-30"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
        </button>
        <button
          onClick={() => skip(10)}
          disabled={!ready}
          className="rounded-full p-2 text-zinc-400 transition-colors hover:text-zinc-100 disabled:opacity-30"
          aria-label="Forward 10 seconds"
        >
          <SkipForward size={18} />
        </button>
        <span className="ml-2 text-sm tabular-nums text-zinc-400">
          {formatTime(current)} / {formatTime(duration)}
        </span>
      </div>

      <div ref={containerRef} className="min-h-[88px]" />

      {chapters.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {chapters.map((ch) => {
            const next = chapters.find((c) => c.start_s > ch.start_s);
            const active = current >= ch.start_s && (!next || current < next.start_s);
            return (
              <button
                key={ch.id}
                onClick={() => seek(ch.start_s)}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  active
                    ? "bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/50"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                }`}
              >
                {ch.title}
                <span className="ml-1.5 tabular-nums opacity-60">{formatTime(ch.start_s)}</span>
              </button>
            );
          })}
        </div>
      )}

      {clips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {clips.map((clip, i) => {
            const active = current >= clip.start_s && current < clip.end_s;
            return (
              <button
                key={clip.id}
                onClick={() => seek(clip.start_s)}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  active
                    ? "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/50"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                }`}
              >
                Clip {i + 1}
                <span className="ml-1.5 tabular-nums opacity-60">
                  {formatTime(clip.start_s)}–{formatTime(clip.end_s)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!ready && (
        <p className="mt-3 text-center text-xs text-zinc-500">
          {audioUrl ? "Loading audio…" : "Demo episode — waveform loaded from bundled peaks."}
        </p>
      )}
    </div>
  );
}
