/* ============================================================
 * calc_logic.js
 * 市県民税 申告準備コーナー 計算支援ツール
 * 計算ロジック（令和9年度住民税＝令和8年分所得 対応版）
 *
 * 各関数は { value, formula } を返す：
 *   value   : 数値（円）
 *   formula : 計算過程の説明文字列（複数行）
 *
 * ─────────────────────────────────────────────────
 * 【R9年度（令和8年分）対応で変えたところ】 2026.10
 *
 *  1. 給与所得控除：最低保障額 65万 → 74万（69万＋R9・R10年度限りの特例5万）
 *     給与収入220万円以下が対象。速算表どおり 2,191,000〜2,199,999円 の
 *     特例区分（1,451,000／1,453,000／1,456,000円）も実装。
 *  2. 端数処理を整数演算に変更（×0.7 等の浮動小数点誤差で
 *     給与所得が1円ずれる区分が93か所あったのを修正）。
 *  3. 所得金額調整控除①の1円未満を切上げに修正。
 *
 * 【R10年度（令和9年分）以降の要改修ポイント ※今回は対象外】
 *
 *  ・青色申告特別控除の見直しは「令和9年分の所得税」から＝住民税は R10年度から。
 *     55万円控除の廃止（書面は10万円）／優良な電子帳簿＋e-Taxで75万円 など。
 *     → R10版で青色クイックボタンを [×0][10万][65万][75万] に、
 *        aggregateGeneralIncomes の上限チェック 650000 → 750000 に。
 *     （R9年度＝令和8年分は従来どおり 65万／55万／10万）
 *  ・ひとり親控除 30万 → 33万 も R10年度から（koujo_data.js）。
 *  ・ふるさと納税の特例控除額の上限（193万円）も R10年度から（zeigaku_logic.js）。
 *
 * ─────────────────────────────────────────────────
 * ============================================================ */

