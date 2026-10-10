import { Check, CircleDashed } from "lucide-react";
import type { Step } from "@/types";

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "transcribe", label: "Transcribe" },
  { id: "scoring", label: "Jev scoring" },
  { id: "writing", label: "Writing" },
];

const ORDER: Step[] = ["upload", "transcribe", "scoring", "writing", "done"];

interface Props {
  step: Step;
  scoredCount?: number;
  totalSegments?: number;
}

export function ProgressStepper({ step, scoredCount, totalSegments }: Props) {
  const currentIdx = ORDER.indexOf(step);
  return (
    <ol className="flex items-center gap-2 sm:gap-4">
      {STEPS.map((s, i) => {
        const idx = ORDER.indexOf(s.id);
        const done = currentIdx > idx || step === "done";
        const active = step === s.id;
        return (
          <li key={s.id} className="flex items-center gap-2">
            {i > 0 && <span className={`h-px w-4 sm:w-8 ${done ? "bg-amber-400" : "bg-zinc-700"}`} />}
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                done
                  ? "bg-amber-400 text-zinc-950"
                  : active
                    ? "border-2 border-amber-400 text-amber-300"
                    : "border border-zinc-700 text-zinc-500"
              }`}
            >
              {done ? <Check size={13} strokeWidth={3} /> : <CircleDashed size={13} />}
            </span>
            <span
              className={`text-xs sm:text-sm whitespace-nowrap ${
                active ? "text-amber-200 font-medium" : done ? "text-zinc-300" : "text-zinc-500"
              }`}
            >
              {s.label}
              {active && s.id === "scoring" && totalSegments ? (
                <span className="ml-1 tabular-nums text-amber-400">
                  {scoredCount}/{totalSegments}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
