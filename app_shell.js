/* ============================================================
 * app_shell.js
 * 市県民税 計算支援（令和9年度）— スマホ画面の制御
 *
 *  ・タブ（所得・控除・結果）と、下の「年税額の目安」の帯
 *  ・一覧の行をタップ → 入力ブロックを全画面シートに移して編集（PC版v2の方式）
 *  ・Androidの「戻る」でシート／メニューを閉じる（history を使用）
 *  ・端末内への自動保存（localStorage）・設定・はじめに表示する注意事項
 *  ・Service Worker の登録と、新しい版がある時の更新案内
 *  ・シミュレーション（節税のヒント）の購入画面（billing.js と連携）
 * ============================================================ */
(function () {
  "use strict";

  const PREVIEW = !!window.__PREVIEW__;
  const USE_HISTORY = !PREVIEW;
  const APP_VERSION = "1.2.0（令和9年度版）";
  const $ = (id) => document.getElementById(id);
  const num = (n) => Math.floor(Number(n) || 0).toLocaleString("ja-JP");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ─── 端末内の保存（使えない環境でも動くように） ─── */
  const LS = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } }
  };
  const KEY_DATA = "juminzei-r9:data";
  const KEY_SETTINGS = "juminzei-r9:settings";
  const KEY_ONBOARD = "juminzei-r9:onboarded";
  const KEY_TAB = "juminzei-r9:tab";

  /* ─── 設定 ─── */
  //  region.code   … 住所地（令和9年1月1日）の団体コード。空なら未設定（全国の標準で計算）
  //  region.manual … 手入力で直した均等割・級地（{ kintou_city, kintou_pref, kyuchi }）。なければ null
  const DEFAULT_SETTINGS = {
    autosave: true,
    theme: "system",
    region: { code: PREVIEW ? "452025" : "", manual: null }
  };
  const saved = LS.get(KEY_SETTINGS, {}) || {};
  const settings = Object.assign({}, DEFAULT_SETTINGS, saved);
  settings.region = normalizeRegionSetting(saved.region);
  function normalizeRegionSetting(r) {
    if (!r || typeof r !== "object") return Object.assign({}, DEFAULT_SETTINGS.region);
    if ("code" in r) return { code: String(r.code || ""), manual: r.manual || null };
    // v1.1 までの形式（均等割・級地だけ）→ 都城市＋手入力の値
    const old = { kintou_city: r.kintou_city, kintou_pref: r.kintou_pref, kyuchi: r.kyuchi };
    const same = old.kintou_city === 3000 && old.kintou_pref === 1500 && Number(old.kyuchi) === 3;
    return { code: "452025", manual: same ? null : old };
  }
  function saveSettings() { LS.set(KEY_SETTINGS, settings); }
  const RL = () => window.REGION_LOGIC;
  // 住所地の税率（手入力の修正を反映する前）
  function baseRegion() {
    const b = settings.region.code && RL() ? RL().build(settings.region.code) : null;
    return b || (RL() ? RL().standard() : { label: "全国の標準", kintou_city: 3000, kintou_pref: 1000, kyuchi: 3, notes: [] });
  }
  function applyRegion() {
    const base = baseRegion();
    const r = Object.assign({}, base);
    const m = settings.region.manual;
    if (m) {
      ["kintou_city", "kintou_pref"].forEach(k => { if (m[k] != null && m[k] !== "") r[k] = Number(m[k]) || 0; });
      if (m.kyuchi) r.kyuchi = Number(m.kyuchi);
      r.label = base.label + "（一部を手入力）";
    }
    window.ZEIGAKU_LOGIC.setRegion(r);
  }
  function setRegionCode(code) {
    settings.region = { code: String(code || ""), manual: null };
    saveSettings(); applyRegion(); window.APP.recalcAll();
  }
  // 保存ファイルを読み込んだとき、住所地も合わせる
  window.__onImportRegion = function (code) {
    if (!code || !RL() || !RL().find(code) || code === settings.region.code) return;
    settings.region = { code: String(code), manual: null };
    saveSettings(); applyRegion();
  };
  function applyTheme() {
    if (PREVIEW) return;
    const root = document.documentElement;
    if (settings.theme === "light" || settings.theme === "dark") root.setAttribute("data-theme", settings.theme);
    else root.removeAttribute("data-theme");
  }

  /* ─── 自動保存 ─── */
  let saveReady = false;
  let saveTimer = null;
  function saveNow() {
    if (!saveReady || !settings.autosave) return;
    try { LS.set(KEY_DATA, window.APP.exportState()); } catch (e) { /* noop */ }
  }
  window.__scheduleSave = function () {
    if (!saveReady || !settings.autosave) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  };
  window.__onClear = function () { LS.del(KEY_DATA); };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveNow(); });
  window.addEventListener("pagehide", saveNow);

  /* ============================================================
   * 重ねて開く画面（シート・ダイアログ）と「戻る」ボタン
   * ============================================================ */
  const stack = [];
  function pushOverlay(entry) {
    stack.push(entry);
    if (USE_HISTORY) { try { history.pushState({ ov: stack.length }, ""); } catch (e) { /* noop */ } }
  }
  function popOverlay() {
    const e = stack.pop();
    if (e) e.close();
  }
  function requestClose() {
    if (!stack.length) return;
    if (USE_HISTORY) { try { history.back(); return; } catch (e) { /* fallthrough */ } }
    popOverlay();
  }
  // 「戻る」：履歴の深さに合うまで、重ねた画面を閉じる（history.go(-n) にも対応）
  window.addEventListener("popstate", () => {
    const st = history.state;
    const depth = (st && st.ov) || 0;
    while (stack.length > depth) popOverlay();
  });
  function lockScroll(on) { document.body.style.overflow = on ? "hidden" : ""; }

  /* ============================================================
   * 一覧の行（カード）
   * ============================================================ */
  const INCOME_GROUPS = [
    { label: "給与・年金", ids: ["salary", "pension"] },
    { label: "事業・不動産・雑所得", note: "当てはまる方だけ", ids: ["eigyo", "nougyo", "fudo", "zatsu-b", "zatsu-o"] },
    { label: "配当・株式・土地建物など", note: "当てはまる方だけ", ids: ["haito", "kabu", "tochi", "gyu"] }
  ];
  const KOUJO_GROUPS = [
    { label: "保険料・医療費など", group: "hoken" },
    { label: "家族・本人の状況", group: "kazoku", after: ["honnin"] },
    { label: "自動で計算", group: "auto" },
    { label: "税額控除", note: "当てはまる方だけ", ids: ["haito-koujo", "wariri", "jutaku", "kifukin", "gaikoku"] }
  ];

  const cards = new Map();   // id → { el, resId, title, comment, btn, ph }
  let openCardId = null;
  let lastFocus = null;

  const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

  function registerCard(id, el, title, comment, resId) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "row-btn";
    btn.dataset.card = id;
    btn.innerHTML = `<span class="row-main"><span class="row-title"></span><span class="row-sub"></span></span><span class="row-amt zero">未入力</span>${CHEV}`;
    btn.querySelector(".row-title").textContent = title;
    btn.querySelector(".row-sub").textContent = comment || "";
    btn.addEventListener("click", () => openCard(id));
    cards.set(id, { el, resId, title, comment, btn, ph: null });
    return btn;
  }

  function buildGroups(hostId, groups, resolver) {
    const host = $(hostId);
    host.innerHTML = "";
    groups.forEach(g => {
      const wrap = document.createElement("section");
      wrap.className = "group";
      const h = document.createElement("h2");
      h.className = "group-label";
      h.textContent = g.label;
      wrap.appendChild(h);
      if (g.note) {
        const n = document.createElement("p");
        n.className = "group-note";
        n.textContent = g.note;
        wrap.appendChild(n);
      }
      const list = document.createElement("div");
      list.className = "list";
      resolver(g).forEach(btn => { if (btn) list.appendChild(btn); });
      wrap.appendChild(list);
      host.appendChild(wrap);
    });
  }

  function cardFromDataset(id) {
    const el = document.querySelector(`#store [data-card-id="${id}"]`);
    if (!el) return null;
    return registerCard(id, el, el.dataset.cardTitle || id, el.dataset.cardComment || "", el.dataset.cardResId || "");
  }

  function buildCards() {
    buildGroups("m-income-groups", INCOME_GROUPS, g => g.ids.map(cardFromDataset));
    buildGroups("m-koujo-groups", KOUJO_GROUPS, g => {
      if (g.ids) return g.ids.map(cardFromDataset);
      const out = window.KOUJO_DATA.deductions.filter(d => (d.group || "kazoku") === g.group).map(d => {
        const el = $(`block-${d.id}`);
        if (!el) return null;
        const short = (d.description || "").split(/[。\n]/)[0];
        return registerCard(d.id, el, d.name, short, `res-${d.id}`);
      });
      (g.after || []).forEach(id => out.push(cardFromDataset(id)));
      return out;
    });
    // 損益通算のまとめは所得画面の下に
    const sg = $("block-songaeki");
    if (sg) $("m-songaeki-slot").appendChild(sg);
  }

  function parseAmt(text) {
    const s = String(text || "").replace(/[,\s円¥￥]/g, "");
    const n = parseInt(s, 10);
    return isNaN(n) ? 0 : n;
  }
  function v(id) { const el = $(id); return el ? (Number(String(el.value || "").replace(/[^0-9]/g, "")) || 0) : 0; }
  function selText(id) { const el = $(id); const o = el && el.options[el.selectedIndex]; return o ? o.textContent : ""; }
  const man = (n) => window.APP.manYen(n);

  // 行の2行目（入力内容の要約）
  function cardSub(id, ref) {
    const S = window.APP.STATE;
    switch (id) {
      case "salary": return v("inp-salary") ? `収入 ${man(v("inp-salary"))}` : ref.comment;
      case "pension": return v("inp-pension") ? `収入 ${man(v("inp-pension"))}${$("inp-pension-age").checked ? "・65歳以上" : ""}` : ref.comment;
      case "eigyo": case "nougyo": case "fudo": {
        const k = id === "fudo" ? "fudo" : id;
        const rev = v(`inp-${k}-rev`), exp = v(`inp-${k}-exp`), ao = v(`inp-${k}-aoiro`);
        if (!rev && !exp) return ref.comment;
        return `収入 ${man(rev) || "0円"}・経費 ${man(exp) || "0円"}${ao ? "・青色" : ""}`;
      }
      case "zatsu-b": case "zatsu-o": {
        const rev = v(`inp-${id}-rev`), exp = v(`inp-${id}-exp`);
        return (rev || exp) ? `収入 ${man(rev) || "0円"}・経費 ${man(exp) || "0円"}` : ref.comment;
      }
      case "haito": return v("inp-haito-revenue") ? `収入 ${man(v("inp-haito-revenue"))}・${S.haitoMethod === "bunri" ? "申告分離" : "総合課税"}` : ref.comment;
      case "kabu": return v("inp-kabu-taika") ? `譲渡対価 ${man(v("inp-kabu-taika"))}` : ref.comment;
      case "tochi": return v("inp-tochi-taika") ? `譲渡対価 ${man(v("inp-tochi-taika"))}` : ref.comment;
      case "haigusha": {
        const m = $("sel-mode-haigusha");
        if (!m || m.value === "none") return "配偶者がいる場合";
        const inc = v("inp-col-haigusha");
        return `${m.value === "rojin" ? "70歳以上" : "70歳未満"}・配偶者の所得 ${inc ? man(inc) : "0円"}`;
      }
      case "fuyou": {
        const n = ["ippan", "tokutei", "rojin", "rojin_dokyo", "nensho"].reduce((a, k) => a + v(`inp-fuyou-${k}`), 0);
        return n ? `${n}人（年少扶養を含む）` : "16歳以上の扶養親族など";
      }
      case "tokutei_shinzoku": {
        const n = Array.from(document.querySelectorAll(".person-input[data-koujo='tokutei_shinzoku']")).filter(e => Number(e.value) > 0).length;
        return n ? `${n}人` : "19〜22歳で所得62万円超の親族";
      }
      case "shogaisha": {
        const n = v("inp-shogaisha-futsu") + v("inp-shogaisha-tokubetsu") + v("inp-shogaisha-dokyo");
        return n ? `${n}人${$("chk-shogaisha-honnin") && $("chk-shogaisha-honnin").checked ? "（本人を含む）" : ""}` : "本人・家族に障害者がいる場合";
      }
      case "kafu": case "hitori_oya": case "kinrou_gakusei": {
        const s = $(`sel-${id}`);
        return (s && s.value !== "none") ? selText(`sel-${id}`).replace(/（.*$/, "") : "該当なし";
      }
      case "kiso": return `合計所得 ${man(S.totalIncome) || "0円"}`;
      case "honnin": return ($("chk-honnin-miseinen") && $("chk-honnin-miseinen").checked) ? "未成年" : "未成年に当たるか";
      case "kifukin": return S.kifuFurusato ? `ふるさと納税 ${man(S.kifuFurusato)}` : ref.comment;
      case "jutaku": return v("inp-jutaku-kanou") ? `控除可能額 ${man(v("inp-jutaku-kanou"))}` : ref.comment;
      case "wariri": { const t = v("inp-wariri-haito") + v("inp-wariri-jouto"); return t ? `源泉分 ${man(t)}` : ref.comment; }
      default: {
        const block = ref.el;
        if (!block) return ref.comment;
        const ins = Array.from(block.querySelectorAll("input.num-input[id]"));
        const sum = ins.reduce((a, e) => a + (Number(e.value) || 0), 0);
        return sum ? `支払額など ${man(sum)}` : ref.comment;
      }
    }
  }

  function syncCards() {
    cards.forEach((ref, id) => {
      const amtEl = ref.btn.querySelector(".row-amt");
      const subEl = ref.btn.querySelector(".row-sub");
      let amount = 0, hasValue = false, text = "";
      if (id === "honnin") {
        const on = $("chk-honnin-miseinen") && $("chk-honnin-miseinen").checked;
        text = on ? "該当" : "";
        hasValue = on;
      } else {
        const resEl = ref.resId ? $(ref.resId) : null;
        amount = resEl ? parseAmt(resEl.textContent) : 0;
        hasValue = amount !== 0;
        text = hasValue ? `${num(amount)}円` : "";
      }
      if (id === "kiso") { hasValue = true; }
      amtEl.textContent = text || "未入力";
      amtEl.classList.toggle("zero", !text);
      amtEl.classList.toggle("neg", amount < 0);
      ref.btn.classList.toggle("filled", hasValue && id !== "kiso");
      subEl.textContent = cardSub(id, ref) || "";
    });
  }

  /* ─── 入力シート ─── */
  function openCard(id) {
    const ref = cards.get(id);
    if (!ref || openCardId) return;
    lastFocus = document.activeElement;
    const ph = document.createComment("ph-" + id);
    ref.el.parentNode.insertBefore(ph, ref.el);
    ref.ph = ph;
    const body = $("sheet-body");
    body.innerHTML = "";
    body.appendChild(ref.el);
    if (ref.el.tagName === "DETAILS") ref.el.open = true;
    $("sheet-title").textContent = ref.title;
    $("sheet").hidden = false;
    $("sheet-scroll").scrollTop = 0;
    lockScroll(true);
    openCardId = id;
    pushOverlay({ name: "card", close: closeCard });
    setTimeout(() => { const b = $("sheet-back"); if (b) b.focus({ preventScroll: true }); }, 30);
  }
  function closeCard() {
    if (!openCardId) return;
    const ref = cards.get(openCardId);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (ref && ref.ph && ref.ph.parentNode) { ref.ph.parentNode.replaceChild(ref.el, ref.ph); ref.ph = null; }
    $("sheet-body").innerHTML = "";
    $("sheet").hidden = true;
    lockScroll(stack.length > 0);
    openCardId = null;
    window.__scheduleSave();
    renderAll(window.APP.STATE);
    if (ref && ref.btn) ref.btn.focus({ preventScroll: true });
  }

  /* ─── 汎用のシート（メニュー・シミュレーション・このアプリについて） ─── */
  function openContentSheet(title, content, after, onClose) {
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.style.zIndex = String(70 + stack.length);
    sheet.innerHTML = `
      <div class="sheet-head gutter"><div class="inner">
        <button type="button" class="icon-btn sheet-back" aria-label="戻る"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>
        <h2 class="sheet-title"></h2>
        <button type="button" class="btn-done">閉じる</button>
      </div></div>
      <div class="sheet-body gutter"><div class="inner"></div></div>`;
    sheet.querySelector(".sheet-title").textContent = title;
    const inner = sheet.querySelector(".sheet-body .inner");
    if (typeof content === "string") inner.innerHTML = content; else inner.appendChild(content);
    sheet.querySelector(".sheet-back").addEventListener("click", requestClose);
    sheet.querySelector(".btn-done").addEventListener("click", requestClose);
    document.body.appendChild(sheet);
    lockScroll(true);
    const prevFocus = document.activeElement;
    pushOverlay({ name: "content", close: () => {
      sheet.remove(); lockScroll(stack.length > 0);
      if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
      if (onClose) onClose();
    } });
    setTimeout(() => sheet.querySelector(".sheet-back").focus({ preventScroll: true }), 30);
    if (after) after(sheet);
    return sheet;
  }

  /* ─── 確認ダイアログ（confirm() の代わり） ─── */
  function confirmDialog(title, message, okLabel, onOk, danger) {
    const scrim = document.createElement("div");
    scrim.className = "dialog-scrim";
    scrim.style.zIndex = String(90 + stack.length);
    scrim.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t">
      <h2 id="dlg-t"></h2><p></p>
      <div class="dialog-actions"><button type="button" class="btn" data-act="cancel">やめる</button><button type="button" class="btn ${danger ? "danger" : "primary"}" data-act="ok"></button></div></div>`;
    scrim.querySelector("h2").textContent = title;
    scrim.querySelector("p").textContent = message;
    scrim.querySelector('[data-act="ok"]').textContent = okLabel;
    let confirmed = false;
    scrim.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (e.target === scrim || (act && act.dataset.act === "cancel")) requestClose();
      else if (act && act.dataset.act === "ok") { confirmed = true; requestClose(); }
    });
    document.body.appendChild(scrim);
    pushOverlay({ name: "dialog", close: () => { scrim.remove(); if (confirmed) onOk(); } });
    setTimeout(() => scrim.querySelector('[data-act="cancel"]').focus(), 30);
  }

  /* ============================================================
   * タブ
   * ============================================================ */
  const TABS = ["income", "koujo", "result"];
  let currentTab = "income";
  function showTab(name, opts) {
    if (!TABS.includes(name)) name = "income";
    currentTab = name;
    TABS.forEach(t => {
      $(`view-${t}`).hidden = (t !== name);
      $(`tab-${t}`).setAttribute("aria-selected", String(t === name));
      $(`tab-${t}`).tabIndex = (t === name) ? 0 : -1;
    });
    $("totalbar").hidden = (name === "result");
    if (!(opts && opts.keepScroll)) window.scrollTo(0, 0);
    LS.set(KEY_TAB, name);
  }

  /* ============================================================
   * 画面の更新（再計算のたびに呼ばれる）
   * ============================================================ */
  function renderAll(S) {
    if (!S || !S.bd) return;
    $("m-total-income").innerHTML = `${num(S.totalIncome)}<small>円</small>`;
    $("m-koujo-total").innerHTML = `${num(S.koujoSum)}<small>円</small>`;
    const y = S.yearTax;
    $("tb-amt").innerHTML = `${y < 0 ? "△" + num(-y) : num(y)}<small>円</small>`;
    const anyInput = S.totalIncome > 0 || S.koujoSum > 430000 || hasAnyInput();
    $("m-empty").hidden = anyInput;
    syncCards();
    renderResult(S);
  }

  function hasAnyInput() {
    return Array.from(document.querySelectorAll("#store input.num-input, #sheet-body input.num-input"))
      .some(e => e.value && e.value !== "0" && !e.closest(".expense-add-form"));
  }

  function badge(text, kind) { return `<span class="badge ${kind || ""}">${esc(text)}</span>`; }

  function renderResult(S) {
    const bd = S.bd;
    const j = S.hikazeiJudge || {};
    const region = window.ZEIGAKU_LOGIC.getRegion();
    const sumOf = (o) => (o.c || 0) + (o.p || 0);
    const minus = (n) => n ? `−${num(n)}` : "0";

    const badges = [];
    if (S.totalIncome <= 0 && !hasAnyInput()) badges.push(badge("まだ入力がありません", "plain"));
    else {
      if (j.shotoku_hikazei && j.kintou_hikazei) badges.push(badge("住民税は非課税"));
      else {
        if (j.shotoku_hikazei) badges.push(badge("所得割は非課税"));
        if (j.kintou_hikazei) badges.push(badge("均等割は非課税"));
      }
      if (S.kanpu > 0) badges.push(badge(`還付 ${num(S.kanpu)}円`, "plain"));
    }

    const rows = [];
    const line = (label, o, cls) => rows.push(`<tr class="${cls || ""}"><th scope="row">${label}</th><td>${o.c != null ? o.c : ""}</td><td>${o.p != null ? o.p : ""}</td><td>${o.t}</td></tr>`);
    line("算出税額", { c: num(bd.sanshutu.c), p: num(bd.sanshutu.p), t: num(sumOf(bd.sanshutu)) });
    const credits = [
      ["調整控除", bd.chosei, true],
      ["配当控除", bd.haito],
      ["住宅ローン控除", bd.jutaku],
      ["寄附金税額控除", bd.kifu],
      ["外国税額控除", bd.gaikoku],
      ["所得割の調整措置", bd.choseiSochi],
      ["配当割額等控除", bd.wariri]
    ];
    credits.forEach(([label, o, always]) => {
      if (always || sumOf(o) > 0) line(label, { c: minus(o.c), p: minus(o.p), t: minus(sumOf(o)) }, "minus");
    });
    if (bd.hikazeiShotoku && sumOf(bd.sanshutu) > 0) line("所得割は非課税", { c: "0", p: "0", t: "0" }, "minus");
    line("所得割<br><small>100円未満切捨て</small>", { c: num(bd.shotokuWari.c), p: num(bd.shotokuWari.p), t: num(S.shotokuWari) }, "total");
    line("均等割", { c: num(bd.kintou.c), p: num(bd.kintou.p), t: num(bd.kintou.c + bd.kintou.p) });
    line("森林環境税<br><small>国税・均等割と一緒に納付</small>", { c: "", p: "", t: num(bd.kintou.s) });
    if (S.kanpu > 0) line("還付", { c: num(bd.kanpu.c), p: num(bd.kanpu.p), t: "△" + num(S.kanpu) }, "minus");
    line("年税額", { c: "", p: "", t: (S.yearTax < 0 ? "△" + num(-S.yearTax) : num(S.yearTax)) }, "grand");

    const bunriRows = (S.separatesTaxable || []).filter(s => s.taxable_amount > 0)
      .map(s => `<div class="kv-row"><span class="k">${esc(s.label)}の課税所得<small>千円未満切捨て</small></span><span class="v">${num(s.taxable_amount)}円</span></div>`).join("");

    const kintouLabel = `${region.kyuchi}級地`;
    const unset = !region.code;
    const html = `
      <div class="view-head"><h1 class="view-title">結果</h1></div>
      <section class="hero" aria-label="年税額の目安">
        <div class="hero-label">令和9年度 市県民税の年税額（目安）</div>
        <div class="hero-amt">${S.yearTax < 0 ? "△" + num(-S.yearTax) : num(S.yearTax)}<small>円</small></div>
        <div class="hero-parts"><span>所得割 <b>${num(S.shotokuWari)}円</b></span><span>均等割 <b>${num(S.kintouWari)}円</b></span></div>
        ${badges.length ? `<div class="hero-badges">${badges.join("")}</div>` : ""}
      </section>
      <button type="button" class="region-chip${unset ? " warn" : ""}" data-act="region">
        ${ICON.pin}
        <span class="rc-main"><small>住所地（令和9年1月1日）</small><b>${unset ? "未設定（全国の標準で計算中）" : esc(region.label)}</b></span>
        <span class="rc-change">${unset ? "選ぶ" : "変更"}</span>
      </button>

      <section class="section-card ledger-card" aria-labelledby="r-ledger">
        <h2 class="section-title" id="r-ledger">税額の内訳</h2>
        <div class="ledger-wrap">
          <table class="ledger">
            <thead><tr><th scope="col">項目</th><th scope="col">市民税</th><th scope="col">県民税</th><th scope="col">合計</th></tr></thead>
            <tbody>${rows.join("")}</tbody>
          </table>
        </div>
      </section>

      <section class="section-card" aria-labelledby="r-flow">
        <h2 class="section-title" id="r-flow">所得と控除</h2>
        <div class="kv">
          <div class="kv-row"><span class="k">総合課税の所得</span><span class="v">${num(S.generalWithHaito)}円</span></div>
          ${S.bunriSum > 0 ? `<div class="kv-row"><span class="k">分離課税の所得</span><span class="v">${num(S.bunriSum)}円</span></div>` : ""}
          <div class="kv-row strong"><span class="k">合計所得金額</span><span class="v">${num(S.totalIncome)}円</span></div>
          <div class="kv-row"><span class="k">所得控除の合計</span><span class="v">${num(S.koujoSum)}円</span></div>
          <div class="kv-row strong"><span class="k">課税総所得金額<small>千円未満切捨て</small></span><span class="v">${num(S.taxableGeneral)}円</span></div>
          ${bunriRows}
          <div class="kv-row"><span class="k">人的控除差の合計<small>調整控除・ふるさと納税の計算に使います</small></span><span class="v">${num(S.koujoDiffSum)}円</span></div>
        </div>
      </section>

      <section class="section-card" aria-labelledby="r-judge">
        <h2 class="section-title" id="r-judge">非課税の判定</h2>
        <div class="judge">
          <div class="judge-row"><span class="k">均等割：合計所得が ${num(j.kintou_kijun)}円 以下なら非課税（${esc(kintouLabel)}）</span>${j.kintou_hikazei ? badge("非課税") : badge("課税", "plain")}</div>
          <div class="judge-row"><span class="k">所得割：総所得金額等が ${num(j.shotoku_kijun)}円 以下なら非課税</span>${j.shotoku_hikazei ? badge("非課税") : badge("課税", "plain")}</div>
          <div class="judge-row"><span class="k">人数（本人・同一生計配偶者・扶養親族）</span><b>${S.ninzu || 1}人</b></div>
        </div>
      </section>

      <div class="actions">
        <button type="button" class="btn primary wide" data-act="sim">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>
          節税のヒント（シミュレーション）${simTag()}
        </button>
        ${PREVIEW ? "" : `<button type="button" class="btn" data-act="print">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>
          印刷・PDF</button>`}
        <button type="button" class="btn${PREVIEW ? " wide" : ""}" data-act="share">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>
          ${PREVIEW ? "結果をコピー" : "結果を送る"}</button>
      </div>
      <p class="note">令和8年1月〜12月の所得をもとにした令和9年度分の試算です。表示は参考値で、実際の税額はお住まいの市区町村から届く通知でご確認ください。${unset ? "住所地が未設定のため、全国の標準" : esc(region.label || "設定") + "の額・税率"}（均等割 市民税${num(region.kintou_city)}円・県民税${num(region.kintou_pref)}円、所得割 市民税${esc(window.ZEIGAKU_LOGIC.pctOf(region.rateCity || 6000))}・県民税${esc(window.ZEIGAKU_LOGIC.pctOf(region.ratePref || 4000))}）で計算しています。</p>
    `;
    $("m-result").innerHTML = html;
  }

  /* ============================================================
   * 結果の共有（テキスト）
   * ============================================================ */
  async function shareSummary() {
    const text = window.APP.summaryText();
    if (!PREVIEW && navigator.share) {
      try { await navigator.share({ title: "市県民税の試算（令和9年度）", text }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    try {
      await navigator.clipboard.writeText(text);
      window.APP.showToast("結果をコピーしました");
    } catch (e) {
      openContentSheet("結果のテキスト", `<p class="view-lead">長押しで選んでコピーしてください。</p><pre class="process-box" style="user-select:text">${esc(text)}</pre>`);
    }
  }

  function openSim() {
    if (simLocked()) { openPaywall(); return; }
    const sim = window.APP.buildTaxSim();
    openContentSheet("節税のヒント", sim.html, () => { if (sim.after) setTimeout(sim.after, 60); });
  }

  /* ============================================================
   * シミュレーションの購入（アプリ内購入・billing.js）
   * ============================================================ */
  const BILL = () => window.BILLING || null;
  function billState() { const b = BILL(); return b ? b.getState() : { mode: "off", ready: true, unlocked: true }; }
  function simLocked() { return !billState().unlocked; }
  // 結果画面のボタンの「有料」の札（判定が終わるまでは出さない）
  function simTag() {
    const st = billState();
    return (st.mode !== "off" && st.ready && !st.unlocked) ? '<span class="tag-paid">有料</span>' : "";
  }
  function playUrl() { const b = BILL(); const u = b && b.config.playStoreUrl; return (u && !b.placeholder(u)) ? u : ""; }
  function tokushohoUrl() { const b = BILL(); return (b && !PREVIEW && b.config.tokushohoUrl) || ""; }

  const PAY_FEATURES = [
    ["ふるさと納税の上限の目安", "自己負担2,000円で収まる寄附額と、寄附額ごとの負担のグラフ。ワンストップ特例と申告の比較も"],
    ["非課税になるライン", "合計所得があといくら少なければ、所得割・均等割が非課税になるか"],
    ["まだ使っていない控除", "0円のままの所得控除の一覧"]
  ];

  function paywallHTML(st, msg) {
    const feats = PAY_FEATURES.map(([t, d]) => `<li>${ICON.check}<span><b>${esc(t)}</b><small>${esc(d)}</small></span></li>`).join("");
    let action = "";
    if (st.mode === "web") {
      const u = playUrl();
      action = `<p class="pay-msg">この機能は、Google Play の<b>Android アプリ版</b>で購入して使えます。ブラウザでは購入できず、購入済みの方もブラウザでは開けません。</p>
        ${u ? `<a class="btn primary wide pay-btn" href="${esc(u)}" target="_blank" rel="noopener">Google Play で見る</a>` : ""}`;
    } else if (st.mode === "unavailable") {
      action = `<p class="pay-msg">Google Play に接続できませんでした。通信の状態と、Google アカウントのログインを確かめてから、もう一度お試しください。</p>
        <button type="button" class="btn primary wide pay-btn" data-pay="retry">もう一度試す</button>`;
    } else if (!st.ready) {
      action = `<p class="pay-msg">購入の準備をしています…</p>`;
    } else {
      const canBuy = st.canBuy && !st.pending;
      action = `
        <div class="pay-price-row"><span>価格（買い切り）</span><b class="pay-price">${esc(st.price || "—")}</b></div>
        <button type="button" class="btn primary wide pay-btn" data-pay="buy" ${canBuy ? "" : "disabled"}>${st.pending ? "お支払い待ち" : "購入してシミュレーションを開く"}</button>
        ${(!st.canBuy && !st.pending) ? `<p class="pay-msg">いまは購入できません。しばらくしてから、もう一度お試しください。</p>` : ""}
        ${st.pending ? `<p class="pay-msg warn">お支払いの完了を待っています（コンビニ払いなど）。支払いが済んだら「購入を復元」を押してください。</p>` : ""}
        ${st.mode === "preview"
          ? `<p class="pay-msg sub">プレビュー版です。ボタンを押しても支払いは発生しません。</p>`
          : `<button type="button" class="btn-text" data-pay="restore">購入済みの方はこちら（購入を復元）</button>`}`;
    }
    const terms = (st.mode === "web" || st.mode === "unavailable") ? "" : `
      <section class="pay-terms" aria-labelledby="pay-terms-t">
        <h4 id="pay-terms-t">購入の条件</h4>
        <dl>
          <div><dt>価格</dt><dd>${esc(st.price || "Google Play の購入画面に表示されます")}${st.mode === "preview" ? "（表示例）" : ""}</dd></div>
          <div><dt>支払い方法</dt><dd>Google Play に登録したお支払い方法</dd></div>
          <div><dt>使える時期</dt><dd>購入の確認ができたら、すぐ</dd></div>
          <div><dt>買い切り</dt><dd>月額の料金はかかりません。同じ Google アカウントなら、機種変更のあとも「購入を復元」で使えます。</dd></div>
          <div><dt>返品・キャンセル</dt><dd>デジタルの内容のため、購入後のキャンセルはできません。返金は Google Play の返金ポリシーに沿って扱われます。</dd></div>
        </dl>
        ${tokushohoUrl() ? `<a href="${esc(tokushohoUrl())}" target="_blank" rel="noopener">特定商取引法に基づく表記</a>` : ""}
      </section>`;
    return `
      <section class="pay-card">
        <div class="pay-kicker">${ICON.lock}有料の機能</div>
        <h3 class="pay-title">税額シミュレーション</h3>
        <p class="pay-lead">いまの入力内容をもとに、税額を下げるヒントをまとめて表示します。</p>
        <ul class="pay-features">${feats}</ul>
        ${action}
        <p class="pay-status" role="status" aria-live="polite">${esc(msg || "")}</p>
      </section>
      ${terms}`;
  }

  function openPaywall() {
    let msg = "";
    let wantSim = false;
    let off = null;
    let inner = null;
    let closed = false;
    const render = () => { if (inner) inner.innerHTML = paywallHTML(billState(), msg); };
    const setMsg = (m) => { msg = m; render(); };
    // 開放されたら購入画面を閉じて、そのままシミュレーションを開く
    const afterUnlock = () => { if (closed || wantSim) return; wantSim = true; requestClose(); };

    async function onClick(e) {
      const btn = e.target.closest("[data-pay]");
      if (!btn) return;
      const b = BILL();
      const act = btn.dataset.pay;
      if (act === "buy") {
        if (billState().mode === "preview") {
          confirmDialog("プレビューでの購入", "プレビュー版なので、支払いは発生しません。購入したことにして、シミュレーションを開きますか？", "開く",
            () => { b.purchase(); });
          return;
        }
        const p = b.purchase();   // ← クリックの中ですぐに呼ぶ（Google Play の購入画面が開く）
        btn.disabled = true;
        setMsg("Google Play の購入画面を開いています…");
        const r = await p;
        if (closed) return;
        if (r.status === "purchased") { window.APP.showToast(r.restored ? "購入を復元しました" : "ご購入ありがとうございます"); afterUnlock(); }
        else if (r.status === "unverified") { window.APP.showToast("購入できました（確認は通信できるときに行います）", 4000); afterUnlock(); }
        else if (r.status === "pending") setMsg("");
        else if (r.status === "cancel") setMsg("");
        else if (r.status === "canceled" || r.status === "invalid") setMsg("購入を確認できませんでした。お手数ですが、もう一度お試しください。");
        else setMsg("購入を完了できませんでした。通信の状態を確かめて、もう一度お試しください。");
      } else if (act === "restore" || act === "retry") {
        btn.disabled = true;
        setMsg(act === "retry" ? "Google Play に接続しています…" : "購入を確認しています…");
        await b.restore();
        if (closed) return;
        const st = billState();
        if (st.unlocked) { window.APP.showToast("購入を復元しました"); afterUnlock(); }
        else if (st.pending) setMsg("");
        else if (st.mode === "unavailable") setMsg("まだ接続できません。少し時間をおいてお試しください。");
        else setMsg("この Google アカウントでの購入は見つかりませんでした。購入したときと同じアカウントか、確かめてください。");
      }
    }

    openContentSheet("節税のヒント", "", (sheet) => {
      inner = sheet.querySelector(".sheet-body .inner");
      render();
      sheet.addEventListener("click", onClick);
      const b = BILL();
      if (b) off = b.onChange((st) => { if (st.unlocked) afterUnlock(); else render(); });
    }, () => {
      closed = true;
      if (off) off();
      if (wantSim) setTimeout(openSim, 30);
    });
  }

  async function restoreFromMenu() {
    const b = BILL();
    if (!b) return;
    window.APP.showToast("購入を確認しています…");
    await b.restore();
    const st = b.getState();
    if (st.unlocked) window.APP.showToast("購入を復元しました");
    else if (st.pending) window.APP.showToast("お支払いの完了を待っています", 3500);
    else if (st.mode === "unavailable") window.APP.showToast("Google Play に接続できませんでした", 3500);
    else window.APP.showToast("この Google アカウントでの購入は見つかりませんでした", 3500);
  }

  /* ============================================================
   * メニュー
   * ============================================================ */
  const ICON = {
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
    load: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21V9M7 14l5-5 5 5"/><path d="M5 3h14"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
    sample: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/></svg>',
    clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/></svg>',
    sim: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>'
  };

  // メニューの「税額シミュレーション」の欄
  function purchaseMenuHTML() {
    const b = BILL();
    if (!b) return "";
    const st = b.getState();
    if (st.mode === "off") return "";
    const status = st.unlocked ? "購入済み" : (st.pending ? "お支払い待ち" : (st.ready ? "未購入" : "確認中"));
    let items = menuItem("sim", "sim", st.unlocked ? "節税のヒントを開く" : "節税のヒント（有料）について", st.unlocked ? "" : "買い切りのアプリ内購入");
    if (st.mode === "play" || st.mode === "unavailable") items += menuItem("restore", "restore", "購入を復元", "機種変更したとき・購入が反映されないとき");
    if (st.mode === "preview") items += menuItem("preview-reset", "restore", "（プレビュー）購入前の状態に戻す", "");
    if (tokushohoUrl()) items += menuItem("tokushoho", "doc", "特定商取引法に基づく表記", "");
    return `<p class="group-label" style="margin-top:18px">税額シミュレーション（${esc(status)}）</p>
      <div class="list menu-list">${items}</div>`;
  }

  function menuItem(act, icon, label, sub, cls) {
    return `<button type="button" class="menu-item ${cls || ""}" data-act="${act}">${ICON[icon]}<span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span></button>`;
  }

  function openMenu() {
    const r = window.ZEIGAKU_LOGIC.getRegion();   // 今の計算に使っている値（手入力の修正を含む）
    const unset = !settings.region.code;
    const html = `
      <p class="group-label" style="margin-top:4px">入力内容</p>
      <div class="list menu-list">
        ${PREVIEW ? "" : menuItem("save", "save", "ファイルに保存", "あとで「ファイルから読み込む」で戻せます")}
        ${PREVIEW ? "" : menuItem("load", "load", "ファイルから読み込む", "このアプリ・PC版で保存したファイル")}
        ${menuItem("sample", "sample", "サンプルの数字を入れる", "給与420万円・配偶者と子2人の例")}
        ${menuItem("clear", "clear", "すべての入力を消す", "", "danger")}
      </div>
      <p class="group-label" style="margin-top:18px">結果</p>
      <div class="list menu-list">
        ${PREVIEW ? "" : menuItem("print", "print", "印刷・PDFで保存", "A4の一覧（申告書の下書きの確認に）")}
        ${menuItem("share", "share", PREVIEW ? "結果をコピー" : "結果をテキストで送る", "")}
      </div>
      ${purchaseMenuHTML()}
      <p class="group-label" style="margin-top:18px">設定</p>
      <div class="list">
        ${PREVIEW ? "" : `<div class="setting">
          <label class="switch" for="set-autosave"><span>入力内容をこの端末に自動で保存する</span><input type="checkbox" id="set-autosave" ${settings.autosave ? "checked" : ""}></label>
          <small>保存先はこの端末の中だけです。オフにすると、アプリを閉じたときに入力が消えます。</small>
        </div>
        <div class="setting">
          <div class="setting-grid">
            <label for="set-theme">画面の色</label>
            <select id="set-theme">
              <option value="system" ${settings.theme === "system" ? "selected" : ""}>端末に合わせる</option>
              <option value="light" ${settings.theme === "light" ? "selected" : ""}>明るい</option>
              <option value="dark" ${settings.theme === "dark" ? "selected" : ""}>暗い</option>
            </select>
          </div>
        </div>`}
        <div class="setting">
          <span style="font-size:var(--fs-m)">住所地（令和9年1月1日）</span>
          <div class="region-now"><b>${unset ? "未設定（全国の標準で計算中）" : esc(baseRegion().label)}</b><button type="button" class="chip-btn" data-act="region">${unset ? "選ぶ" : "変更"}</button></div>
          <small>住民税は、令和9年1月1日に住んでいる市区町村で計算されます。均等割・所得割の税率・非課税の基準が、住所地に合わせて変わります。</small>
          <details class="region-manual"${settings.region.manual ? " open" : ""}>
            <summary>数字を直接直す（くわしい方向け）</summary>
            <div class="setting-grid" style="margin-top:8px">
              <label for="set-kintou-city">市町村民税の均等割（円）</label>
              <input type="text" inputmode="numeric" class="num-input" id="set-kintou-city" value="${num(r.kintou_city).replace(/,/g, "")}" data-no-hint="1">
              <label for="set-kintou-pref">道府県民税の均等割（円）</label>
              <input type="text" inputmode="numeric" class="num-input" id="set-kintou-pref" value="${num(r.kintou_pref).replace(/,/g, "")}" data-no-hint="1">
              <label for="set-kyuchi">均等割が非課税になる基準（級地）</label>
              <select id="set-kyuchi">
                <option value="1" ${r.kyuchi === 1 ? "selected" : ""}>1級地（45万円）</option>
                <option value="2" ${r.kyuchi === 2 ? "selected" : ""}>2級地（41.5万円）</option>
                <option value="3" ${r.kyuchi === 3 ? "selected" : ""}>3級地（38万円）</option>
              </select>
            </div>
            <small>市区町村の条例で額が変わったときなどに使います。級地は生活保護の地域区分で、（　）内は本人だけの場合の合計所得の基準です。</small>
            <div style="margin-top:8px"><button type="button" class="chip-btn" data-act="region-reset">住所地の値に戻す</button></div>
          </details>
        </div>
      </div>
      <p class="group-label" style="margin-top:18px">このアプリについて</p>
      <div class="list menu-list">
        ${menuItem("about", "info", "このアプリについて・ご注意", "公式アプリではありません／計算の前提")}
        ${PREVIEW ? "" : menuItem("privacy", "lock", "プライバシーポリシー", "")}
      </div>
      <p class="note">バージョン ${esc(APP_VERSION)}</p>`;
    openContentSheet("メニュー", html, (sheet) => {
      sheet.addEventListener("click", (e) => {
        const b = e.target.closest("[data-act]");
        if (!b) return;
        const act = b.dataset.act;
        if (act === "save") window.APP.downloadJSON();
        else if (act === "load") $("json-loader").click();
        else if (act === "print") { requestClose(); setTimeout(() => window.APP.printAllSummary(), 250); }
        else if (act === "share") shareSummary();
        else if (act === "sample") confirmDialog("サンプルの数字を入れますか？", "いまの入力内容はサンプルに置き換わります。", "入れる", () => { window.APP.loadSample(); requestCloseAll(); showTab("result"); window.APP.showToast("サンプルの数字を入れました"); });
        else if (act === "clear") confirmDialog("すべての入力を消しますか？", "所得・控除・寄附などの入力がすべて消えます。元に戻せません。", "消す", () => { window.APP.clearAll(true); requestCloseAll(); showTab("income"); }, true);
        else if (act === "about") openAbout();
        else if (act === "privacy") window.open("privacy.html", "_blank", "noopener");
        else if (act === "sim") { requestClose(); setTimeout(openSim, 250); }
        else if (act === "restore") restoreFromMenu();
        else if (act === "preview-reset") { const bl = BILL(); if (bl) bl.resetPreview(); window.APP.showToast("購入前の状態に戻しました"); requestClose(); }
        else if (act === "tokushoho") window.open(tokushohoUrl(), "_blank", "noopener");
        else if (act === "region") { requestClose(); setTimeout(() => openRegionPicker(), 250); }
        else if (act === "region-reset") {
          settings.region.manual = null;
          saveSettings(); applyRegion(); window.APP.recalcAll();
          const g = window.ZEIGAKU_LOGIC.getRegion();
          sheet.querySelector("#set-kintou-city").value = String(g.kintou_city);
          sheet.querySelector("#set-kintou-pref").value = String(g.kintou_pref);
          sheet.querySelector("#set-kyuchi").value = String(g.kyuchi);
          window.APP.showToast("住所地の値に戻しました");
        }
      });
      sheet.addEventListener("change", (e) => {
        const t = e.target;
        if (t.id === "set-autosave") {
          settings.autosave = t.checked; saveSettings();
          if (!t.checked) LS.del(KEY_DATA); else saveNow();
        } else if (t.id === "set-theme") {
          settings.theme = t.value; saveSettings(); applyTheme();
        } else if (t.id === "set-kyuchi") {
          manualFromSheet(sheet);
        }
      });
      sheet.addEventListener("input", (e) => {
        const t = e.target;
        if (t.id === "set-kintou-city" || t.id === "set-kintou-pref") manualFromSheet(sheet);
      });
    });
  }
  // メニューの「数字を直接直す」：住所地の値と同じなら手入力なしに戻す
  function manualFromSheet(sheet) {
    const n = (sel) => Number(String(sheet.querySelector(sel).value).replace(/[^0-9]/g, "")) || 0;
    const base = baseRegion();
    const m = { kintou_city: n("#set-kintou-city"), kintou_pref: n("#set-kintou-pref"), kyuchi: Number(sheet.querySelector("#set-kyuchi").value) || 3 };
    const same = m.kintou_city === base.kintou_city && m.kintou_pref === base.kintou_pref && m.kyuchi === base.kyuchi;
    settings.region.manual = same ? null : m;
    saveSettings(); applyRegion(); window.APP.recalcAll();
  }

  /* ============================================================
   * 住所地（令和9年1月1日）を選ぶ
   * ============================================================ */
  function regionSummaryHTML(rg) {
    const pct = window.ZEIGAKU_LOGIC.pctOf;
    const kintou = rg.kintou_city + rg.kintou_pref + 1000;
    return `
      <h3>${esc(rg.label)}</h3>
      <div class="kv">
        <div class="kv-row"><span class="k">均等割<small>市民税・県民税・森林環境税（国税）</small></span><span class="v">${num(kintou)}円</span></div>
        <div class="kv-row"><span class="k">　内訳</span><span class="v rp-sub">${num(rg.kintou_city)}円・${num(rg.kintou_pref)}円・1,000円</span></div>
        <div class="kv-row"><span class="k">所得割の税率<small>市民税・県民税</small></span><span class="v">${esc(pct(rg.rateCity))}・${esc(pct(rg.ratePref))}</span></div>
        <div class="kv-row"><span class="k">非課税の基準（均等割）</span><span class="v">${rg.kyuchi}級地</span></div>
      </div>
      <ul class="rp-notes">${(rg.notes || []).map(t => `<li>${esc(t)}</li>`).join("")}</ul>`;
  }

  function openRegionPicker(opts) {
    opts = opts || {};
    const R = RL();
    if (!R) return;
    let chosen = settings.region.code || "";
    const prefOpts = R.prefs().map(p => `<option value="${p.code}">${esc(p.name)}</option>`).join("");
    const nowLabel = chosen ? baseRegion().label : "";
    const laterLabel = nowLabel ? `今のまま（${nowLabel}）` : "あとで選ぶ（全国の標準の税率で計算）";
    const html = `
      <div class="region-picker">
        <p class="view-lead">${opts.upgrade ? "住所地（市区町村）を選べるようになりました。" : ""}令和9年1月1日に住んでいる（住民票がある）市区町村を選んでください。住民税は、この市区町村で計算されます。</p>
        <label class="rp-label" for="rp-search">名前やよみで探す</label>
        <input type="search" id="rp-search" class="rp-search" placeholder="例：みやこのじょう、横浜" autocomplete="off" enterkeyhint="search">
        <div class="rp-results" id="rp-results" hidden></div>
        <div class="rp-selects">
          <label class="rp-label" for="rp-pref">都道府県</label>
          <select id="rp-pref"><option value="">選んでください</option>${prefOpts}</select>
          <label class="rp-label" for="rp-city">市区町村</label>
          <select id="rp-city" disabled><option value="">先に都道府県を選んでください</option></select>
        </div>
        <section class="rp-summary" id="rp-summary" aria-live="polite" hidden></section>
        <button type="button" class="btn primary wide pay-btn" data-rp="ok" disabled>この市区町村にする</button>
        ${opts.onboarding ? `<button type="button" class="btn-text" data-rp="later">${esc(laterLabel)}</button>` : ""}
        <p class="note">市区町村の一覧・均等割・税率は${esc(R.asOf || "")}時点の情報です。市区町村の条例で変わった場合は、メニューの「数字を直接直す」で直せます。</p>
      </div>`;
    openContentSheet("住所地を選ぶ", html, (sheet) => {
      const $s = (sel) => sheet.querySelector(sel);
      const fillCities = (pc, selectCode) => {
        const list = pc ? R.munis(pc) : [];
        const city = $s("#rp-city");
        city.disabled = !pc;
        city.innerHTML = pc
          ? `<option value="">選んでください</option>` + list.map(m => `<option value="${m.code}">${esc(m.name)}${m.designated ? "（指定都市）" : ""}</option>`).join("")
          : `<option value="">先に都道府県を選んでください</option>`;
        if (selectCode) city.value = selectCode;
      };
      const show = (code) => {
        chosen = code || "";
        const rg = code ? R.build(code) : null;
        const sum = $s("#rp-summary");
        sum.hidden = !rg;
        sum.innerHTML = rg ? regionSummaryHTML(rg) : "";
        $s('[data-rp="ok"]').disabled = !rg;
      };
      const pick = (code) => {
        const pc = String(code).slice(0, 2);
        $s("#rp-pref").value = pc;
        fillCities(pc, code);
        show(code);
      };
      if (chosen && R.find(chosen)) pick(chosen);

      $s("#rp-pref").addEventListener("change", (e) => { fillCities(e.target.value); show(""); });
      $s("#rp-city").addEventListener("change", (e) => show(e.target.value));
      let timer = null;
      $s("#rp-search").addEventListener("input", (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const q = e.target.value.trim();
          const box = $s("#rp-results");
          const hits = q ? R.search(q, 20) : [];
          box.hidden = !q;
          box.innerHTML = hits.length
            ? hits.map(h => `<button type="button" class="rp-hit" data-code="${h.code}">${esc(h.label)}</button>`).join("")
            : (q ? `<p class="rp-none">見つかりませんでした。都道府県から選んでください。</p>` : "");
        }, 120);
      });
      sheet.addEventListener("click", (e) => {
        const hit = e.target.closest(".rp-hit");
        if (hit) {
          pick(hit.dataset.code);
          $s("#rp-results").hidden = true;
          $s("#rp-search").value = "";
          return;
        }
        const b = e.target.closest("[data-rp]");
        if (!b) return;
        if (b.dataset.rp === "ok" && chosen) {
          setRegionCode(chosen);
          const label = window.ZEIGAKU_LOGIC.getRegion().label;
          requestClose();
          window.APP.showToast(`${label}で計算します`);
        } else if (b.dataset.rp === "later") {
          requestClose();
        }
      });
    });
  }

  function requestCloseAll() {
    // メニューなど重ねて開いている画面をすべて閉じる
    const n = stack.length;
    if (!n) return;
    if (USE_HISTORY) { try { history.go(-n); return; } catch (e) { /* fallthrough */ } }
    while (stack.length) popOverlay();
  }

  function openAbout() {
    const bst = billState();
    const billNote = bst.mode === "off" ? "" : `
        <h3>税額シミュレーション（アプリ内購入）</h3>
        <p>「節税のヒント（シミュレーション）」は、Google Play での買い切りのアプリ内購入です。支払いは Google Play が扱い、開発者がカード番号などを受け取ることはありません。</p>
        <p>購入したときは、購入の確認のため、購入ごとの番号（購入トークン）だけを開発者の確認用サーバーに送ります。入力した収入などは送りません。</p>
        ${tokushohoUrl() ? `<p><a href="${esc(tokushohoUrl())}" target="_blank" rel="noopener">特定商取引法に基づく表記</a></p>` : ""}`;
    openContentSheet("このアプリについて", `
      <div class="about">
        <p>令和9年度（令和8年1月1日〜12月31日の所得）の市県民税（個人住民税）を、申告書の項目に沿って試算するアプリです。</p>
        <h3>ご注意</h3>
        <ul>
          <li>このアプリは個人が作成したもので、国・都道府県・市区町村などの<b>行政機関の公式アプリではありません</b>。行政機関とは関係がありません。</li>
          <li>計算結果は<b>参考値</b>です。実際の税額は、お住まいの市区町村から届く税額決定通知書・納税通知書でご確認ください。</li>
          <li>申告や税額についての問い合わせは、お住まいの市区町村の住民税の担当課へ。</li>
        </ul>
        <h3>計算の前提</h3>
        <ul>
          <li>令和9年1月1日の住所地（市区町村）を選ぶと、その市区町村の均等割・所得割の税率・非課税の基準（級地）で計算します。</li>
          <li>所得割は10%（市民税6%・県民税4%）。指定都市は市民税8%・県民税2%で、調整控除・寄附金税額控除・住宅ローン控除・分離課税なども指定都市の率で計算します。</li>
          <li>標準と違う税率：神奈川県（県民税の所得割に0.018%上乗せ）、名古屋市（市民税の所得割7.7%・均等割2,800円）、豊岡市（市民税の所得割6.1%）、横浜市（市民税の均等割3,900円）、神戸市（同3,400円）。</li>
          <li>県民税の均等割には、37府県の上乗せ（森林環境税など）を含みます。上乗せの額は${esc((window.REGION_LOGIC && window.REGION_LOGIC.asOf) || "")}時点の情報で、令和9年度以降の延長を手続き中の県は今の額で計算しています。</li>
          <li>退職所得・山林所得、純損失・雑損失の繰越控除、生活保護による非課税、市区町村独自の減免には対応していません。</li>
        </ul>
        <h3>令和9年度の主な改正（反映済み）</h3>
        <ul>
          <li>給与所得控除の最低額 65万円 → 74万円（給与収入220万円以下。69万円＋令和9・10年度の特例5万円）</li>
          <li>配偶者・扶養親族などの所得要件 58万円 → 62万円、勤労学生 85万円 → 89万円</li>
          <li>特定親族特別控除の対象 62万円超123万円以下</li>
          <li>住宅ローン控除の対象を令和12年入居まで延長</li>
        </ul>
        <p>ひとり親控除の引上げ（33万円）、ふるさと納税の特例控除の上限（193万円）、青色申告特別控除の見直しは、令和10年度分からです。</p>
        <h3>出典（計算のもとにした情報）</h3>
        <ul>
          <li>総務省「個人住民税」<br><a href="https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/czaisei_seido/150790_06.html" target="_blank" rel="noopener">https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/czaisei_seido/150790_06.html</a></li>
          <li>国税庁「令和8年度税制改正による所得税の基礎控除の引上げ等について」<br><a href="https://www.nta.go.jp/users/gensen/2026kiso/index.htm" target="_blank" rel="noopener">https://www.nta.go.jp/users/gensen/2026kiso/index.htm</a></li>
          <li>国税庁「No.1177 特定親族特別控除」<br><a href="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1177.htm" target="_blank" rel="noopener">https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1177.htm</a></li>
          <li>住所地ごとの税率：${esc(((window.REGION_LOGIC && window.REGION_LOGIC.sources) || []).join("、"))}</li>
        </ul>
        <h3>データの扱い</h3>
        <p>入力した内容は、この端末の中だけで計算・保存します。外部に送ることはありません。広告や利用状況の収集もしていません。</p>
        ${billNote}
        <p class="note">バージョン ${esc(APP_VERSION)}</p>
      </div>`);
  }

  /* ─── はじめて開いたときの注意 ─── */
  function maybeOnboard() {
    if (PREVIEW) return;
    if (LS.get(KEY_ONBOARD, false)) {
      // v1.1 までを使っていた人には、住所地を選べるようになったことを一度だけ案内する
      if (!saved.region || !("code" in saved.region)) {
        saveSettings();
        setTimeout(() => openRegionPicker({ onboarding: true, upgrade: true }), 400);
      }
      return;
    }
    const scrim = document.createElement("div");
    scrim.className = "dialog-scrim";
    scrim.innerHTML = `<div class="dialog onboard" role="dialog" aria-modal="true" aria-labelledby="ob-t">
      <h2 id="ob-t">はじめにお読みください</h2>
      <ul>
        <li>令和9年度（令和8年中の所得）の市県民税を試算するアプリです。</li>
        <li>計算結果は<b>参考値</b>です。実際の税額は市区町村から届く通知でご確認ください。</li>
        <li>個人が作成したアプリで、<b>行政機関の公式アプリではありません</b>。</li>
        <li>入力した内容はこの端末の中だけで扱い、外部には送りません。</li>
      </ul>
      <div class="dialog-actions"><button type="button" class="btn primary" id="ob-ok">わかりました</button></div></div>`;
    document.body.appendChild(scrim);
    const ok = scrim.querySelector("#ob-ok");
    ok.addEventListener("click", () => {
      LS.set(KEY_ONBOARD, true); scrim.remove();
      saveSettings();   // 住所地を選ばずに閉じても、次からは案内しない
      // つづけて住所地を選んでもらう（住民税は1月1日の住所地で計算されるため）
      if (!settings.region.code) setTimeout(() => openRegionPicker({ onboarding: true }), 60);
    });
    setTimeout(() => ok.focus(), 50);
  }

  /* ─── Service Worker（オフライン対応・更新の案内） ─── */
  function registerSW() {
    if (PREVIEW || !("serviceWorker" in navigator)) return;
    if (!(location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) return;
    // はじめてのインストール時（まだ制御されていない）は再読み込みしない
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").then(reg => {
      const offer = (worker) => {
        window.APP.showToast("新しい版があります", 12000, { label: "更新する", onClick: () => worker.postMessage("SKIP_WAITING") });
      };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) offer(nw);
        });
      });
    }).catch(() => { /* オフライン対応なしで動く */ });
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading || !hadController) return;
      reloading = true;
      saveNow();
      location.reload();
    });
  }

  /* ─── 入力シート内の使い勝手 ─── */
  function setupSheetUX() {
    const scroller = $("sheet-scroll");
    // キーボードが出たとき、入力欄が隠れないように
    scroller.addEventListener("focusin", (e) => {
      const t = e.target;
      if (t && t.matches && t.matches("input, select")) setTimeout(() => t.scrollIntoView({ block: "center", behavior: "smooth" }), 280);
    });
    // 数字キーボードの「次へ」で次の欄へ
    scroller.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const t = e.target;
      if (!t.matches || !t.matches("input.num-input")) return;
      e.preventDefault();
      const all = Array.from(scroller.querySelectorAll("input.num-input:not([disabled])")).filter(x => x.offsetParent !== null);
      const i = all.indexOf(t);
      if (i >= 0 && i < all.length - 1) all[i + 1].focus(); else t.blur();
    });
    $("sheet-back").addEventListener("click", requestClose);
    $("sheet-done").addEventListener("click", requestClose);
  }

  /* ============================================================
   * 起動
   * ============================================================ */
  function start() {
    applyTheme();
    applyRegion();
    // シミュレーションの購入状態（判定が終わったら、結果画面の「有料」の札を更新）
    const bill = BILL();
    if (bill) {
      bill.onChange(() => { const S = window.APP.STATE; if (S && S.bd) renderResult(S); });
      bill.init();
    }
    window.__onRecalc = renderAll;
    window.APP.init();

    // 数字欄に「次へ」キー
    document.querySelectorAll("input.num-input").forEach(e => e.setAttribute("enterkeyhint", "next"));

    buildCards();
    setupSheetUX();

    // 保存してあった入力を戻す（プレビュー版はサンプル）
    let restored = false;
    if (!PREVIEW) {
      const data = settings.autosave ? LS.get(KEY_DATA, null) : null;
      if (data) {
        try { window.APP.importState(data); restored = true; } catch (e) { LS.del(KEY_DATA); }
      }
    } else {
      $("preview-note").hidden = false;
      window.APP.loadSample();
    }
    saveReady = true;
    window.APP.recalcAll();

    // タブ
    TABS.forEach(t => $(`tab-${t}`).addEventListener("click", () => showTab(t)));
    $("tab-income").parentElement.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const i = TABS.indexOf(currentTab);
      const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
      showTab(next); $(`tab-${next}`).focus();
    });
    $("totalbar").addEventListener("click", () => showTab("result"));
    $("btn-menu").addEventListener("click", openMenu);
    $("btn-sample").addEventListener("click", () => { window.APP.loadSample(); showTab("result"); window.APP.showToast("サンプルの数字を入れました"); });
    $("m-result").addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      if (b.dataset.act === "sim") openSim();
      else if (b.dataset.act === "region") openRegionPicker();
      else if (b.dataset.act === "print") window.APP.printAllSummary();
      else if (b.dataset.act === "share") shareSummary();
    });

    const startTab = PREVIEW ? "result" : (restored ? (LS.get(KEY_TAB, "income") || "income") : "income");
    showTab(startTab);
    if (restored) window.APP.showToast("前回の入力を戻しました");

    maybeOnboard();
    registerSW();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