window.CALC_LOGIC = (function() {

  // ─── ユーティリティ ───
  function yen(n) {
    return Math.max(0, Math.floor(n)).toLocaleString() + " 円";
  }

  function safeNum(v) {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  /* ============================================================
   * 1. 給与所得計算（令和9年度＝令和8年分）
   *    令和8年度税制改正：給与所得控除の最低保障額 65万 → 69万、
   *    さらに令和9・10年度に限り＋5万（＝74万）。給与収入220万円以下が対象。
   *    速算表（令和9年度・10年度）：
   *      〜740,999円            0円
   *      741,000〜2,190,999円   収入 − 740,000円
   *      2,191,000〜2,192,999円 1,451,000円
   *      2,193,000〜2,195,999円 1,453,000円
   *      2,196,000〜2,199,999円 1,456,000円
   *      2,200,000〜3,599,999円 A×2.8 − 80,000円（A＝収入÷4、千円未満切捨）
   *      3,600,000〜6,599,999円 A×3.2 − 440,000円
   *      6,600,000〜8,499,999円 収入×0.9 − 1,100,000円
   *      8,500,000円〜          収入 − 1,950,000円
   *    ※浮動小数点の誤差を避けるため、すべて整数演算で計算する。
   * ============================================================ */
  function salaryIncome(revenue) {
    const rev = Math.floor(safeNum(revenue));
    if (rev <= 0) {
      return {
        value: 0,
        formula: "（給与収入が未入力または0円のため、給与所得は 0円）"
      };
    }

    let income = 0;
    let lines = [];
    lines.push(`給与収入：${rev.toLocaleString()}円`);

    if (rev < 741000) {
      income = 0;
      lines.push(`→ 740,999円以下：給与所得控除（最低保障 740,000円）で全額控除`);
      lines.push(`→ 給与所得 ＝ 0円`);
    } else if (rev < 2191000) {
      income = rev - 740000;
      lines.push(`→ 741,000円〜2,190,999円：給与所得控除 740,000円`);
      lines.push(`  （最低保障額69万円＋令和9・10年度の特例5万円）`);
      lines.push(`→ 給与所得 ＝ ${rev.toLocaleString()} − 740,000 ＝ ${income.toLocaleString()}円`);
    } else if (rev < 2200000) {
      // 速算表の特例区分（2,191,000〜2,199,999円）
      if (rev < 2193000)      income = 1451000;
      else if (rev < 2196000) income = 1453000;
      else                    income = 1456000;
      lines.push(`→ 2,191,000円〜2,199,999円：速算表の特例区分`);
      lines.push(`→ 給与所得 ＝ ${income.toLocaleString()}円`);
    } else if (rev < 3600000) {
      const a = Math.floor(rev / 4000);          // A÷1,000
      income = a * 2800 - 80000;                 // A×2.8 − 80,000
      lines.push(`→ 2,200,000円〜3,599,999円の区分`);
      lines.push(`→ A ＝ 給与収入÷4（千円未満切捨）＝ ${(a * 1000).toLocaleString()}円`);
      lines.push(`→ 給与所得 ＝ ${(a * 1000).toLocaleString()} × 2.8 − 80,000 ＝ ${income.toLocaleString()}円`);
    } else if (rev < 6600000) {
      const a = Math.floor(rev / 4000);
      income = a * 3200 - 440000;                // A×3.2 − 440,000
      lines.push(`→ 3,600,000円〜6,599,999円の区分`);
      lines.push(`→ A ＝ 給与収入÷4（千円未満切捨）＝ ${(a * 1000).toLocaleString()}円`);
      lines.push(`→ 給与所得 ＝ ${(a * 1000).toLocaleString()} × 3.2 − 440,000 ＝ ${income.toLocaleString()}円`);
    } else if (rev < 8500000) {
      income = Math.floor(rev * 9 / 10) - 1100000;
      lines.push(`→ 6,600,000円〜8,499,999円の区分`);
      lines.push(`→ 給与所得 ＝ ${rev.toLocaleString()} × 0.9 − 1,100,000 ＝ ${income.toLocaleString()}円`);
    } else {
      income = rev - 1950000;
      lines.push(`→ 8,500,000円以上の区分（控除上限 1,950,000円）`);
      lines.push(`→ 給与所得 ＝ ${rev.toLocaleString()} − 1,950,000 ＝ ${income.toLocaleString()}円`);
    }

    return {
      value: Math.max(0, income),
      formula: lines.join("\n")
    };
  }

  /* ============================================================
   * 1-2. 所得金額調整控除（令和2年〜）
   *    ① 子ども・特別障害者等を有する者等：給与収入850万円超
   *       控除額 ＝（min(給与収入,1,000万) − 850万）× 10%（最大15万円）
   *       要件：本人が特別障害者／23歳未満の扶養親族あり／
   *             特別障害者である同一生計配偶者・扶養親族あり のいずれか
   *    ② 給与所得と公的年金等の雑所得の双方がある者：
   *       控除額 ＝ min(給与所得,10万) ＋ min(年金所得,10万) − 10万（最大10万円）
   *    ①②とも給与所得から控除。両方該当なら①②の合計を控除。
   *
   *    引数: { salaryRev, salaryIncome, pensionIncome, hasKodomoTokubetsu }
   *    返却: { value:控除額合計, adjustedSalary:控除後の給与所得, formula }
   * ============================================================ */
  function shotokuChouseiKoujo(args) {
    const salaryRev = safeNum(args.salaryRev);
    const sIncome   = safeNum(args.salaryIncome);
    const pIncome   = safeNum(args.pensionIncome);
    const hasKodomo = !!args.hasKodomoTokubetsu;

    let c1 = 0, c2 = 0;
    const lines = [];

    // ① 子ども・特別障害者等＋給与収入850万円超
    if (hasKodomo && salaryRev > 8500000) {
      const capped = Math.min(Math.floor(salaryRev), 10000000);
      c1 = Math.ceil((capped - 8500000) / 10);   // ×10%、1円未満切上げ
      lines.push(`① 子ども・特別障害者等：(${capped.toLocaleString()} − 8,500,000) × 10% ＝ ${c1.toLocaleString()}円`);
    }

    // ② 給与所得と公的年金等の雑所得の双方あり
    if (sIncome > 0 && pIncome > 0) {
      const a = Math.min(sIncome, 100000);
      const b = Math.min(pIncome, 100000);
      c2 = Math.max(0, a + b - 100000);
      if (c2 > 0) {
        lines.push(`② 給与・年金の双方あり：min(${sIncome.toLocaleString()},10万) ＋ min(${pIncome.toLocaleString()},10万) − 10万 ＝ ${c2.toLocaleString()}円`);
      }
    }

    const value = c1 + c2;
    const adjustedSalary = Math.max(0, sIncome - value);

    if (value <= 0) {
      return { value: 0, adjustedSalary: sIncome, formula: "" };
    }
    lines.push(`→ 所得金額調整控除 合計 ＝ ${value.toLocaleString()}円（給与所得から控除）`);
    lines.push(`→ 控除後の給与所得 ＝ ${sIncome.toLocaleString()} − ${value.toLocaleString()} ＝ ${adjustedSalary.toLocaleString()}円`);
    return { value, adjustedSalary, formula: lines.join("\n") };
  }

  /* ============================================================
   * 2. 年金所得計算（令和9年度：公的年金等控除の改正なし）
   *    引数: rev=年金収入, otherIncome=年金以外の所得, is65=12月31日時点で65歳以上
   *    ※ ×0.85 等は整数演算（収入×85÷100）で1円未満切捨て
   * ============================================================ */
  function pensionIncome(revenue, otherIncome, is65) {
    const rev = Math.floor(safeNum(revenue));
    const other = safeNum(otherIncome);
    if (rev <= 0) {
      return {
        value: 0,
        formula: "（年金収入が未入力または0円のため、年金所得は 0円）"
      };
    }

    let income = 0;
    let deduction = 0;
    let lines = [];
    lines.push(`年金収入：${rev.toLocaleString()}円`);
    lines.push(`年金以外の所得：${other.toLocaleString()}円`);
    lines.push(`年齢区分：${is65 ? "65歳以上" : "65歳未満"}`);

    // 他所得の階層判定
    let otherTier = 0;
    if (other > 20000000) otherTier = 2;
    else if (other > 10000000) otherTier = 1;
    const otherTierLabel = ["1,000万円以下", "1,000万円超 2,000万円以下", "2,000万円超"][otherTier];
    lines.push(`→ 年金以外の所得区分：${otherTierLabel}`);

    if (is65) {
      // 65歳以上
      if (rev <= 3300000) {
        deduction = [1100000, 1000000, 900000][otherTier];
        income = rev - deduction;
        lines.push(`→ 年金収入 330万円以下：控除額 ${deduction.toLocaleString()}円`);
        lines.push(`→ 年金所得 ＝ ${rev.toLocaleString()} − ${deduction.toLocaleString()} ＝ ${income.toLocaleString()}円`);
      } else if (rev <= 4100000) {
        deduction = [275000, 175000, 75000][otherTier];
        income = Math.floor(rev * 75 / 100) - deduction;
        lines.push(`→ 年金収入 330万円超 410万円以下：控除額 ${deduction.toLocaleString()}円`);
        lines.push(`→ 年金所得 ＝ ${rev.toLocaleString()} × 0.75 − ${deduction.toLocaleString()} ＝ ${income.toLocaleString()}円`);
      } else if (rev <= 7700000) {
        deduction = [685000, 585000, 485000][otherTier];
        income = Math.floor(rev * 85 / 100) - deduction;
        lines.push(`→ 年金収入 410万円超 770万円以下：控除額 ${deduction.toLocaleString()}円`);
        lines.push(`→ 年金所得 ＝ ${rev.toLocaleString()} × 0.85 − ${deduction.toLocaleString()} ＝ ${income.toLocaleString()}円`);
      } else if (rev <= 10000000) {
        deduction = [1455000, 1355000, 1255000][otherTier];
        income = Math.floor(rev * 95 / 100) - deduction;
        lines.push(`→ 年金収入 770万円超 1,000万円以下：控除額 ${deduction.toLocaleString()}円`);
        lines.push(`→ 年金所得 ＝ ${rev.toLocaleString()} × 0.95 − ${deduction.toLocaleString()} ＝ ${income.toLocaleString()}円`);
      } else {
        deduction = [1955000, 1855000, 1755000][otherTier];
        income = rev - deduction;
        lines.push(`→ 年金収入 1,000万円超：控除額 ${deduction.toLocaleString()}円`);
        lines.push(`→ 年金所得 ＝ ${rev.toLocaleString()} − ${deduction.toLocaleString()} ＝ ${income.toLocaleString()}円`);
      }
    } else {
      // 65歳未満
      if (rev <= 1300000) {
        deduction = [600000, 500000, 400000][otherTier];
        income = rev - deduction;
        lines.push(`→ 年金収入 130万円以下：控除額 ${deduction.toLocaleString()}円`);
        lines.push(`→ 年金所得 ＝ ${rev.toLocaleString()} − ${deduction.toLocaleString()} ＝ ${income.toLocaleString()}円`);
      } else if (rev <= 4100000) {
        deduction = [275000, 175000, 75000][otherTier];
        income = Math.floor(rev * 75 / 100) - deduction;
        lines.push(`→ 年金収入 130万円超 410万円以下：控除額 ${deduction.toLocaleString()}円`);
        lines.push(`→ 年金所得 ＝ ${rev.toLocaleString()} × 0.75 − ${deduction.toLocaleString()} ＝ ${income.toLocaleString()}円`);
      } else if (rev <= 7700000) {
        deduction = [685000, 585000, 485000][otherTier];
        income = Math.floor(rev * 85 / 100) - deduction;
        lines.push(`→ 年金収入 410万円超 770万円以下：控除額 ${deduction.toLocaleString()}円`);
        lines.push(`→ 年金所得 ＝ ${rev.toLocaleString()} × 0.85 − ${deduction.toLocaleString()} ＝ ${income.toLocaleString()}円`);
      } else if (rev <= 10000000) {
        deduction = [1455000, 1355000, 1255000][otherTier];
        income = Math.floor(rev * 95 / 100) - deduction;
        lines.push(`→ 年金収入 770万円超 1,000万円以下：控除額 ${deduction.toLocaleString()}円`);
        lines.push(`→ 年金所得 ＝ ${rev.toLocaleString()} × 0.95 − ${deduction.toLocaleString()} ＝ ${income.toLocaleString()}円`);
      } else {
        deduction = [1955000, 1855000, 1755000][otherTier];
        income = rev - deduction;
        lines.push(`→ 年金収入 1,000万円超：控除額 ${deduction.toLocaleString()}円`);
        lines.push(`→ 年金所得 ＝ ${rev.toLocaleString()} − ${deduction.toLocaleString()} ＝ ${income.toLocaleString()}円`);
      }
    }

    return {
      value: Math.max(0, Math.floor(income)),
      formula: lines.join("\n")
    };
  }

  /* ============================================================
   * 3. 営業等所得・農業所得（収入 − 経費 = 所得。赤字は損益通算へ）
   *    label: "営業等" | "農業"
   * ============================================================ */
  function businessLikeIncome(label, revenue, expense) {
    const r = safeNum(revenue);
    const e = safeNum(expense);
    if (r <= 0 && e <= 0) {
      return { value: 0, formula: `（${label}の収入・経費が未入力のため、所得は 0円）` };
    }
    const income = r - e;
    const lines = [
      `${label}の収入金額：${r.toLocaleString()}円`,
      `必要経費：${e.toLocaleString()}円`,
      `→ ${label}の所得 ＝ ${r.toLocaleString()} − ${e.toLocaleString()} ＝ ${income.toLocaleString()}円`
    ];
    if (income < 0) {
      lines.push(`※ 赤字のため、他の所得との損益通算の対象となります（青特控適用前）`);
    }
    return { value: Math.floor(income), formula: lines.join("\n") };
  }
  function eigyoIncome(rev, exp) { return businessLikeIncome("営業等", rev, exp); }
  function nougyoIncome(rev, exp) { return businessLikeIncome("農業", rev, exp); }

  /* ============================================================
   * 4. 不動産所得（収入 − 経費 = 所得）
   *    赤字のうち土地等取得の負債利子分は損益通算不可（措法41の4）
   *    引数: rev=収入, exp=必要経費, fusai_riko=土地等取得の負債利子
   * ============================================================ */
  function fudosanIncome(revenue, expense, fusai_riko) {
    const r = safeNum(revenue);
    const e = safeNum(expense);
    const fr = safeNum(fusai_riko);
    if (r <= 0 && e <= 0) {
      return { value: 0, restrictedLoss: 0, formula: "（不動産の収入・経費が未入力のため、所得は 0円）" };
    }
    const income = r - e;
    const lines = [
      `不動産の収入金額：${r.toLocaleString()}円`,
      `必要経費：${e.toLocaleString()}円`
    ];
    if (fr > 0) lines.push(`（うち土地等取得の負債利子：${fr.toLocaleString()}円）`);
    lines.push(`→ 不動産所得 ＝ ${r.toLocaleString()} − ${e.toLocaleString()} ＝ ${income.toLocaleString()}円`);

    let restrictedLoss = 0;
    if (income < 0) {
      restrictedLoss = Math.min(fr, -income);
      if (restrictedLoss > 0) {
        lines.push(`※ 赤字 ${(-income).toLocaleString()}円 のうち、土地等取得の負債利子分 ${restrictedLoss.toLocaleString()}円 は損益通算できません`);
      } else {
        lines.push(`※ 赤字のため、他の所得との損益通算の対象となります`);
      }
    }
    return { value: Math.floor(income), restrictedLoss: restrictedLoss, formula: lines.join("\n") };
  }

  /* ============================================================
   * 5. 雑所得（業務／その他）
   *    赤字でも0円として扱う（他所得との損益通算は不可）
   *    label: "業務" | "その他"
   * ============================================================ */
  function zatsuIncome(label, revenue, expense) {
    const r = safeNum(revenue);
    const e = safeNum(expense);
    if (r <= 0 && e <= 0) {
      return { value: 0, raw: 0, formula: `（雑（${label}）の収入・経費が未入力のため、所得は 0円）` };
    }
    const raw = r - e;
    const lines = [
      `雑（${label}）の収入金額：${r.toLocaleString()}円`,
      `必要経費：${e.toLocaleString()}円`
    ];
    if (raw < 0) {
      lines.push(`→ 計算上の差額：${raw.toLocaleString()}円`);
      lines.push(`→ 雑所得は赤字でも 0円 として扱われます（他の所得との損益通算は不可）`);
      return { value: 0, raw: raw, formula: lines.join("\n") };
    }
    lines.push(`→ 雑（${label}）所得 ＝ ${raw.toLocaleString()}円`);
    return { value: Math.floor(raw), raw: raw, formula: lines.join("\n") };
  }
  function zatsuBusinessIncome(rev, exp) { return zatsuIncome("業務", rev, exp); }
  function zatsuOtherIncome(rev, exp) { return zatsuIncome("その他", rev, exp); }

  /* ============================================================
   * 6. 青色申告特別控除の適用＋損益通算（総合課税）
   *    青特控の控除順序：不動産 → 事業（営業＋農業）→ 山林（本ツールでは山林省略）
   *    引数: {
   *      kyuyo, nenkin, zatsuB, zatsuO,
   *      eigyoRaw, nougyoRaw, fudosanRaw, fudosanRestrictedLoss,
   *      aoiroEigyo, aoiroNougyo, aoiroFudosan, fudosanJigyoTeki
   *    }
   *    返却: {
   *      value:         損益通算後の総合課税合計所得（≧0）
   *      formula:       計算過程
   *      aoiroApplied:  { fudosan, eigyo, nougyo, total } 実際に適用された青特控
   *      after:         { eigyo, nougyo, fudosan } 青特控適用後の各所得
   *      warnings:      警告メッセージ配列
   *    }
   * ============================================================ */
  function aggregateGeneralIncomes(args) {
    const kyuyo   = safeNum(args.kyuyo);
    const nenkin  = safeNum(args.nenkin);
    const zatsuB  = safeNum(args.zatsuB);
    const zatsuO  = safeNum(args.zatsuO);
    const eigyoR  = safeNum(args.eigyoRaw);
    const nougyoR = safeNum(args.nougyoRaw);
    const fudoR   = safeNum(args.fudosanRaw);
    const fudoRL  = safeNum(args.fudosanRestrictedLoss);
    const aoF_in  = safeNum(args.aoiroFudosan);
    const aoE_in  = safeNum(args.aoiroEigyo);
    const aoN_in  = safeNum(args.aoiroNougyo);
    const jigyoTeki = !!args.fudosanJigyoTeki;

    const lines = [];
    const warnings = [];

    // 青特控：黒字所得からのみ控除可（注1：黒字額が控除額の上限）
    let aoF = 0, aoE = 0, aoN = 0;
    let fudoAfter = fudoR, eigyoAfter = eigyoR, nougyoAfter = nougyoR;

    if (fudoR > 0 && aoF_in > 0) {
      aoF = Math.min(aoF_in, fudoR);
      fudoAfter = fudoR - aoF;
      if (aoF < aoF_in) {
        warnings.push(`不動産：青特控指定額 ${aoF_in.toLocaleString()}円 → 黒字額 ${fudoR.toLocaleString()}円までしか適用できないため ${aoF.toLocaleString()}円に縮減`);
      }
    } else if (aoF_in > 0 && fudoR <= 0) {
      warnings.push(`不動産：黒字がないため、青特控は適用できません`);
    }

    if (eigyoR > 0 && aoE_in > 0) {
      aoE = Math.min(aoE_in, eigyoR);
      eigyoAfter = eigyoR - aoE;
      if (aoE < aoE_in) {
        warnings.push(`営業等：青特控指定額 ${aoE_in.toLocaleString()}円 → 黒字額 ${eigyoR.toLocaleString()}円までしか適用できないため ${aoE.toLocaleString()}円に縮減`);
      }
    } else if (aoE_in > 0 && eigyoR <= 0) {
      warnings.push(`営業等：黒字がないため、青特控は適用できません`);
    }

    if (nougyoR > 0 && aoN_in > 0) {
      aoN = Math.min(aoN_in, nougyoR);
      nougyoAfter = nougyoR - aoN;
      if (aoN < aoN_in) {
        warnings.push(`農業：青特控指定額 ${aoN_in.toLocaleString()}円 → 黒字額 ${nougyoR.toLocaleString()}円までしか適用できないため ${aoN.toLocaleString()}円に縮減`);
      }
    } else if (aoN_in > 0 && nougyoR <= 0) {
      warnings.push(`農業：黒字がないため、青特控は適用できません`);
    }

    // 青特控の合計上限チェック
    const aoTotal = aoF + aoE + aoN;
    const hasJigyo = (eigyoR > 0 || nougyoR > 0);
    const limit = (jigyoTeki || hasJigyo) ? 650000 : 100000;
    if (aoTotal > limit) {
      warnings.push(`⚠ 青特控合計 ${aoTotal.toLocaleString()}円 が上限 ${limit.toLocaleString()}円 を超えています（${jigyoTeki || hasJigyo ? "事業所得 or 事業的規模あり" : "事業的規模でない不動産のみ"}）`);
    }
    if (!jigyoTeki && !hasJigyo && aoF > 100000) {
      warnings.push(`⚠ 不動産が事業的規模でなく事業所得もないため、青特控は 100,000円が上限です`);
    }

    // 損益通算
    const fudoLoss = Math.max(0, -fudoAfter);
    const fudoLossDed = Math.max(0, fudoLoss - fudoRL);  // 通算可能な損失
    const eigyoLoss = Math.max(0, -eigyoAfter);
    const nougyoLoss = Math.max(0, -nougyoAfter);

    const fudoGain = Math.max(0, fudoAfter);
    const eigyoGain = Math.max(0, eigyoAfter);
    const nougyoGain = Math.max(0, nougyoAfter);

    const zatsuTotal = zatsuB + zatsuO;  // 雑は黒字のみ加算（赤字は呼び出し側で0クリップ済み）

    // 集計
    let sum = kyuyo + nenkin + fudoGain + eigyoGain + nougyoGain + zatsuTotal;
    sum -= fudoLossDed;
    sum -= eigyoLoss;
    sum -= nougyoLoss;
    const value = Math.max(0, sum);

    // ログ
    lines.push(`給与所得：${kyuyo.toLocaleString()}円`);
    lines.push(`年金所得：${nenkin.toLocaleString()}円`);
    if (eigyoR !== 0 || aoE > 0) {
      lines.push(`営業等所得：${eigyoR.toLocaleString()}円` + (aoE > 0 ? `（青特控 ${aoE.toLocaleString()}円適用後：${eigyoAfter.toLocaleString()}円）` : ``));
    }
    if (nougyoR !== 0 || aoN > 0) {
      lines.push(`農業所得：${nougyoR.toLocaleString()}円` + (aoN > 0 ? `（青特控 ${aoN.toLocaleString()}円適用後：${nougyoAfter.toLocaleString()}円）` : ``));
    }
    if (fudoR !== 0 || aoF > 0) {
      lines.push(`不動産所得：${fudoR.toLocaleString()}円` + (aoF > 0 ? `（青特控 ${aoF.toLocaleString()}円適用後：${fudoAfter.toLocaleString()}円）` : ``));
      if (fudoRL > 0 && fudoLoss > 0) {
        lines.push(`  ※赤字 ${fudoLoss.toLocaleString()}円のうち、負債利子分 ${fudoRL.toLocaleString()}円は損益通算不可（通算対象：${fudoLossDed.toLocaleString()}円）`);
      }
    }
    if (zatsuTotal > 0) lines.push(`雑所得（業務＋その他）：${zatsuTotal.toLocaleString()}円`);
    if (fudoLossDed + eigyoLoss + nougyoLoss > 0) {
      lines.push(`→ 損益通算：赤字合計 ${(fudoLossDed + eigyoLoss + nougyoLoss).toLocaleString()}円 を控除`);
    }
    lines.push(`→ 総合課税の合計所得金額 ＝ ${value.toLocaleString()}円`);

    return {
      value: value,
      formula: lines.join("\n"),
      aoiroApplied: { fudosan: aoF, eigyo: aoE, nougyo: aoN, total: aoTotal },
      after: { eigyo: eigyoAfter, nougyo: nougyoAfter, fudosan: fudoAfter },
      warnings: warnings
    };
  }

  /* ============================================================
   * 7. 医療費控除（順算）
   *    引数: (inputs={paid, ins}, koujo, state={totalIncome})
   * ============================================================ */
  function medical(inputs, koujo, state) {
    const paid = safeNum(inputs.paid);
    const ins = safeNum(inputs.ins);
    const totalIncome = safeNum(state && state.totalIncome);

    if (paid <= 0) {
      return {
        value: 0,
        formula: "（支払った医療費が未入力または0円のため、医療費控除は 0円）"
      };
    }

    const threshold = Math.max(0, Math.min(100000, Math.floor(totalIncome * 5 / 100)));
    const raw = paid - ins - threshold;
    const value = Math.max(0, Math.min(2000000, raw));

    let lines = [];
    lines.push(`支払った医療費：${paid.toLocaleString()}円`);
    lines.push(`保険等の補填金：${ins.toLocaleString()}円`);
    lines.push(`総所得金額等：${totalIncome.toLocaleString()}円`);
    lines.push(`→ 足切り額：min(100,000円, 総所得金額等の5%)`);
    lines.push(`  ＝ min(100,000, ${Math.floor(totalIncome * 5 / 100).toLocaleString()}) ＝ ${threshold.toLocaleString()}円`);
    lines.push(`→ 控除額 ＝ ${paid.toLocaleString()} − ${ins.toLocaleString()} − ${threshold.toLocaleString()}`);
    lines.push(`         ＝ ${raw.toLocaleString()}円`);
    if (raw <= 0) {
      lines.push(`→ 0円未満のため、医療費控除は 0円`);
    } else if (raw > 2000000) {
      lines.push(`→ 200万円の上限を適用：医療費控除 ＝ 2,000,000円`);
    } else {
      lines.push(`→ 医療費控除 ＝ ${value.toLocaleString()}円`);
    }

    return { value: Math.floor(value), formula: lines.join("\n") };
  }

  /* ============================================================
   * 4. 扶養控除（formula型・人数別集計）
   *    引数: inputs={ippan, tokutei, rojin, rojin_dokyo}, koujo（マスタ）
   * ============================================================ */
  function fuyou(inputs, koujo) {
    let total = 0;
    let lines = [];
    let hasAny = false;

    for (const rate of (koujo.rates || [])) {
      const count = Number(inputs[rate.id]) || 0;
      if (count > 0) {
        const subtotal = rate.amount * count;
        total += subtotal;
        lines.push(`${rate.name}：${count}人 × ${rate.amount.toLocaleString()}円 ＝ ${subtotal.toLocaleString()}円`);
        hasAny = true;
      }
    }

    if (!hasAny) {
      return {
        value: 0,
        formula: "（扶養親族の人数が0のため、扶養控除は 0円）"
      };
    }

    lines.push(`→ 扶養控除合計 ＝ ${total.toLocaleString()}円`);
    return { value: total, formula: lines.join("\n") };
  }

  /* ============================================================
   * 4-2. 障害者控除（区分×人数で合算）
   *      本人・同一生計配偶者・扶養親族それぞれが障害者になり得るため、
   *      普通／特別／同居特別の区分ごとに人数を入力し、人数分を加算する。
   *      ※rates.amount は住民税額。所得税額は amount_shotoku に保持（参考）。
   * ============================================================ */
  function shogaisha(inputs, koujo) {
    let total = 0;
    let lines = [];
    let hasAny = false;

    for (const rate of (koujo.rates || [])) {
      const count = Number(inputs[rate.id]) || 0;
      if (count > 0) {
        const subtotal = rate.amount * count;
        total += subtotal;
        lines.push(`${rate.name}：${count}人 × ${rate.amount.toLocaleString()}円 ＝ ${subtotal.toLocaleString()}円`);
        hasAny = true;
      }
    }

    if (!hasAny) {
      return {
        value: 0,
        formula: "（障害者に該当する人数が0のため、障害者控除は 0円）"
      };
    }

    lines.push(`→ 障害者控除合計 ＝ ${total.toLocaleString()}円`);
    return { value: total, formula: lines.join("\n") };
  }

  /* ============================================================
   * 5. 社会保険料控除（支払額全額）
   * ============================================================ */
  function shakai_hoken(inputs, koujo, state) {
    const amount = safeNum(inputs.amount);
    if (amount <= 0) {
      return { value: 0, formula: "（社会保険料が未入力のため、控除は 0円）" };
    }
    return {
      value: Math.floor(amount),
      formula: `支払った社会保険料：${amount.toLocaleString()}円\n→ 全額控除されます\n→ 社会保険料控除 ＝ ${Math.floor(amount).toLocaleString()}円`
    };
  }

  /* ============================================================
   * 5-2. 小規模企業共済等掛金控除（支払額全額）
   * ============================================================ */
  function shokibo_kyousai(inputs, koujo, state) {
    const amount = safeNum(inputs.amount);
    if (amount <= 0) {
      return { value: 0, formula: "（小規模企業共済等掛金が未入力のため、控除は 0円）" };
    }
    return {
      value: Math.floor(amount),
      formula: `支払った小規模企業共済等掛金：${amount.toLocaleString()}円\n→ 全額控除されます\n→ 小規模企業共済等掛金控除 ＝ ${Math.floor(amount).toLocaleString()}円`
    };
  }

  /* ============================================================
   * 6. 生命保険料控除（住民税）
   *    新契約／旧契約 × 一般／介護医療／個人年金
   *    新契約のみ：上限28,000円／旧契約のみ：上限35,000円
   *    新旧併用：max(旧のみ計算額, min(新+旧, 28000))
   *    全体合計上限：70,000円
   * ============================================================ */
  function seimei_hoken(inputs, koujo, state) {
    const ni = safeNum(inputs.new_ippan);
    const nk = safeNum(inputs.new_kaigo);
    const nn = safeNum(inputs.new_nenkin);
    const oi = safeNum(inputs.old_ippan);
    const on = safeNum(inputs.old_nenkin);

    if (ni + nk + nn + oi + on <= 0) {
      return { value: 0, formula: "（支払保険料が未入力のため、控除は 0円）" };
    }

    // 新契約の控除額計算（住民税）
    function calcNew(amt) {
      if (amt <= 0) return 0;
      if (amt <= 12000) return amt;
      if (amt <= 32000) return Math.ceil(amt * 0.5 + 6000);
      if (amt <= 56000) return Math.ceil(amt * 0.25 + 14000);
      return 28000;
    }
    // 旧契約の控除額計算（住民税）
    function calcOld(amt) {
      if (amt <= 0) return 0;
      if (amt <= 15000) return amt;
      if (amt <= 40000) return Math.ceil(amt * 0.5 + 7500);
      if (amt <= 70000) return Math.ceil(amt * 0.25 + 17500);
      return 35000;
    }
    // 新旧併用時の有利選択
    // ・旧のみ場合の額（旧契約は上限35,000）
    // ・新旧合算の場合の額（新契約の上限28,000を適用）
    // のうち大きい方が当該区分の控除額
    function combine(newAmt, oldAmt) {
      const c_new = calcNew(newAmt);
      const c_old = calcOld(oldAmt);
      if (newAmt > 0 && oldAmt > 0) {
        return Math.max(c_old, Math.min(c_new + c_old, 28000));
      }
      return c_new + c_old;
    }

    const ippan  = combine(ni, oi);   // 一般生命保険料
    const kaigo  = calcNew(nk);        // 介護医療（新のみ）
    const nenkin = combine(nn, on);    // 個人年金

    const sum = ippan + kaigo + nenkin;
    const total = Math.min(sum, 70000);

    let lines = [];
    lines.push(`【一般生命保険料】`);
    if (ni > 0) lines.push(`  新契約: ${ni.toLocaleString()}円 → ${calcNew(ni).toLocaleString()}円`);
    if (oi > 0) lines.push(`  旧契約: ${oi.toLocaleString()}円 → ${calcOld(oi).toLocaleString()}円`);
    if (ni > 0 || oi > 0) lines.push(`  → 一般控除額（有利選択）: ${ippan.toLocaleString()}円`);
    else lines.push(`  （未入力）`);

    lines.push(`【介護医療保険料】（新契約のみ）`);
    if (nk > 0) lines.push(`  支払額: ${nk.toLocaleString()}円 → ${kaigo.toLocaleString()}円`);
    else lines.push(`  （未入力）`);

    lines.push(`【個人年金保険料】`);
    if (nn > 0) lines.push(`  新契約: ${nn.toLocaleString()}円 → ${calcNew(nn).toLocaleString()}円`);
    if (on > 0) lines.push(`  旧契約: ${on.toLocaleString()}円 → ${calcOld(on).toLocaleString()}円`);
    if (nn > 0 || on > 0) lines.push(`  → 個人年金控除額（有利選択）: ${nenkin.toLocaleString()}円`);
    else lines.push(`  （未入力）`);

    lines.push(`→ 3区分合計: ${sum.toLocaleString()}円`);
    if (sum > 70000) lines.push(`→ 全体上限70,000円を適用`);
    lines.push(`→ 生命保険料控除 ＝ ${total.toLocaleString()}円`);

    return { value: total, formula: lines.join("\n") };
  }

  /* ============================================================
   * 7. 地震保険料控除（住民税）
   *    地震保険：×1/2、上限25,000円
   *    旧長期損害保険：5,000円以下→全額／〜15,000→×1/2+2,500／超→10,000
   *    合算上限：25,000円
   * ============================================================ */
  function jishin_hoken(inputs, koujo, state) {
    const j = safeNum(inputs.jishin);
    const c = safeNum(inputs.choki);

    if (j <= 0 && c <= 0) {
      return { value: 0, formula: "（保険料が未入力のため、控除は 0円）" };
    }

    const jVal = Math.min(Math.floor(j * 0.5), 25000);

    function calcChoki(amt) {
      if (amt <= 0) return 0;
      if (amt <= 5000) return amt;
      if (amt <= 15000) return Math.floor(amt * 0.5 + 2500);
      return 10000;
    }
    const cVal = calcChoki(c);

    const sum = jVal + cVal;
    const total = Math.min(sum, 25000);

    let lines = [];
    if (j > 0) lines.push(`地震保険: ${j.toLocaleString()}円 × 1/2 = ${jVal.toLocaleString()}円（上限25,000円）`);
    if (c > 0) lines.push(`旧長期損害保険: ${c.toLocaleString()}円 → ${cVal.toLocaleString()}円（上限10,000円）`);
    lines.push(`→ 合計: ${sum.toLocaleString()}円`);
    if (sum > 25000) lines.push(`→ 合算上限25,000円を適用`);
    lines.push(`→ 地震保険料控除 ＝ ${total.toLocaleString()}円`);

    return { value: total, formula: lines.join("\n") };
  }

  /* ============================================================
   * 8. 雑損控除
   *    差引損失額(A) = 損害金額 − 保険等補填
   *    ① A − 総所得金額等×10%
   *    ② 災害関連支出 − 50,000
   *    ①と②の多い方
   * ============================================================ */
  function zasshou(inputs, koujo, state) {
    const songai = safeNum(inputs.songai);
    const hoten = safeNum(inputs.hoten);
    const saigai = safeNum(inputs.saigai);
    const totalIncome = safeNum(state && state.totalIncome);

    if (songai <= 0 && saigai <= 0) {
      return { value: 0, formula: "（損害金額・災害関連支出が未入力のため、控除は 0円）" };
    }

    const A = songai - hoten;
    const calc1 = A - Math.floor(totalIncome / 10);
    const calc2 = saigai - 50000;
    const value = Math.max(0, calc1, calc2);

    let lines = [];
    lines.push(`損害金額：${songai.toLocaleString()}円`);
    lines.push(`保険等で補填される金額：${hoten.toLocaleString()}円`);
    lines.push(`災害関連支出：${saigai.toLocaleString()}円`);
    lines.push(`総所得金額等：${totalIncome.toLocaleString()}円`);
    lines.push(`→ 差引損失額(A) = ${songai.toLocaleString()} − ${hoten.toLocaleString()} = ${A.toLocaleString()}円`);
    lines.push(`→ ① A − 総所得金額等×10% = ${A.toLocaleString()} − ${Math.floor(totalIncome / 10).toLocaleString()} = ${calc1.toLocaleString()}円`);
    lines.push(`→ ② 災害関連支出 − 50,000円 = ${saigai.toLocaleString()} − 50,000 = ${calc2.toLocaleString()}円`);
    lines.push(`→ ①と②の多い方（負の値は0扱い）: ${value.toLocaleString()}円`);
    lines.push(`→ 雑損控除 ＝ ${value.toLocaleString()}円`);

    return { value, formula: lines.join("\n") };
  }

  /* ============================================================
   * 9. 医療費控除の特例（セルフメディケーション税制）
   *    特定一般用医薬品等購入費 − 保険等補填 − 12,000円
   *    上限：88,000円
   *    通常の医療費控除と選択適用
   * ============================================================ */
  function medical_self(inputs, koujo, state) {
    const paid = safeNum(inputs.paid);
    const hoten = safeNum(inputs.hoten);

    if (paid <= 0) {
      return { value: 0, formula: "（特定一般用医薬品等購入費が未入力のため、特例控除は 0円）" };
    }

    const raw = paid - hoten - 12000;
    const value = Math.max(0, Math.min(88000, raw));

    let lines = [];
    lines.push(`特定一般用医薬品等購入費：${paid.toLocaleString()}円`);
    lines.push(`保険等で補填される金額：${hoten.toLocaleString()}円`);
    lines.push(`→ 控除額 = ${paid.toLocaleString()} − ${hoten.toLocaleString()} − 12,000 = ${raw.toLocaleString()}円`);
    if (raw <= 0) {
      lines.push(`→ 0円以下のため、特例控除は 0円`);
    } else if (raw > 88000) {
      lines.push(`→ 上限88,000円を適用`);
    }
    lines.push(`→ セルフメディケーション特例 ＝ ${value.toLocaleString()}円`);
    lines.push(`※ 通常の医療費控除との選択適用です`);

    return { value, formula: lines.join("\n") };
  }

  /* ============================================================
   *  ▼▼▼ フェーズ2：分離課税・特例所得 ▼▼▼
   * ============================================================ */

  /* ============================================================
   * 10. 配当所得（総合課税）
   *     配当所得 = 配当等の収入 − 株式等取得のための負債利子
   *     他の所得と合算して総合課税
   * ============================================================ */
  function haito_sougou(inputs) {
    const revenue = safeNum(inputs.revenue);
    const fusai = safeNum(inputs.fusai_risoku);

    if (revenue <= 0) {
      return { value: 0, formula: "（配当収入が未入力のため、配当所得は 0円）" };
    }

    const value = Math.max(0, revenue - fusai);
    let lines = [];
    lines.push(`配当等の収入金額：${revenue.toLocaleString()}円`);
    if (fusai > 0) {
      lines.push(`株式等取得のための負債利子：${fusai.toLocaleString()}円`);
      lines.push(`→ 配当所得 ＝ ${revenue.toLocaleString()} − ${fusai.toLocaleString()} ＝ ${value.toLocaleString()}円`);
    } else {
      lines.push(`→ 配当所得 ＝ ${value.toLocaleString()}円`);
    }
    lines.push(`※ 総合課税：他の所得と合算されます。配当控除は「税額控除」で自動計算されます`);

    return { value, formula: lines.join("\n") };
  }

  /* ============================================================
   * 11. 配当所得（申告分離課税）
   *     上場株式等の配当所得を申告分離で計算
   *     所得計算自体は総合と同じ。税率5%（住民税）は税額計算で適用
   * ============================================================ */
  function haito_bunri(inputs) {
    const revenue = safeNum(inputs.revenue);
    const fusai = safeNum(inputs.fusai_risoku);

    if (revenue <= 0) {
      return { value: 0, formula: "（配当収入が未入力のため、配当所得は 0円）", taxable_type: "haito_bunri" };
    }

    const value = Math.max(0, revenue - fusai);
    let lines = [];
    lines.push(`配当等の収入金額：${revenue.toLocaleString()}円`);
    if (fusai > 0) {
      lines.push(`株式等取得のための負債利子：${fusai.toLocaleString()}円`);
      lines.push(`→ 配当所得（申告分離） ＝ ${value.toLocaleString()}円`);
    } else {
      lines.push(`→ 配当所得（申告分離） ＝ ${value.toLocaleString()}円`);
    }
    lines.push(`※ 申告分離課税：住民税5%（市3%・県2%）が分離で課税`);
    lines.push(`※ 源泉徴収済みの住民税（配当割）は「配当割額等控除」に入力すると控除されます`);

    return { value, formula: lines.join("\n"), taxable_type: "haito_bunri" };
  }

  /* ============================================================
   * 12. 上場株式等譲渡所得（申告分離）
   *     譲渡所得 = 譲渡対価 − 取得費 − 譲渡費用
   *     繰越損失があれば差引（住民税3年繰越）
   *     住民税5%
   * ============================================================ */
  function kabushiki_jouto(inputs) {
    const taika = safeNum(inputs.taika);
    const shutokuhi = safeNum(inputs.shutokuhi);
    const hiyou = safeNum(inputs.jouto_hiyou);
    const kurikoshi = safeNum(inputs.kurikoshi_son);

    if (taika <= 0) {
      return { value: 0, formula: "（譲渡対価が未入力のため、株式譲渡所得は 0円）", taxable_type: "kabushiki_jouto" };
    }

    const rieki = taika - shutokuhi - hiyou;
    const value = Math.max(0, rieki - kurikoshi);

    let lines = [];
    lines.push(`譲渡対価：${taika.toLocaleString()}円`);
    lines.push(`取得費：${shutokuhi.toLocaleString()}円`);
    lines.push(`譲渡費用：${hiyou.toLocaleString()}円`);
    lines.push(`→ 譲渡益 ＝ ${taika.toLocaleString()} − ${shutokuhi.toLocaleString()} − ${hiyou.toLocaleString()} ＝ ${rieki.toLocaleString()}円`);
    if (kurikoshi > 0) {
      lines.push(`繰越損失：${kurikoshi.toLocaleString()}円`);
      lines.push(`→ 繰越損失差引後 ＝ ${rieki.toLocaleString()} − ${kurikoshi.toLocaleString()} ＝ ${(rieki - kurikoshi).toLocaleString()}円`);
    }
    if (value === 0 && rieki - kurikoshi < 0) {
      lines.push(`→ 損失のため、株式譲渡所得は 0円（損失は翌年以降3年繰越可能）`);
    } else {
      lines.push(`→ 株式譲渡所得（申告分離） ＝ ${value.toLocaleString()}円`);
    }
    lines.push(`※ 住民税5%（市3%・県2%）が分離で課税`);
    lines.push(`※ 特定口座（源泉徴収あり）で徴収済みの住民税（株式等譲渡所得割）は「配当割額等控除」に入力すると控除されます`);

    return { value, formula: lines.join("\n"), taxable_type: "kabushiki_jouto" };
  }

  /* ============================================================
   * 13. 土地建物譲渡所得（申告分離）
   *     譲渡益 = 譲渡対価 − 取得費 − 譲渡費用 − 特別控除
   *     取得費が不明な場合は譲渡対価×5%（みなし取得費）
   *
   *     youto:
   *       "tanki_ippan"        : 短期・一般（住民税5.4%）
   *       "tanki_keigen"       : 短期・軽減（土地のみ、住民税3%）
   *       "chouki_ippan"       : 長期・一般（住民税3%）
   *       "chouki_keika_kyo"   : 長期・軽課（居住用、住民税4%/3.5%帯あり）※税額はフェーズ3
   *       "chouki_tokutei"     : 長期・特定（優良住宅地、住民税3%/2.4%帯あり）
   *
   *     特別控除：マイホーム3,000万／収用5,000万／その他
   * ============================================================ */
  function tochi_jouto(inputs) {
    const taika = safeNum(inputs.taika);
    let shutokuhi = safeNum(inputs.shutokuhi);
    const useMinashi = inputs.minashi_shutokuhi === true || inputs.minashi_shutokuhi === "true";
    const hiyou = safeNum(inputs.jouto_hiyou);
    const tokubetsu = safeNum(inputs.tokubetsu_koujo);
    const youto = inputs.youto || "chouki_ippan";

    if (taika <= 0) {
      return { value: 0, formula: "（譲渡対価が未入力のため、譲渡所得は 0円）", taxable_type: youto };
    }

    let lines = [];
    lines.push(`【譲渡区分】${labelOfYouto(youto)}`);
    lines.push(`譲渡対価：${taika.toLocaleString()}円`);

    if (useMinashi) {
      shutokuhi = Math.floor(taika * 5 / 100);
      lines.push(`取得費（みなし5%）：${shutokuhi.toLocaleString()}円`);
    } else {
      lines.push(`取得費：${shutokuhi.toLocaleString()}円`);
    }
    lines.push(`譲渡費用：${hiyou.toLocaleString()}円`);

    const rieki = taika - shutokuhi - hiyou;
    lines.push(`→ 譲渡益 ＝ ${taika.toLocaleString()} − ${shutokuhi.toLocaleString()} − ${hiyou.toLocaleString()} ＝ ${rieki.toLocaleString()}円`);

    if (tokubetsu > 0) {
      const appliedTokubetsu = Math.min(tokubetsu, Math.max(0, rieki));
      lines.push(`特別控除：${tokubetsu.toLocaleString()}円（譲渡益までを適用：${appliedTokubetsu.toLocaleString()}円）`);
      const value = Math.max(0, rieki - appliedTokubetsu);
      lines.push(`→ 譲渡所得 ＝ ${rieki.toLocaleString()} − ${appliedTokubetsu.toLocaleString()} ＝ ${value.toLocaleString()}円`);
      lines.push(`※ ${labelOfYouto(youto)}：税率は算出税額の計算で適用されます`);
      return { value, formula: lines.join("\n"), taxable_type: youto };
    }

    const value = Math.max(0, rieki);
    if (value === 0 && rieki < 0) {
      lines.push(`→ 譲渡損失のため、譲渡所得は 0円`);
    } else {
      lines.push(`→ 譲渡所得 ＝ ${value.toLocaleString()}円`);
    }
    lines.push(`※ ${labelOfYouto(youto)}：税率は算出税額の計算で適用されます`);

    return { value, formula: lines.join("\n"), taxable_type: youto };
  }

  function labelOfYouto(y) {
    return ({
      tanki_ippan:       "短期譲渡・一般所得（住民税5.4%）",
      tanki_keigen:      "短期譲渡・軽減所得（土地のみ、住民税3%）",
      chouki_ippan:      "長期譲渡・一般所得（住民税3%）",
      chouki_keika_kyo:  "長期譲渡・軽課所得（居住用）",
      chouki_tokutei:    "長期譲渡・特定所得（優良住宅地）"
    })[y] || y;
  }

  /* ============================================================
   * 14. 特定肉用牛（免税牛）
   *     売却価額が基準額以上の頭は事業所得から免税（事業所得から控除）
   *     一般用：100万円以上 ／ 交雑種：80万円以上 ／ 乳用種：50万円以上
   *     ※基準額は消費税抜き
   *
   *     簡易実装：各種別ごとに「免税対象となる売却額の合計」を入力してもらう
   *     （頭ごとの判定は職員サポート前提）
   * ============================================================ */
  function meneki_gyu(inputs) {
    const ippan = safeNum(inputs.ippan_kingaku);
    const kouzatu = safeNum(inputs.kouzatu_kingaku);
    const nyuyou = safeNum(inputs.nyuyou_kingaku);

    if (ippan + kouzatu + nyuyou <= 0) {
      return { value: 0, formula: "（免税対象売却額が未入力のため、免税額は 0円）" };
    }

    const value = ippan + kouzatu + nyuyou;
    let lines = [];
    lines.push(`【特定肉用牛の免税対象売却額】`);
    if (ippan > 0)   lines.push(`一般用（100万円以上/頭）：${ippan.toLocaleString()}円`);
    if (kouzatu > 0) lines.push(`交雑種（80万円以上/頭）：${kouzatu.toLocaleString()}円`);
    if (nyuyou > 0)  lines.push(`乳用種（50万円以上/頭）：${nyuyou.toLocaleString()}円`);
    lines.push(`→ 免税対象額合計 ＝ ${value.toLocaleString()}円`);
    lines.push(`※ この額は事業所得から控除されます`);
    lines.push(`※ 売却価額に対し市民税0.9%・県民税0.6%が別途課税`);

    return { value, formula: lines.join("\n") };
  }

  /* ============================================================
   * データ駆動型の汎用計算（tier/fixed/matrix）
   * ============================================================ */

  // 段階型
  function calcTier(koujo, refValue) {
    const v = safeNum(refValue);
    let lines = [];
    lines.push(`参照値（${koujo.input.label}）：${v.toLocaleString()}円`);
    for (const tier of koujo.tiers) {
      if (tier.max === null || v <= tier.max) {
        lines.push(`→ ${tier.label} に該当`);
        lines.push(`→ ${koujo.name} ＝ ${tier.amount.toLocaleString()}円`);
        return { value: tier.amount, formula: lines.join("\n") };
      }
    }
    return { value: 0, formula: lines.join("\n") };
  }

  // 固定額型
  function calcFixed(koujo, selectedId) {
    const opt = koujo.options.find(o => o.id === selectedId) || koujo.options[0];
    let lines = [];
    lines.push(`選択：「${opt.label}」`);
    lines.push(`→ ${koujo.name} ＝ ${opt.amount.toLocaleString()}円`);
    return { value: opt.amount, formula: lines.join("\n") };
  }

  // マトリクス型
  // mode: 配偶者控除等の「該当区分」識別子。modes 配列が定義されている控除のみ参照される。
  //   - "none" を渡す（または mode 未指定で modes 定義あり）→ 控除0を返す
  //   - "general" / "rojin" 等 → cells[mode][rowId][colIdx] を参照
  //   - modes 未定義の控除では従来通りフラット構造の cells[rowId][colIdx] を参照（後方互換）
  function calcMatrix(koujo, rowValue, colValue, mode) {
    const rv = safeNum(rowValue);
    const cv = safeNum(colValue);
    const hasModes = Array.isArray(koujo.modes) && koujo.modes.length > 0;

    let lines = [];

    // ─── mode判定（modes定義あり） ───
    if (hasModes) {
      const modeId = mode || "none";
      const modeObj = koujo.modes.find(m => m.id === modeId);
      const modeLabel = modeObj ? modeObj.label : modeId;
      lines.push(`対象区分：${modeLabel}`);
      if (modeId === "none") {
        lines.push(`→ 該当なし、控除額 0円`);
        return { value: 0, formula: lines.join("\n") };
      }
    }

    // 行判定
    let rowIdx = -1, rowRange = null;
    for (let i = 0; i < koujo.row_ranges.length; i++) {
      const r = koujo.row_ranges[i];
      if (r.max === null || rv <= r.max) {
        rowIdx = i; rowRange = r; break;
      }
    }

    // 列判定
    let colIdx = -1, colRange = null;
    for (let i = 0; i < koujo.col_ranges.length; i++) {
      const c = koujo.col_ranges[i];
      if (c.max === null || cv <= c.max) {
        colIdx = i; colRange = c; break;
      }
    }

    lines.push(`${koujo.inputs.row.label}：${rv.toLocaleString()}円`);
    lines.push(`${koujo.inputs.col.label}：${cv.toLocaleString()}円`);

    if (rowIdx < 0 || colIdx < 0) {
      lines.push(`→ 該当区分なし、控除額 0円`);
      return { value: 0, formula: lines.join("\n") };
    }

    // セル参照（modes対応／フラット構造の両対応）
    let amount = 0;
    if (hasModes) {
      const modeId = mode;
      const modeCells = (koujo.cells || {})[modeId] || {};
      amount = (modeCells[rowRange.id] || [])[colIdx] || 0;
    } else {
      amount = (koujo.cells[rowRange.id] || [])[colIdx] || 0;
    }

    lines.push(`→ 行：${rowRange.label}　列：${colRange.label}`);
    lines.push(`→ ${koujo.name} ＝ ${amount.toLocaleString()}円`);
    return { value: amount, formula: lines.join("\n") };
  }

  /* ============================================================
   * 公開API
   * ============================================================ */
  return {
    yen,
    salaryIncome,
    shotokuChouseiKoujo,
    pensionIncome,
    // 事業所得系・雑所得（フェーズ3.5：所得タイプ拡張）
    eigyoIncome,
    nougyoIncome,
    fudosanIncome,
    zatsuBusinessIncome,
    zatsuOtherIncome,
    aggregateGeneralIncomes,
    medical,
    fuyou,
    shogaisha,
    shakai_hoken,
    shokibo_kyousai,
    seimei_hoken,
    jishin_hoken,
    zasshou,
    medical_self,
    // フェーズ2：分離課税・特例所得
    haito_sougou,
    haito_bunri,
    kabushiki_jouto,
    tochi_jouto,
    meneki_gyu,
    // データ駆動汎用
    calcTier,
    calcFixed,
    calcMatrix
  };

})();
