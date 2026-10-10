import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { CLIP_TYPE_COLORS } from "@/lib/clips";
import type { Segment } from "@/types";

interface Props {
  segments: Segment[];
  currentTime: number;
  onSeek: (t: number) => void;
}

export function HookHeatmap({ segments, currentTime, onSeek }: Props) {
  const data = segments.map((s, i) => ({
    idx: i,
    hook: s.hook ?? 0,
    type: s.clip_type ?? "uncertain",
    start_s: Number(s.start_s),
    preview: s.text.length > 40 ? `${s.text.slice(0, 40)}…` : s.text,
  }));

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">Hook heatmap</h2>
        <div className="flex flex-wrap gap-2">
          {(["story", "hot_take", "tip", "stat", "funny", "filler"] as const).map((t) => (
            <span key={t} className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CLIP_TYPE_COLORS[t] }} />
              {t.replace("_", " ")}
            </span>
          ))}
        </div>
      </div>
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            onClick={(state) => {
              const idx = state?.activeTooltipIndex;
              if (typeof idx === "number" && data[idx]) onSeek(data[idx].start_s);
            }}
          >
            <XAxis dataKey="idx" tick={false} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 4]} width={20} tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              contentStyle={{
                background: "#18181b",
                border: "1px solid #3f3f46",
                borderRadius: 8,
                fontSize: 12,
                color: "#e4e4e7",
              }}
              formatter={(value) => [String(value ?? ""), "Hook"]}
              labelFormatter={(idx) => {
                const d = data[idx as number];
                return d ? `${idx} · ${d.preview}` : "";
              }}
            />
            <Bar dataKey="hook" radius={[2, 2, 0, 0]}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={CLIP_TYPE_COLORS[d.type as keyof typeof CLIP_TYPE_COLORS] ?? "#52525b"}
                  opacity={currentTime >= d.start_s && currentTime < (data[i + 1]?.start_s ?? Infinity) ? 1 : 0.55}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-center text-[11px] text-zinc-600">Click a bar to jump the player</p>
    </div>
  );
}
