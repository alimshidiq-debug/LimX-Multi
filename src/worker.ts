const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Content-Type"
};
const PM = "https://stream.pencarimovie.com/66ff097863dedb7ccd8401d5ffe616f3/music";
const MONO = "https://tracks.monochrome.st";
const CONFih = "https://bitchord.confih.tech";
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
function parseConfih(t: any) {
  const rawId = t.id ?? t.track_id ?? t.trackId ?? t.qobuz_id;
  const duration = Number(t.duration) || 0;
  const artists = Array.isArray(t.artists) ? t.artists.map((a: any) => typeof a === "string" ? a : a?.name).filter(Boolean).join(", ") : (t.artist || t.artist_name || "");
  return {
    id: "confih::" + encodeURIComponent(String(rawId)),
    title: String(t.title || t.name || ""),
    artist: String(artists),
    album: String(t.album?.title || t.album_title || t.album || ""),
    albumCover: t.album?.image || t.album?.cover || t.cover || t.artwork || t.thumbnail || null,
    duration: Math.round(duration > 10000 ? duration / 1000 : duration),
    audioQuality: String(t.audioQuality || t.audio_quality || t.quality || "UNKNOWN"),
    format: String(t.format || "unknown"),
    provider: "Confih"
  };
}
async function search(q: string, limit: number) {
  // Provider priority: Confih is primary; use PencariMusic, then Monochrome
  // only when the higher-priority provider is unavailable or returns no tracks.
  const providers = [
    {
      name: "Confih",
      run: async () => {
        const data = await getJson(CONFih + "/search?q=" + encodeURIComponent(q) + "&quality=max", 6000);
        return rowsOf(data)
          .filter((t: any) => t && (t.id != null || t.track_id != null || t.trackId != null || t.qobuz_id != null) && (t.title || t.name))
          .slice(0, limit)
          .map(parseConfih);
      }
    },
    {
      name: "PencariMusic",
      run: async () => {
        const rows = rowsOf(await getJson(PM + "/search?q=" + encodeURIComponent(q), 5000));
        return rows.filter((t: any) => t && t.id != null && t.title).slice(0, limit).map(parsePM);
      }
    },
    {
      name: "Monochrome",
      run: async () => {
        const rows = rowsOf(await getJson(MONO + "/search/tracks?q=" + encodeURIComponent(q) + "&limit=" + limit, 5000));
        return rows.filter((t: any) => t && (t.id != null || t.trackId != null) && (t.title || t.name) && t.playable !== false).slice(0, limit).map(parseMono);
      }
    }
  ];

  const errors: string[] = [];
  for (const provider of providers) {
    try {
      const tracks = await provider.run();
      if (tracks.length) {
        return {
          tracks: tracks.slice(0, limit),
          total: tracks.length,
          providers: [provider.name],
          primaryProvider: "Confih",
          activeProvider: provider.name,
          fallbackUsed: provider.name !== "Confih"
        };
      }
    } catch (error) {
      errors.push(provider.name + ": " + (error instanceof Error ? error.message : "request failed"));
    }
  }
  return {
    tracks: [],
    total: 0,
    providers: [],
    primaryProvider: "Confih",
    fallbackUsed: true,
    error: errors.length ? errors.join("; ") : "No tracks found from Confih or fallback providers."
  };
}
async function diagnoseProvider(name: string, endpoint: string, parser: (data: any) => any[]) {
  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      headers: { "Accept": "application/json", "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(8000)
    });
    const contentType = response.headers.get("content-type") || "";
    const bodyText = await response.text();
    let data: any;
    try {
      data = JSON.parse(bodyText);
    } catch {
      return {
        provider: name,
        ok: false,
        httpStatus: response.status,
        contentType,
        elapsedMs: Date.now() - started,
        error: "Response is not valid JSON",
        responsePreview: bodyText.slice(0, 240)
      };
    }
    if (!response.ok) {
      return {
        provider: name,
        ok: false,
        httpStatus: response.status,
        contentType,
        elapsedMs: Date.now() - started,
        error: "Upstream HTTP " + response.status,
        responseKeys: data && typeof data === "object" ? Object.keys(data).slice(0, 30) : []
      };
    }
    const rawRows = rowsOf(data);
    const parsedRows = parser(data);
    const sample = rawRows[0];
    return {
      provider: name,
      ok: true,
      httpStatus: response.status,
      contentType,
      elapsedMs: Date.now() - started,
      topLevelKeys: data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data).slice(0, 30) : [],
      rawTrackCount: rawRows.length,
      compatibleTrackCount: parsedRows.length,
      sampleTrackKeys: sample && typeof sample === "object" ? Object.keys(sample).slice(0, 40) : [],
      sampleTrack: sample ? {
        id: sample.id ?? sample.track_id ?? sample.trackId ?? sample.qobuz_id ?? null,
        title: sample.title ?? sample.name ?? null,
        artist: sample.artist ?? sample.artist_name ?? null
      } : null,
      note: rawRows.length && !parsedRows.length ? "API returned tracks, but current LimX parser did not recognize their fields." : undefined
    };
  } catch (error) {
    return {
      provider: name,
      ok: false,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : "Request failed"
    };
  }
}

