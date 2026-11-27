"use strict";

const CACHE_NAME = "fogfire-media-v1";
const ASSETS = [
  { path: "assets/films/01.mp4", bytes: 10559520 },
  { path: "assets/films/posters/01.jpg", bytes: 127725 },
  { path: "assets/films/02.mp4", bytes: 9483485 },
  { path: "assets/films/posters/02.jpg", bytes: 152949 },
  { path: "assets/films/03.mp4", bytes: 5949464 },
  { path: "assets/films/posters/03.jpg", bytes: 89026 },
  { path: "assets/films/portfolio/01.mp4", bytes: 5000168 },
  { path: "assets/films/portfolio/posters/01.jpg", bytes: 45385 },
  { path: "assets/films/portfolio/02.mp4", bytes: 6011776 },
  { path: "assets/films/portfolio/posters/02.jpg", bytes: 41158 },
  { path: "assets/films/portfolio/03.mp4", bytes: 5883129 },
  { path: "assets/films/portfolio/posters/03.jpg", bytes: 33555 },
  { path: "assets/films/portfolio/04.mp4", bytes: 5928572 },
  { path: "assets/films/portfolio/posters/04.jpg", bytes: 40110 },
  { path: "assets/films/portfolio/05.mp4", bytes: 4310478 },
  { path: "assets/films/portfolio/posters/05.jpg", bytes: 55442 },
  { path: "assets/films/portfolio/06.mp4", bytes: 6885163 },
  { path: "assets/films/portfolio/posters/06.jpg", bytes: 57770 },
  { path: "assets/films/portfolio/07.mp4", bytes: 2958556 },
  { path: "assets/films/portfolio/posters/07.jpg", bytes: 75048 },
  { path: "assets/films/portfolio/08.mp4", bytes: 3293628 },
  { path: "assets/films/portfolio/posters/08.jpg", bytes: 82309 },
  { path: "assets/films/portfolio/09.mp4", bytes: 4417260 },
  { path: "assets/films/portfolio/posters/09.jpg", bytes: 63399 },
  { path: "assets/films/plate.mp4", bytes: 18895441 },
  { path: "assets/films/plate.jpg", bytes: 97282 }
];
const TOTAL_BYTES = ASSETS.reduce((sum, item) => sum + item.bytes, 0);
const URL_TO_ASSET = new Map(
  ASSETS.map(item => [new URL(item.path, self.registration.scope).href, item])
);

function notify(targets, payload) {
  (targets || []).forEach(client => {
    try { client.postMessage(payload); } catch (error) {}
  });
}

async function preloadAll(targets) {
  const cache = await caches.open(CACHE_NAME);
  const queue = ASSETS.slice();
  let completedFiles = 0;
  let completedBytes = 0;
  const inFlightBytes = new Map();

  function report(current) {
    let activeBytes = 0;
    inFlightBytes.forEach(value => { activeBytes += value; });
    notify(targets, {
      type: "progress",
      done: completedFiles,
      total: ASSETS.length,
      loadedBytes: Math.min(TOTAL_BYTES, completedBytes + activeBytes),
      totalBytes: TOTAL_BYTES,
      current: current || ""
    });
  }

  async function worker() {
    while (queue.length) {
      const asset = queue.shift();
      if (!asset) return;
      const url = new URL(asset.path, self.registration.scope).href;
      try {
        const existing = await cache.match(url);
        if (existing) {
          completedFiles += 1;
          completedBytes += asset.bytes;
          report(asset.path);
          continue;
        }

        const response = await fetch(url, { cache: "reload" });
        if (!response.ok) throw new Error("HTTP " + response.status + " · " + asset.path);

        const headers = new Headers(response.headers);
        headers.set("Accept-Ranges", "bytes");

        if (response.body && typeof response.body.tee === "function") {
          const streams = response.body.tee();
          const cacheResponse = new Response(streams[0], {
            status: response.status,
            statusText: response.statusText,
            headers
          });
          const savePromise = cache.put(url, cacheResponse);
          const progressPromise = (async function () {
            const reader = streams[1].getReader();
            let received = 0;
            let lastReport = 0;
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              received += part.value.byteLength;
              inFlightBytes.set(asset.path, received);
              const now = Date.now();
              if (now - lastReport > 120) {
                report(asset.path);
                lastReport = now;
              }
            }
            return received;
          })();
          const results = await Promise.all([savePromise, progressPromise]);
          inFlightBytes.delete(asset.path);
          completedBytes += results[1] || asset.bytes;
        } else {
          const blob = await response.blob();
          await cache.put(url, new Response(blob, { status: 200, headers }));
          completedBytes += blob.size || asset.bytes;
        }

        completedFiles += 1;
        report(asset.path);
      } catch (error) {
        inFlightBytes.delete(asset.path);
        notify(targets, {
          type: "error",
          message: error && error.message ? error.message : "素材下载失败：" + asset.path
        });
        throw error;
      }
    }
  }

  await Promise.all([worker(), worker()]);
  notify(targets, {
    type: "complete",
    done: ASSETS.length,
    total: ASSETS.length,
    loadedBytes: TOTAL_BYTES,
    totalBytes: TOTAL_BYTES
  });
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

self.addEventListener("message", event => {
  if (event.data && event.data.type === "PRELOAD_ALL") {
    const targets = event.source ? [event.source] : [];
    event.waitUntil(preloadAll(targets));
  }
});

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

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!URL_TO_ASSET.has(url.href)) return;

  event.respondWith((async function () {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url.href);
    if (!cached) return fetch(request);

    const rangeHeader = request.headers.get("Range");
    if (rangeHeader) {
      const ranged = await makeRangeResponse(cached, rangeHeader);
      if (ranged) return ranged;
    }
    return cached;
  })());
});
