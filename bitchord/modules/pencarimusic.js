(function () {
'use strict';

var BASE = 'https://stream.pencarimovie.com/66ff097863dedb7ccd8401d5ffe616f3/music';
var UA = 'Mozilla/5.0 (compatible; LimX-BitChord/1.0)';

function withQuery(url, params) {
  var q = Object.keys(params).filter(function (k) { return params[k] != null; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  return url + (url.indexOf('?') < 0 ? '?' : '&') + q;
}

async function request(url) {
  var options = { headers: { 'Accept': 'application/json', 'User-Agent': UA } };
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) options.signal = AbortSignal.timeout(10000);
  var response = await fetch(url, options);
  if (!response.ok) throw new Error('PencariMusic HTTP ' + response.status);
  return response.json();
}

function parseTrack(t) {
  var duration = Number(t.duration) || 0;
  if (duration > 10000) duration = Math.round(duration / 1000);
  return {
    id: 'limx-pm::' + encodeURIComponent(String(t.id)),
    title: String(t.title || ''),
    artist: String(t.artist || ''),
    album: String(t.album || ''),
    albumCover: t.artworkURL || t.artwork || null,
    duration: Math.max(0, Math.round(duration)),
    audioQuality: String(t.audioQuality || 'LOSSLESS'),
    format: String(t.format || 'flac')
  };
}

async function searchTracks(text, limit) {
  try {
    var max = Math.max(1, Math.min(30, Number(limit) || 15));
    var data = await request(withQuery(BASE + '/search', { q: text }));
    var rows = Array.isArray(data.tracks) ? data.tracks : [];
    var tracks = rows.filter(function (t) {
      return t && t.id != null && t.title && String(t.format || 'flac').toLowerCase().indexOf('flac') >= 0;
    }).slice(0, max).map(parseTrack);
    return { tracks: tracks, total: tracks.length };
  } catch (_) {
    return { tracks: [], total: 0 };
  }
}

async function getTrackStreamUrl(id) {
  var raw = decodeURIComponent(String(id));
  if (raw.indexOf('limx-pm::') !== 0) return null;
  var trackId = raw.slice('limx-pm::'.length);
  var data = await request(BASE + '/stream/' + encodeURIComponent(trackId));
  if (!data || !data.url) throw new Error('PencariMusic did not return a stream URL');
  var mime = String(data.mimeType || data.mime_type || 'audio/flac').toLowerCase();
  if (mime.indexOf('flac') < 0 && !String(data.url).toLowerCase().split('?')[0].endsWith('.flac')) {
    throw new Error('Stream is not verified as FLAC; lossy fallback is disabled.');
  }
  return {
    streamUrl: data.url,
    track: {
      id: String(id),
      audioQuality: 'LOSSLESS',
      mimeType: mime,
      bitDepth: Number(data.bitDepth) || 0,
      sampleRate: Number(data.sampleRate) || 0,
      audioModes: ['STEREO']
    }
  };
}

module.exports = { searchTracks: searchTracks, getTrackStreamUrl: getTrackStreamUrl };
})();