async function stream(id: string, quality = "max") {
  const [provider, ...rest] = id.split("::");
  const trackId = decodeURIComponent(rest.join("::"));
  if (!trackId || trackId.includes("..")) throw new Error("Invalid track ID");
  if (provider === "pm") {
    const data = await getJson(PM + "/stream/" + encodeURIComponent(trackId), 7000);
    if (data?.url) return { ...data, provider: "PencariMusic", fallback: false };
    throw new Error("PencariMusic did not return a stream URL.");
  }
  if (provider === "confih") {
    const data = await getJson(CONFih + "/stream/" + encodeURIComponent(trackId) + "?quality=" + encodeURIComponent(quality), 8000);
    if (data?.url || data?.streamUrl) return { ...data, url: data.url || data.streamUrl, provider: "Confih", fallback: false };
    throw new Error("Confih did not return a stream URL.");
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
    if (path === "/" || path === "/health") return json({ status: "ok", service: "LimX Music", version: "2.2.0", providers: ["PencariMusic", "Monochrome", "Confih"] });
    if (path === "/manifest.json") return json({
      id: "com.limx.openmulti.music",
      name: "LimX Open Multi",
      title: "LimX Open Multi",
      displayName: "LimX Open Multi",
      description: "Combined PencariMusic, Monochrome and Confih music search and streaming.",
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
        name: "LimX Multi (PencariMusic + Monochrome + Confih)",
        author: "LimX",
        version: "2.1.0",
        code: 5,
        type: "MODULE",
        download: "/music/modules/pencarimusic.js",
        trusted: false,
        logo: "https://raw.githubusercontent.com/alimshidiq-debug/LimX-Multi/main/bitchord/logo.svg",
        icon: "https://raw.githubusercontent.com/alimshidiq-debug/LimX-Multi/main/bitchord/logo.svg",
        tags: ["music", "search", "stream", "multi-provider", "confih"],
        labels: ["music", "search", "stream"]
      }]
    });
    if (path === "/modules/pencarimusic.js") return new Response(MODULE, {
      headers: { ...CORS, "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300" }
    });
    if (path === "/debug/providers") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return json({ error: 'Query parameter "q" is required.' }, 400);
      const encoded = encodeURIComponent(q);
      const checks = await Promise.all([
        diagnoseProvider("Confih", CONFih + "/search?q=" + encoded + "&quality=max", (data) =>
          rowsOf(data).filter((t: any) => t && (t.id != null || t.track_id != null || t.trackId != null || t.qobuz_id != null) && (t.title || t.name))
        ),
        diagnoseProvider("PencariMusic", PM + "/search?q=" + encoded, (data) =>
          rowsOf(data).filter((t: any) => t && t.id != null && t.title)
        ),
        diagnoseProvider("Monochrome", MONO + "/search/tracks?q=" + encoded + "&limit=5", (data) =>
          rowsOf(data).filter((t: any) => t && (t.id != null || t.trackId != null) && (t.title || t.name) && t.playable !== false)
        )
      ]);
      return json({
        query: q,
        primaryProvider: "Confih",
        fallbackOrder: ["PencariMusic", "Monochrome"],
        diagnostics: checks
      });
    }
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
        const result = await stream(id, requestedQuality);
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
