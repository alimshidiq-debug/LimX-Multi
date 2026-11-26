const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Content-Type"
};
const PM = "https://stream.pencarimovie.com/66ff097863dedb7ccd8401d5ffe616f3/music";
const MONO = "https://tracks.monochrome.st";
const UA = "Mozilla/5.0 (compatible; LimX-Open-Multi/2.1)";
const SEARCH_TTL = 90;

function json(data: unknown, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": cache }
  });
}
async function getJson(url: string, timeoutMs = 4500) {
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
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
    audioQuality: String(t.audioQuality || "UNKNOWN"),
    format: String(t.format || "unknown"),
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
    audioQuality: String(t.audioQuality || "UNKNOWN"),
    format: String(t.format || "unknown"),
    provider: "Monochrome"
  };
}
async function search(q: string, limit: number) {
  try {
    const pm = rowsOf(await getJson(PM + "/search?q=" + encodeURIComponent(q), 4000));
    const valid = pm.filter((t: any) => t && t.id != null && t.title).slice(0, limit).map(parsePM);
    if (valid.length) return { tracks: valid, total: valid.length, provider: "PencariMusic" };
  } catch (_) {}
  try {
    const mono = rowsOf(await getJson(MONO + "/search/tracks?q=" + encodeURIComponent(q) + "&limit=" + limit, 4000));
    const valid = mono.filter((t: any) => t && (t.id != null || t.trackId != null) && (t.title || t.name) && t.playable !== false)
      .slice(0, limit).map(parseMono);
    return { tracks: valid, total: valid.length, provider: "Monochrome", fallback: true };
  } catch (_) {
    return { tracks: [], total: 0, provider: null, error: "Music providers timed out or are unavailable." };
  }
}
async function stream(id: string) {
  const [provider, ...rest] = id.split("::");
  const trackId = decodeURIComponent(rest.join("::"));
  if (!trackId || trackId.includes("..")) throw new Error("Invalid track ID");
  if (provider === "pm") {
    const data = await getJson(PM + "/stream/" + encodeURIComponent(trackId), 7000);
    if (data?.url) return { ...data, provider: "PencariMusic", fallback: false };
    throw new Error("PencariMusic did not return a stream URL.");
  }
  if (provider === "mono") {
    return {
      url: MONO + "/track/" + encodeURIComponent(trackId),
      provider: "Monochrome",
      fallback: false
    };
  }
  throw new Error("Unknown music provider.");
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
async function getTrackStreamUrl(id, quality) {
  try {
    var selectedQuality = String(quality || 'max').toLowerCase();
    if (['max', 'lossless', 'high', 'low'].indexOf(selectedQuality) === -1) selectedQuality = 'max';
    var data = await req('/stream/' + encodeURIComponent(String(id)) + '?quality=' + encodeURIComponent(selectedQuality));
    if (!data.url) return null;
    var quality = data.audioQuality || 'UNKNOWN';
    return { streamUrl: data.url, track: {
      id: String(id), audioQuality: quality,
      mimeType: data.mimeType || 'application/octet-stream',
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
    const path = url.pathname.replace(/^\/music/, "") || "/";
    if (path === "/" || path === "/health") return json({ status: "ok", service: "LimX Music", version: "2.1.0", primary: "PencariMusic", fallback: "Monochrome" });
    if (path === "/manifest.json") return json({
      id: "com.limx.openmulti.music",
      name: "LimX Open Multi",
      title: "LimX Open Multi",
      displayName: "LimX Open Multi",
      description: "Multi-provider music search and stream with quality preference settings.",
      version: "2.1.0",
      logo: "https://raw.githubusercontent.com/alimshidiq-debug/LimX-Multi/main/bitchord/logo.svg",
      icon: "https://raw.githubusercontent.com/alimshidiq-debug/LimX-Multi/main/bitchord/logo.svg",
      resources: ["search", "stream"],
      checkValidLossless: 0,
      allowDownloads: 0,
      settings: [{
        key: "quality",
        type: "select",
        label: "Audio quality preference",
        default: "max",
        options: [
          { value: "max", label: "Maximum available quality" },
          { value: "lossless", label: "Lossless when available" },
          { value: "high", label: "High quality" },
          { value: "low", label: "Data saver" }
        ]
      }],
      "category:music": [{
        id: "alimshidiq-limx-pencarimusic",
        name: "LimX PencariMusic + Monochrome",
        author: "LimX",
        version: "2.1.0",
        code: 5,
        type: "MODULE",
        download: "/music/modules/pencarimusic.js",
        trusted: false,
        logo: "https://raw.githubusercontent.com/alimshidiq-debug/LimX-Multi/main/bitchord/logo.svg",
        icon: "https://raw.githubusercontent.com/alimshidiq-debug/LimX-Multi/main/bitchord/logo.svg",
        tags: ["music", "search", "stream"],
        labels: ["music", "search", "stream"]
      }]
    });
    if (path === "/modules/pencarimusic.js") return new Response(MODULE, {
      headers: { ...CORS, "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300" }
    });
    if (path === "/search") {
      const q = (url.searchParams.get("q") || "").trim();
      const limit = Math.max(1, Math.min(30, Number(url.searchParams.get("limit")) || 15));
      if (!q) return json({ error: 'Query parameter "q" is required.' }, 400);
      const cacheUrl = new URL(url.origin + "/music/search");
      cacheUrl.searchParams.set("q", q.toLowerCase());
      cacheUrl.searchParams.set("limit", String(limit));
      const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) return new Response(cached.body, { status: cached.status, headers: { ...Object.fromEntries(cached.headers), ...CORS, "x-limx-cache": "HIT" } });
      const result = await search(q, limit);
      const response = json(result, 200, "public, max-age=0, s-maxage=" + SEARCH_TTL);
      if (result.tracks.length) {
        const stored = new Response(response.clone().body, {
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=" + SEARCH_TTL }
        });
        await cache.put(cacheKey, stored);
      }
      return new Response(response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), "x-limx-cache": "MISS" } });
    }
    if (path.startsWith("/stream/")) {
      const id = decodeURIComponent(path.slice("/stream/".length));
      const requestedQuality = url.searchParams.get("quality") || "max";
      const allowedQualities = new Set(["max", "lossless", "high", "low"]);
      if (!allowedQualities.has(requestedQuality)) {
        return json({ error: "Unsupported quality. Use max, lossless, high, or low." }, 400);
      }
      const cache = caches.default;
      const cacheKey = new Request(url.origin + "/music/stream-cache/" + encodeURIComponent(id) + "?quality=" + requestedQuality, { method: "GET" });
      const cached = await cache.match(cacheKey);
      if (cached) {
        return new Response(cached.body, {
          status: cached.status,
          headers: { ...Object.fromEntries(cached.headers), ...CORS, "x-limx-cache": "HIT" }
        });
      }
      try {
        const result = await stream(id);
        // Preference is recorded for future provider-specific negotiation.
        // Never claim requested quality unless the upstream confirms it.
        const response = json({ ...result, requestedQuality }, 200, "public, max-age=0, s-maxage=20");
        if (result?.url) {
          const stored = new Response(response.clone().body, {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "public, max-age=20"
            }
          });
          await cache.put(cacheKey, stored);
        }
        return new Response(response.body, {
          status: response.status,
          headers: { ...Object.fromEntries(response.headers), "x-limx-cache": "MISS" }
        });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Stream unavailable" }, 502);
      }
    }
    return json({ error: "Not found" }, 404);
  }
};
