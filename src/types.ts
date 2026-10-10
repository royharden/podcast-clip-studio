export type ClipType =
  | "story"
  | "hot_take"
  | "tip"
  | "stat"
  | "funny"
  | "filler"
  | "uncertain";

export type EpisodeStatus =
  | "uploading"
  | "transcribing"
  | "scoring"
  | "writing"
  | "ready"
  | "error";

export interface Episode {
  id: string;
  title: string;
  show_description: string | null;
  audio_path: string | null;
  duration_s: number | null;
  status: EpisodeStatus;
  source: "upload" | "demo";
  waveform_peaks: number[] | null;
  jev_calls: number;
  jev_cost_usd: number;
  jev_latency_ms_sum: number;
  writer_calls: number;
  writer_cost_usd: number;
  writer_latency_ms_sum: number;
  created_at: string;
}

export interface Segment {
  id: string;
  episode_id: string;
  idx: number;
  start_s: number;
  end_s: number;
  text: string;
  jev: JevRaw | null;
  hook: number | null;
  hook_conf: number | null;
  standalone: number | null;
  risky: number | null;
  clip_type: ClipType | null;
}

export interface JevRaw {
  hook?: { score?: number; confidence?: number; type?: string };
  standalone?: { noul?: number; type?: string };
  clip_type?: { choice?: string; confidence?: number; type?: string };
  risky?: { noul?: number; type?: string };
}

export interface Clip {
  id: string;
  episode_id: string;
  start_s: number;
  end_s: number;
  segment_ids: number[];
  clip_score: number;
  title: string | null;
  caption: string | null;
  hashtags: string[] | null;
  low_confidence: boolean;
  created_at: string;
}

export interface Chapter {
  id: string;
  episode_id: string;
  start_s: number;
  title: string;
}

export interface JevStats {
  calls: number;
  totalCostUsd: number;
  avgLatencyMs: number;
}

export type Step = "upload" | "transcribe" | "scoring" | "writing" | "done";
