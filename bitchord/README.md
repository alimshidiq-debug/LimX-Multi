# LimX Open Multi — BitChord addon

Modular BitChord music addon for PencariMusic FLAC discovery.

## Install
In BitChord/Dial, open **Settings → Sources → Add an addon** and paste:

`https://raw.githubusercontent.com/alimshidiq-debug/LimX-Multi/main/bitchord/manifest.json`

## Module
- PencariMusic: search and stream adapter.
- Lossy formats are not used as fallback.
- Hi-Res bit depth/sample rate are reported only when returned by the upstream service; unknown values remain 0.
- Upstream API availability and actual audio format must be verified at runtime.

This addon does not bypass subscriptions, DRM, or access controls.
