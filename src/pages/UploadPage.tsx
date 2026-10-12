import { useCallback, useRef, useState } from "react";
import { UploadCloud, Sparkles, AlertCircle, FileAudio } from "lucide-react";
import { ProgressStepper } from "@/components/ProgressStepper";
import { usePipeline } from "@/hooks/usePipeline";

const ACCEPTED = ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/wav", "audio/x-wav"];
const MAX_MB = 25;

export function UploadPage({ onDone }: { onDone: (episodeId: string) => void }) {
  const { state, run, reset } = usePipeline();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [showDescription, setShowDescription] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = state.step !== "upload" && state.step !== "done";

  const pickFile = useCallback((f: File | undefined) => {
    if (!f) return;
    if (!ACCEPTED.includes(f.type)) {
      setLocalError("Please choose an mp3, m4a, or wav file.");
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setLocalError(`File is larger than ${MAX_MB} MB.`);
      return;
    }
    setLocalError(null);
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  }, [title]);

  const start = async (demo: boolean) => {
    setLocalError(null);
    if (!demo && !file) {
      setLocalError("Choose an audio file first, or try the demo episode.");
      return;
    }
    await run({
      file: demo ? undefined : file!,
      title: demo ? "Demo episode: Maya Chen on building Parallel" : title,
      showDescription,
      demo,
    });
  };

  if (state.step === "done" && state.episode) {
    onDone(state.episode.id);
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-14">
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Podcast Clip Studio</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Upload an episode and get a timestamped transcript, AI-picked clip-worthy moments,
          chapters, and a share page for every clip. Jev scores, code cuts, the LLM writes.
        </p>
      </div>

      {(busy || state.step === "done") && (
        <div className="mb-10 flex justify-center">
          <ProgressStepper
            step={state.step}
            scoredCount={state.scoredCount}
            totalSegments={state.totalSegments}
          />
        </div>
      )}

      {busy && (
        <p className="mb-8 text-center text-sm text-zinc-500">
          {state.step === "transcribe" && "Transcribing your episode..."}
          {state.step === "scoring" && `Jev has scored ${state.scoredCount} of ${state.totalSegments} segments...`}
          {state.step === "writing" && "Writing titles, captions, and chapters..."}
        </p>
      )}

      {(state.error ?? localError) && (
        <div className="mb-8 flex items-start gap-3 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{state.error ?? localError}</span>
        </div>
      )}

      {state.dailyCapReached && (
        <div className="mb-8 rounded-lg border border-amber-900/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
          Daily demo limit reached. The bundled demo episode is still available.
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 sm:p-8">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => !busy && inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragOver ? "border-amber-400 bg-amber-400/5" : "border-zinc-700 hover:border-zinc-600"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/m4a,audio/wav,audio/x-wav,.mp3,.m4a,.wav"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          {file ? (
            <>
              <FileAudio size={28} className="mb-3 text-amber-300" />
              <p className="text-sm font-medium text-zinc-200">{file.name}</p>
              <p className="mt-1 text-xs text-zinc-500">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </>
          ) : (
            <>
              <UploadCloud size={28} className="mb-3 text-zinc-500" />
              <p className="text-sm text-zinc-300">Drag and drop audio here, or click to browse</p>
              <p className="mt-1 text-xs text-zinc-500">mp3, m4a, or wav — up to {MAX_MB} MB</p>
            </>
          )}
        </div>

        <div className="mt-6 grid gap-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Episode title
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              placeholder="Episode 42: Scaling engineering teams"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-amber-500"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Show description <span className="normal-case text-zinc-600">(gives Jev context)</span>
            </span>
            <textarea
              value={showDescription}
              onChange={(e) => setShowDescription(e.target.value)}
              disabled={busy}
              maxLength={2000}
              rows={2}
              placeholder="A podcast about startups and AI tools"
              className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-amber-500"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            onClick={() => start(false)}
            disabled={busy || !file}
            className="flex-1 rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Working..." : "Analyze episode"}
          </button>
          <button
            onClick={() => start(true)}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-amber-500 hover:text-amber-200 disabled:opacity-40"
          >
            <Sparkles size={15} />
            Try the demo episode
          </button>
        </div>
      </div>

      {!busy && (state.step === "upload") && state.error && (
        <button onClick={reset} className="mx-auto mt-6 block text-xs text-zinc-500 hover:text-zinc-300">
          Start over
        </button>
      )}
    </div>
  );
}
