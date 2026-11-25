const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "Content-Type" };
const PENCARI_BASE = "https://stream.pencarimovie.com/66ff097863dedb7ccd8401d5ffe616f3/music";
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; LimX-Open-Multi/1.4)", "Accept": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
async function upstream(path: string) {
  const response = await fetch(PENCARI_BASE + path, { headers: HEADERS, redirect: "follow" });
  const body = await response.text();
  if (!response.ok) throw new Error("PencariMusic returned HTTP " + response.status);
  try { return JSON.parse(body); } catch { throw new Error("PencariMusic returned a non-JSON response"); }
}
function isFlacTrack(track: any) {
  const format = String(track?.format || track?.mimeType || track?.mime_type || "").toLowerCase();
  const quality = String(track?.audioQuality || track?.quality || "").toLowerCase();
  const url = String(track?.url || track?.streamUrl || track?.stream_url || "").toLowerCase();
  return format.includes("flac") || quality.includes("lossless") || url.split("?")[0].endsWith(".flac");
}
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") return json({ status: "ok", service: "LimX Open Multi", provider: "PencariMusic", audioPolicy: "FLAC only" });
    if (url.pathname === "/manifest.json") return json({
      id: "com.limx.addon.openmulti", name: "LimX Open Multi", version: "1.4.0",
      description: "PencariMusic-based discovery. FLAC-only playback; Hi-Res is prioritized when source metadata confirms it.",
      author: "LimX", icon: "https://stream.pencarimovie.com/favicon.ico",
      resources: ["search", "stream"], types: ["track"], contentType: "music"
    });
    if (url.pathname === "/search") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return json({ error: 'Query parameter "q" is required.' }, 400);
      try {
        const data = await upstream("/search?q=" + encodeURIComponent(q));
        const tracks = Array.isArray(data) ? data : Array.isArray(data?.tracks) ? data.tracks : Array.isArray(data?.results) ? data.results : [];
        const flac = tracks.filter(isFlacTrack).map((t: any) => ({ ...t, provider: "PencariMusic" }));
        flac.sort((a: any, b: any) => {
          const score = (x: any) => Number(x?.bitDepth || x?.bit_depth || 0) * 100000 + Number(x?.sampleRate || x?.sample_rate || 0);
          return score(b) - score(a);
        });
        return json({ tracks: flac, providers: { primary: "PencariMusic" }, qualityPriority: ["HI_RES_LOSSLESS", "LOSSLESS"], warnings: flac.length ? [] : ["PencariMusic did not return results verifiably identified as FLAC."] });
      } catch (e) { return json({ error: e instanceof Error ? e.message : "PencariMusic search failed" }, 502); }
    }
    if (url.pathname.startsWith("/stream/")) {
      const id = decodeURIComponent(url.pathname.slice("/stream/".length));
      if (!id || id.includes("..")) return json({ error: "Invalid track ID" }, 400);
      try {
        const data = await upstream("/stream/" + encodeURIComponent(id));
        if (!isFlacTrack(data)) return json({ error: "This track is not verified as FLAC; MP3 playback is disabled." }, 415);
        return json({ ...data, provider: "PencariMusic", format: "flac" });
      } catch (e) { return json({ error: e instanceof Error ? e.message : "PencariMusic stream failed" }, 502); }
    }
    return json({ error: "Not found" }, 404);
  }
};
