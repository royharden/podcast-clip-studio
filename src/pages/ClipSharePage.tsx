import { useEffect, useState } from "react";
import { Pause, Play, Podcast, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatTime } from "@/lib/clips";
import type { Clip, Episode } from "@/types";

interface Props {
  clipId: string;
}

export function ClipSharePage({ clipId }: Props) {
  const [clip, setClip] = useState<Clip | null>(null);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: clipRow } = await supabase
        .from("clips")
        .select("*")
        .eq("id", clipId)
        .maybeSingle();
      if (cancelled) return;
      if (!clipRow) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setClip(clipRow as Clip);
      const { data: epRow } = await supabase
        .from("episodes")
        .select("*")
        .eq("id", (clipRow as Clip).episode_id)
        .maybeSingle();
      if (cancelled) return;
      if (epRow) {
        setEpisode(epRow as Episode);
        if ((epRow as Episode).audio_path) {
          const { data } = supabase.storage
            .from("episodes")
            .getPublicUrl((epRow as Episode).audio_path!);
          const start = Math.floor((clipRow as Clip).start_s);
          const end = Math.ceil((clipRow as Clip).end_s);
          setAudioUrl(`${data.publicUrl}#t=${start},${end}`);
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [clipId]);

  const toggle = () => {
    if (!audioEl) return;
    if (playing) {
      audioEl.pause();
    } else {
      audioEl.play();
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-zinc-500">
        Loading clip…
      </div>
    );
  }

  if (notFound || !clip) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <Podcast size={28} className="text-zinc-600" />
        <p className="text-sm text-zinc-400">This clip doesn't exist or was removed.</p>
        <a href="#/" className="text-sm text-amber-300 hover:text-amber-200">
          Go to Podcast Clip Studio
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900/70 p-8 shadow-2xl shadow-black/40">
        <div className="mb-6 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-amber-400/80">
          <Podcast size={14} />
          {episode?.title ?? "Podcast clip"}
        </div>

        <h1 className="text-2xl font-semibold leading-snug tracking-tight text-zinc-50">
          {clip.title ?? "Untitled clip"}
        </h1>

        <p className="mt-4 text-sm leading-relaxed text-zinc-300">{clip.caption}</p>
        <p className="mt-3 text-xs text-emerald-400/90">{(clip.hashtags ?? []).join(" ")}</p>

        <div className="mt-6 flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <button
            onClick={toggle}
            disabled={!audioUrl}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-400 text-zinc-950 transition-transform hover:scale-105 disabled:opacity-30"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-zinc-200">
              {formatTime(clip.start_s)} – {formatTime(clip.end_s)}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {audioUrl ? "Plays just this clip" : "Demo episode — audio playback unavailable"}
            </p>
          </div>
        </div>

        {audioUrl && (
          <audio
            ref={setAudioEl}
            src={audioUrl}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              if (Number.isFinite(clip.start_s)) el.currentTime = clip.start_s;
            }}
            onTimeUpdate={(e) => {
              const el = e.currentTarget;
              if (el.currentTime >= clip.end_s) {
                el.pause();
                el.currentTime = clip.start_s;
              }
            }}
            preload="metadata"
            className="hidden"
          />
        )}

        <div className="mt-8 flex items-center justify-between border-t border-zinc-800 pt-5">
          <a href="#/" className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300">
            <ArrowLeft size={13} />
            Podcast Clip Studio
          </a>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href);
              } catch {
                // clipboard unavailable
              }
            }}
            className="text-xs text-amber-300 transition-colors hover:text-amber-200"
          >
            Copy link
          </button>
        </div>
      </div>
    </div>
  );
}
