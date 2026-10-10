import { useEffect, useRef } from "react";
import { CLIP_TYPE_COLORS } from "@/lib/clips";
import type { Segment } from "@/types";

interface Props {
  segments: Segment[];
  currentTime: number;
  onSeek: (t: number) => void;
}

export function TranscriptView({ segments, currentTime, onSeek }: Props) {
  const activeRef = useRef<HTMLButtonElement>(null);

  const activeIdx = segments.findIndex((s) => currentTime >= s.start_s && currentTime < s.end_s);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIdx]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
      <div className="border-b border-zinc-800 px-5 py-3">
        <h2 className="text-sm font-semibold text-zinc-200">Transcript</h2>
      </div>
      <div className="max-h-[480px] space-y-1 overflow-y-auto p-3">
        {segments.map((seg, i) => {
          const active = i === activeIdx;
          return (
            <button
              key={seg.id}
              ref={active ? activeRef : undefined}
              onClick={() => onSeek(seg.start_s)}
              className={`flex w-full gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                active ? "bg-amber-400/10 ring-1 ring-amber-400/40" : "hover:bg-zinc-800/60"
              }`}
            >
              <span
                className={`mt-0.5 shrink-0 text-xs tabular-nums ${
                  active ? "text-amber-300" : "text-zinc-600"
                }`}
              >
                {formatTime(seg.start_s)}
              </span>
              <span className="flex-1">
                <span
                  className={`mr-2 inline-block rounded px-1.5 py-0.5 align-middle text-[10px] font-medium ${
                    active ? "text-zinc-950" : "text-zinc-950/80"
                  }`}
                  style={{
                    backgroundColor: seg.clip_type ? CLIP_TYPE_COLORS[seg.clip_type] : "#52525b",
                    opacity: active ? 1 : 0.75,
                  }}
                >
                  {seg.clip_type ?? "unscored"}
                </span>
                <span className={`text-sm leading-relaxed ${active ? "text-zinc-100" : "text-zinc-400"}`}>
                  {seg.text}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatTime(s: number): string {
  const total = Math.max(0, Math.floor(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
