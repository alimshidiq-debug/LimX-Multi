# LimX Open Multi

Open-source multi-provider music addon for BitChord.

## Current provider
- Internet Archive: searches public catalog items and only exposes FLAC files when the item's metadata declares a supported public-domain or Creative Commons license.

## Quality policy
The addon reports source metadata when available. It does **not** promise Hi-Res unless bit depth/sample rate are verified from the source metadata. FLAC alone does not mean Hi-Res.

## API
- `GET /health`
- `GET /manifest.json`
- `GET /search?q=...`
- `GET /stream/{track-id}`

Track IDs are URL-encoded by clients. This addon links to source-hosted files; it does not bypass subscriptions, DRM, or access controls. Please respect each item's license and attribution requirements.

## Deploy
1. Install Node.js and Wrangler.
2. Run `npm install`.
3. Run `npm run deploy`.
4. Add the deployed Worker URL as a custom addon in BitChord.

See `wrangler.jsonc` and `package.json`.
