/* ============================================================
 * billing.js — シミュレーション（節税のヒント）のアプリ内購入
 *
 *  Google Play から入れたアプリ（TWA）の中では、Chrome の Digital Goods API と
 *  Payment Request API で Google Play の購入画面を出します（Chrome 101 以上）。
 *  購入の確認と「承認（acknowledge）」は、購入確認サーバー（server/worker.js）で行います。
 *   ・Google Play の購入は、3日以内に承認しないと自動で返金・取り消しになる
 *   ・承認と確認は、不正防止のためサーバー側で行うよう Google が求めている
 *
 *  動き方（mode）
 *   off         … 課金を止めている（billing_config.js の enabled:false）→ 全員に開放
 *   preview     … 確認用の1ファイル版。支払いは起きない（模擬の購入）
 *   play        … Google Play から入れたアプリの中。購入・復元ができる
 *   unavailable … アプリの中だが Google Play に接続できない
 *   web         … ふつうのブラウザ。購入はアプリ版で（freeOnWeb:true なら開放）
 *
 *  端末に残すもの：サーバーで確認できた購入（購入トークン）だけ。オフラインのときに使います。
 *  入力した収入などは、購入確認サーバーにも送りません。
 * ============================================================ */
(function () {
  "use strict";

  const PLAY = "https://play.google.com/billing";
  const KEY_PURCHASE = "juminzei-r9:purchase";
  const KEY_TWA = "juminzei-r9:twa";
  const RECHECK_MS = 7 * 24 * 60 * 60 * 1000;   // 確認済みの購入も、7日ごとにサーバーで確かめ直す（返金を拾う）
  const CFG = Object.assign({
    enabled: true,
    productId: "sim_unlock",
    verifyUrl: "",
    playStoreUrl: "",
    tokushohoUrl: "tokushoho.html",
    freeOnWeb: false,
    previewPrice: "￥480"
  }, window.BILLING_CONFIG || {});

  const LS = {
    get(k) { try { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* noop */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } }
  };

  const state = {
    mode: "web",        // 上の表のどれか
    ready: false,       // 判定が終わったか
    unlocked: false,    // シミュレーションを開けるか
    pending: false,     // 支払い待ち（コンビニ払いなど）
    provisional: false, // サーバーで確認できず、仮に開放している
    canBuy: false,      // 購入ボタンを押せるか（アイテムの情報を取れたか）
    price: ""           // 表示用の価格
  };
  const listeners = new Set();
  let service = null;
  let initPromise = null;
  let lastRefresh = 0;
  let busy = false;
  let visHooked = false;

  function snapshot() { return Object.assign({}, state); }
  function set(patch) {
    let changed = false;
    Object.keys(patch).forEach(k => { if (state[k] !== patch[k]) { state[k] = patch[k]; changed = true; } });
    if (changed) listeners.forEach(fn => { try { fn(snapshot()); } catch (e) { /* noop */ } });
  }

  // 設定がまだ YOUR_… のままか
  function placeholder(s) { return !s || /YOUR_/.test(String(s)); }

  // TWA から開かれたか（最初の画面の referrer が android-app:// になる）
  function fromTwa() {
    try {
      if (document.referrer && document.referrer.indexOf("android-app://") === 0) {
        sessionStorage.setItem(KEY_TWA, "1");
        return true;
      }
      return sessionStorage.getItem(KEY_TWA) === "1";
    } catch (e) { return false; }
  }

  function withTimeout(p, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), ms);
      Promise.resolve(p).then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  function formatPrice(price) {
    if (!price || price.value == null) return "";
    try { return new Intl.NumberFormat("ja-JP", { style: "currency", currency: price.currency || "JPY" }).format(Number(price.value)); }
    catch (e) { return `${price.value} ${price.currency || ""}`.trim(); }
  }
  const idOf = (x) => x && (x.itemId || x.sku);

  /* ─── 確認済みの購入（端末内） ─── */
  function readCache() {
    const c = LS.get(KEY_PURCHASE);
    return (c && c.productId === CFG.productId && c.token) ? c : null;
  }
  function writeCache(token) { LS.set(KEY_PURCHASE, { productId: CFG.productId, token, at: Date.now() }); }
  function clearCache() { LS.del(KEY_PURCHASE); }

  /* ─── 購入確認サーバー ─── */
  async function callVerify(token) {
    if (placeholder(CFG.verifyUrl)) throw new Error("verifyUrl-not-set");
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, 15000);
    try {
      // text/plain で送ると、ブラウザの事前確認（preflight）が要らず速い
      const res = await fetch(CFG.verifyUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ productId: CFG.productId, purchaseToken: token }),
        cache: "no-store",
        credentials: "omit",
        signal: ctl ? ctl.signal : undefined
      });
      if (!res.ok) throw new Error("http-" + res.status);
      const j = await res.json();
      if (!j || typeof j.status !== "string") throw new Error("bad-response");
      return j;
    } finally {
      clearTimeout(timer);
    }
  }

  // サーバーの答えを反映する。
  // サーバーにつながらないとき（設定ミス・通信エラー）は、Google Play では購入できているので
  // 仮に開放する（端末には残さず、次に開いたときにもう一度確認する）。
  async function verifyAndApply(token) {
    let r;
    try { r = await callVerify(token); }
    catch (e) {
      set({ unlocked: true, pending: false, provisional: true });
      return { status: "unverified" };
    }
    if (r.status === "purchased") {
      if (r.acknowledged) writeCache(token);
      set({ unlocked: true, pending: false, provisional: !r.acknowledged });
    } else if (r.status === "pending") {
      set({ unlocked: false, pending: true, provisional: false });
    } else {
      const c = readCache();
      if (c && c.token === token) clearCache();
      set({ unlocked: false, pending: false, provisional: false });
    }
    return r;
  }

  /* ─── Google Play ─── */
  async function loadDetails() {
    try {
      const list = await withTimeout(service.getDetails([CFG.productId]), 8000);
      const item = (list || []).find(d => idOf(d) === CFG.productId);
      if (item) set({ price: formatPrice(item.price), canBuy: true });
      else set({ price: "", canBuy: false });
    } catch (e) {
      set({ price: "", canBuy: false });
    }
  }

  // 持っている購入を Google Play に聞いて、開放するか決める
  async function refreshPlay() {
    let list;
    try { list = await withTimeout(service.listPurchases(), 8000); }
    catch (e) {
      // 聞けないとき（オフラインなど）は、確認済みの購入があれば開放
      set({ unlocked: !!readCache(), provisional: false });
      return "cache";
    }
    const own = (list || []).find(p => idOf(p) === CFG.productId);
    if (!own) {
      // 返金・取り消しされた場合も、ここで閉じる
      clearCache();
      set({ unlocked: false, pending: false, provisional: false });
      return "none";
    }
    const c = readCache();
    if (c && c.token === own.purchaseToken) {
      set({ unlocked: true, pending: false, provisional: false });
      // 返金されても Play の持ち物に残る場合があるので、ときどき確かめ直す（待たずに裏で）
      if (Date.now() - (Number(c.at) || 0) > RECHECK_MS) verifyAndApply(own.purchaseToken);
      return "purchased";
    }
    const r = await verifyAndApply(own.purchaseToken);
    return r.status;
  }

  function onVisible() {
    // Play ストアでプロモーションコードを使ったときなど、アプリの外での購入を拾う
    if (document.visibilityState !== "visible" || busy || state.mode !== "play") return;
    if (Date.now() - lastRefresh < 30000) return;
    lastRefresh = Date.now();
    refreshPlay();
  }

  async function connect() {
    service = null;
    if (typeof window.getDigitalGoodsService === "function") {
      try { service = await withTimeout(window.getDigitalGoodsService(PLAY), 6000); }
      catch (e) { service = null; }
    }
    if (service) {
      set({ mode: "play" });
      await Promise.all([loadDetails(), refreshPlay()]);
      lastRefresh = Date.now();
      if (!visHooked) { document.addEventListener("visibilitychange", onVisible); visHooked = true; }
      return true;
    }
    return false;
  }

  function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!CFG.enabled) { set({ mode: "off", unlocked: true, ready: true }); return snapshot(); }
      if (window.__PREVIEW__) { set({ mode: "preview", unlocked: false, canBuy: true, price: CFG.previewPrice, ready: true }); return snapshot(); }
      const twa = fromTwa();
      if (await connect()) { set({ ready: true }); return snapshot(); }
      if (twa) set({ mode: "unavailable", unlocked: !!readCache(), ready: true });
      else set({ mode: "web", unlocked: !!CFG.freeOnWeb, ready: true });
      return snapshot();
    })();
    return initPromise;
  }

  // 購入ボタンのクリックの中で、すぐに呼ぶこと（Payment Request は利用者の操作が必要）
  function purchase() {
    if (state.mode === "preview") {
      set({ unlocked: true });
      return Promise.resolve({ status: "purchased", preview: true });
    }
    if (state.mode !== "play" || !service) return Promise.resolve({ status: "unavailable" });
    if (busy) return Promise.resolve({ status: "busy" });
    let req;
    try {
      req = new PaymentRequest(
        [{ supportedMethods: PLAY, data: { sku: CFG.productId, itemId: CFG.productId } }],
        // 金額は Google Play 側の価格が使われる（ここは形だけ）
        { total: { label: "合計", amount: { currency: "JPY", value: "0" } } }
      );
    } catch (e) {
      return Promise.resolve({ status: "error" });
    }
    busy = true;
    return req.show().then(async (resp) => {
      const d = (resp && resp.details) || {};
      const token = d.purchaseToken || d.token;
      if (!token) { try { await resp.complete("fail"); } catch (e) { /* noop */ } return { status: "error" }; }
      const r = await verifyAndApply(token);
      try { await resp.complete(r.status === "canceled" || r.status === "invalid" ? "fail" : "success"); } catch (e) { /* noop */ }
      return r;
    }, async (err) => {
      if (err && err.name === "AbortError") return { status: "cancel" };
      // 「すでに持っている」などのエラーは、持ち物を確かめ直す
      try { await refreshPlay(); } catch (e) { /* noop */ }
      return state.unlocked ? { status: "purchased", restored: true } : { status: "error" };
    }).finally(() => { busy = false; lastRefresh = Date.now(); });
  }

  // 購入を復元（機種変更・アプリの外での購入・支払い待ちが済んだとき）
  async function restore() {
    if (state.mode === "preview" || state.mode === "off" || state.mode === "web") return { status: state.unlocked ? "purchased" : "none" };
    if (busy) return { status: "busy" };
    busy = true;
    try {
      if (state.mode === "unavailable" || !service) {
        if (!(await connect())) { set({ unlocked: !!readCache() }); return { status: "unavailable" }; }
        return { status: state.unlocked ? "purchased" : (state.pending ? "pending" : "none") };
      }
      const s = await refreshPlay();
      return { status: s };
    } finally {
      busy = false;
      lastRefresh = Date.now();
    }
  }

  function resetPreview() { if (state.mode === "preview") set({ unlocked: false }); }

  window.BILLING = {
    init,
    purchase,
    restore,
    resetPreview,
    isUnlocked: () => state.unlocked,
    getState: snapshot,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    config: CFG,
    placeholder
  };
})();
