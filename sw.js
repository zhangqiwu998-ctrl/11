"use strict";

const CACHE_NAME = "fogfire-media-v4";
const MEDIA_ROOT = new URL("assets/films/", self.registration.scope);

function isPortfolioMedia(url) {
  return url.origin === MEDIA_ROOT.origin && url.pathname.startsWith(MEDIA_ROOT.pathname);
}

async function makeRangeResponse(cached, rangeHeader) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader || "");
  if (!match) return null;

  const blob = await cached.blob();
  let start;
  let end;
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, blob.size - suffixLength);
    end = blob.size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? blob.size - 1 : Math.min(Number(match[2]), blob.size - 1);
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || start >= blob.size || end < start) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": "bytes */" + blob.size, "Accept-Ranges": "bytes" }
    });
  }

  const headers = new Headers();
  headers.set("Content-Type", cached.headers.get("Content-Type") || "video/mp4");
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Content-Range", "bytes " + start + "-" + end + "/" + blob.size);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(blob.slice(start, end + 1), { status: 206, headers });
}

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith("fogfire-media-") && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!isPortfolioMedia(url)) return;
  // Keep the opening clip on the browser's native HTTP Range path, including Safari.
  if (url.pathname === new URL("01.mp4", MEDIA_ROOT).pathname) return;

  event.respondWith((async function () {
    const rangeHeader = request.headers.get("Range");
    let cache;
    try {
      cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url.href);
      if (cached) {
        if (!rangeHeader) return cached;
        const ranged = await makeRangeResponse(cached, rangeHeader);
        if (ranged) return ranged;
      }
    } catch (error) {
      // A damaged/unavailable cache must not prevent network playback.
    }

    const response = await fetch(request);
    if (cache && !rangeHeader && response.ok && response.status === 200) {
      event.waitUntil(cache.put(url.href, response.clone()).catch(function () {}));
    }
    return response;
  })());
});
