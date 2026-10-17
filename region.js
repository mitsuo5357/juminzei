/* ============================================================
 * region.js — 住所地（令和9年1月1日）から税率を決める
 *
 *  region_data.js（tools/build_region_data.py で作る表）を引いて、
 *  ZEIGAKU_LOGIC.setRegion() に渡す形にする。
 *   ・均等割：市町村民税 3,000円（横浜・神戸・名古屋は別）＋ 道府県民税 1,000円＋府県の上乗せ（37府県）
 *   ・所得割（総合課税分）：市6%・県4%（指定都市は市8%・県2%）
 *       例外：名古屋市 市7.7%／豊岡市 市6.1%／神奈川県 県＋0.018%
 *   ・級地（均等割の非課税の基準）：生活保護の級地区分（1・2・3級地）
 * ============================================================ */
(function () {
  "use strict";

  const D = window.REGION_DATA || { prefs: [], munis: {}, overrides: {} };
  let byCode = null;      // code → 市区町村
  let byPref = null;      // 都道府県コード → [市区町村]
  const prefByCode = {};
  (D.prefs || []).forEach(p => { prefByCode[p.c] = p; });

  function index() {
    if (byCode) return;
    byCode = {}; byPref = {};
    Object.keys(D.munis || {}).forEach(pc => {
      byPref[pc] = String(D.munis[pc]).split(";").filter(Boolean).map(s => {
        const [code, name, kana, kyuchi, flags] = s.split(",");
        const m = { code, name, kana, kyuchi: Number(kyuchi) || 3, designated: (flags || "").includes("d"), pref: pc };
        byCode[code] = m;
        return m;
      });
    });
  }

  function prefs() { return (D.prefs || []).map(p => ({ code: p.c, name: p.n })); }
  function munis(prefCode) { index(); return (byPref[prefCode] || []).slice(); }
  function find(code) { index(); return byCode[String(code || "")] || null; }

  const KYU_ONE = { 1: "45万円", 2: "41.5万円", 3: "38万円" };

  // 住所地の税率一式（ZEIGAKU_LOGIC.setRegion に渡す形）
  function build(code) {
    const m = find(code);
    if (!m) return null;
    const p = prefByCode[m.pref] || { n: "", k: 0 };
    const ov = (D.overrides || {})[m.code] || {};
    const designated = m.designated;
    const rateCity = ov.rateCity != null ? ov.rateCity : (designated ? 8000 : 6000);
    const ratePref = (designated ? 2000 : 4000) + (p.s || 0);
    const kintouCity = ov.kintouCity != null ? ov.kintouCity : 3000;
    const kintouPref = 1000 + (p.k || 0);
    const notes = [];
    if (designated) notes.push("指定都市なので、所得割は市民税8%・県民税2%（合計10%）で計算します。");
    if (ov.memo) notes.push(ov.memo + "。");
    if (p.k) notes.push(`県民税の均等割に${p.t || "上乗せ"}${p.k.toLocaleString("ja-JP")}円を含みます（${p.p || ""}）。`);
    if (p.m) notes.push(p.m + "。");
    if (p.st === "pending") notes.push("この上乗せは令和8年度までの期間で、令和9年度以降の延長は県で手続き中です（令和8年10月時点）。今の額のまま計算しています。");
    notes.push(`均等割が非課税になる基準は${m.kyuchi}級地です（本人だけなら合計所得${KYU_ONE[m.kyuchi]}以下）。`);
    return {
      code: m.code,
      label: `${p.n} ${m.name}`,
      prefName: p.n,
      cityName: m.name,
      designated,
      rateCity,
      ratePref,
      kintou_city: kintouCity,
      kintou_pref: kintouPref,
      shinrin: 1000,
      kyuchi: m.kyuchi,
      pending: p.st === "pending",
      notes
    };
  }

  // 住所地が未設定のとき：全国の標準（市3,000円・県1,000円、市6%・県4%、3級地）
  function standard() {
    return {
      code: "",
      label: "住所地が未設定（全国の標準）",
      prefName: "", cityName: "",
      designated: false, rateCity: 6000, ratePref: 4000,
      kintou_city: 3000, kintou_pref: 1000, shinrin: 1000, kyuchi: 3,
      pending: false,
      notes: ["住所地を選ぶと、その市区町村の均等割・税率・非課税の基準で計算します。"]
    };
  }

  // 名前・よみで探す（ひらがな・カタカナ・漢字の一部）
  //  「鶴ヶ島」「鶴ケ島」のどちらでも見つかるように、ヶ・ケをそろえてからくらべる
  function norm(s) {
    return String(s || "").normalize("NFKC").replace(/\s+/g, "")
      .replace(/[ヶゖ]/g, "ケ")
      .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }
  function search(q, limit) {
    index();
    const s = norm(q);
    if (!s) return [];
    const hits = [];
    (D.prefs || []).forEach((p, pi) => {
      (byPref[p.c] || []).forEach((m, mi) => {
        const name = norm(m.name), full = norm(p.n + m.name);
        let score = -1;
        if (name === s || m.kana === s) score = 0;                               // ぴったり
        else if (name.startsWith(s) || m.kana.startsWith(s)) score = 1;          // 先頭が同じ
        else if (full.startsWith(s)) score = 2;                                  // 「宮崎県都城」など
        else if (name.includes(s) || m.kana.includes(s) || full.includes(s)) score = 3;
        if (score >= 0) hits.push({ score, len: score <= 1 ? m.kana.length : 0, pi, mi, code: m.code, label: `${p.n} ${m.name}` });
      });
    });
    // 近いもの → （名前の先頭が同じものは）よみが短いもの（「とよおか」なら豊岡市が豊丘村より先）→ 都道府県・団体コードの順
    hits.sort((a, b) => a.score - b.score || a.len - b.len || a.pi - b.pi || a.mi - b.mi);
    return hits.slice(0, limit || 30).map(h => ({ code: h.code, label: h.label }));
  }

  window.REGION_LOGIC = {
    prefs, munis, find, build, standard, search,
    asOf: D.asOf || "", version: D.version || "", sources: D.sources || []
  };
})();
