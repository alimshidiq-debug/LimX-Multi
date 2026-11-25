const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Content-Type"
};
const PM = "https://stream.pencarimovie.com/66ff097863dedb7ccd8401d5ffe616f3/music";
const MONO = "https://tracks.monochrome.st";
const UA = "Mozilla/5.0 (compatible; LimX-Open-Multi/2.0)";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
async function getJson(url: string) {
  const res = await fetch(url, { headers: { "Accept": "application/json", "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error("Upstream HTTP " + res.status);
  return await res.json<any>();
}
function rowsOf(data: any) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.tracks)) return data.tracks;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.data?.tracks)) return data.data.tracks;
  return [];
}
function parsePM(t: any) {
  const duration = Number(t.duration) || 0;
  return {
    id: "pm::" + encodeURIComponent(String(t.id)),
    title: String(t.title || ""),
    artist: String(t.artist || ""),
    album: String(t.album || ""),
    albumCover: t.artworkURL || t.artwork || null,
    duration: Math.round(duration > 10000 ? duration / 1000 : duration),
    audioQuality: String(t.audioQuality || "LOSSLESS"),
    format: String(t.format || "flac"),
    provider: "PencariMusic"
  };
}
function parseMono(t: any) {
  const artist = Array.isArray(t.artistNames) ? t.artistNames.join(", ") : (t.artist || "");
  const duration = Number(t.duration) || 0;
  return {
    id: "mono::" + encodeURIComponent(String(t.id ?? t.trackId)),
    title: String(t.title || t.name || ""),
    artist: String(artist),
    album: String(t.albumTitle || t.releaseTitle || t.album || ""),
    albumCover: t.artwork || t.artworkURL || t.albumArtworkURL || null,
    duration: Math.round(duration > 10000 ? duration / 1000 : duration),
    audioQuality: String(t.audioQuality || "LOSSLESS"),
    format: "flac",
    provider: "Monochrome"
  };
}
async function search(q: string, limit: number) {
  try {
    const pm = rowsOf(await getJson(PM + "/search?q=" + encodeURIComponent(q)));
    const valid = pm.filter((t: any) => t && t.id != null && t.title).slice(0, limit).map(parsePM);
    if (valid.length) return { tracks: valid, total: valid.length, provider: "PencariMusic" };
  } catch (_) {}
  try {
    const mono = rowsOf(await getJson(MONO + "/search/tracks?q=" + encodeURIComponent(q) + "&limit=" + limit));
    const valid = mono.filter((t: any) => t && (t.id != null || t.trackId != null) && (t.title || t.name) && t.playable !== false)
      .slice(0, limit).map(parseMono);
    return { tracks: valid, total: valid.length, provider: "Monochrome", fallback: true };
  } catch (_) {
    return { tracks: [], total: 0, provider: null, error: "Both music providers are unavailable." };
  }
}
async function stream(id: string) {
  const [provider, ...rest] = id.split("::");
  const trackId = decodeURIComponent(rest.join("::"));
  if (!trackId || trackId.includes("..")) throw new Error("Invalid track ID");
  if (provider === "pm") {
    try {
      const data = await getJson(PM + "/stream/" + encodeURIComponent(trackId));
      if (data?.url) return { ...data, provider: "PencariMusic", fallback: false };
    } catch (_) {}
  }
  const monoId = trackId;
  return { url: MONO + "/track/" + encodeURIComponent(monoId), mimeType: "audio/flac", bitDepth: 16, sampleRate: 44100, provider: "Monochrome", fallback: true };
}
const MODULE = `(function () {
'use strict';
var BASE = 'https://limx-multi.alim-shidiq.workers.dev/music';
async function req(path) {
  var r = await fetch(BASE + path, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('LimX music API HTTP ' + r.status);
  return r.json();
}
async function searchTracks(text, limit) {
  try {
    var data = await req('/search?q=' + encodeURIComponent(text) + '&limit=' + (Number(limit) || 15));
    return { tracks: data.tracks || [], total: data.total || 0 };
  } catch (_) { return { tracks: [], total: 0 }; }
}
async function getTrackStreamUrl(id) {
  try {
    var data = await req('/stream/' + encodeURIComponent(String(id)));
    if (!data.url) return null;
    return { streamUrl: data.url, track: {
      id: String(id), audioQuality: 'LOSSLESS',
      mimeType: data.mimeType || 'audio/flac',
      bitDepth: Number(data.bitDepth) || 0,
      sampleRate: Number(data.sampleRate) || 0,
      audioModes: ['STEREO']
    }};
  } catch (_) { return null; }
}
module.exports = { searchTracks: searchTracks, getTrackStreamUrl: getTrackStreamUrl };
})();`;

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\\/music/, "") || "/";
    if (path === "/" || path === "/health") return json({ status: "ok", service: "LimX Music", primary: "PencariMusic", fallback: "Monochrome" });
    if (path === "/manifest.json") return json({
      id: "com.limx.openmulti.music",
      name: "LimX Open Multi",
      title: "LimX Open Multi",
      displayName: "LimX Open Multi",
      description: "PencariMusic primary with Monochrome fallback.",
      version: "2.0.0",
      logo: "https://raw.githubusercontent.com/alimshidiq-debug/LimX-Multi/main/bitchord/logo.svg",
      icon: "https://raw.githubusercontent.com/alimshidiq-debug/LimX-Multi/main/bitchord/logo.svg",
      checkValidLossless: 0,
      allowDownloads: 0,
      "category:music": [{
        id: "alimshidiq-limx-pencarimusic",
        name: "LimX PencariMusic + Monochrome",
        author: "LimX",
        version: "2.0.0",
        code: 5,
        type: "MODULE",
        download: "/music/modules/pencarimusic.js",
        trusted: false,
        logo: "https://raw.githubusercontent.com/alimshidiq-debug/LimX-Multi/main/bitchord/logo.svg",
        icon: "https://raw.githubusercontent.com/alimshidiq-debug/LimX-Multi/main/bitchord/logo.svg",
        tags: ["lossless", "flac", "hi-res"],
        labels: ["lossless", "flac", "hi-res"]
      }]
    });
    if (path === "/modules/pencarimusic.js") return new Response(MODULE, { headers: { ...CORS, "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } });
    if (path === "/search") {
      const q = (url.searchParams.get("q") || "").trim();
      const limit = Math.max(1, Math.min(30, Number(url.searchParams.get("limit")) || 15));
      if (!q) return json({ error: 'Query parameter "q" is required.' }, 400);
      return json(await search(q, limit));
    }
    if (path.startsWith("/stream/")) {
      try { return json(await stream(decodeURIComponent(path.slice("/stream/".length)))); }
      catch (e) { return json({ error: e instanceof Error ? e.message : "Stream unavailable" }, 502); }
    }
    return json({ error: "Not found" }, 404);
  }
};
