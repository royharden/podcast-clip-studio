import type { ClipType, Segment } from "@/types";

export interface ScoredSegment {
  idx: number;
  start_s: number;
  end_s: number;
  text: string;
  hook: number;
  hook_conf: number;
  standalone: number;
  risky: number;
  clip_type: ClipType;
}

export interface PickedClip {
  segmentIds: number[];
  startS: number;
  endS: number;
  clipScore: number;
  lowConfidence: boolean;
  hook: number;
  hookConf: number;
  standalone: number;
  risky: number;
  clipType: ClipType;
  text: string;
}

export function computeClipScore(seg: ScoredSegment): number {
  const hookFactor = seg.hook / 4;
  const standaloneFactor = 0.6 + 0.4 * seg.standalone;
  const riskyGate = seg.risky >= 0.5 ? 0 : 1;
  const typeGate = seg.clip_type === "filler" ? 0.2 : 1;
  return hookFactor * standaloneFactor * riskyGate * typeGate;
}

const MIN_CLIP_S = 15;
const MAX_CLIP_S = 75;
const GAP_S = 60;

export function pickClips(segments: ScoredSegment[], topN = 5): PickedClip[] {
  const scored = segments.map((seg) => ({ seg, score: computeClipScore(seg) }));
  // Exclude clips cut to nothing by the risky gate when better candidates exist.
  const candidates = scored.filter((c) => c.score > 0).sort((a, b) => b.score - a.score);

  const picked: PickedClip[] = [];

  for (const { seg, score } of candidates) {
    if (picked.length >= topN) break;

    let startSeg = seg;
    let endSeg = seg;

    // Extend backwards by one neighbouring segment when standalone is weak
    // and the previous neighbour exists (it comes before it).
    if (seg.standalone < 0.5) {
      const prev = segments.find((s) => s.idx === seg.idx - 1);
      if (prev && computeClipScore(prev) > 0) startSeg = prev;
    }

    const startS = startSeg.start_s;
    let endS = endSeg.end_s;

    // Clips last 15-75s: extend into the next segment if too short, trim if too long.
    let next = segments.find((s) => s.idx === endSeg.idx + 1);
    while (endS - startS < MIN_CLIP_S && next && computeClipScore(next) > 0) {
      endSeg = next;
      endS = next.end_s;
      next = segments.find((s) => s.idx === endSeg.idx + 1);
    }
    if (endS - startS > MAX_CLIP_S) endS = startS + MAX_CLIP_S;
    if (endS - startS < MIN_CLIP_S) {
      // Clamp the window to the minimum rather than dropping the moment.
      endS = Math.min(startS + MIN_CLIP_S, startSeg.end_s > startS ? Math.max(endS, startS + 5) : startS + MIN_CLIP_S);
    }

    // No overlap and no closer than 60s to an already-picked clip.
    const conflicts = picked.some(
      (p) => startS < p.endS + GAP_S && p.startS < endS + GAP_S,
    );
    if (conflicts) continue;

    const segIds: number[] = [];
    for (let i = startSeg.idx; i <= endSeg.idx; i++) segIds.push(i);

    const text = segments
      .filter((s) => s.idx >= startSeg.idx && s.idx <= endSeg.idx)
      .map((s) => s.text)
      .join(" ");

    picked.push({
      segmentIds: segIds,
      startS,
      endS,
      clipScore: score,
      lowConfidence: seg.hook_conf < 0.4,
      hook: seg.hook,
      hookConf: seg.hook_conf,
      standalone: seg.standalone,
      risky: seg.risky,
      clipType: seg.clip_type,
      text,
    });
  }

  return picked.sort((a, b) => a.startS - b.startS);
}

export function toScoredSegments(segments: Segment[]): ScoredSegment[] {
  return segments
    .filter((s) => s.hook !== null && s.standalone !== null && s.risky !== null && s.clip_type !== null)
    .map((s) => ({
      idx: s.idx,
      start_s: Number(s.start_s),
      end_s: Number(s.end_s),
      text: s.text,
      hook: Number(s.hook),
      hook_conf: Number(s.hook_conf ?? 0),
      standalone: Number(s.standalone),
      risky: Number(s.risky),
      clip_type: s.clip_type as ClipType,
    }));
}

export function formatTime(s: number): string {
  const total = Math.max(0, Math.floor(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export const CLIP_TYPE_COLORS: Record<ClipType, string> = {
  story: "#22c55e",
  hot_take: "#ef4444",
  tip: "#3b82f6",
  stat: "#f59e0b",
  funny: "#ec4899",
  filler: "#6b7280",
  uncertain: "#94a3b8",
};
