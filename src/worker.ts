interface ArchiveDoc { identifier: string; title?: string; creator?: string | string[]; year?: string; }
interface ArchiveFile { name: string; format?: string; sample_rate?: string; bit_depth?: string; size?: string; }
interface ArchiveMetadata { metadata?: Record<string, unknown>; files?: ArchiveFile[]; }
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "Content-Type" };
const LICENSES = ["creativecommons.org/publicdomain/zero/1.0/", "creativecommons.org/licenses/by/4.0/", "creativecommons.org/licenses/by/3.0/", "creativecommons.org/licenses/by-sa/4.0/", "creativecommons.org/licenses/by-sa/3.0/"];
const UPSTREAM_HEADERS = { "User-Agent": "LimX-Open-Multi/1.0 (BitChord audio provider)" };
const DEFAULT_AUDIO_QUALITY = "LOSSLESS";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const allowed = (license: string) => LICENSES.some(x => license.toLowerCase().includes(x));
const isFlac = (f: ArchiveFile) => f.name.toLowerCase().endsWith(".flac") || (f.format || "").toLowerCase().includes("flac");
const getQuality = (f: ArchiveFile) => {
  const sampleRate = Number(f.sample_rate || 0) || 44100;
  const bitDepth = Number(f.bit_depth || 0) || 16;
  return { sampleRate, bitDepth, audioQuality: sampleRate >= 88200 || bitDepth >= 24 ? "HI_RES_LOSSLESS" : "LOSSLESS" };
};
const durationSeconds = (value: unknown) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1000 ? Math.round(n / 1000) : Math.round(n);
};
const encodeTrackId = (identifier: string, filename: string) => "ia:" + encodeURIComponent(identifier) + ":" + encodeURIComponent(filename);
const decodeTrackId = (raw: string) => {
  const id = decodeURIComponent(raw);
  if (!id.startsWith("ia:")) throw new Error("Unsupported track ID");
  const split = id.slice(3).indexOf(":");
  if (split < 0) throw new Error("Invalid track ID");
  return { identifier: decodeURIComponent(id.slice(3, split)), filename: decodeURIComponent(id.slice(split + 1)) };
};
async function metadata(identifier: string): Promise<ArchiveMetadata> {
  const r = await fetch("https://archive.org/metadata/" + encodeURIComponent(identifier), { headers: UPSTREAM_HEADERS });
  if (!r.ok) throw new Error("Internet Archive metadata request failed (" + r.status + ")");
  return await r.json() as ArchiveMetadata;
}
async function search(q: string) {
  const terms = q.toLowerCase().replace(/[^\\p{L}\\p{N} ]/gu, " ").split(/\\s+/).filter(Boolean).slice(0, 5);
  if (!terms.length) return [];
  const clauses = terms.map(term => `(title:"${term}" OR creator:"${term}")`);
  const params = new URLSearchParams({ q: `mediatype:audio AND (${clauses.join(" AND ")})`, fl: "identifier,title,creator,year", rows: "50", page: "1", output: "json" });
  const response = await fetch("https://archive.org/advancedsearch.php?" + params, { headers: UPSTREAM_HEADERS });
  if (!response.ok) throw new Error("Internet Archive search failed (" + response.status + ")");
  const data = await response.json() as { response?: { docs?: ArchiveDoc[] } };
  const docs = (data.response?.docs || []).slice(0, 40);
  const tracks: any[] = [];
  for (let i = 0; i < docs.length; i += 8) {
    const batch = await Promise.allSettled(docs.slice(i, i + 8).map(async doc => {
      const meta = await metadata(doc.identifier);
      const license = String(meta.metadata?.licenseurl || "");
      if (!allowed(license)) return [];
      const files = (meta.files || []).filter(isFlac).slice(0, 2);
      return files.map(file => {
        const qInfo = getQuality(file);
        const creator = doc.creator;
        return {
          id: encodeTrackId(doc.identifier, file.name),
          title: doc.title || file.name.replace(/\\.flac$/i, ""),
          artist: Array.isArray(creator) ? creator.join(", ") : (creator || "Unknown Artist"),
          album: String(meta.metadata?.collection || doc.identifier),
          duration: durationSeconds(meta.metadata?.length),
          artworkURL: "https://archive.org/services/img/" + encodeURIComponent(doc.identifier),
          format: "flac",
          audioQuality: qInfo.audioQuality
        };
      });
    }));
    for (const result of batch) if (result.status === "fulfilled") tracks.push(...result.value);
    if (tracks.length >= 30) break;
  }
  return tracks.slice(0, 30);
}
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") return json({ status: "ok", service: "LimX Open Multi", provider: "Internet Archive" });
    if (url.pathname === "/manifest.json") return json({
      id: "com.limx.addon.openmulti",
      name: "LimX Open Multi",
      version: "1.0.0",
      description: "Open-license FLAC music provider powered by Internet Archive.",
      author: "LimX",
      icon: "https://archive.org/images/glogo.jpg",
      resources: ["search", "stream", "settings"],
      types: ["track"],
      contentType: "music",
      settings: [{
        key: "audio_quality",
        title: "Preferred Audio Quality",
        type: "select",
        default: DEFAULT_AUDIO_QUALITY,
        options: [
          { label: "Lossless FLAC", value: "LOSSLESS" },
          { label: "Hi-Res Lossless (verified metadata only)", value: "HI_RES_LOSSLESS" }
        ]
      }]
    });
    if (url.pathname === "/search") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return json({ error: 'Query parameter "q" is required.' }, 400);
      try { return json({ tracks: await search(q) }); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Search failed" }, 502); }
    }
    if (url.pathname.startsWith("/stream/")) {
      try {
        const { identifier, filename } = decodeTrackId(url.pathname.slice("/stream/".length));
        const meta = await metadata(identifier);
        const license = String(meta.metadata?.licenseurl || "");
        if (!allowed(license)) return json({ error: "Item license is not approved" }, 403);
        const file = (meta.files || []).find(item => item.name === filename && isFlac(item));
        if (!file) return json({ error: "FLAC file not found" }, 404);
        const qInfo = getQuality(file);
        const filePath = filename.split("/").map(encodeURIComponent).join("/");
        return json({
          url: "https://archive.org/download/" + encodeURIComponent(identifier) + "/" + filePath,
          format: "flac",
          quality: qInfo.audioQuality,
          mimeType: "audio/flac",
          manifest: "none",
          encrypted: false,
          sampleRate: qInfo.sampleRate,
          bitDepth: qInfo.bitDepth,
          headers: UPSTREAM_HEADERS
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to resolve source file";
        const status = message === "Unsupported track ID" || message === "Invalid track ID" ? 400 : 502;
        return json({ error: message }, status);
      }
    }
    return json({ error: "Not found" }, 404);
  }
};
