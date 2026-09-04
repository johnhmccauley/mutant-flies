/* =====================================================================
   THE SERVICE WORKER

   What makes the game work with no internet at all.

   Everything the game needs is a fixed, known list - two pages, three.js,
   a loader, four fonts and some icons - so there is no cleverness here:
   the lot is fetched once on install and served from the cache for ever
   after. A cellar opens on a train, on a plane, and on a laptop that has
   not seen a network since the day it was set up.

   VERSION is stamped by tools/build.js from a hash of the files below,
   so a new build gets a new cache and the old one is thrown away. Doing
   it by hand is how people end up shipping a fix that nobody can see
   because their browser is still serving last month's copy.

   Nothing here needs an account, and nothing here phones home. The only
   requests that ever go to a server are catalogue ones under api/, and
   those are network-only: if there is no network there is no catalogue,
   and the game carries on without it.
   ===================================================================== */
const VERSION = "8bec1aa3a9ae";
const CACHE = "mutant-fly-" + VERSION;

const SHELL = [
  "./",
  "index.html",
  "classic/",
  "classic/index.html",
  "manifest.webmanifest",
  "vendor/three.min.js",
  "vendor/GLTFLoader.js",
  "vendor/fonts.css",
  "vendor/fonts/ArchivoNarrow.woff2",
  "vendor/fonts/IBMPlexMono-400.woff2",
  "vendor/fonts/IBMPlexMono-500.woff2",
  "vendor/fonts/IBMPlexMono-600.woff2",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* one at a time and forgiving: a single 404 in the list must not
       leave the player with no offline game at all */
    await Promise.all(SHELL.map(async (url) => {
      try { await cache.add(new Request(url, { cache: "reload" })); }
      catch (err) { /* that one is not available; the rest still are */ }
    }));
    /* Deliberately NOT skipWaiting(). A new build must not take over a
       page that is in the middle of a cellar - swapping the scripts out
       from under a running game is how you lose somebody's descent to a
       deploy. The new worker installs, waits, and takes over the next
       time the game is opened. */
  })());
});

/* The only thing that will make a waiting worker take over early: the
   player asking for it, from a title screen, with nothing in progress.
   Never on its own - that is the whole point of not calling
   skipWaiting() in install. */
self.addEventListener("message", (e) => {
  if (e.data && e.data.mutantFly === "takeOver") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE && k.startsWith("mutant-fly-")) ? caches.delete(k) : null));
    /* claim() is safe here and is what makes the very first visit
       controlled without a reload - by the time this runs there is no
       older version left to interrupt */
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* the catalogue is the one part that genuinely needs a network. Do not
     pretend otherwise by serving it stale - let it fail, and let the
     game show "no connection" rather than yesterday's star ratings. */
  if (url.pathname.indexOf("/api/") >= 0) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) {
      /* serve at once, and quietly pick up a newer copy for next time */
      e.waitUntil((async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) await cache.put(req, fresh.clone());
        } catch (err) { /* offline: the cached copy is the right answer */ }
      })());
      return hit;
    }
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === "basic") await cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      /* a navigation with nothing cached for it still gets the game,
         because every route in this thing is the same two pages */
      if (req.mode === "navigate") {
        const shell = await cache.match("index.html") || await cache.match("./");
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
