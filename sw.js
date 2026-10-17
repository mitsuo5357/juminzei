/* ============================================================
 * sw.js — オフラインで使えるようにするための Service Worker
 *
 * ★アプリを更新したら、下の CACHE の番号を必ず上げてください。
 *   （番号が変わると、利用者の端末に「新しい版があります」と表示され、
 *     「更新する」を押すと新しい版に切り替わります）
 * ============================================================ */
const CACHE = "juminzei-r9-v1.2.0";
const ASSETS = [
  "./",
  "./index.html",
  "./koujo_data.js",
  "./expense_data.js",
  "./calc_logic.js",
  "./zeigaku_logic.js",
  "./region_data.js",
  "./region.js",
  "./app_core.js",
  "./billing_config.js",
  "./billing.js",
  "./app_shell.js",
  "./manifest.webmanifest",
  "./privacy.html",
  "./tokushoho.html",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/favicon-32.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" })))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("juminzei-r9-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 画面の「更新する」ボタンから呼ばれる
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || fetch(req))
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
