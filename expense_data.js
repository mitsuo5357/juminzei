/* ============================================================
 * expense_data.js
 * 市県民税 申告準備コーナー 計算支援ツール
 * 経費分類支援マスタ
 *
 * 構造：
 *   categories  : 経費科目（収支内訳書（白色）の17科目ベース）
 *                 - id: 内部ID
 *                 - name: 表示名
 *                 - default_apportion: 標準按分率（%）
 *                 - hint: 入力時の補助説明
 *   keyword_map : 摘要キーワード → 科目ID の連想辞書
 *                 部分一致（toLowerCase後）で先勝ち
 * ============================================================ */

window.EXPENSE_DATA = {
  version: "2026.10-R9-mobile",
  last_updated: "2026-10-15",

  // 経費科目（収支内訳書 白色 ベース17科目）
  categories: [
    { id: "kyuryo_chingin",   name: "給料賃金",     default_apportion: 100, hint: "従業員に支払う給料・賞与" },
    { id: "gaichu",           name: "外注工賃",     default_apportion: 100, hint: "業務の一部を外注した費用" },
    { id: "genka_shokyaku",   name: "減価償却費",   default_apportion: 100, hint: "建物・車両・設備等の減価償却" },
    { id: "kashidaore",       name: "貸倒金",       default_apportion: 100, hint: "回収不能となった売掛金等" },
    { id: "chidai_yachin",    name: "地代家賃",     default_apportion:  50, hint: "事業所の家賃。自宅兼の場合は按分" },
    { id: "rishi_warihiki",   name: "利子割引料",   default_apportion: 100, hint: "事業上の借入金利子・手形割引料" },
    { id: "sozei_kouka",      name: "租税公課",     default_apportion: 100, hint: "事業税・固定資産税・印紙税等" },
    { id: "nizukuri_unchin",  name: "荷造運賃",     default_apportion: 100, hint: "商品の発送費・梱包資材" },
    { id: "suidou_kounetsu",  name: "水道光熱費",   default_apportion:  50, hint: "電気・ガス・水道。自宅兼の場合は按分" },
    { id: "ryohi_kotsu",      name: "旅費交通費",   default_apportion: 100, hint: "業務上の交通費・出張費・ガソリン代等" },
    { id: "tsushin",          name: "通信費",       default_apportion:  50, hint: "電話・携帯・インターネット。自宅兼の場合は按分" },
    { id: "koukoku",          name: "広告宣伝費",   default_apportion: 100, hint: "ホームページ・チラシ・看板等" },
    { id: "settai_kosai",     name: "接待交際費",   default_apportion: 100, hint: "取引先との会食・贈答品等" },
    { id: "songai_hoken",     name: "損害保険料",   default_apportion: 100, hint: "事業用の損害保険料" },
    { id: "shuzen",           name: "修繕費",       default_apportion: 100, hint: "事業用資産の修繕費" },
    { id: "shomohin",         name: "消耗品費",     default_apportion: 100, hint: "事務用品・備品（10万円未満）等" },
    { id: "fukuri_kosei",     name: "福利厚生費",   default_apportion: 100, hint: "従業員の慶弔費・健康診断費等" },
    { id: "zappi",            name: "雑費",         default_apportion: 100, hint: "他の科目に当てはまらない経費" },
    { id: "uncategorized",    name: "未分類",       default_apportion: 100, hint: "後で分類する一時項目" }
  ],

  // キーワード→科目の連想辞書（先勝ち）
  // 摘要欄に入力された文字列に対し、部分一致で判定
  keyword_map: [
    // 旅費交通費
    { keywords: ["ENEOS", "出光", "コスモ", "シェル", "JA-SS", "ガソリン", "給油", "軽油"],          category: "ryohi_kotsu" },
    { keywords: ["JR", "電車", "新幹線", "バス", "タクシー", "高速", "ETC", "駐車場", "パーキング"],  category: "ryohi_kotsu" },
    { keywords: ["航空券", "ANA", "JAL", "ジェットスター", "ピーチ"],                                  category: "ryohi_kotsu" },

    // 水道光熱費
    { keywords: ["九州電力", "東京電力", "関西電力", "中部電力", "電気代", "電力"],                    category: "suidou_kounetsu" },
    { keywords: ["ガス", "西部ガス", "都市ガス", "プロパン", "LPG"],                                    category: "suidou_kounetsu" },
    { keywords: ["水道", "上下水道", "水道料金"],                                                       category: "suidou_kounetsu" },

    // 通信費
    { keywords: ["docomo", "ドコモ", "au", "softbank", "ソフトバンク", "楽天モバイル", "携帯", "スマホ"],  category: "tsushin" },
    { keywords: ["NTT", "光回線", "プロバイダ", "OCN", "BIGLOBE", "So-net", "インターネット", "Wi-Fi", "WiFi"], category: "tsushin" },
    { keywords: ["切手", "はがき", "郵便", "ゆうパック"],                                                  category: "tsushin" },

    // 消耗品費
    { keywords: ["コピー用紙", "文具", "ボールペン", "ノート", "ファイル", "封筒", "印刷"],              category: "shomohin" },
    { keywords: ["ヨドバシ", "ビックカメラ", "アスクル", "カウネット", "コクヨ"],                         category: "shomohin" },

    // 地代家賃
    { keywords: ["家賃", "賃料", "レンタルオフィス"],                                                     category: "chidai_yachin" },

    // 接待交際費
    { keywords: ["居酒屋", "レストラン", "飲食店", "ランチ", "ディナー", "贈答", "お中元", "お歳暮"],     category: "settai_kosai" },

    // 広告宣伝費
    { keywords: ["広告", "チラシ", "看板", "ホームページ", "サーバー", "ドメイン", "Google広告", "リスティング"], category: "koukoku" },

    // 租税公課
    { keywords: ["印紙", "収入印紙", "登記", "固定資産税", "事業税", "自動車税", "印鑑証明"],            category: "sozei_kouka" },

    // 修繕費
    { keywords: ["修理", "修繕", "メンテナンス"],                                                        category: "shuzen" },

    // 損害保険料
    { keywords: ["損害保険", "自動車保険", "火災保険", "事業保険"],                                       category: "songai_hoken" },

    // 荷造運賃
    { keywords: ["ヤマト", "クロネコ", "佐川急便", "ゆうパック", "宅配", "梱包"],                         category: "nizukuri_unchin" }
  ]
};

/* ============================================================
 * カテゴリ自動推測関数
 *   引数: description（摘要文字列）
 *   返却: { categoryId, matchedKeyword } | null（マッチなし）
 * ============================================================ */
window.guessExpenseCategory = function(description) {
  if (!description || typeof description !== "string") return null;
  const desc = description.toLowerCase();
  for (const entry of window.EXPENSE_DATA.keyword_map) {
    for (const kw of entry.keywords) {
      if (desc.includes(kw.toLowerCase())) {
        return { categoryId: entry.category, matchedKeyword: kw };
      }
    }
  }
  return null;
};

/* ============================================================
 * カテゴリIDからオブジェクト取得
 * ============================================================ */
window.getExpenseCategory = function(id) {
  return window.EXPENSE_DATA.categories.find(c => c.id === id) || null;
};
