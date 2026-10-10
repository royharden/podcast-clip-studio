import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Copy, Check, Play, AlertTriangle, Share2 } from "lucide-react";
import { formatTime } from "@/lib/clips";
import type { Clip } from "@/types";

interface Props {
  clip: Clip;
  index: number;
  onPlay: (startS: number) => void;
  hook?: number | null;
  hookConf?: number | null;
  standalone?: number | null;
  risky?: number | null;
  rawJev?: unknown;
}

export function ClipCard({ clip, index, onPlay, hook, hookConf, standalone, risky, rawJev }: Props) {
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const copyCaption = async () => {
    const text = `${clip.caption ?? ""}\n${(clip.hashtags ?? []).join(" ")}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  const shareUrl = `#/clip/${clip.id}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-400/80">Clip {index + 1}</p>
          <h3 className="mt-1 text-base font-semibold leading-snug text-zinc-100">{clip.title ?? "Untitled clip"}</h3>
          <p className="mt-1 text-xs tabular-nums text-zinc-500">
            {formatTime(clip.start_s)} – {formatTime(clip.end_s)} · score {clip.clip_score.toFixed(2)}
            {clip.low_confidence && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-500">
                <AlertTriangle size={11} /> low confidence
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => onPlay(clip.start_s)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400 text-zinc-950 transition-transform hover:scale-105"
          aria-label="Play clip"
        >
          <Play size={15} fill="currentColor" className="ml-0.5" />
        </button>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-zinc-300">{clip.caption}</p>
      <p className="mt-2 text-xs text-emerald-400/90">{(clip.hashtags ?? []).join(" ")}</p>

      <div className="mt-4 space-y-2">
        <JevBar label="Hook" value={hook ?? 0} max={4} color="#fbbf24" />
        <JevBar label="Standalone" value={standalone ?? 0} max={1} color="#34d399" />
        <JevBar label="Risky" value={risky ?? 0} max={1} color="#f87171" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={copyCaption}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-200"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy caption"}
        </button>
        <a
          href={`#/clip/${clip.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-amber-500 hover:text-amber-200"
        >
          <Share2 size={13} />
          Share page
        </a>
        <button
          onClick={() => setShowRaw((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-500"
        >
          <ChevronDown size={13} className={`transition-transform ${showRaw ? "rotate-180" : ""}`} />
          Raw Jev JSON
        </button>
      </div>

      {showRaw && (
        <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-400">
          {JSON.stringify(
            {
              clip_score: clip.clip_score,
              hook: hook,
              hook_confidence: hookConf,
              standalone: standalone,
              risky: risky,
              segment_ids: clip.segment_ids,
              raw: rawJev,
            },
            null,
            2,
          )}
        </pre>
      )}
    </motion.div>
  );
}

function JevBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-[11px] uppercase tracking-wide text-zinc-500">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
