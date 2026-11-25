interface ArchiveDoc { identifier: string; title?: string; creator?: string | string[]; year?: string; licenseurl?: string; }
interface ArchiveFile { name: string; format?: string; sample_rate?: string; bit_depth?: string; size?: string; }
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "Content-Type" };
const LICENSES = ["creativecommons.org/publicdomain/zero/1.0/", "creativecommons.org/licenses/by/4.0/", "creativecommons.org/licenses/by/3.0/", "creativecommons.org/licenses/by-sa/4.0/", "creativecommons.org/licenses/by-sa/3.0/"];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
const allowed = (license: string) => { const s = license.toLowerCase(); return s.includes("publicdomain") || LICENSES.some(x => s.includes(x)); };
const flac = (f: ArchiveFile) => f.name.toLowerCase().endsWith(".flac") || (f.format || "").toLowerCase().includes("flac");
const quality = (f: ArchiveFile) => { const sampleRate = Number(f.sample_rate || 0) || null; const bitDepth = Number(f.bit_depth || 0) || null; return { codec: "FLAC", sampleRate, bitDepth, hiRes: (sampleRate || 0) >= 88200 || (bitDepth || 0) >= 24 }; };
async function metadata(identifier: string) {
  const r = await fetch("https://archive.org/metadata/" + encodeURIComponent(identifier));
  if (!r.ok) throw new Error("Internet Archive metadata request failed");
  return await r.json() as { metadata?: Record<string, unknown>; files?: ArchiveFile[] };
}
async function search(q: string) {
  const terms = q.toLowerCase().replace(/[^\\p{L}\\p{N} ]/gu, " ").split(/\\s+/).filter(Boolean).slice(0, 5);
  const clauses = terms.map(term => `(title:${term} OR creator:${term})`);
  const p = new URLSearchParams({ q: `mediatype:audio AND (${clauses.join(" AND ")})`, fl: "identifier,title,creator,year,licenseurl", rows: "50", page: "1", output: "json" });
  const r = await fetch("https://archive.org/advancedsearch.php?" + p);
  if (!r.ok) throw new Error("Internet Archive search failed");
  const data = await r.json() as { response?: { docs?: ArchiveDoc[] } };
  const results: unknown[] = [];
  const docs = (data.response?.docs || []).slice(0, 40);
  // Check metadata concurrently in small batches to avoid slow sequential requests.
  for (let i = 0; i < docs.length; i += 8) {
    const batch = await Promise.allSettled(docs.slice(i, i + 8).map(async (doc) => {
      const m = await metadata(doc.identifier);
      const license = String(m.metadata?.licenseurl || doc.licenseurl || "");
      if (!allowed(license)) return [];
      return (m.files || []).filter(flac).slice(0, 2).map((f) => ({
        id: "ia:" + encodeURIComponent(doc.identifier) + ":" + encodeURIComponent(f.name),
        title: doc.title || f.name,
        artist: Array.isArray(doc.creator) ? doc.creator.join(", ") : (doc.creator || "Unknown artist"),
        album: doc.identifier,
        year: doc.year || null,
        provider: "Internet Archive",
        format: "FLAC",
        license,
        attributionRequired: !license.toLowerCase().includes("publicdomain") && !license.toLowerCase().includes("/zero/"),
        quality: quality(f)
      }));
    }));
    for (const item of batch) if (item.status === "fulfilled") results.push(...item.value);
    if (results.length >= 20) break;
  }
  return results;
}
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") return json({ status: "ok", service: "LimX Open Multi", provider: "Internet Archive" });
    if (url.pathname === "/manifest.json") return json({
      id: "com.limx.open.multi", version: "1.0.0", name: "LimX Open Multi",
      description: "Open-license FLAC music discovery for BitChord",
      resources: ["catalog"], types: ["music"],
      catalogs: [{ type: "music", id: "limx-open-multi", name: "LimX Open Multi" }]
    });
    if (url.pathname === "/search") {
      const q = (url.searchParams.get("q") || "").trim();
      if (q.length < 2) return json({ error: "Query must contain at least 2 characters" }, 400);
      try { return json({ tracks: await search(q) }); }
      catch (e) { return json({ error: e instanceof Error ? e.message : "Search failed" }, 502); }
    }
    if (url.pathname.startsWith("/stream/")) {
      try {
        const id = decodeURIComponent(url.pathname.slice(8));
        if (!id.startsWith("ia:")) return json({ error: "Unsupported track ID" }, 400);
        const split = id.slice(3).indexOf(":");
        if (split < 0) return json({ error: "Invalid track ID" }, 400);
        const identifier = decodeURIComponent(id.slice(3, split));
        const filename = decodeURIComponent(id.slice(split + 1));
        const m = await metadata(identifier);
        const license = String(m.metadata?.licenseurl || "");
        if (!allowed(license)) return json({ error: "Item license is not approved" }, 403);
        const f = (m.files || []).find(x => x.name === filename && flac(x));
        if (!f) return json({ error: "FLAC file not found" }, 404);
        const path = filename.split("/").map(encodeURIComponent).join("/");
        return json({
          url: "https://archive.org/download/" + encodeURIComponent(identifier) + "/" + path,
          mimeType: "audio/flac", format: "FLAC", provider: "Internet Archive", license,
          attributionRequired: !license.toLowerCase().includes("publicdomain") && !license.toLowerCase().includes("/zero/"),
          quality: quality(f)
        });
      } catch { return json({ error: "Unable to resolve source file" }, 502); }
    }
    return json({ error: "Not found" }, 404);
  }
};
