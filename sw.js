"use strict";

const CACHE_NAME = "fogfire-media-v2";
const MEDIA_ROOT = new URL("assets/films/", self.registration.scope);
const pending = new Map();

function isPortfolioMedia(url) {
  return url.origin === MEDIA_ROOT.origin && url.pathname.startsWith(MEDIA_ROOT.pathname);
}

function resolveMediaUrl(path) {
  const url = new URL(path, self.registration.scope);
  if (!isPortfolioMedia(url)) throw new Error("拒绝缓存非作品集媒体地址");
  return url;
}

function notify(client, payload) {
  if (!client) return;
  try { client.postMessage(payload); } catch (error) {}
}

async function cacheOne(path) {
  const url = resolveMediaUrl(path);
  const cache = await caches.open(CACHE_NAME);
  const existing = await cache.match(url.href);
  if (existing) return "cached";

  if (pending.has(url.href)) {
    await pending.get(url.href);
    return "cached";
  }

  const task = (async function () {
    const response = await fetch(url.href, { cache: "reload" });
    if (!response.ok || response.status !== 200) {
      throw new Error("HTTP " + response.status + " · " + path);
    }
    await cache.put(url.href, response.clone());
    return "downloaded";
  })();

  pending.set(url.href, task);
  try {
    return await task;
  } finally {
    pending.delete(url.href);
  }
}

async function cachePaths(paths, client, concurrency) {
  const queue = Array.from(new Set((paths || []).filter(path => typeof path === "string")));
  let cursor = 0;
  let done = 0;
  const total = queue.length;

  async function worker() {
    while (cursor < queue.length) {
      const path = queue[cursor++];
      try {
        const result = await cacheOne(path);
        done += 1;
        notify(client, { type: "MEDIA_CACHE_PROGRESS", path, result, done, total });
      } catch (error) {
        done += 1;
        notify(client, {
          type: "MEDIA_CACHE_ERROR",
          path,
          message: error && error.message ? error.message : "媒体缓存失败",
          done,
          total
        });
      }
    }
  }

  const count = Math.max(1, Math.min(concurrency || 1, queue.length || 1));
  await Promise.all(Array.from({ length: count }, worker));
}

async function makeRangeResponse(cached, rangeHeader) {
  const match = /^bytes=(\\d*)-(\\d*)$/i.exec(rangeHeader || "");
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

self.addEventListener("message", event => {
  const data = event.data || {};
  if (data.type === "CACHE_IMAGES") {
    event.waitUntil(cachePaths(data.paths, event.source, 4));
  } else if (data.type === "PREFETCH_VIDEO") {
    event.waitUntil(cachePaths([data.path], event.source, 1));
  }
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!isPortfolioMedia(url)) return;

  event.respondWith((async function () {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url.href);
    const rangeHeader = request.headers.get("Range");

    if (cached) {
      if (rangeHeader) {
        const ranged = await makeRangeResponse(cached, rangeHeader);
        if (ranged) return ranged;
      }
      return cached;
    }

    const response = await fetch(request);
    if (!rangeHeader && response.ok && response.status === 200) {
      event.waitUntil(cache.put(url.href, response.clone()).catch(function () {}));
    }
    return response;
  })());
});
