/* ============================================================
 * zeigaku_logic.js
 * 市県民税 申告準備コーナー 計算支援ツール
 * 税額・税額控除計算ロジック（令和9年度＝令和8年分 対応版）
 *
 * 【R9年度対応で変えたところ】 2026.10
 *  ・調整控除：200万円超の「5万円を下回る場合は5万円」（＝最低2,500円）を正しく実装
 *    （旧版は2,500円を基準額に使っていたため最低125円になっていた）
 *  ・寄附金税額控除：特例控除の割合を「課税総所得金額−人的控除差調整額
 *    −（所得税の基礎控除額−48万円）」で判定（R8年度〜の取扱い）。
 *    20%上限は市・県それぞれの調整控除後所得割で判定。
 *  ・住宅ローン控除：令和7年までの入居は限度額の計算に
 *    「所得税の基礎控除額−48万円」を加算（令和8年以降の入居は加算なし）
 *  ・配当控除：1,000万円の判定を「課税総所得金額等」（分離課税分を含む）で行う
 *  ・均等割・非課税基準を地域設定（REGION）で切替可能に（既定：宮崎県・都城市）
 *  ・端数処理を整数演算に統一（浮動小数点誤差対策）
 *
 * 【住所地（1月1日）ごとの税率】 2026.10（v1.2）
 *  ・指定都市（20市）：所得割 市8%・県2%、調整控除 市4%・県1%、分離課税・配当控除・
 *    寄附金（基本 市8%・県2%、特例 市4/5・県1/5）・住宅ローン控除（市4/5・県1/5）を
 *    地方税法（令和9年1月1日施行時点）の指定都市の率で計算
 *  ・所得割（総合課税分）の超過課税・減税：神奈川県 県民税+0.018%、名古屋市 市民税7.7%、
 *    豊岡市 市民税6.1%（REGION.rateCity・ratePref に10万分率で持つ）
 *  ・配当割額・株式等譲渡所得割額の控除は指定都市でも市3/5・県2/5（法37条の4・314条の9）
 *
 * 【返り値の標準形式】
 *   {
 *     value:      合計値（市＋県）
 *     city:       市民税分
 *     prefecture: 県民税分
 *     formula:    計算過程の説明文字列
 *   }
 *
 * ※ 1円未満の端数処理：
 *   - 市民税：原則切捨て
 *   - 県民税：原則切上げ
 *   - 配当控除・税額控除は早見表の指定に従う
 * ============================================================ */

