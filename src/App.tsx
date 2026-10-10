import { useEffect, useState } from "react";
import { AudioWaveform } from "lucide-react";
import { UploadPage } from "@/pages/UploadPage";
import { StudioPage } from "@/pages/StudioPage";
import { ClipSharePage } from "@/pages/ClipSharePage";

type Route = { name: "upload" } | { name: "studio"; episodeId: string } | { name: "clip"; clipId: string };

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#/, "");
  const clipMatch = hash.match(/^\/clip\/(.+)$/);
  if (clipMatch) return { name: "clip", clipId: clipMatch[1] };
  const studioMatch = hash.match(/^\/studio\/(.+)$/);
  if (studioMatch) return { name: "studio", episodeId: studioMatch[1] };
  return { name: "upload" };
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {route.name !== "clip" && (
        <header className="border-b border-zinc-900">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-4">
            <AudioWaveform size={20} className="text-amber-400" />
            <span className="text-sm font-semibold tracking-tight">Podcast Clip Studio</span>
          </div>
        </header>
      )}
      {route.name === "upload" && (
        <UploadPage
          onDone={(episodeId) => {
            window.location.hash = `#/studio/${episodeId}`;
            setRoute({ name: "studio", episodeId });
          }}
        />
      )}
      {route.name === "studio" && (
        <StudioPage
          episodeId={route.episodeId}
          onBack={() => {
            window.location.hash = "#/";
            setRoute({ name: "upload" });
          }}
        />
      )}
      {route.name === "clip" && <ClipSharePage clipId={route.clipId} />}
    </div>
  );
}
