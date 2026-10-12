import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false },
});

export const FUNCTIONS_URL = `${url}/functions/v1`;

export async function callEdgeFunction<T>(
  name: "transcribe" | "jev-score" | "writer",
  body: unknown,
): Promise<T> {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      (data as { error?: string }).error ?? `Request failed (${res.status})`,
    ) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data as T;
}

export async function getPublicAudioUrl(audioPath: string): Promise<string> {
  const { data } = supabase.storage.from("episodes").getPublicUrl(audioPath);
  return data.publicUrl;
}
