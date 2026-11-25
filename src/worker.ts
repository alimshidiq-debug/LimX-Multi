interface BandcampSearchItem { type?: string; name?: string; band_name?: string; item_url_path?: string; item_id?: number; band_id?: number; art_id?: number; }
interface BandcampTrackInfo { title?: string; title_link?: string; duration?: number; track_num?: number; file?: Record<string, string>; }
interface BandcampPageData { current?: { title?: string; type?: string; }; artist?: string; album_title?: string; art_id?: number; trackinfo?: BandcampTrackInfo[]; }
interface ArchiveDoc { identifier: string; title?: string; creator?: string | string[]; }
interface ArchiveFile { name: string; format?: string; sample_rate?: string; bit_depth?: string; }
interface ArchiveMetadata { metadata?: Record<string, unknown>; files?: ArchiveFile[]; }
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "Content-Type" };
const LICENSES = ["creativecommons.org/publicdomain/zero/1.0/", "creativecommons.org/licenses/by/4.0/", "creativecommons.org/licenses/by/3.0/", "creativecommons.org/licenses/by-sa/4.0/", "creativecommons.org/licenses/by-sa/3.0/"];
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; LimX-Open-Multi/1.2; +https://github.com/alimshidiq-debug/LimX-Multi)" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const allowed = (license: string) => LICENSES.some(x => license.toLowerCase().includes(x));
const isFlac = (f: ArchiveFile) => f.name.toLowerCase().endsWith(".flac") || (f.format || "").toLowerCase().includes("flac");
const quality = (f: ArchiveFile) => { const sampleRate = Number(f.sample_rate || 0) || 44100; const bitDepth = Number(f.bit_depth || 0) || 16; return { sampleRate, bitDepth, audioQuality: sampleRate >= 88200 || bitDepth >= 24 ? "HI_RES_LOSSLESS" : "LOSSLESS" }; };
const decodeEntities = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const trackId = (url: string) => "bc:" + encodeURIComponent(url);
async function bandcampSearch(q: string) {
  const response = await fetch("https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic", {
    method: "POST", headers: { ...HEADERS, "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({ search_text: q, search_filter: "t", full_page: false, fan_id: null })
  });
  if (!response.ok) throw new Error("Bandcamp search failed (" + response.status + ")");
  const raw = await response.text();
  let data: any;
  try { data = JSON.parse(raw); } catch { throw new Error("Bandcamp search is temporarily unavailable (challenge or unexpected response)"); }
  const items: BandcampSearchItem[] = data?.auto?.results || [];
  return items.filter(x => x.item_url_path && x.name).slice(0, 20).map(x => {
    const pageUrl = x.item_url_path!.startsWith("http") ? x.item_url_path! : "https://" + x.item_url_path!.replace(/^\/+/, "");
    return { id: trackId(pageUrl), title: x.name!, artist: x.band_name || "Unknown Artist", album: "", duration: 0, artworkURL: x.art_id ? "https://bandcamp.com/img/a" + x.art_id + "_16.jpg" : "", format: "mp3", audioQuality: "HIGH", provider: "Bandcamp", sourceUrl: pageUrl };
  });
}
async function bandcampStream(pageUrl: string) {
  const r = await fetch(pageUrl, { headers: HEADERS });
  if (!r.ok) throw new Error("Bandcamp track page unavailable (" + r.status + ")");
  const html = await r.text();
  const match = html.match(/data-tralbum="([^"]+)"/);
  if (!match) throw new Error("Bandcamp track metadata not found");
  let parsed: BandcampPageData;
  try { parsed = JSON.parse(decodeEntities(match[1])); } catch { throw new Error("Bandcamp track metadata could not be parsed"); }
  const tracks = parsed.trackinfo || [];
  const info = tracks[0];
  const stream = info?.file?.["mp3-128"];
  if (!stream || !/^https:\/\/.*\.bcbits\.com\//i.test(stream)) throw new Error("No public Bandcamp preview stream is available");
  return { url: stream, format: "mp3", quality: "HIGH", mimeType: "audio/mpeg", manifest: "none", encrypted: false, sampleRate: null, bitDepth: null, headers: {}, isPreview: true, provider: "Bandcamp", duration: info?.duration || 0 };
}
async function archiveSearch(q: string) {
  const terms = q.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 5);
  if (!terms.length) return [];
  const clauses = terms.map(t => `(title:"${t}" OR creator:"${t}")`);
  const params = new URLSearchParams({ q: `mediatype:audio AND (${clauses.join(" AND ")})`, fl: "identifier,title,creator", rows: "40", output: "json" });
  const r = await fetch("https://archive.org/advancedsearch.php?" + params, { headers: HEADERS });
  if (!r.ok) return [];
  const data = await r.json() as { response?: { docs?: ArchiveDoc[] } };
  const docs = (data.response?.docs || []).slice(0, 24);
  const tracks: any[] = [];
  for (let i = 0; i < docs.length; i += 8) {
    const batch = await Promise.allSettled(docs.slice(i, i + 8).map(async doc => {
      const mr = await fetch("https://archive.org/metadata/" + encodeURIComponent(doc.identifier), { headers: HEADERS });
      if (!mr.ok) return [];
      const meta = await mr.json() as ArchiveMetadata;
      if (!allowed(String(meta.metadata?.licenseurl || ""))) return [];
      return (meta.files || []).filter(isFlac).slice(0, 1).map(file => {
        const q = quality(file);
        return { id: "ia:" + encodeURIComponent(doc.identifier) + ":" + encodeURIComponent(file.name), title: doc.title || file.name, artist: Array.isArray(doc.creator) ? doc.creator.join(", ") : doc.creator || "Unknown Artist", album: doc.identifier, duration: Number(meta.metadata?.length || 0), artworkURL: "https://archive.org/services/img/" + encodeURIComponent(doc.identifier), format: "flac", audioQuality: q.audioQuality, provider: "Internet Archive" };
      });
    }));
    for (const b of batch) if (b.status === "fulfilled") tracks.push(...b.value);
  }
  return tracks;
}
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") return json({ status: "ok", service: "LimX Open Multi", provider: "Bandcamp + approved Internet Archive FLAC" });
    if (url.pathname === "/manifest.json") return json({
      id: "com.limx.addon.openmulti", name: "LimX Open Multi", version: "1.2.0",
      description: "Bandcamp-based music discovery with best-available legal audio; FLAC from approved open-license archives.",
      author: "LimX", icon: "https://bandcamp.com/img/buttons/bandcamp-button-circle-black-32.png",
      resources: ["search", "stream", "settings"], types: ["track"], contentType: "music",
      settings: [{ key: "audio_quality", title: "Audio Quality", type: "select", default: "AVAILABLE", options: [
        { label: "Best Available (FLAC when legally available)", value: "AVAILABLE" },
        { label: "Lossless FLAC only", value: "LOSSLESS" },
        { label: "Hi-Res Lossless only (verified metadata)", value: "HI_RES_LOSSLESS" }
      ] }]
    });
    if (url.pathname === "/search") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return json({ error: 'Query parameter "q" is required.' }, 400);
      try {
        const [bc, ia] = await Promise.allSettled([bandcampSearch(q), archiveSearch(q)]);
        const bandcamp = bc.status === "fulfilled" ? bc.value : [];
        const flac = ia.status === "fulfilled" ? ia.value : [];
        return json({ tracks: [...flac, ...bandcamp], providers: { primary: "Bandcamp", lossless: "Internet Archive (approved licenses only)" }, warnings: bc.status === "rejected" ? ["Bandcamp search is temporarily unavailable; showing legal archive results if available."] : [] });
      } catch (e) { return json({ error: e instanceof Error ? e.message : "Search failed" }, 502); }
    }
    if (url.pathname.startsWith("/stream/")) {
      const raw = decodeURIComponent(url.pathname.slice("/stream/".length));
      if (raw.startsWith("bc:")) {
        try {
          const pageUrl = decodeURIComponent(raw.slice(3));
          const parsed = new URL(pageUrl);
          if (!parsed.hostname.endsWith("bandcamp.com") || !/^https?:$/.test(parsed.protocol)) return json({ error: "Invalid Bandcamp track URL" }, 400);
          return json(await bandcampStream(pageUrl));
        } catch (e) { return json({ error: e instanceof Error ? e.message : "Unable to resolve Bandcamp preview" }, 502); }
      }
      if (raw.startsWith("ia:")) {
        try {
          const id = raw.slice(3); const split = id.indexOf(":");
          if (split < 0) return json({ error: "Invalid archive track ID" }, 400);
          const identifier = decodeURIComponent(id.slice(0, split)); const filename = decodeURIComponent(id.slice(split + 1));
          const mr = await fetch("https://archive.org/metadata/" + encodeURIComponent(identifier), { headers: HEADERS });
          if (!mr.ok) return json({ error: "Archive metadata unavailable" }, 502);
          const meta = await mr.json() as ArchiveMetadata;
          if (!allowed(String(meta.metadata?.licenseurl || ""))) return json({ error: "Item license is not approved" }, 403);
          const file = (meta.files || []).find(f => f.name === filename && isFlac(f));
          if (!file) return json({ error: "FLAC file not found" }, 404);
          const q = quality(file); const path = filename.split("/").map(encodeURIComponent).join("/");
          return json({ url: "https://archive.org/download/" + encodeURIComponent(identifier) + "/" + path, format: "flac", quality: q.audioQuality, mimeType: "audio/flac", manifest: "none", encrypted: false, sampleRate: q.sampleRate, bitDepth: q.bitDepth, headers: HEADERS });
        } catch (e) { return json({ error: e instanceof Error ? e.message : "Unable to resolve FLAC" }, 502); }
      }
      return json({ error: "Unsupported track ID" }, 400);
    }
    return json({ error: "Not found" }, 404);
  }
};