window.ZEIGAKU_LOGIC = (function() {

  // ─── 税率定数 ───
  const RATE_GENERAL = {
    city: 0.06,         // 市民税6%
    prefecture: 0.04,   // 県民税4%
    total: 0.10
  };

  // 分離課税の住民税率（taxable_typeをキーに）
  const RATE_BUNRI = {
    haito_bunri:       { city: 0.03,  prefecture: 0.02,  label: "申告分離配当（5%）" },
    kabushiki_jouto:   { city: 0.03,  prefecture: 0.02,  label: "上場株式等譲渡（5%）" },
    sakimono:          { city: 0.03,  prefecture: 0.02,  label: "先物取引（5%）" },
    tanki_ippan:       { city: 0.054, prefecture: 0.036, label: "短期譲渡・一般（9%）" },
    tanki_keigen:      { city: 0.03,  prefecture: 0.02,  label: "短期譲渡・軽減（5%）" },
    chouki_ippan:      { city: 0.03,  prefecture: 0.02,  label: "長期譲渡・一般（5%）" },
    // 軽課・特定は所得帯で税率が変わる。calc_sanshutu内で処理
  };

  // 分離課税の率（‰＝1/1,000）。[市, 県]。指定都市は地方税法附則33条の2〜35条の4の指定都市の率
  const BUNRI_PERMIL = {
    std: {
      haito_bunri: [30, 20], kabushiki_jouto: [30, 20], sakimono: [30, 20],
      tanki_ippan: [54, 36], tanki_keigen: [30, 20], chouki_ippan: [30, 20],
      keika_under: [24, 16], keika_over: [30, 20], tokutei_under: [24, 16], tokutei_over: [30, 20]
    },
    designated: {
      haito_bunri: [40, 10], kabushiki_jouto: [40, 10], sakimono: [40, 10],
      tanki_ippan: [72, 18], tanki_keigen: [40, 10], chouki_ippan: [40, 10],
      keika_under: [32, 8], keika_over: [40, 10], tokutei_under: [32, 8], tokutei_over: [40, 10]
    }
  };

  // 配当控除率（指定都市）：地方税法附則5条の指定都市の率
  const HAITO_KOUJO_RATE_DESIGNATED = {
    ippan: {
      under_1000man: { city: 0.0224, prefecture: 0.0056 },
      over_1000man:  { city: 0.0112, prefecture: 0.0028 }
    },
    tokutei_yougai: {
      under_1000man: { city: 0.0112, prefecture: 0.0028 },
      over_1000man:  { city: 0.0056, prefecture: 0.0014 }
    },
    tokutei_gaikadate: {
      under_1000man: { city: 0.0056, prefecture: 0.0014 },
      over_1000man:  { city: 0.0028, prefecture: 0.0007 }
    }
  };

  // 配当控除率（早見表より、住民税側、課税所得1000万円超は別レート）
  // 1円未満：市(3/5)切捨て・県(2/5)切上げ（ただしここは控除率なので別途）
  const HAITO_KOUJO_RATE = {
    // 利益の配当、剰余金の分配、特定株式投資信託
    ippan: {
      under_1000man: { city: 0.016, prefecture: 0.012 },
      over_1000man:  { city: 0.008, prefecture: 0.006 }
    },
    // 特定証券投資信託の収益の分配（外貨建以外）
    tokutei_yougai: {
      under_1000man: { city: 0.008, prefecture: 0.006 },
      over_1000man:  { city: 0.004, prefecture: 0.003 }
    },
    // 特定証券投資信託の収益の分配（外貨建）
    tokutei_gaikadate: {
      under_1000man: { city: 0.004,  prefecture: 0.003   },
      over_1000man:  { city: 0.002,  prefecture: 0.0015 }
    }
  };

  // ─── ユーティリティ ───
  function safeNum(v) {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }
  function floor100(n) { return Math.floor(n / 100) * 100; } // 100円単位切捨

  /* ============================================================
   * 0. 地域設定（均等割の額・均等割の非課税基準）
   *    既定値は宮崎県・都城市。
   *    ・県民税均等割 1,500円 ＝ 標準1,000円 ＋ 宮崎県森林環境税 500円
   *      （第5期：令和8〜12年度。名称を「水と緑の森林づくり税」に変更予定）
   *    ・均等割の非課税基準は生活保護の級地で異なる（都城市は3級地）
   *    ・アプリでは住所地（region.js・region_data.js）から、指定都市かどうか・
   *      所得割の税率・均等割・級地をまとめて設定する
   * ============================================================ */
  const REGION_DEFAULT = {
    code: "452025",
    label: "宮崎県・都城市",
    designated: false,   // 指定都市か
    rateCity: 6000,      // 市町村民税 所得割（総合課税分）の税率（10万分率：6000＝6%）
    ratePref: 4000,      // 道府県民税 所得割（総合課税分）の税率（4000＝4%）
    kintou_city: 3000,   // 市町村民税 均等割
    kintou_pref: 1500,   // 道府県民税 均等割（宮崎県：森林環境税500円を含む）
    shinrin: 1000,       // 森林環境税（国税）
    kyuchi: 3            // 均等割の非課税基準に使う級地（1・2・3）
  };
  let REGION = Object.assign({}, REGION_DEFAULT);
  function setRegion(r) {
    r = r || {};
    const next = Object.assign({}, REGION_DEFAULT, r);
    next.designated = !!next.designated;
    // 税率を渡されなかったときは、指定都市かどうかの標準税率
    if (r.rateCity == null) next.rateCity = next.designated ? 8000 : 6000;
    if (r.ratePref == null) next.ratePref = next.designated ? 2000 : 4000;
    next.rateCity = Math.max(0, Math.round(safeNum(next.rateCity)));
    next.ratePref = Math.max(0, Math.round(safeNum(next.ratePref)));
    next.kintou_city = Math.max(0, Math.floor(safeNum(next.kintou_city)));
    next.kintou_pref = Math.max(0, Math.floor(safeNum(next.kintou_pref)));
    next.shinrin = Math.max(0, Math.floor(safeNum(next.shinrin)));
    next.kyuchi = [1, 2, 3].includes(Number(next.kyuchi)) ? Number(next.kyuchi) : 3;
    REGION = next;
    return getRegion();
  }
  function getRegion() { return Object.assign({}, REGION); }

  // 住所地で変わる率のまとめ（指定都市かどうか）
  function getRates() {
    const d = REGION.designated;
    return {
      designated: d,
      sougou: { c: REGION.rateCity, p: REGION.ratePref },   // 所得割（総合課税分）10万分率
      chosei: d ? { c: 4, p: 1 } : { c: 3, p: 2 },          // 調整控除（%）
      fifths: d ? { c: 4, p: 1 } : { c: 3, p: 2 },          // 住宅ローン控除・寄附金の特例控除の市県の割合（5分の）
      kifuBasic: d ? { c: 8, p: 2 } : { c: 6, p: 4 },       // 寄附金の基本控除（%）
      gaikoku: d ? { c: 24, p: 6 } : { c: 18, p: 12 },      // 外国税額控除の限度額（所得税の控除限度額に対する%）
      bunri: d ? BUNRI_PERMIL.designated : BUNRI_PERMIL.std,
      haito: d ? HAITO_KOUJO_RATE_DESIGNATED : HAITO_KOUJO_RATE
    };
  }
  // 10万分率 → 「7.7%」「4.018%」
  function pctOf(per100k) {
    return (per100k / 1000).toFixed(3).replace(/\.?0+$/, "") + "%";
  }

  /* ============================================================
   * 0-2. 所得税の基礎控除額（令和8年分）
   *    住民税の「住宅ローン控除の限度額」「寄附金の特例控除割合」で
   *    （所得税の基礎控除額 − 48万円）を使うための参照表。
   *    出典：国税庁 No.1199 基礎控除（令和8年分・令和9年分）
   * ============================================================ */
  const KISO_SHOTOKU_R8 = [
    { max:  4890000, amount: 1040000 },
    { max:  6550000, amount:  670000 },
    { max: 23500000, amount:  620000 },
    { max: 24000000, amount:  480000 },
    { max: 24500000, amount:  320000 },
    { max: 25000000, amount:  160000 },
    { max:     null, amount:       0 }
  ];
  function kiso_shotoku_r8(total_income) {
    const v = safeNum(total_income);
    for (const t of KISO_SHOTOKU_R8) {
      if (t.max === null || v <= t.max) return t.amount;
    }
    return 0;
  }
  /** （所得税の基礎控除額 − 48万円）。0円未満は0円 */
  function kiso_chosei_gaku(total_income) {
    return Math.max(0, kiso_shotoku_r8(total_income) - 480000);
  }

  /* ============================================================
   * 0-3. 寄附金税額控除（特例控除）の割合
   *    判定額 ＝ 課税総所得金額 − 人的控除差調整額 −（所得税の基礎控除額 − 48万円）
   *    割合は復興特別所得税を加味した値（令和20年度まで）。
   *    単位：1/100,000（84895 → 84.895%）
   * ============================================================ */
  const TOKUREI_RATE_TABLE = [
    { max:  1950000, rate: 84895, shotoku: 5,  label: "195万円以下" },
    { max:  3300000, rate: 79790, shotoku: 10, label: "195万円超330万円以下" },
    { max:  6950000, rate: 69580, shotoku: 20, label: "330万円超695万円以下" },
    { max:  9000000, rate: 66517, shotoku: 23, label: "695万円超900万円以下" },
    { max: 18000000, rate: 56307, shotoku: 33, label: "900万円超1,800万円以下" },
    { max: 40000000, rate: 49160, shotoku: 40, label: "1,800万円超4,000万円以下" },
    { max:     null, rate: 44055, shotoku: 45, label: "4,000万円超" }
  ];
  function tokurei_rate(hantei_gaku) {
    const h = safeNum(hantei_gaku);
    if (h < 0) return { rate: 90000, shotoku: 0, label: "0円未満" };
    for (const t of TOKUREI_RATE_TABLE) {
      if (t.max === null || h <= t.max) return { rate: t.rate, shotoku: t.shotoku, label: t.label };
    }
    return { rate: 44055, shotoku: 45, label: "4,000万円超" };
  }
  function pct(rate100k) {
    // 84895 → "84.895%"
    return (rate100k / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "") + "%";
  }

  /* ============================================================
   * 1. 算出税額の計算
   *    引数:
   *      taxable_general  : 総合課税の課税所得金額
   *      separates        : [{ taxable_type, taxable_amount }, ...]
   *    返り値: { value, city, prefecture, breakdown, formula }
   *
   *    注意：
   *    - 軽課所得（居住用長期）は譲渡所得6,000万以下/超で税率分岐
   *    - 特定所得（優良住宅地）は2,000万以下/超で税率分岐
   *    - これらは separates の側に taxable_type で判別できるよう渡す前提
   *      （tochi_jouto結果を「6000万以下なら chouki_keika_kyo_under」のように分岐）
   * ============================================================ */
  function calc_sanshutu(taxable_general, separates) {
    let lines = [];
    let total_city = 0;
    let total_pref = 0;
    let breakdown = [];

    // ─── 総合課税分 ───（整数演算：10万分率。標準は市6%・県4%、指定都市は市8%・県2%）
    const R = getRates();
    const tg = safeNum(taxable_general);
    const tg_city = Math.floor(tg * R.sougou.c / 100000);
    const tg_pref = Math.floor(tg * R.sougou.p / 100000);
    total_city += tg_city;
    total_pref += tg_pref;
    lines.push(`【総合課税】課税所得 ${tg.toLocaleString()}円 × ${pctOf(R.sougou.c + R.sougou.p)}`);
    lines.push(`  → 市民税：${tg.toLocaleString()} × ${pctOf(R.sougou.c)} = ${tg_city.toLocaleString()}円`);
    lines.push(`  → 県民税：${tg.toLocaleString()} × ${pctOf(R.sougou.p)} = ${tg_pref.toLocaleString()}円`);
    breakdown.push({ type: "general", city: tg_city, prefecture: tg_pref });
    const B = R.bunri;
    const pm = (amt, r) => Math.floor(amt * r / 1000);
    const pmL = (r) => (r / 10).toFixed(1).replace(/\.0$/, "") + "%";

    // ─── 分離課税分 ───
    (separates || []).forEach(sep => {
      const amt = safeNum(sep.taxable_amount);
      if (amt <= 0) return;

      // 特殊：長期譲渡・軽課所得（居住用、6000万円以下と超で税率変動）
      // 軽課（居住用）：6,000万以下 → 市2.4% 県1.6%
      //                 6,000万超   → 市3.0% 県2.0%（うち6000万円までは軽課税率）
      // ここでは簡略化：6000万までは軽課レート、超過分は一般レート
      if (sep.taxable_type === "chouki_keika_kyo") {
        const under = Math.min(amt, 60000000);
        const over = Math.max(0, amt - 60000000);
        const c1 = pm(under, B.keika_under[0]);
        const p1 = pm(under, B.keika_under[1]);
        const c2 = pm(over, B.keika_over[0]);
        const p2 = pm(over, B.keika_over[1]);
        const c = c1 + c2;
        const p = p1 + p2;
        total_city += c;
        total_pref += p;
        lines.push(`【長期譲渡・軽課（居住用）】課税所得 ${amt.toLocaleString()}円`);
        if (over > 0) {
          lines.push(`  6,000万円以下分：${under.toLocaleString()} → 市${c1.toLocaleString()} 県${p1.toLocaleString()}円`);
          lines.push(`  6,000万円超分：${over.toLocaleString()} → 市${c2.toLocaleString()} 県${p2.toLocaleString()}円`);
        } else {
          lines.push(`  → 市民税 ${pmL(B.keika_under[0])} = ${c.toLocaleString()}円  県民税 ${pmL(B.keika_under[1])} = ${p.toLocaleString()}円`);
        }
        breakdown.push({ type: sep.taxable_type, city: c, prefecture: p });
        return;
      }

      // 特殊：長期譲渡・特定所得（優良住宅地、2000万円以下と超で税率変動）
      if (sep.taxable_type === "chouki_tokutei") {
        const under = Math.min(amt, 20000000);
        const over = Math.max(0, amt - 20000000);
        const c1 = pm(under, B.tokutei_under[0]);
        const p1 = pm(under, B.tokutei_under[1]);
        const c2 = pm(over, B.tokutei_over[0]);
        const p2 = pm(over, B.tokutei_over[1]);
        const c = c1 + c2;
        const p = p1 + p2;
        total_city += c;
        total_pref += p;
        lines.push(`【長期譲渡・特定所得（優良住宅地）】課税所得 ${amt.toLocaleString()}円`);
        if (over > 0) {
          lines.push(`  2,000万円以下分：${under.toLocaleString()} → 市${c1.toLocaleString()} 県${p1.toLocaleString()}円`);
          lines.push(`  2,000万円超分：${over.toLocaleString()} → 市${c2.toLocaleString()} 県${p2.toLocaleString()}円`);
        } else {
          lines.push(`  → 市民税：${c.toLocaleString()}円  県民税：${p.toLocaleString()}円`);
        }
        breakdown.push({ type: sep.taxable_type, city: c, prefecture: p });
        return;
      }

      // 通常の分離課税
      const rate = RATE_BUNRI[sep.taxable_type];
      const rr = B[sep.taxable_type];
      if (!rate || !rr) {
        lines.push(`【${sep.taxable_type}】税率不明：スキップ`);
        return;
      }
      // 整数演算（‰）：5.4% → 54/1000
      const c = pm(amt, rr[0]);
      const p = pm(amt, rr[1]);
      total_city += c;
      total_pref += p;
      lines.push(`【${rate.label}】課税所得 ${amt.toLocaleString()}円`);
      lines.push(`  → 市民税：${amt.toLocaleString()} × ${pmL(rr[0])} = ${c.toLocaleString()}円`);
      lines.push(`  → 県民税：${amt.toLocaleString()} × ${pmL(rr[1])} = ${p.toLocaleString()}円`);
      breakdown.push({ type: sep.taxable_type, city: c, prefecture: p });
    });

    lines.push(`────────────────────`);
    lines.push(`算出税額合計：市民税 ${total_city.toLocaleString()}円 ／ 県民税 ${total_pref.toLocaleString()}円`);
    lines.push(`           総合計：${(total_city + total_pref).toLocaleString()}円`);

    return {
      value: total_city + total_pref,
      city: total_city,
      prefecture: total_pref,
      breakdown,
      formula: lines.join("\n")
    };
  }

  /* ============================================================
   * 2. 調整控除
   *    引数:
   *      koujo_diff_sum   : 人的控除額の差の合計
   *      taxable_general  : 合計課税所得金額（≒総合課税の課税所得）
   *      total_income     : 合計所得金額（2,500万円超は適用なし）
   *
   *    ルール（早見表より）:
   *    1) 合計所得金額 > 2,500万円 → 適用なし
   *    2) 合計課税所得金額 ≦ 200万円
   *         min(人的差合計, 合計課税所得) × 5%（市3%・県2%）
   *    3) 合計課税所得金額 > 200万円
   *         {人的差合計 − (合計課税所得 − 200万)} × 5%（市3%・県2%）
   *         ※ただし { } 内が5万円を下回る場合は5万円（＝最低2,500円）
   *    ※ 旧版は「基準額の下限＝2,500円」としていたため最低125円になっていた → 修正
   * ============================================================ */
  function calc_chosei(koujo_diff_sum, taxable_general, total_income) {
    const diff = safeNum(koujo_diff_sum);
    const tg = safeNum(taxable_general);
    const ti = safeNum(total_income);
    let lines = [];

    // 2,500万円超は適用なし
    if (ti > 25000000) {
      lines.push(`合計所得金額 ${ti.toLocaleString()}円 ＞ 25,000,000円`);
      lines.push(`→ 調整控除の適用なし`);
      return { value: 0, city: 0, prefecture: 0, formula: lines.join("\n") };
    }
    if (tg <= 0) {
      lines.push(`合計課税所得金額が0円のため、調整控除は 0円`);
      return { value: 0, city: 0, prefecture: 0, formula: lines.join("\n") };
    }

    lines.push(`人的控除額の差の合計：${diff.toLocaleString()}円`);
    lines.push(`合計課税所得金額：${tg.toLocaleString()}円`);

    let base;
    if (tg <= 2000000) {
      // 200万円以下
      base = Math.min(diff, tg);
      lines.push(`→ 200万円以下のケース`);
      lines.push(`  min(${diff.toLocaleString()}, ${tg.toLocaleString()}) = ${base.toLocaleString()}円`);
    } else {
      // 200万円超
      const raw = diff - (tg - 2000000);
      base = Math.max(50000, raw);
      lines.push(`→ 200万円超のケース`);
      lines.push(`  ${diff.toLocaleString()} − (${tg.toLocaleString()} − 2,000,000) = ${raw.toLocaleString()}円`);
      if (raw < 50000) {
        lines.push(`  5万円を下回るため、5万円を適用（調整控除は最低2,500円）`);
      }
    }

    // 整数演算（市3%・県2%、指定都市は市4%・県1%）
    const cr = getRates().chosei;
    const city = Math.floor(base * cr.c / 100);
    const pref = Math.floor(base * cr.p / 100);
    const total = city + pref;

    lines.push(`────────────────────`);
    lines.push(`調整控除 ＝ ${base.toLocaleString()} × 5%`);
    lines.push(`  市民税：${base.toLocaleString()} × ${cr.c}% = ${city.toLocaleString()}円`);
    lines.push(`  県民税：${base.toLocaleString()} × ${cr.p}% = ${pref.toLocaleString()}円`);
    lines.push(`  合計：${total.toLocaleString()}円`);

    return { value: total, city, prefecture: pref, formula: lines.join("\n") };
  }

  /* ============================================================
   * 3. 配当控除
   *    引数:
   *      haito_amount         : 総合課税を選択した配当所得の金額
   *      taxable_general      : 課税総所得金額
   *      type                 : "ippan" | "tokutei_yougai" | "tokutei_gaikadate"
   *
   *    課税総所得が1,000万円を境に税率が変わる。
   *    1,000万円を超える場合：
   *      ・1,000万円までの部分の配当所得 → 通常レート
   *      ・1,000万円超の部分の配当所得 → 半額レート
   *    厳密には「配当所得の一部のうち、1000万円超に対応する部分」が半額レートになる
   * ============================================================ */
  // 率 × 金額（1/100,000 単位の整数演算）。mode: "floor" | "ceil"
  function mulRate(amt, rate, mode) {
    const r = Math.round(rate * 100000);
    const v = amt * r / 100000;
    return mode === "ceil" ? Math.ceil(v) : Math.floor(v);
  }

  /*  ※ 第2引数は「課税総所得金額等」（総合課税＋分離課税の課税所得の合計）。
   *     1,000万円の判定はこの額で行う（R9版で分離課税分を含めるよう修正）。 */
  function calc_haito_koujo(haito_amount, taxable_general, type) {
    const amt = safeNum(haito_amount);
    const tg = safeNum(taxable_general);
    type = type || "ippan";
    const rateSet = getRates().haito[type];       // 指定都市は指定都市の率

    if (amt <= 0 || !rateSet) {
      return { value: 0, city: 0, prefecture: 0,
               formula: "（配当所得が未入力、または種類が不明のため、配当控除は 0円）" };
    }

    let lines = [];
    const typeLabel = ({
      ippan: "利益の配当・剰余金の分配・特定株式投資信託",
      tokutei_yougai: "特定証券投資信託（外貨建以外）",
      tokutei_gaikadate: "特定証券投資信託（外貨建）"
    })[type];
    lines.push(`【配当の種類】${typeLabel}`);
    lines.push(`配当所得（総合課税）：${amt.toLocaleString()}円`);
    lines.push(`課税総所得金額等：${tg.toLocaleString()}円`);

    let city = 0, pref = 0;

    if (tg <= 10000000) {
      // 全額が「1,000万円以下」のレート
      const r = rateSet.under_1000man;
      // 1円未満：市切捨て・県切上げ（整数演算）
      city = mulRate(amt, r.city, "floor");
      pref = mulRate(amt, r.prefecture, "ceil");
      lines.push(`→ 課税総所得金額等 1,000万円以下のレート適用`);
      lines.push(`  市民税：${amt.toLocaleString()} × ${(r.city*100).toFixed(2)}% = ${city.toLocaleString()}円（切捨）`);
      lines.push(`  県民税：${amt.toLocaleString()} × ${(r.prefecture*100).toFixed(2)}% = ${pref.toLocaleString()}円（切上）`);
    } else {
      // 1,000万円を境に分岐
      // 1,000万円超の部分に対応する配当所得 = min(haito, tg - 1000万)
      const over_portion = Math.min(amt, tg - 10000000);
      const under_portion = amt - over_portion;
      const r1 = rateSet.under_1000man;
      const r2 = rateSet.over_1000man;
      const c1 = mulRate(under_portion, r1.city, "floor");
      const p1 = mulRate(under_portion, r1.prefecture, "ceil");
      const c2 = mulRate(over_portion, r2.city, "floor");
      const p2 = mulRate(over_portion, r2.prefecture, "ceil");
      city = c1 + c2;
      pref = p1 + p2;
      lines.push(`→ 課税総所得金額等 1,000万円超：境界で分岐`);
      lines.push(`  1,000万円以下に対応する部分：${under_portion.toLocaleString()}円`);
      lines.push(`    市：${c1.toLocaleString()}円 ／ 県：${p1.toLocaleString()}円`);
      lines.push(`  1,000万円超に対応する部分：${over_portion.toLocaleString()}円`);
      lines.push(`    市：${c2.toLocaleString()}円 ／ 県：${p2.toLocaleString()}円`);
    }

    const total = city + pref;
    lines.push(`────────────────────`);
    lines.push(`配当控除 合計：${total.toLocaleString()}円（市 ${city.toLocaleString()} ／ 県 ${pref.toLocaleString()}）`);

    return { value: total, city, prefecture: pref, formula: lines.join("\n") };
  }

  /* ============================================================
   * 4. 配当割額控除・株式譲渡所得割額控除
   *    源泉徴収済みの住民税分（5%相当）を所得割から控除
   *    市民税 3/5、県民税 2/5
   *    1円未満：市切捨て、県切上げ
   *
   *    引数:
   *      genseichoushuugaku : 源泉徴収された住民税額（市県民税合算）
   * ============================================================ */
  function calc_wariri_koujo(haito_wari, jouto_wari) {
    const h = safeNum(haito_wari);
    const j = safeNum(jouto_wari);
    if (h + j <= 0) {
      return { value: 0, city: 0, prefecture: 0,
               formula: "（源泉徴収済額が未入力のため、控除は 0円）" };
    }

    // 配当割・譲渡割それぞれで市3/5・県2/5に按分（1円未満：市切捨・県切上）
    const hCity = Math.floor(h * 3 / 5), hPref = Math.ceil(h * 2 / 5);
    const jCity = Math.floor(j * 3 / 5), jPref = Math.ceil(j * 2 / 5);
    const city = hCity + jCity;
    const pref = hPref + jPref;

    let lines = [];
    if (h > 0) lines.push(`配当割額：${h.toLocaleString()}円 → 市民税 ${hCity.toLocaleString()}円・県民税 ${hPref.toLocaleString()}円`);
    if (j > 0) lines.push(`株式等譲渡所得割額：${j.toLocaleString()}円 → 市民税 ${jCity.toLocaleString()}円・県民税 ${jPref.toLocaleString()}円`);
    lines.push(`────────────────────`);
    lines.push(`配当割額・株式譲渡所得割額控除 合計：${(city + pref).toLocaleString()}円（市 ${city.toLocaleString()}円・県 ${pref.toLocaleString()}円）`);
    lines.push(`※ 法313条-13・15により、確定申告書で申告されたもののみ控除対象`);

    return { value: city + pref, city, prefecture: pref, formula: lines.join("\n") };
  }

  /* ============================================================
   * 5. 住宅借入金等特別税額控除（住宅ローン控除）
   *    所得税から控除しきれなかった住宅ローン控除額を住民税から控除
   *
   *    引数:
   *      shotokuzei_jutaku_kanou : 所得税の住宅ローン控除可能額
   *      shotokuzei_shogaku      : 所得税額（住宅ローン控除前）
   *      shotokuzei_kazei_total  : 所得税の課税総所得金額等
   *      tekiyou_ritsu_type      : 入居時期の区分
   *          "r3_7" : H26.4〜R3.12入居（消費税8%/10%の特定取得等）→ 7%・上限136,500円
   *          "r7_5" : 上記以外で R7.12 までに入居             → 5%・上限 97,500円
   *          "r8_5" : R8.1〜R12.12 入居                      → 5%・上限 97,500円
   *          （旧値 "7percent" は r3_7、"5percent" は r7_5 として扱う）
   *      kiso_chosei             : （所得税の基礎控除額 − 48万円）※0未満は0
   *
   *    控除限度額（令和8年度〜）：
   *      R7.12までの入居 … {所得税の課税総所得金額等 ＋（所得税の基礎控除額−48万円）}× 5%（7%）
   *      R8.1以降の入居  … 所得税の課税総所得金額等 × 5%
   *    控除額 = min(所得税で控除しきれなかった額, 控除限度額, 97,500円（136,500円）)
   *    市民税 3/5、県民税 2/5（1円未満：市切捨・県切上）
   * ============================================================ */
  function calc_jutaku_loan(shotokuzei_jutaku_kanou, shotokuzei_shogaku, shotokuzei_kazei_total, tekiyou_ritsu_type, kiso_chosei) {
    const kanou = safeNum(shotokuzei_jutaku_kanou);
    const shogaku = safeNum(shotokuzei_shogaku);
    const kazei = safeNum(shotokuzei_kazei_total);
    let type = tekiyou_ritsu_type || "r7_5";
    if (type === "7percent") type = "r3_7";
    if (type === "5percent") type = "r7_5";
    const is7 = (type === "r3_7");
    const ratePct = is7 ? 7 : 5;
    const max = is7 ? 136500 : 97500;
    const useKiso = (type !== "r8_5");
    const kiso = useKiso ? Math.max(0, safeNum(kiso_chosei)) : 0;

    if (kanou <= 0) {
      return { value: 0, city: 0, prefecture: 0,
               formula: "（所得税の住宅ローン控除可能額が未入力のため、控除は 0円）" };
    }

    // 所得税で控除しきれなかった額
    const amari = Math.max(0, kanou - shogaku);
    // 控除限度額の基礎（R7.12までの入居は基礎控除の調整額を加算）
    const kisoBase = kazei + kiso;
    const byRate = Math.floor(kisoBase * ratePct / 100);
    const upper = Math.min(max, byRate);
    // 実際の控除額
    const value = Math.min(amari, upper);

    const fr = getRates().fifths;            // 市3/5・県2/5（指定都市は市4/5・県1/5）
    const city = Math.floor(value * fr.c / 5);
    const pref = Math.ceil(value * fr.p / 5);

    let lines = [];
    lines.push(`所得税の住宅ローン控除可能額：${kanou.toLocaleString()}円`);
    lines.push(`所得税額（控除前）：${shogaku.toLocaleString()}円`);
    lines.push(`→ 所得税で控除しきれない額：${kanou.toLocaleString()} − ${shogaku.toLocaleString()} = ${amari.toLocaleString()}円`);
    lines.push(`所得税の課税総所得金額等：${kazei.toLocaleString()}円`);
    if (useKiso) {
      lines.push(`＋（所得税の基礎控除額 − 48万円）：${kiso.toLocaleString()}円 ※令和7年までの入居の調整`);
      lines.push(`→ ${ratePct}%上限：${kisoBase.toLocaleString()} × ${ratePct}% = ${byRate.toLocaleString()}円`);
    } else {
      lines.push(`→ ${ratePct}%上限：${kazei.toLocaleString()} × ${ratePct}% = ${byRate.toLocaleString()}円（令和8年以降の入居）`);
    }
    lines.push(`→ 絶対上限：${max.toLocaleString()}円`);
    lines.push(`→ 控除額 ＝ min(${amari.toLocaleString()}, ${upper.toLocaleString()}) = ${value.toLocaleString()}円`);
    lines.push(`────────────────────`);
    lines.push(`住宅ローン控除（住民税）：合計 ${value.toLocaleString()}円`);
    lines.push(`  市民税：${city.toLocaleString()}円（${fr.c}/5・切捨）`);
    lines.push(`  県民税：${pref.toLocaleString()}円（${fr.p}/5・切上）`);

    return { value: city + pref, city, prefecture: pref, formula: lines.join("\n") };
  }

  /* ============================================================
   * 6. 寄附金税額控除（基本控除＋特例控除）
   *
   *    opts:
   *      furusato   : 都道府県・市区町村への寄附（ふるさと納税）… 基本＋特例
   *      nisseki    : 住所地の共同募金会・日本赤十字社支部 … 基本10%
   *      shiJourei  : 市区町村の条例指定寄附 … 市6%
   *      kenJourei  : 都道府県の条例指定寄附 … 県4%
   *      ryoJourei  : 市・県 両方の条例指定 … 10%
   *      total_income      : 総所得金額等（基本控除の対象寄附金は30%が上限）
   *      hantei_gaku       : 特例控除割合の判定額
   *                          ＝課税総所得金額−人的控除差調整額−（所得税の基礎控除額−48万円）
   *      hantei_detail     : { kazei, diff, kiso }（計算過程の表示用・任意）
   *      city_after_chosei : 調整控除後の市民税所得割（特例20%上限・全体上限）
   *      pref_after_chosei : 調整控除後の県民税所得割
   *      has_bunri         : 分離課税の所得あり（割合が変わる場合がある旨を注記）
   *      （旧API）shotoku_genkai・shotokuwari_zei … hantei_gaku が無い時だけ使用
   *
   *    ○ 基本控除：(対象寄附金 − 2,000円) × 10%（市6%・県4%）
   *        対象寄附金は総所得金額等の30%が上限
   *    ○ 特例控除（ふるさと納税のみ）：(ふるさと納税額 − 2,000円) × 特例控除割合
   *        市3/5・県2/5、それぞれ「調整控除後の所得割 × 20%」が上限
   *    ○ 基本＋特例 ≦ 所得割（市・県それぞれ）
   *    ※ 特例控除額の定額上限（193万円）は令和10年度（令和9年中の寄附）から。R9年度は対象外。
   * ============================================================ */
  function calc_kifukin(opts) {
    opts = opts || {};
    const safe = v => Math.max(0, safeNum(v));
    const furusato  = safe(opts.furusato);    // ふるさと納税（自治体）：基本＋特例
    const nisseki   = safe(opts.nisseki);     // 日赤・共同募金：基本10%
    const shiJourei = safe(opts.shiJourei);   // 市区町村 条例指定：市6%
    const kenJourei = safe(opts.kenJourei);   // 都道府県 条例指定：県4%
    const ryoJourei = safe(opts.ryoJourei);   // 市＋県 条例指定：10%
    const total = safe(opts.total_income);

    // 住所地の率（基本控除 市6%・県4%、特例控除 市3/5・県2/5。指定都市は 8%・2%、4/5・1/5）
    const R = getRates();
    const kb = R.kifuBasic, fr = R.fifths;

    // 調整控除後の所得割（市・県それぞれ）
    let cityZ, prefZ;
    if (opts.city_after_chosei != null || opts.pref_after_chosei != null) {
      cityZ = safe(opts.city_after_chosei);
      prefZ = safe(opts.pref_after_chosei);
    } else {
      const sw = safe(opts.shotokuwari_zei);      // 旧API：合計のみ → 所得割の税率の比で按分
      cityZ = Math.floor(sw * R.sougou.c / (R.sougou.c + R.sougou.p));
      prefZ = sw - cityZ;
    }

    // 特例控除割合
    let rateInfo;
    if (opts.hantei_gaku != null) {
      rateInfo = tokurei_rate(opts.hantei_gaku);
    } else {
      let genkai = safeNum(opts.shotoku_genkai);
      if (genkai >= 1) genkai = genkai / 100;     // 5 → 0.05
      rateInfo = { rate: Math.round((0.9 - genkai * 1.021) * 100000),
                   shotoku: Math.round(genkai * 100), label: `所得税率${Math.round(genkai * 100)}%` };
    }

    const totalKifu = furusato + nisseki + shiJourei + kenJourei + ryoJourei;
    if (totalKifu <= 0) {
      return { value: 0, city: 0, prefecture: 0, tokurei_rate: rateInfo.rate, tokurei_shotoku: rateInfo.shotoku,
               formula: "（住民税の対象となる寄附が未入力のため、寄附金税額控除は 0円）" };
    }

    // ─── 基本控除（市民税の対象・県民税の対象を別々に算定）───
    const upper30 = Math.floor(total * 30 / 100);
    const shiTarget = Math.min(furusato + nisseki + shiJourei + ryoJourei, upper30);
    const kenTarget = Math.min(furusato + nisseki + kenJourei + ryoJourei, upper30);
    const basicShi = Math.floor(Math.max(0, shiTarget - 2000) * kb.c / 100);
    const basicKen = Math.floor(Math.max(0, kenTarget - 2000) * kb.p / 100);

    let lines = [];
    lines.push(`【基本控除】総所得金額等の30%上限：${upper30.toLocaleString()}円`);
    lines.push(`  市民税${kb.c}%対象：${shiTarget.toLocaleString()}円 →（−2,000）×${kb.c}% ＝ ${basicShi.toLocaleString()}円`);
    lines.push(`  県民税${kb.p}%対象：${kenTarget.toLocaleString()}円 →（−2,000）×${kb.p}% ＝ ${basicKen.toLocaleString()}円`);

    // ─── 特例控除（ふるさと納税のみ）───
    let toku_city = 0, toku_pref = 0, tokuRaw = 0;
    if (furusato > 0) {
      const tokuTarget = Math.max(0, furusato - 2000);
      tokuRaw = Math.floor(tokuTarget * rateInfo.rate / 100000);
      const tCity = Math.floor(tokuRaw * fr.c / 5);   // 市：切捨て
      const tPref = tokuRaw - tCity;                   // 県：残り（切上げ）
      const capCity = Math.floor(cityZ * 20 / 100);
      const capPref = Math.floor(prefZ * 20 / 100);
      toku_city = Math.min(tCity, capCity);
      toku_pref = Math.min(tPref, capPref);

      lines.push(`【特例控除（ふるさと納税）】`);
      if (opts.hantei_gaku != null) {
        const d = opts.hantei_detail || {};
        if (d.kazei != null) {
          lines.push(`  判定額 ＝ 課税総所得金額 ${safeNum(d.kazei).toLocaleString()} − 人的控除差 ${safeNum(d.diff).toLocaleString()}`);
          lines.push(`         −（所得税の基礎控除額−48万円）${safeNum(d.kiso).toLocaleString()} ＝ ${safeNum(opts.hantei_gaku).toLocaleString()}円`);
        } else {
          lines.push(`  判定額：${safeNum(opts.hantei_gaku).toLocaleString()}円`);
        }
        lines.push(`  → 区分「${rateInfo.label}」：特例控除割合 ${pct(rateInfo.rate)}`);
      }
      lines.push(`  （${furusato.toLocaleString()} − 2,000）× ${pct(rateInfo.rate)} ＝ ${tokuRaw.toLocaleString()}円`);
      lines.push(`  市民税（${fr.c}/5）：${tCity.toLocaleString()}円（上限：市民税所得割×20% ＝ ${capCity.toLocaleString()}円）→ ${toku_city.toLocaleString()}円`);
      lines.push(`  県民税（${fr.p}/5）：${tPref.toLocaleString()}円（上限：県民税所得割×20% ＝ ${capPref.toLocaleString()}円）→ ${toku_pref.toLocaleString()}円`);
      if (opts.has_bunri && safeNum(opts.hantei_gaku) < 0) {
        lines.push(`  ※分離課税の所得がある場合は、割合が異なることがあります（簡易計算）`);
      }
    }

    let city = basicShi + toku_city;
    let pref = basicKen + toku_pref;
    if (city > cityZ || pref > prefZ) {
      city = Math.min(city, cityZ);
      pref = Math.min(pref, prefZ);
      lines.push(`【全体上限】控除額が所得割を超えるため、所得割（市 ${cityZ.toLocaleString()}円・県 ${prefZ.toLocaleString()}円）を上限に調整`);
    }
    const value = city + pref;

    lines.push(`────────────────────`);
    lines.push(`寄附金税額控除 合計：${value.toLocaleString()}円（市 ${city.toLocaleString()}円・県 ${pref.toLocaleString()}円）`);

    return { value, city, prefecture: pref, tokurei_rate: rateInfo.rate, tokurei_shotoku: rateInfo.shotoku,
             tokurei_raw: tokuRaw, formula: lines.join("\n") };
  }

  /* ============================================================
   * 7. 外国税額控除（簡易版）
   *    国外で課税された所得税相当額を、按分計算した限度額まで国内住民税から控除
   *    所得税で控除しきれない分が県民税→市民税の順に控除される
   *
   *    引数:
   *      gaikoku_zeigaku        : 外国で課税された税額
   *      shotokuzei_amari       : 所得税で控除しきれなかった額（市民から）
   *      shotokuzei_kazei_total : 所得税の課税総所得金額等
   *      koku_naigai_shotoku    : 国外所得 / 全所得 の比率（小数、例: 0.2）
   *
   *    限度額計算：
   *      所得税：課税総所得 × 所得税率 × 国外/全所得比率
   *      → 県民税：所得税限度額 × 12%
   *      → 市民税：所得税限度額 × 18%
   *
   *    簡易実装：余り額を県民税→市民税の順に上限まで充当
   * ============================================================ */
  function calc_gaikoku_zeigaku(gaikoku_zeigaku, shotokuzei_amari, gendo_kenmin, gendo_shimin) {
    const amari = safeNum(shotokuzei_amari);
    const gKen = safeNum(gendo_kenmin);
    const gShi = safeNum(gendo_shimin);

    if (amari <= 0) {
      return { value: 0, city: 0, prefecture: 0,
               formula: "（所得税で控除しきれない外国税額が未入力のため、控除は 0円）" };
    }

    // 県民税から控除
    const ken_value = Math.min(amari, gKen);
    const remain_after_ken = amari - ken_value;
    // 残りを市民税から控除
    const shi_value = Math.min(remain_after_ken, gShi);

    let lines = [];
    lines.push(`所得税で控除しきれない外国税額：${amari.toLocaleString()}円`);
    lines.push(`県民税控除限度額：${gKen.toLocaleString()}円`);
    lines.push(`市民税控除限度額：${gShi.toLocaleString()}円`);
    lines.push(`→ 県民税から控除：min(${amari.toLocaleString()}, ${gKen.toLocaleString()}) = ${ken_value.toLocaleString()}円`);
    if (remain_after_ken > 0) {
      lines.push(`→ 残り ${remain_after_ken.toLocaleString()}円を市民税から控除：min(${remain_after_ken.toLocaleString()}, ${gShi.toLocaleString()}) = ${shi_value.toLocaleString()}円`);
    }
    lines.push(`────────────────────`);
    lines.push(`外国税額控除 合計：${(ken_value + shi_value).toLocaleString()}円`);
    lines.push(`  市民税：${shi_value.toLocaleString()}円 ／ 県民税：${ken_value.toLocaleString()}円`);
    const gr = getRates().gaikoku;
    lines.push(`※ 限度額の目安：県民税は所得税の控除限度額の${gr.p}%、市民税は${gr.c}%${getRates().designated ? "（指定都市）" : ""}`);
    lines.push(`※ 簡易計算です。正確には外国所得と全所得の按分が必要`);

    return { value: ken_value + shi_value, city: shi_value, prefecture: ken_value, formula: lines.join("\n") };
  }

  /* ============================================================
   * 8. 所得割の調整措置
   *    算出税額が非課税(所得割)基準を超えるが、課税後の手取りが基準を下回る場合の調整
   *
   *    引数:
   *      hikazei_kijun  : 非課税(所得割)基準の金額（35万×人数+42万）
   *      total_income   : 総所得金額等
   *      sangoshu       : 算出税額（調整・寄附・外国・配当・住宅借入金控除適用後）
   *      city_zei       : 市民税の算出税額（調整後）
   *      pref_zei       : 県民税の算出税額（調整後）
   *
   *    調整額 = (非課税(所得割)基準 − (総所得金額等 − 算出税額)) × 当該税の算出税額/算出税額合計
   *    ※適用条件：(基準 − (総所得 − 算出)) > 0 の時
   * ============================================================ */
  function calc_shotokuwari_chosei(hikazei_kijun, total_income, sangoshu, city_zei, pref_zei) {
    const k = safeNum(hikazei_kijun);
    const ti = safeNum(total_income);
    const sg = safeNum(sangoshu);
    const cz = safeNum(city_zei);
    const pz = safeNum(pref_zei);

    const diff = k - (ti - sg);
    if (diff <= 0 || sg <= 0) {
      return {
        value: 0, city: 0, prefecture: 0,
        formula: `非課税(所得割)基準：${k.toLocaleString()}円\n総所得金額等 − 算出税額 ＝ ${(ti-sg).toLocaleString()}円\n→ 差額 ${diff.toLocaleString()}円 ≦ 0 のため、調整なし`
      };
    }

    const city = Math.floor(diff * cz / sg);
    const pref = Math.floor(diff * pz / sg);

    let lines = [];
    lines.push(`非課税(所得割)基準：${k.toLocaleString()}円`);
    lines.push(`総所得金額等：${ti.toLocaleString()}円`);
    lines.push(`算出税額（控除後）：${sg.toLocaleString()}円`);
    lines.push(`→ 調整対象額 ＝ ${k.toLocaleString()} − (${ti.toLocaleString()} − ${sg.toLocaleString()}) = ${diff.toLocaleString()}円`);
    lines.push(`→ 市民税分：${diff.toLocaleString()} × ${cz.toLocaleString()} / ${sg.toLocaleString()} = ${city.toLocaleString()}円`);
    lines.push(`→ 県民税分：${diff.toLocaleString()} × ${pz.toLocaleString()} / ${sg.toLocaleString()} = ${pref.toLocaleString()}円`);
    lines.push(`────────────────────`);
    lines.push(`所得割の調整額 合計：${(city + pref).toLocaleString()}円`);

    return { value: city + pref, city, prefecture: pref, formula: lines.join("\n") };
  }

  /* ============================================================
   * 9. 均等割の計算
   *    既定（宮崎県・都城市）：市民税3,000円 + 県民税1,500円 + 森林環境税1,000円（国税）= 5,500円
   *    ※ 額は地域設定（REGION）で変更できる
   *
   *    非課税の場合は0円
   *
   *    引数:
   *      is_hikazei_kintou : 均等割が非課税かどうか
   * ============================================================ */
  function calc_kintou_wari(is_hikazei_kintou) {
    if (is_hikazei_kintou) {
      return {
        value: 0, city: 0, prefecture: 0, shinrin: 0,
        formula: "均等割は非課税のため 0円"
      };
    }
    const c = REGION.kintou_city, p = REGION.kintou_pref, s = REGION.shinrin;
    return {
      value: c + p + s, city: c, prefecture: p, shinrin: s,
      formula: `均等割：市民税 ${c.toLocaleString()}円 ＋ 県民税 ${p.toLocaleString()}円 ＋ 森林環境税（国税）${s.toLocaleString()}円 ＝ ${(c + p + s).toLocaleString()}円`
    };
  }

  /* ============================================================
   * 10. 非課税判定
   *    引数:
   *      total_income           : 合計所得金額
   *      sou_shotoku_kingaku_to : 総所得金額等
   *      ninzu                  : 本人＋扶養（年少含む）の人数
   *      has_shougai_etc        : 障害者・未成年・寡婦・ひとり親のいずれかに該当
   *
   *    判定:
   *    ① 合計所得135万円以下 かつ 障害者等 → 均等割・所得割 共に非課税
   *    ② 均等割の非課税判定（級地で異なる。既定は3級地＝都城市）：
   *        3級地：1人 38万円 ／ 2人以上 28万円×人数 + 26.8万円 以下
   *        2級地：1人 41.5万円 ／ 2人以上 31.5万円×人数 + 28.9万円 以下
   *        1級地：1人 45万円 ／ 2人以上 35万円×人数 + 31万円 以下
   *    ③ 所得割の非課税判定：
   *        1人：総所得金額等45万円以下
   *        2人以上：35万円×人数 + 42万円 以下
   *
   *    返り値: {
   *      kintou_hikazei: 均等割が非課税か（boolean）
   *      shotoku_hikazei: 所得割が非課税か（boolean）
   *      kintou_kijun: 均等割非課税基準額
   *      shotoku_kijun: 所得割非課税基準額
   *      formula
   *    }
   * ============================================================ */
  function judge_hikazei(total_income, sou_shotoku_kingaku_to, ninzu, has_shougai_etc) {
    const ti = safeNum(total_income);
    const sst = safeNum(sou_shotoku_kingaku_to);
    const n = Math.max(1, safeNum(ninzu));
    const sg = !!has_shougai_etc;

    let lines = [];
    lines.push(`合計所得金額：${ti.toLocaleString()}円`);
    lines.push(`総所得金額等：${sst.toLocaleString()}円`);
    lines.push(`人数（本人＋扶養）：${n}人`);
    lines.push(`障害者・未成年・寡婦・ひとり親：${sg ? "該当" : "非該当"}`);

    // ① 障害者等＋135万以下なら全部非課税
    if (sg && ti <= 1350000) {
      lines.push(`→ 合計所得135万円以下 かつ 障害者等該当 → 均等割・所得割 共に非課税`);
      return {
        kintou_hikazei: true, shotoku_hikazei: true,
        kintou_kijun: 1350000, shotoku_kijun: 1350000,
        formula: lines.join("\n")
      };
    }

    // ② 均等割の非課税判定（級地別：基本額×級地率 ＋ 10万円 ＋ 扶養加算×級地率）
    const KYU = { 1: { per: 350000, add: 310000, one: 450000, perL: "35万", addL: "31万", oneL: "45万" },
                  2: { per: 315000, add: 289000, one: 415000, perL: "31.5万", addL: "28.9万", oneL: "41.5万" },
                  3: { per: 280000, add: 268000, one: 380000, perL: "28万", addL: "26.8万", oneL: "38万" } };
    const k = KYU[REGION.kyuchi] || KYU[3];
    const kintou_kijun = (n === 1) ? k.one : (k.per * n + k.add);
    const kintou_hikazei = ti <= kintou_kijun;
    // ③ 所得割の非課税判定
    const shotoku_kijun = (n === 1) ? 450000 : (350000 * n + 420000);
    const shotoku_hikazei = sst <= shotoku_kijun;

    lines.push(`【均等割の非課税判定】（${REGION.kyuchi}級地）`);
    lines.push(`  基準額：${(n === 1 ? `1人：${k.oneL}円` : `${k.perL}×${n}人 + ${k.addL} = ${kintou_kijun.toLocaleString()}円`)}`);
    lines.push(`  → 合計所得 ${ti.toLocaleString()} ${kintou_hikazei ? "≦" : ">"} ${kintou_kijun.toLocaleString()} ：${kintou_hikazei ? "非課税" : "課税"}`);
    lines.push(`【所得割の非課税判定】`);
    lines.push(`  基準額：${(n === 1 ? "1人：45万円" : `35万×${n}人 + 42万 = ${shotoku_kijun.toLocaleString()}円`)}`);
    lines.push(`  → 総所得等 ${sst.toLocaleString()} ${shotoku_hikazei ? "≦" : ">"} ${shotoku_kijun.toLocaleString()} ：${shotoku_hikazei ? "非課税" : "課税"}`);

    return { kintou_hikazei, shotoku_hikazei, kintou_kijun, shotoku_kijun, formula: lines.join("\n") };
  }

  /* ============================================================
   * 参考：所得税の限界税率テーブル
   *    課税総所得・課税標準額 → 限界税率
   *    ※ 所得税法89条の「195万円以下」等に合わせて境界を「以下」で判定
   * ============================================================ */
  const SHOTOKUZEI_RATE_TABLE = [
    { max:  1950000, rate: 0.05 },
    { max:  3300000, rate: 0.10 },
    { max:  6950000, rate: 0.20 },
    { max:  9000000, rate: 0.23 },
    { max: 18000000, rate: 0.33 },
    { max: 40000000, rate: 0.40 },
    { max:     null, rate: 0.45 }
  ];

  /** 課税総所得（または判定額）から所得税の限界税率を取得（％）。0円未満は0 */
  function shotokuzei_genkai_rate(kazei_total) {
    const v = safeNum(kazei_total);
    if (v < 0) return 0;
    for (const t of SHOTOKUZEI_RATE_TABLE) {
      if (t.max === null || v <= t.max) return Math.round(t.rate * 100);
    }
    return 0;
  }

  /* ============================================================
   * 公開API
   * ============================================================ */
  return {
    // 算出税額
    calc_sanshutu,
    // 税額控除
    calc_chosei,
    calc_haito_koujo,
    calc_wariri_koujo,
    calc_jutaku_loan,
    calc_kifukin,
    calc_gaikoku_zeigaku,
    // 所得割の調整措置・均等割・非課税判定
    calc_shotokuwari_chosei,
    calc_kintou_wari,
    judge_hikazei,
    // 参考
    shotokuzei_genkai_rate,
    SHOTOKUZEI_RATE_TABLE,
    // R9追加：所得税の基礎控除（令和8年分）・特例控除割合・地域設定
    kiso_shotoku_r8,
    kiso_chosei_gaku,
    tokurei_rate,
    TOKUREI_RATE_TABLE,
    setRegion,
    getRegion,
    getRates,
    pctOf,
    REGION_DEFAULT,
    // 定数（参照用）
    RATE_GENERAL,
    RATE_BUNRI,
    HAITO_KOUJO_RATE,
    NENDO: "令和9年度（令和8年分）"
  };

})();
