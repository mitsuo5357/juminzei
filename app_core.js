/* ============================================================
 * app_core.js
 * 市県民税 計算支援（令和9年度）— アプリ本体（計算と入力フォーム）
 *
 * PC版（R8_計算支援.html）のメインスクリプトを移植したもの。
 * 計算の流れ（recalcAll）はPC版と同じで、次の点を変えている。
 *   ・R9年度の改正（給与所得控除・所得要件62万・特定親族の人的控除差なし など）
 *   ・寄附金の特例控除割合を「判定額」で決定／20%上限は市・県それぞれ
 *   ・住宅ローン控除の限度額に（所得税の基礎控除額−48万円）を加算（R7までの入居）
 *   ・配当控除の1,000万円判定を課税総所得金額等で
 *   ・非課税判定：配偶者は合計所得62万円以下のときだけ人数に入れる／
 *     「本人が障害者」「本人が未成年」をチェックで判定
 *   ・60分自動クリア（共用PC向け）を廃止し、端末内への自動保存に
 *   ・保存ファイルにふるさと納税の行・配当の課税方式も含める（PC版の保存漏れを修正）
 *   ・印刷は別ウィンドウではなく、同じ画面から印刷（スマホの「PDFとして保存」に対応）
 *   ・入力欄は数字キーボード（全角数字・カンマは自動で半角数字に直す）
 * ============================================================ */
(function () {
  "use strict";

  const PREVIEW = !!window.__PREVIEW__;

  // ─── 状態 ───
  const STATE = {
    salaryIncome: 0,
    pensionIncome: 0,
    eigyoIncome: 0,
    nougyoIncome: 0,
    fudosanIncome: 0,
    fudosanRestrictedLoss: 0,
    zatsuBusinessIncome: 0,
    zatsuOtherIncome: 0,
    generalIncome: 0,
    haitoBunri: 0,
    haitoSougou: 0,
    haitoType: "ippan",
    haitoMethod: "sougou",
    kabuJouto: 0,
    tochiJouto: 0,
    tochiYouto: "chouki_ippan",
    menekiGyu: 0,
    separates: [],
    bunriSum: 0,
    totalIncome: 0,
    generalWithHaito: 0,
    koujoValues: {},
    koujoSum: 0,
    koujoDiffSum: 0,
    taxableGeneral: 0,
    kazeiTotalTou: 0,
    sangoshu: { value: 0, city: 0, prefecture: 0 },
    zeigakuKoujo: 0,
    shotokuWari: 0,
    kintouWari: 0,
    kanpu: 0,
    yearTax: 0,
    bd: null,
    expenses: { eigyo: [], nougyo: [], fudo: [], zatsu_b: [], zatsu_o: [] },
    expenseSeq: 1
  };

  // ─── ヘルパ ───
  function $(id) { return document.getElementById(id); }
  function fmt(n) { return Math.max(0, Math.floor(Number(n) || 0)).toLocaleString("ja-JP"); }
  function fmtSigned(n) { return Math.floor(Number(n) || 0).toLocaleString("ja-JP"); }
  function numVal(id) { const el = $(id); return el ? (toNumber(el.value)) : 0; }
  function toNumber(v) {
    const s = normalizeDigits(String(v == null ? "" : v));
    const n = Number(s);
    return isFinite(n) ? n : 0;
  }
  // 全角数字→半角、カンマ・空白・円などを除去（数字だけ残す）
  function normalizeDigits(s) {
    return String(s)
      .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/[^0-9]/g, "");
  }
  function escapeHTML(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  const escapeHtml = escapeHTML;

  // 金額の読み（123万4,567円）
  function manYen(n) {
    n = Math.floor(Number(n) || 0);
    if (n <= 0) return "";
    const man = Math.floor(n / 10000);
    const rest = n % 10000;
    if (man === 0) return `${rest.toLocaleString("ja-JP")}円`;
    const manStr = man >= 10000
      ? `${Math.floor(man / 10000).toLocaleString("ja-JP")}億${(man % 10000) ? (man % 10000).toLocaleString("ja-JP") + "万" : ""}`
      : `${man.toLocaleString("ja-JP")}万`;
    return rest ? `${manStr}${rest.toLocaleString("ja-JP")}円` : `${manStr}円`;
  }

  let toastTimer = null;
  function showToast(msg, duration, action) {
    const t = $("toast");
    if (!t) return;
    t.textContent = msg;
    if (action && action.label) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = action.label;
      b.addEventListener("click", () => { t.classList.remove("show"); action.onClick(); });
      t.appendChild(b);
    }
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), duration || 2600);
  }

  // 入力のたびに呼ぶ（PC版のタイマー延長の代わりに、自動保存を予約）
  function resetTimer() {
    if (typeof window.__scheduleSave === "function") window.__scheduleSave();
  }

  /* ============================================================
   * 数字入力欄の飾り（「＝123万円」の読み）
   * ============================================================ */
  function ensureHint(input) {
    if (!input || input.dataset.noHint) return;
    const row = input.closest(".form-row, .kifu-row, .person-row");
    if (!row) return;
    const unit = input.nextElementSibling;
    if (unit && unit.classList.contains("unit") && unit.textContent.trim() !== "円") return;
    let hint = row.querySelector(`.amt-hint[data-for="${input.id || ""}"]`);
    if (!hint && !input.id) hint = row.querySelector(".amt-hint");
    if (!hint) {
      hint = document.createElement("span");
      hint.className = "amt-hint";
      hint.setAttribute("aria-hidden", "true");
      if (input.id) hint.dataset.for = input.id;
      const host = input.closest(".form-row") || row;
      // 単位の直後に置く（特定親族の行は削除ボタンの後ろ＝行の最後）
      if (unit && unit.classList.contains("unit") && !input.closest(".person-row")) unit.after(hint);
      else host.appendChild(hint);
    }
    const v = toNumber(input.value);
    hint.textContent = v >= 10000 ? `＝ ${manYen(v)}` : "";
  }
  function decorateNumInputs(root) {
    (root || document).querySelectorAll("input.num-input").forEach(ensureHint);
  }
  function refreshHints() { decorateNumInputs(document); }

  /* ============================================================
   * 控除フォームの動的生成
   * ============================================================ */
  function renderKoujoForms() {
    const container = $("koujo-container");
    container.innerHTML = "";

    KOUJO_DATA.deductions.forEach(k => {
      const block = document.createElement("div");
      block.className = "koujo-block";
      block.id = `block-${k.id}`;

      const html = [];
      html.push(`<h3>${escapeHTML(k.name)}</h3>`);
      if (k.description) html.push(`<p class="koujo-desc">${escapeHTML(k.description)}</p>`);

      if (k.type === "tier") {
        if (k.multiple_per_person) {
          html.push(`<div class="people-container" id="people-${k.id}"></div>`);
          html.push(`<button type="button" class="btn-add-person" id="add-person-${k.id}">＋ もう1人追加</button>`);
        } else if (k.input.source === "auto_total_income") {
          html.push(`
            <div class="form-row">
              <label>${escapeHTML(k.input.label)}</label>
              <div class="auto-display"><span id="ref-${k.id}">0</span>&nbsp;円</div>
            </div>
          `);
        }
      } else if (k.type === "fixed") {
        const opts = k.options.map(o =>
          `<option value="${o.id}">${escapeHTML(o.label)}（${o.amount.toLocaleString("ja-JP")}円）</option>`
        ).join("");
        html.push(`
          <div class="form-row">
            <label for="sel-${k.id}">${escapeHTML(k.input.label)}</label>
            <select id="sel-${k.id}" autocomplete="off">${opts}</select>
          </div>
        `);
      } else if (k.type === "matrix") {
        if (Array.isArray(k.modes) && k.modes.length > 0) {
          const modeOpts = k.modes.map(m =>
            `<option value="${escapeHTML(m.id)}">${escapeHTML(m.label)}</option>`
          ).join("");
          html.push(`
            <div class="form-row">
              <label for="sel-mode-${k.id}">該当する区分</label>
              <select id="sel-mode-${k.id}" autocomplete="off">${modeOpts}</select>
            </div>
          `);
        }
        html.push(`
          <div class="form-row">
            <label>${escapeHTML(k.inputs.row.label)}</label>
            <div class="auto-display"><span id="ref-row-${k.id}">0</span>&nbsp;円</div>
          </div>
          <div class="form-row">
            <label for="inp-col-${k.id}">${escapeHTML(k.inputs.col.label)}</label>
            <input type="text" inputmode="numeric" class="num-input" id="inp-col-${k.id}" autocomplete="off" placeholder="${escapeHTML(k.inputs.col.placeholder || "")}">
            <span class="unit">円</span>
          </div>
        `);
      } else if (k.type === "formula") {
        (k.input_fields || []).forEach(field => {
          const unit = field.unit || "円";
          html.push(`
            <div class="form-row">
              <label for="inp-${k.id}-${field.id}">${escapeHTML(field.label)}</label>
              <input type="text" inputmode="numeric" class="num-input" id="inp-${k.id}-${field.id}" autocomplete="off" placeholder="${escapeHTML(field.placeholder || "")}">
              <span class="unit">${escapeHTML(unit)}</span>
            </div>
          `);
        });
      }

      // 追加のチェック（障害者控除の「本人」など）
      (k.extra_checkboxes || []).forEach(cb => {
        html.push(`
          <div class="form-row">
            <label><input type="checkbox" id="chk-${k.id}-${cb.id}"> ${escapeHTML(cb.label)}</label>
          </div>
        `);
      });

      html.push(`<div class="process-box empty" id="proc-${k.id}">入力すると、計算過程がここに表示されます。</div>`);
      html.push(`
        <div class="result-row">
          <span class="label">${escapeHTML(k.name)}</span>
          <span class="value"><span id="res-${k.id}">0</span> 円</span>
        </div>
      `);

      block.innerHTML = html.join("");
      container.appendChild(block);

      if (k.type === "tier" && k.multiple_per_person) {
        addPersonRow(k.id);
        $(`add-person-${k.id}`).addEventListener("click", () => {
          addPersonRow(k.id);
          resetTimer();
        });
      }
    });
    decorateNumInputs(container);
  }

  /* ============================================================
   * 複数人の入力行（特定親族特別控除）
   * ============================================================ */
  function addPersonRow(koujoId) {
    const k = KOUJO_DATA.deductions.find(d => d.id === koujoId);
    if (!k) return;
    const container = $(`people-${koujoId}`);
    const idx = container.children.length;

    const row = document.createElement("div");
    row.className = "person-row";
    row.dataset.idx = idx;

    const fr = document.createElement("div");
    fr.className = "form-row";

    const lbl = document.createElement("label");
    lbl.textContent = `${k.input.label}（${idx + 1}人目）`;
    fr.appendChild(lbl);

    const inp = document.createElement("input");
    inp.type = "text";
    inp.inputMode = "numeric";
    inp.autocomplete = "off";
    inp.placeholder = k.input.placeholder || "";
    inp.className = "num-input person-input";
    inp.dataset.koujo = koujoId;
    inp.setAttribute("aria-label", `${k.input.label}（${idx + 1}人目）`);
    fr.appendChild(inp);

    const unit = document.createElement("span");
    unit.className = "unit";
    unit.textContent = "円";
    fr.appendChild(unit);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-remove-person";
    btn.textContent = "削除";
    fr.appendChild(btn);

    row.appendChild(fr);
    container.appendChild(row);
    ensureHint(inp);

    btn.addEventListener("click", () => {
      row.remove();
      Array.from(container.children).forEach((r, i) => {
        const l = r.querySelector("label");
        if (l) l.textContent = `${k.input.label}（${i + 1}人目）`;
      });
      if (container.children.length === 0) addPersonRow(koujoId);
      recalcAll();
      resetTimer();
    });
    return inp;
  }

  /* ============================================================
   * 経費内訳（レシート入力）
   * ============================================================ */
  const EXPENSE_TYPES = [
    { key: "eigyo",   field: "inp-eigyo-exp",   label: "営業等" },
    { key: "nougyo",  field: "inp-nougyo-exp",  label: "農業" },
    { key: "fudo",    field: "inp-fudo-exp",    label: "不動産" },
    { key: "zatsu_b", field: "inp-zatsu-b-exp", label: "雑（業務）" },
    { key: "zatsu_o", field: "inp-zatsu-o-exp", label: "雑（その他）" }
  ];

  function apportioned(x) { return Math.floor(x.amount * x.apportion / 100); }

  function renderExpenseBlock(type) {
    const root = $(`expense-block-${type.key}`);
    if (!root) return;
    const categories = window.EXPENSE_DATA.categories;

    if (root.children.length === 0) {
      root.className = "expense-detail";
      const optionsHtml = categories.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join("");
      root.innerHTML = `
        <details>
          <summary>経費の内訳を作る（レシートから入力・任意）</summary>
          <div class="expense-body">
            <p class="opt-hint">レシートを1件ずつ入力すると、摘要から科目を自動で推測します。按分率（%）は科目の標準値が入ります。</p>
            <div class="expense-add-form" data-form-for="${type.key}">
              <input type="date" data-role="date" aria-label="日付">
              <input type="text" data-role="desc" placeholder="摘要（例：ENEOS 給油）" aria-label="摘要">
              <input type="text" inputmode="numeric" class="num-input" data-role="amount" placeholder="金額" aria-label="金額" data-no-hint="1">
              <select data-role="category" aria-label="科目">${optionsHtml}</select>
              <input type="text" inputmode="numeric" class="num-input" data-role="apportion" value="100" aria-label="按分率（%）" data-no-hint="1">
              <button type="button" data-role="add">追加</button>
              <span class="expense-guess-hint" data-role="hint"></span>
            </div>
            <table class="expense-table" data-table-for="${type.key}">
              <thead>
                <tr><th>日付</th><th>摘要</th><th>科目</th><th class="num">金額</th><th class="num">按分%</th><th class="num">按分後</th><th></th></tr>
              </thead>
              <tbody></tbody>
            </table>
            <div class="expense-empty" data-role="empty">まだレシートが入力されていません</div>
            <div class="expense-summary">
              <div class="totals">
                <span>件数 <strong data-role="count">0</strong></span>
                <span>合計 <strong data-role="sum">0</strong>円</span>
                <span>按分後 <strong data-role="apportioned">0</strong>円</span>
              </div>
              <div class="expense-actions">
                <button type="button" data-role="apply">必要経費の欄に反映</button>
                <button type="button" data-role="export-csv">CSVで保存</button>
                <button type="button" data-role="print">印刷</button>
              </div>
            </div>
          </div>
        </details>
      `;
      if (PREVIEW) {
        root.querySelectorAll('[data-role="export-csv"], [data-role="print"]').forEach(b => { b.hidden = true; });
      }
    }

    const tbody = root.querySelector(`[data-table-for="${type.key}"] tbody`);
    const emptyEl = root.querySelector('[data-role="empty"]');
    const items = STATE.expenses[type.key] || [];
    tbody.innerHTML = "";
    items.forEach(item => {
      const cat = window.getExpenseCategory(item.categoryId);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHTML(item.date || "—")}</td>
        <td>${escapeHTML(item.desc || "")}</td>
        <td>${cat ? escapeHTML(cat.name) : "—"}</td>
        <td class="num">${item.amount.toLocaleString("ja-JP")}</td>
        <td class="num">${item.apportion}</td>
        <td class="num">${apportioned(item).toLocaleString("ja-JP")}</td>
        <td><button type="button" class="row-delete" data-delete-id="${item.id}" aria-label="この行を削除">削除</button></td>
      `;
      tbody.appendChild(tr);
    });
    emptyEl.hidden = items.length !== 0;

    const sum = items.reduce((s, x) => s + x.amount, 0);
    const ap = items.reduce((s, x) => s + apportioned(x), 0);
    root.querySelector('[data-role="count"]').textContent = items.length.toLocaleString("ja-JP");
    root.querySelector('[data-role="sum"]').textContent = sum.toLocaleString("ja-JP");
    root.querySelector('[data-role="apportioned"]').textContent = ap.toLocaleString("ja-JP");
    const disabled = items.length === 0;
    root.querySelectorAll('[data-role="apply"], [data-role="export-csv"], [data-role="print"]').forEach(b => { b.disabled = disabled; });
  }

  function renderAllExpenseBlocks() { EXPENSE_TYPES.forEach(renderExpenseBlock); }

  function handleExpenseDescInput(formEl) {
    const desc = formEl.querySelector('[data-role="desc"]').value;
    const sel = formEl.querySelector('[data-role="category"]');
    const hint = formEl.querySelector('[data-role="hint"]');
    const apportion = formEl.querySelector('[data-role="apportion"]');
    if (!desc) { hint.textContent = ""; return; }
    const guess = window.guessExpenseCategory(desc);
    if (guess) {
      sel.value = guess.categoryId;
      const cat = window.getExpenseCategory(guess.categoryId);
      if (cat) {
        apportion.value = cat.default_apportion;
        hint.textContent = `「${guess.matchedKeyword}」から「${cat.name}」（標準の按分${cat.default_apportion}%）と推測しました。違う場合は選び直してください。`;
      }
    } else {
      hint.textContent = "科目を推測できませんでした。選んでください。";
    }
  }

  function handleExpenseCategoryChange(formEl) {
    const sel = formEl.querySelector('[data-role="category"]');
    const apportion = formEl.querySelector('[data-role="apportion"]');
    const cat = window.getExpenseCategory(sel.value);
    if (cat) apportion.value = cat.default_apportion;
  }

  function addExpenseRow(type) {
    const root = $(`expense-block-${type.key}`);
    const form = root.querySelector(`[data-form-for="${type.key}"]`);
    const date = form.querySelector('[data-role="date"]').value;
    const desc = form.querySelector('[data-role="desc"]').value.trim();
    const amount = toNumber(form.querySelector('[data-role="amount"]').value);
    const categoryId = form.querySelector('[data-role="category"]').value;
    const apRaw = form.querySelector('[data-role="apportion"]').value;
    let apportion;
    if (apRaw === "" || apRaw == null) {
      const cat = window.getExpenseCategory(categoryId);
      apportion = cat ? cat.default_apportion : 100;
    } else {
      apportion = Math.max(0, Math.min(100, toNumber(apRaw)));
    }
    if (amount <= 0) { showToast("金額を入力してください"); return; }
    if (!desc) { showToast("摘要を入力してください"); return; }

    STATE.expenses[type.key].push({ id: STATE.expenseSeq++, date, desc, amount, categoryId, apportion, note: "" });
    form.querySelector('[data-role="desc"]').value = "";
    form.querySelector('[data-role="amount"]').value = "";
    form.querySelector('[data-role="hint"]').textContent = "";
    renderExpenseBlock(type);
    resetTimer();
  }

  function deleteExpenseRow(type, id) {
    STATE.expenses[type.key] = STATE.expenses[type.key].filter(x => x.id !== id);
    renderExpenseBlock(type);
    resetTimer();
  }

  function applyExpenseToField(type) {
    const items = STATE.expenses[type.key] || [];
    const ap = items.reduce((s, x) => s + apportioned(x), 0);
    const inp = $(type.field);
    if (inp) {
      inp.value = ap;
      ensureHint(inp);
      recalcAll();
      resetTimer();
      showToast(`${type.label}の必要経費に ${ap.toLocaleString("ja-JP")}円 を入れました`, 3000);
    }
  }

  function categorySummary(items) {
    const map = new Map();
    items.forEach(it => {
      const cat = window.getExpenseCategory(it.categoryId);
      if (!cat) return;
      const cur = map.get(cat.id) || { id: cat.id, name: cat.name, count: 0, total: 0 };
      cur.count += 1;
      cur.total += apportioned(it);
      map.set(cat.id, cur);
    });
    return window.EXPENSE_DATA.categories.map(c => map.get(c.id)).filter(Boolean);
  }

  function todayStr(sep) {
    const d = new Date();
    const p = n => String(n).padStart(2, "0");
    return sep === "ja" ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
                        : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /* ファイルの保存：共有シート（使える場合）→ だめならダウンロード */
  async function saveFile(name, mime, parts, preferShare) {
    const blob = new Blob(parts, { type: mime });
    if (preferShare) {
      try {
        const file = new File([blob], name, { type: mime });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: name });
          return "shared";
        }
      } catch (e) {
        if (e && e.name === "AbortError") return "cancel";
      }
    }
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return "downloaded";
    } catch (e) {
      return "error";
    }
  }

  async function exportExpenseCSV(type) {
    const items = STATE.expenses[type.key] || [];
    if (items.length === 0) { showToast("レシートが0件のため保存できません"); return; }
    const esc = (v) => {
      const s = String(v == null ? "" : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [];
    lines.push(`【${type.label}の経費内訳】,,,,,,`);
    lines.push(`作成日,${todayStr()},,,,,`);
    lines.push("");
    lines.push("■ 明細");
    lines.push("日付,摘要,科目,金額,按分%,按分後金額,メモ");
    items.forEach(it => {
      const cat = window.getExpenseCategory(it.categoryId);
      lines.push([esc(it.date), esc(it.desc), esc(cat ? cat.name : ""), it.amount, it.apportion, apportioned(it), esc(it.note || "")].join(","));
    });
    const sum = items.reduce((s, x) => s + x.amount, 0);
    const ap = items.reduce((s, x) => s + apportioned(x), 0);
    lines.push(`,,合計,${sum},,${ap},`);
    lines.push("");
    lines.push("■ 科目別集計（按分後）");
    lines.push("科目,件数,按分後金額");
    categorySummary(items).forEach(c => lines.push(`${esc(c.name)},${c.count},${c.total}`));
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const r = await saveFile(`経費内訳_${type.label}_${todayStr()}.csv`, "text/csv", [bom, lines.join("\r\n")], true);
    if (r === "shared") showToast("CSVを共有しました");
    else if (r === "downloaded") showToast("CSVを保存しました（ダウンロード）");
    else if (r === "error") showToast("保存できませんでした");
  }

  /* 印刷：同じ画面の印刷用エリアに組み立てて印刷（PDF保存にも使える） */
  function printHTML(html) {
    if (PREVIEW) { showToast("プレビュー版では印刷できません。アプリ版で使えます。"); return; }
    const root = $("print-root");
    root.innerHTML = html;
    const cleanup = () => { root.innerHTML = ""; window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);
    setTimeout(() => {
      try { window.print(); } catch (e) { showToast("この端末では印刷を開けませんでした"); }
    }, 60);
  }

  function printExpenseView(type) {
    const items = STATE.expenses[type.key] || [];
    if (items.length === 0) { showToast("レシートが0件のため印刷できません"); return; }
    const sum = items.reduce((s, x) => s + x.amount, 0);
    const ap = items.reduce((s, x) => s + apportioned(x), 0);
    const rows = items.map(it => {
      const cat = window.getExpenseCategory(it.categoryId);
      return `<tr><td>${escapeHTML(it.date || "—")}</td><td>${escapeHTML(it.desc)}</td><td>${escapeHTML(cat ? cat.name : "—")}</td>
        <td class="v">${it.amount.toLocaleString("ja-JP")}</td><td class="v">${it.apportion}%</td><td class="v">${apportioned(it).toLocaleString("ja-JP")}</td></tr>`;
    }).join("");
    const srows = categorySummary(items).map(c =>
      `<tr><td>${escapeHTML(c.name)}</td><td class="v">${c.count}件</td><td class="v">${c.total.toLocaleString("ja-JP")}円</td></tr>`).join("");
    printHTML(`
      <h1>${escapeHTML(type.label)} 経費内訳</h1>
      <div class="meta">作成日：${todayStr("ja")}／件数：${items.length}件／合計：${sum.toLocaleString("ja-JP")}円／按分後：${ap.toLocaleString("ja-JP")}円</div>
      <h2>科目別集計（按分後）</h2>
      <table><tr><th>科目</th><th class="v">件数</th><th class="v">按分後金額</th></tr>${srows}
        <tr class="final"><td>合計</td><td class="v">${items.length}件</td><td class="v">${ap.toLocaleString("ja-JP")}円</td></tr></table>
      <p class="note">科目別の合計を、収支内訳書の対応する経費の欄に写してください。</p>
      <h2>明細</h2>
      <table><tr><th>日付</th><th>摘要</th><th>科目</th><th class="v">金額</th><th class="v">按分</th><th class="v">按分後</th></tr>${rows}
        <tr class="final"><td colspan="3">合計</td><td class="v">${sum.toLocaleString("ja-JP")}円</td><td></td><td class="v">${ap.toLocaleString("ja-JP")}円</td></tr></table>
      <p class="note">市県民税 計算支援（令和9年度）で作成した整理用の資料です。申告内容は申告書の手引き等でご確認ください。</p>
    `);
  }

  /* ============================================================
   * 全体再計算
   * ============================================================ */
  function recalcAll() {
    // ─── 1. 総合課税の所得 ───
    const salaryRev = numVal("inp-salary");
    const sRes = CALC_LOGIC.salaryIncome(salaryRev);
    STATE.salaryIncome = sRes.value;
    $("res-salary").textContent = fmt(sRes.value);
    setProcess("proc-salary", sRes.formula);

    const pRev = numVal("inp-pension");
    const pOther = numVal("inp-pension-other");
    const is65 = $("inp-pension-age").checked;
    const pRes = CALC_LOGIC.pensionIncome(pRev, pOther, is65);
    STATE.pensionIncome = pRes.value;
    $("res-pension").textContent = fmt(pRes.value);
    setProcess("proc-pension", pRes.formula);

    // 所得金額調整控除（給与所得から控除）
    const hasKodomo = $("inp-salary-kodomo") ? $("inp-salary-kodomo").checked : false;
    const chouseiRes = CALC_LOGIC.shotokuChouseiKoujo({
      salaryRev: salaryRev,
      salaryIncome: STATE.salaryIncome,
      pensionIncome: STATE.pensionIncome,
      hasKodomoTokubetsu: hasKodomo
    });
    STATE.shotokuChousei = chouseiRes.value;
    STATE.salaryIncomeAdjusted = chouseiRes.adjustedSalary;
    if (chouseiRes.value > 0) {
      setProcess("proc-salary", sRes.formula + "\n────────────\n【所得金額調整控除】\n" + chouseiRes.formula);
    }

    // ① 営業等 ② 農業 ③ 不動産 ⑥ 雑(業務) ⑦ 雑(その他)
    const eigyoAoi = numVal("inp-eigyo-aoiro");
    const eRes = CALC_LOGIC.eigyoIncome(numVal("inp-eigyo-rev"), numVal("inp-eigyo-exp"));
    STATE.eigyoIncome = eRes.value;
    $("res-eigyo").textContent = fmtSigned(eRes.value);
    setProcess("proc-eigyo", eRes.formula);

    const nougyoAoi = numVal("inp-nougyo-aoiro");
    const nRes = CALC_LOGIC.nougyoIncome(numVal("inp-nougyo-rev"), numVal("inp-nougyo-exp"));
    STATE.nougyoIncome = nRes.value;
    $("res-nougyo").textContent = fmtSigned(nRes.value);
    setProcess("proc-nougyo", nRes.formula);

    const fudoJigyo = $("inp-fudo-jigyo").checked;
    const fudoAoi = numVal("inp-fudo-aoiro");
    const fRes = CALC_LOGIC.fudosanIncome(numVal("inp-fudo-rev"), numVal("inp-fudo-exp"), numVal("inp-fudo-fusai"));
    STATE.fudosanIncome = fRes.value;
    STATE.fudosanRestrictedLoss = fRes.restrictedLoss;
    $("res-fudo").textContent = fmtSigned(fRes.value);
    setProcess("proc-fudo", fRes.formula);

    const zBRes = CALC_LOGIC.zatsuBusinessIncome(numVal("inp-zatsu-b-rev"), numVal("inp-zatsu-b-exp"));
    STATE.zatsuBusinessIncome = zBRes.value;
    $("res-zatsu-b").textContent = fmt(zBRes.value);
    setProcess("proc-zatsu-b", zBRes.formula);

    const zORes = CALC_LOGIC.zatsuOtherIncome(numVal("inp-zatsu-o-rev"), numVal("inp-zatsu-o-exp"));
    STATE.zatsuOtherIncome = zORes.value;
    $("res-zatsu-o").textContent = fmt(zORes.value);
    setProcess("proc-zatsu-o", zORes.formula);

    // 損益通算＋青色申告特別控除
    const agg = CALC_LOGIC.aggregateGeneralIncomes({
      kyuyo: STATE.salaryIncomeAdjusted,
      nenkin: STATE.pensionIncome,
      zatsuB: STATE.zatsuBusinessIncome,
      zatsuO: STATE.zatsuOtherIncome,
      eigyoRaw: STATE.eigyoIncome,
      nougyoRaw: STATE.nougyoIncome,
      fudosanRaw: STATE.fudosanIncome,
      fudosanRestrictedLoss: STATE.fudosanRestrictedLoss,
      aoiroEigyo: eigyoAoi,
      aoiroNougyo: nougyoAoi,
      aoiroFudosan: fudoAoi,
      fudosanJigyoTeki: fudoJigyo
    });
    STATE.generalIncome = agg.value;
    STATE.aggWarnings = agg.warnings;

    const hasSongaeki = (STATE.eigyoIncome !== 0 || STATE.nougyoIncome !== 0 || STATE.fudosanIncome !== 0
                        || STATE.zatsuBusinessIncome !== 0 || STATE.zatsuOtherIncome !== 0
                        || eigyoAoi > 0 || nougyoAoi > 0 || fudoAoi > 0);
    if (hasSongaeki) {
      $("block-songaeki").style.display = "";
      const warnText = agg.warnings.length ? "\n⚠ " + agg.warnings.join("\n⚠ ") : "";
      setProcess("proc-songaeki", agg.formula + warnText);
    } else {
      $("block-songaeki").style.display = "none";
    }

    // ─── 2. 分離課税の所得 ───
    STATE.separates = [];

    const haitoRev = numVal("inp-haito-revenue");
    const haitoFusai = numVal("inp-haito-fusai");
    const haitoMethodEl = document.querySelector('input[name="haito-method"]:checked');
    STATE.haitoMethod = haitoMethodEl ? haitoMethodEl.value : "sougou";
    STATE.haitoType = $("sel-haito-type").value;
    if (haitoRev > 0) {
      if (STATE.haitoMethod === "sougou") {
        const r = CALC_LOGIC.haito_sougou({ revenue: haitoRev, fusai_risoku: haitoFusai });
        STATE.haitoSougou = r.value;
        STATE.haitoBunri = 0;
        $("res-haito").textContent = fmt(r.value);
        setProcess("proc-haito", r.formula);
      } else {
        const r = CALC_LOGIC.haito_bunri({ revenue: haitoRev, fusai_risoku: haitoFusai });
        STATE.haitoBunri = r.value;
        STATE.haitoSougou = 0;
        $("res-haito").textContent = fmt(r.value);
        setProcess("proc-haito", r.formula);
      }
    } else {
      STATE.haitoSougou = 0;
      STATE.haitoBunri = 0;
      $("res-haito").textContent = "0";
      setProcess("proc-haito", "");
    }

    const kabuTaika = numVal("inp-kabu-taika");
    const kabuKuri = numVal("inp-kabu-kurikoshi");
    if (kabuTaika > 0) {
      const rRaw = CALC_LOGIC.kabushiki_jouto({ taika: kabuTaika, shutokuhi: numVal("inp-kabu-shutokuhi"), jouto_hiyou: numVal("inp-kabu-hiyou"), kurikoshi_son: 0 });
      STATE.kabuRieki = rRaw.value;
    } else {
      STATE.kabuRieki = 0;
      STATE.kabuJouto = 0;
      $("res-kabu").textContent = "0";
      setProcess("proc-kabu", "");
    }

    // 上場株式等の繰越損失の通算（①譲渡益 → ②申告分離配当の順）
    {
      const riekiRaw = STATE.kabuRieki || 0;
      const haitoBunriRaw = (STATE.haitoMethod !== "sougou") ? (STATE.haitoBunri || 0) : 0;
      let nokori = kabuKuri;
      const useJouto = Math.min(nokori, riekiRaw);
      const joutoShotoku = riekiRaw - useJouto;
      nokori -= useJouto;
      const useHaito = Math.min(nokori, haitoBunriRaw);
      const haitoBunriShotoku = haitoBunriRaw - useHaito;
      nokori -= useHaito;

      if (kabuTaika > 0) {
        STATE.kabuJouto = joutoShotoku;
        $("res-kabu").textContent = fmt(joutoShotoku);
        let kl = "譲渡益（繰越前）：" + riekiRaw.toLocaleString("ja-JP") + "円";
        if (kabuKuri > 0) kl += "\n繰越損失 " + kabuKuri.toLocaleString("ja-JP") + "円 → 譲渡益に " + useJouto.toLocaleString("ja-JP") + "円 充当";
        kl += "\n→ 株式等の譲渡所得（申告分離）＝ " + joutoShotoku.toLocaleString("ja-JP") + "円";
        if (useHaito > 0) kl += "\n（譲渡で引ききれない繰越損失 " + useHaito.toLocaleString("ja-JP") + "円 を申告分離の配当と通算）";
        if (nokori > 0) kl += "\n→ 残り " + nokori.toLocaleString("ja-JP") + "円 は翌年以降に繰越し";
        setProcess("proc-kabu", kl);
        if (joutoShotoku > 0) STATE.separates.push({ taxable_type: "kabushiki_jouto", amount: joutoShotoku, label: "上場株式等の譲渡所得" });
      }
      if (STATE.haitoMethod !== "sougou" && haitoRev > 0) {
        STATE.haitoBunri = haitoBunriShotoku;
        $("res-haito").textContent = fmt(haitoBunriShotoku);
        if (useHaito > 0) setProcess("proc-haito", "配当所得（申告分離・繰越前）：" + haitoBunriRaw.toLocaleString("ja-JP") + "円\n繰越損失（譲渡で引ききれない分）" + useHaito.toLocaleString("ja-JP") + "円 を通算\n→ 配当所得（申告分離）＝ " + haitoBunriShotoku.toLocaleString("ja-JP") + "円");
        if (haitoBunriShotoku > 0) STATE.separates.push({ taxable_type: "haito_bunri", amount: haitoBunriShotoku, label: "配当所得（申告分離）" });
      }
    }

    // 土地建物の譲渡
    const tochiTaika = numVal("inp-tochi-taika");
    STATE.tochiYouto = $("sel-tochi-youto").value;
    if (tochiTaika > 0) {
      const r = CALC_LOGIC.tochi_jouto({
        taika: tochiTaika, minashi_shutokuhi: $("chk-tochi-minashi").checked,
        shutokuhi: numVal("inp-tochi-shutokuhi"), jouto_hiyou: numVal("inp-tochi-hiyou"),
        tokubetsu_koujo: numVal("inp-tochi-tokubetsu"), youto: STATE.tochiYouto
      });
      STATE.tochiJouto = r.value;
      $("res-tochi").textContent = fmt(r.value);
      setProcess("proc-tochi", r.formula);
      if (r.value > 0) STATE.separates.push({ taxable_type: r.taxable_type, amount: r.value, label: "土地・建物の譲渡所得" });
    } else {
      STATE.tochiJouto = 0;
      $("res-tochi").textContent = "0";
      setProcess("proc-tochi", "");
    }

    // 特定肉用牛
    const gIppan = numVal("inp-gyu-ippan"), gKou = numVal("inp-gyu-kouzatu"), gNyu = numVal("inp-gyu-nyuyou");
    if (gIppan + gKou + gNyu > 0) {
      const r = CALC_LOGIC.meneki_gyu({ ippan_kingaku: gIppan, kouzatu_kingaku: gKou, nyuyou_kingaku: gNyu });
      STATE.menekiGyu = r.value;
      $("res-gyu").textContent = fmt(r.value);
      setProcess("proc-gyu", r.formula);
    } else {
      STATE.menekiGyu = 0;
      $("res-gyu").textContent = "0";
      setProcess("proc-gyu", "");
    }

    const generalWithHaito = STATE.generalIncome + STATE.haitoSougou;
    STATE.generalWithHaito = generalWithHaito;
    STATE.bunriSum = STATE.separates.reduce((a, b) => a + b.amount, 0);
    STATE.totalIncome = generalWithHaito + STATE.bunriSum;
    $("res-total-income").textContent = fmt(generalWithHaito);

    // ─── 3. 所得控除（データ駆動） ───
    let koujoSum = 0;
    let koujoDiffSum = 0;
    const state = { totalIncome: STATE.totalIncome };
    STATE.koujoDiffs = {};

    KOUJO_DATA.deductions.forEach(k => {
      let r = { value: 0, formula: "" };
      let diff = 0;

      if (k.type === "tier") {
        if (k.multiple_per_person) {
          const peopleContainer = $(`people-${k.id}`);
          const inputs = peopleContainer ? peopleContainer.querySelectorAll(".person-input") : [];
          let total = 0;
          const lines = [];
          let hasAny = false;
          inputs.forEach((inp, i) => {
            const v = toNumber(inp.value);
            if (v > 0) {
              const tierRes = CALC_LOGIC.calcTier(k, v);
              total += tierRes.value;
              const tier = k.tiers.find(t => t.max === null || v <= t.max);
              lines.push(`${i + 1}人目（${v.toLocaleString("ja-JP")}円・${tier ? tier.label : ""}）：${tierRes.value.toLocaleString("ja-JP")}円`);
              hasAny = true;
              if (tier) diff += (tier.koujo_diff || 0);
            }
          });
          if (hasAny) {
            lines.push(`→ ${k.name} 合計 ＝ ${total.toLocaleString("ja-JP")}円`);
            r = { value: total, formula: lines.join("\n") };
          } else {
            r = { value: 0, formula: "（所得が入力されていないため、控除は 0円）" };
          }
        } else {
          const ref = (k.input.source === "auto_total_income") ? STATE.totalIncome : 0;
          const refEl = $(`ref-${k.id}`); if (refEl) refEl.textContent = fmt(ref);
          r = CALC_LOGIC.calcTier(k, ref);
          const tier = k.tiers.find(t => t.max === null || ref <= t.max);
          diff = tier ? (tier.koujo_diff || 0) : 0;
        }
      } else if (k.type === "fixed") {
        const sel = $(`sel-${k.id}`);
        const optionId = sel ? sel.value : k.options[0].id;
        r = CALC_LOGIC.calcFixed(k, optionId);
        const opt = k.options.find(o => o.id === optionId);
        diff = (opt && opt.koujo_diff) || 0;
      } else if (k.type === "matrix") {
        const rowRef = (k.inputs.row.source === "auto_total_income") ? STATE.totalIncome : 0;
        const refEl = $(`ref-row-${k.id}`); if (refEl) refEl.textContent = fmt(rowRef);
        const hasModes = Array.isArray(k.modes) && k.modes.length > 0;
        const modeSel = hasModes ? $(`sel-mode-${k.id}`) : null;
        const mode = modeSel ? modeSel.value : null;
        const isNone = hasModes && (!mode || mode === "none");
        const colInp = $(`inp-col-${k.id}`);
        if (colInp) {
          colInp.disabled = isNone;
          if (isNone && colInp.value) { colInp.value = ""; ensureHint(colInp); }
        }
        const col = colInp ? toNumber(colInp.value) : 0;
        r = CALC_LOGIC.calcMatrix(k, rowRef, col, mode);
        if (k.cells_diff && !isNone) {
          const rowIdx = k.row_ranges.findIndex(x => x.max === null || rowRef <= x.max);
          const colIdx = k.col_ranges.findIndex(x => x.max === null || col <= x.max);
          if (rowIdx >= 0 && colIdx >= 0) {
            const rid = k.row_ranges[rowIdx].id;
            const diffMap = hasModes ? (k.cells_diff[mode] || {}) : k.cells_diff;
            diff = (diffMap[rid] || [])[colIdx] || 0;
          }
        }
      } else if (k.type === "formula") {
        const inputs = {};
        (k.input_fields || []).forEach(f => { inputs[f.id] = numVal(`inp-${k.id}-${f.id}`); });
        const fn = CALC_LOGIC[k.formula_id];
        if (typeof fn === "function") r = fn(inputs, k, state);
        if ((k.formula_id === "fuyou" || k.formula_id === "shogaisha") && k.rates) {
          for (const rate of k.rates) diff += (rate.koujo_diff || 0) * (Number(inputs[rate.id]) || 0);
        }
      }

      STATE.koujoValues[k.id] = r.value;
      STATE.koujoDiffs[k.id] = diff;
      const resEl = $(`res-${k.id}`); if (resEl) resEl.textContent = fmt(r.value);
      setProcess(`proc-${k.id}`, r.formula);
      koujoSum += r.value;
      koujoDiffSum += diff;
    });

    STATE.koujoSum = koujoSum;
    STATE.koujoDiffSum = koujoDiffSum;

    // ─── 4. 課税所得（所得控除は総合課税 → 分離課税の順に充当） ───
    const koujoForGeneral = Math.min(koujoSum, generalWithHaito);
    let koujoRemain = koujoSum - koujoForGeneral;
    STATE.taxableGeneral = Math.max(0, Math.floor((generalWithHaito - koujoForGeneral) / 1000) * 1000);
    const separatesTaxable = STATE.separates.map(s => {
      let amt = s.amount;
      if (koujoRemain > 0) {
        const applied = Math.min(koujoRemain, amt);
        amt -= applied;
        koujoRemain -= applied;
      }
      return { taxable_type: s.taxable_type, taxable_amount: Math.max(0, Math.floor(amt / 1000) * 1000), label: s.label };
    });
    STATE.separatesTaxable = separatesTaxable;
    STATE.kazeiTotalTou = STATE.taxableGeneral + separatesTaxable.reduce((a, s) => a + s.taxable_amount, 0);

    // ─── 5. 算出税額 ───
    const sango = ZEIGAKU_LOGIC.calc_sanshutu(STATE.taxableGeneral, separatesTaxable);
    STATE.sangoshu = sango;
    $("res-sangoshu").textContent = fmt(sango.value);
    setProcess("proc-sangoshu", sango.formula);

    const bd = {
      sanshutu: { c: sango.city, p: sango.prefecture },
      chosei: { c: 0, p: 0 }, haito: { c: 0, p: 0 }, jutaku: { c: 0, p: 0 },
      kifu: { c: 0, p: 0 }, gaikoku: { c: 0, p: 0 }, choseiSochi: { c: 0, p: 0 },
      wariri: { c: 0, p: 0 }, shotokuWari: { c: 0, p: 0 }, kintou: { c: 0, p: 0, s: 0 },
      kanpu: { c: 0, p: 0 }, hikazeiShotoku: false
    };

    // ─── 6. 税額控除 ───
    let cityZei = sango.city;
    let prefZei = sango.prefecture;
    let zeikoujoSum = 0;

    // 調整控除
    const chosei = ZEIGAKU_LOGIC.calc_chosei(koujoDiffSum, STATE.taxableGeneral, STATE.totalIncome);
    cityZei -= chosei.city;
    prefZei -= chosei.prefecture;
    zeikoujoSum += chosei.value;
    bd.chosei = { c: chosei.city, p: chosei.prefecture };
    STATE.choseiFormula = chosei.formula;

    // ふるさと納税の特例控除（20%上限）の基準：調整控除後の所得割（市・県それぞれ）
    const cityAfterChosei = Math.max(0, cityZei);
    const prefAfterChosei = Math.max(0, prefZei);
    STATE.cityAfterChosei = cityAfterChosei;
    STATE.prefAfterChosei = prefAfterChosei;
    STATE.shotokuWariAfterChosei = cityAfterChosei + prefAfterChosei;

    // 配当控除（総合課税の配当）
    if (STATE.haitoSougou > 0) {
      const hk = ZEIGAKU_LOGIC.calc_haito_koujo(STATE.haitoSougou, STATE.kazeiTotalTou, STATE.haitoType);
      cityZei -= hk.city;
      prefZei -= hk.prefecture;
      zeikoujoSum += hk.value;
      bd.haito = { c: hk.city, p: hk.prefecture };
      $("res-haito-koujo").textContent = fmt(hk.value);
      setProcess("proc-haito-koujo", hk.formula);
    } else {
      $("res-haito-koujo").textContent = "0";
      setProcess("proc-haito-koujo", "");
    }

    // 配当割額・株式等譲渡所得割額控除（適用は所得割の確定後）
    const wHaito = numVal("inp-wariri-haito");
    const wJouto = numVal("inp-wariri-jouto");
    const wariri = wHaito + wJouto;
    const wr = ZEIGAKU_LOGIC.calc_wariri_koujo(wHaito, wJouto);
    $("res-wariri").textContent = fmt(wr.value);
    setProcess("proc-wariri", wr.formula);

    // 所得税の基礎控除の調整額（住宅ローン控除・ふるさと納税の判定に使う）
    const kisoChosei = ZEIGAKU_LOGIC.kiso_chosei_gaku(STATE.totalIncome);
    STATE.kisoChosei = kisoChosei;

    // 住宅ローン控除
    const jKanou = numVal("inp-jutaku-kanou");
    const jt = ZEIGAKU_LOGIC.calc_jutaku_loan(jKanou, numVal("inp-jutaku-shogaku"), numVal("inp-jutaku-kazei"), $("sel-jutaku-ritsu").value, kisoChosei);
    if (jKanou > 0) {
      cityZei -= jt.city;
      prefZei -= jt.prefecture;
      zeikoujoSum += jt.value;
      bd.jutaku = { c: jt.city, p: jt.prefecture };
    }
    $("res-jutaku").textContent = fmt(jt.value);
    setProcess("proc-jutaku", jt.formula);

    // 寄附金税額控除
    let kFurusato = 0, kNisseki = 0, kShi = 0, kKen = 0, kRyo = 0, kKokuzei = 0;
    document.querySelectorAll("#kifu-rows .kifu-row").forEach(row => {
      const a = toNumber((row.querySelector(".kifu-amount") || {}).value);
      if (a <= 0) return;
      const kind = (row.querySelector(".kifu-kind") || {}).value || "";
      if (kind === "furusato") kFurusato += a;
      else if (kind === "nisseki") kNisseki += a;
      else if (kind === "shi") kShi += a;
      else if (kind === "ken") kKen += a;
      else if (kind === "ryo") kRyo += a;
      else kKokuzei += a;
    });
    STATE.kifuFurusato = kFurusato;
    const kJuumin = kFurusato + kNisseki + kShi + kKen + kRyo;
    const hantei = STATE.taxableGeneral - koujoDiffSum - kisoChosei;
    STATE.hanteiGaku = hantei;
    STATE.tokurei = ZEIGAKU_LOGIC.tokurei_rate(hantei);
    STATE.shotokuGenkaiRate = STATE.tokurei.shotoku;
    if (kJuumin > 0 || kKokuzei > 0) {
      const kf = ZEIGAKU_LOGIC.calc_kifukin({
        furusato: kFurusato, nisseki: kNisseki, shiJourei: kShi, kenJourei: kKen, ryoJourei: kRyo,
        total_income: STATE.totalIncome,
        hantei_gaku: hantei,
        hantei_detail: { kazei: STATE.taxableGeneral, diff: koujoDiffSum, kiso: kisoChosei },
        city_after_chosei: cityAfterChosei, pref_after_chosei: prefAfterChosei,
        has_bunri: STATE.separates.length > 0
      });
      if (kJuumin > 0) {
        cityZei -= kf.city;
        prefZei -= kf.prefecture;
        zeikoujoSum += kf.value;
        bd.kifu = { c: kf.city, p: kf.prefecture };
      }
      $("res-kifu").textContent = fmt(kf.value);
      let pf = (kJuumin > 0) ? kf.formula : "（住民税の控除の対象となる寄附はありません）";
      if (kKokuzei > 0) pf += "\n\n※ 所得税だけが対象の寄附（認定NPO・公益社団法人・政党など）：" + kKokuzei.toLocaleString("ja-JP") + "円\n　住民税の控除の対象外です（条例で指定されている場合を除く）";
      setProcess("proc-kifu", pf);
    } else {
      $("res-kifu").textContent = "0";
      setProcess("proc-kifu", "");
    }

    // 外国税額控除
    const gAmari = numVal("inp-gai-amari");
    if (gAmari > 0) {
      const gk = ZEIGAKU_LOGIC.calc_gaikoku_zeigaku(0, gAmari, numVal("inp-gai-ken"), numVal("inp-gai-shi"));
      cityZei -= gk.city;
      prefZei -= gk.prefecture;
      zeikoujoSum += gk.value;
      bd.gaikoku = { c: gk.city, p: gk.prefecture };
      $("res-gaikoku").textContent = fmt(gk.value);
      setProcess("proc-gaikoku", gk.formula);
    } else {
      $("res-gaikoku").textContent = "0";
      setProcess("proc-gaikoku", "");
    }

    STATE.zeigakuKoujo = zeikoujoSum;

    // ─── 7. 非課税判定の人数（本人＋同一生計配偶者＋扶養親族（年少を含む））───
    let ninzu = 1;
    let spouseCounted = false;
    const haigK = KOUJO_DATA.deductions.find(d => d.id === "haigusha");
    if (haigK) {
      const haigSel = $("sel-mode-haigusha");
      const haigMode = haigSel ? haigSel.value : "none";
      const spouseIncome = numVal("inp-col-haigusha");
      const limit = (haigK.col_ranges && haigK.col_ranges[0] && haigK.col_ranges[0].max) || 620000;
      // 同一生計配偶者（合計所得62万円以下）のときだけ人数に入れる
      if (haigMode && haigMode !== "none" && spouseIncome <= limit) { ninzu++; spouseCounted = true; }
    }
    const fuyouK = KOUJO_DATA.deductions.find(d => d.id === "fuyou");
    if (fuyouK) {
      (fuyouK.input_fields || []).forEach(f => { ninzu += numVal(`inp-fuyou-${f.id}`); });
    }
    STATE.spouseCounted = spouseCounted;

    // 障害者（本人）・未成年・寡婦・ひとり親（合計所得135万円以下の非課税）
    const selNotNone = (id) => { const e = $(id); return !!(e && e.value && e.value !== "none"); };
    const honninShogai = !!($("chk-shogaisha-honnin") && $("chk-shogaisha-honnin").checked);
    const miseinen = !!($("chk-honnin-miseinen") && $("chk-honnin-miseinen").checked);
    const hasShougaiEtc = honninShogai || miseinen || selNotNone("sel-kafu") || selNotNone("sel-hitori_oya");
    const judge = ZEIGAKU_LOGIC.judge_hikazei(STATE.totalIncome, STATE.totalIncome, ninzu, hasShougaiEtc);

    // ─── 8. 所得割（非課税判定 → 所得割の調整措置） ───
    if (judge.shotoku_hikazei) {
      cityZei = 0;
      prefZei = 0;
      bd.hikazeiShotoku = true;
      setProcess("proc-shotokuwari-chosei", "所得割は非課税（0円）です。\n\n" + judge.formula);
    } else {
      const sgAfter = Math.max(0, cityZei) + Math.max(0, prefZei);
      const sc = ZEIGAKU_LOGIC.calc_shotokuwari_chosei(judge.shotoku_kijun, STATE.totalIncome, sgAfter, Math.max(0, cityZei), Math.max(0, prefZei));
      cityZei -= sc.city;
      prefZei -= sc.prefecture;
      bd.choseiSochi = { c: sc.city, p: sc.prefecture };
      setProcess("proc-shotokuwari-chosei", sc.formula);
    }
    const preWariCity = Math.max(0, cityZei);
    const preWariPref = Math.max(0, prefZei);

    // ─── 9. 均等割 ───
    const kintou = ZEIGAKU_LOGIC.calc_kintou_wari(judge.kintou_hikazei);
    $("kintou-note").innerHTML = judge.kintou_hikazei ? '<span class="hikazei-badge">非課税</span>' : "";

    // ─── 8'. 配当割額・株式等譲渡所得割額控除 ───
    //   ほかの税額控除の後の所得割から控除し、引ききれない分は同じ税目の均等割に充当、残りは還付
    let kintouCity = kintou.city, kintouPref = kintou.prefecture;
    let kanpuCity = 0, kanpuPref = 0;
    let netCity = preWariCity - wr.city;
    let netPref = preWariPref - wr.prefecture;
    if (netCity < 0) { const over = -netCity; const use = Math.min(over, kintouCity); kintouCity -= use; kanpuCity = over - use; netCity = 0; }
    if (netPref < 0) { const over = -netPref; const use = Math.min(over, kintouPref); kintouPref -= use; kanpuPref = over - use; netPref = 0; }
    bd.wariri = { c: wr.city, p: wr.prefecture };

    // 所得割（100円未満切捨て）
    cityZei = Math.floor(netCity / 100) * 100;
    prefZei = Math.floor(netPref / 100) * 100;
    STATE.shotokuWari = cityZei + prefZei;
    bd.shotokuWari = { c: cityZei, p: prefZei };

    STATE.kintouWari = kintouCity + kintouPref + kintou.shinrin;
    bd.kintou = { c: kintouCity, p: kintouPref, s: kintou.shinrin };

    STATE.kanpu = kanpuCity + kanpuPref;
    bd.kanpu = { c: kanpuCity, p: kanpuPref };
    if (wariri > 0 && STATE.kanpu > 0) {
      setProcess("proc-wariri", wr.formula +
        "\n\n【所得割・均等割から引ききれない分】" +
        "\n  市民税分：均等割に充当した後の残り " + kanpuCity.toLocaleString("ja-JP") + "円 を還付" +
        "\n  県民税分：均等割に充当した後の残り " + kanpuPref.toLocaleString("ja-JP") + "円 を還付" +
        "\n  → 還付額 合計 " + STATE.kanpu.toLocaleString("ja-JP") + "円");
    }

    // ─── 10. 年税額（還付があればマイナス） ───
    STATE.yearTax = STATE.shotokuWari + STATE.kintouWari - STATE.kanpu;
    STATE.hikazeiJudge = judge;
    STATE.ninzu = ninzu;
    STATE.hasShougaiEtc = hasShougaiEtc;
    STATE.bd = bd;

    // PC版の集計欄（値の受け渡し用）
    $("sum-income-general").textContent = fmt(generalWithHaito);
    $("sum-income-bunri").textContent = fmt(STATE.bunriSum);
    $("sum-income").textContent = fmt(STATE.totalIncome);
    $("sum-koujo").textContent = fmt(koujoSum);
    $("sum-koujo-diff").textContent = fmt(koujoDiffSum);
    $("sum-taxable").textContent = fmt(STATE.taxableGeneral);
    $("sum-sangoshu").textContent = fmt(sango.value);
    $("sum-zeikoujo").textContent = fmt(zeikoujoSum);
    $("sum-shotokuwari").textContent = fmt(STATE.shotokuWari);
    $("sum-kintouwari").textContent = fmt(STATE.kintouWari);
    $("sum-year").textContent = STATE.yearTax < 0 ? "△" + fmt(-STATE.yearTax) + "（還付）" : fmt(STATE.yearTax);

    if (typeof window.__onRecalc === "function") {
      try { window.__onRecalc(STATE); } catch (e) { console.error(e); }
    }
  }

  function setProcess(elId, text) {
    const el = $(elId);
    if (!el) return;
    if (!text || text.trim() === "") {
      el.className = "process-box empty";
      el.textContent = "入力すると、計算過程がここに表示されます。";
    } else {
      el.className = "process-box";
      el.textContent = text;
    }
  }

  /* ============================================================
   * すべてクリア
   * ============================================================ */
  // 入力フォームのある場所（ふだんは #store、編集中のブロックは入力シートの中）
  function qsa(sel) {
    const parts = sel.split(",").map(s => s.trim());
    return document.querySelectorAll(parts.map(p => `#store ${p}, #sheet-body ${p}`).join(", "));
  }

  function resetForms() {
    qsa("input.num-input, input[type='text'], input[type='date']").forEach(el => { el.value = ""; });
    qsa("input[type='checkbox']").forEach(el => { el.checked = false; });
    qsa("select").forEach(el => { el.selectedIndex = 0; });
    qsa("input[type='radio']").forEach(el => { el.checked = el.defaultChecked; });
    // 動的な行を初期状態（1行）に戻す
    KOUJO_DATA.deductions.filter(k => k.type === "tier" && k.multiple_per_person).forEach(k => {
      const c = $(`people-${k.id}`);
      if (c) { c.innerHTML = ""; addPersonRow(k.id); }
    });
    const kr = $("kifu-rows");
    if (kr) { kr.innerHTML = ""; addKifuRow(); }
    STATE.expenses = { eigyo: [], nougyo: [], fudo: [], zatsu_b: [], zatsu_o: [] };
    STATE.expenseSeq = 1;
    document.querySelectorAll('.expense-add-form [data-role="apportion"]').forEach(el => { el.value = "100"; });
    renderAllExpenseBlocks();
  }

  function clearAll(byUser) {
    resetForms();
    recalcAll();
    refreshHints();
    if (typeof window.__onClear === "function") window.__onClear();
    if (byUser) showToast("入力をすべて消しました");
  }

  /* ============================================================
   * 入力内容の保存（JSON）・読み込み
   * ============================================================ */
  function exportState() {
    const state = {
      version: "snapshot-v1",
      app: "juminzei-r9",
      nendo: "R9",
      timestamp: new Date().toISOString(),
      tool_version: (window.KOUJO_DATA || {}).version || "",
      inputs: {},
      selects: {},
      checkboxes: {},
      radios: {},
      persons: {},
      kifu: [],
      expenses: STATE.expenses || {},
      expense_seq: STATE.expenseSeq || 1
    };
    qsa("input[id]").forEach(el => {
      if (el.type === "checkbox") state.checkboxes[el.id] = el.checked;
      else if (["text", "date", "number"].includes(el.type) && !el.classList.contains("person-input")) {
        if (el.value !== "") state.inputs[el.id] = el.value;
      }
    });
    qsa("select[id]").forEach(el => { state.selects[el.id] = el.value; });
    qsa("input[type='radio']:checked").forEach(el => { if (el.name) state.radios[el.name] = el.value; });
    document.querySelectorAll(".person-input").forEach(el => {
      const koujo = el.dataset.koujo;
      if (!koujo) return;
      (state.persons[koujo] = state.persons[koujo] || []).push(el.value || "");
    });
    document.querySelectorAll("#kifu-rows .kifu-row").forEach(row => {
      const kind = (row.querySelector(".kifu-kind") || {}).value || "furusato";
      const amount = (row.querySelector(".kifu-amount") || {}).value || "";
      state.kifu.push({ kind, amount });
    });
    // 住所地（令和9年1月1日）の団体コード
    const rg = ZEIGAKU_LOGIC.getRegion();
    if (rg.code) state.region = rg.code;
    return state;
  }

  function importState(state) {
    if (!state || state.version !== "snapshot-v1") throw new Error("このアプリの保存ファイルではありません");
    resetForms();

    STATE.expenses = Object.assign({ eigyo: [], nougyo: [], fudo: [], zatsu_b: [], zatsu_o: [] }, state.expenses || {});
    STATE.expenseSeq = state.expense_seq || 1;
    renderAllExpenseBlocks();

    Object.keys(state.persons || {}).forEach(koujoId => {
      const values = state.persons[koujoId] || [];
      const container = $(`people-${koujoId}`);
      if (!container) return;
      container.innerHTML = "";
      if (values.length === 0) addPersonRow(koujoId);
      values.forEach(v => { const inp = addPersonRow(koujoId); if (inp) inp.value = v || ""; });
    });

    if (Array.isArray(state.kifu) && state.kifu.length) {
      const kr = $("kifu-rows");
      kr.innerHTML = "";
      state.kifu.forEach(k => addKifuRow(k.kind, k.amount));
    }

    // 旧版（PC版）の住宅ローン区分を読み替え
    const sel = Object.assign({}, state.selects || {});
    if (sel["sel-jutaku-ritsu"] === "5percent") sel["sel-jutaku-ritsu"] = "r7_5";
    if (sel["sel-jutaku-ritsu"] === "7percent") sel["sel-jutaku-ritsu"] = "r3_7";

    Object.entries(state.inputs || {}).forEach(([id, v]) => { const el = $(id); if (el) el.value = v; });
    Object.entries(sel).forEach(([id, v]) => {
      const el = $(id);
      if (el && Array.from(el.options).some(o => o.value === v)) el.value = v;
    });
    Object.entries(state.checkboxes || {}).forEach(([id, v]) => { const el = $(id); if (el) el.checked = !!v; });
    Object.entries(state.radios || {}).forEach(([name, v]) => {
      document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`).forEach(r => { r.checked = (r.value === v); });
    });
    // 保存ファイルに住所地があれば、その住所地にする（画面側の設定も合わせる）
    if (state.region && typeof window.__onImportRegion === "function") window.__onImportRegion(state.region);

    recalcAll();
    refreshHints();
  }

  async function downloadJSON() {
    if (PREVIEW) { showToast("プレビュー版ではファイルに保存できません"); return; }
    try {
      const state = exportState();
      const ts = new Date();
      const p = n => String(n).padStart(2, "0");
      const name = `住民税計算R9_${ts.getFullYear()}${p(ts.getMonth() + 1)}${p(ts.getDate())}_${p(ts.getHours())}${p(ts.getMinutes())}.json`;
      const r = await saveFile(name, "application/json", [JSON.stringify(state, null, 2)], false);
      if (r === "downloaded") showToast("ファイルに保存しました（ダウンロード）", 3000);
      else if (r === "error") showToast("保存できませんでした");
    } catch (err) {
      showToast("保存できませんでした：" + err.message, 4000);
    }
  }

  function loadJSONFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        importState(JSON.parse(e.target.result));
        showToast("入力内容を読み込みました");
        resetTimer();
      } catch (err) {
        showToast("読み込めませんでした：" + err.message, 4000);
      }
    };
    reader.onerror = () => showToast("ファイルを読めませんでした", 3000);
    reader.readAsText(file, "utf-8");
  }

  /* ============================================================
   * 印刷（A4）・テキストのまとめ
   * ============================================================ */
  function kifuSummaryText() {
    const sums = {};
    const labels = { furusato: "ふるさと納税", nisseki: "日赤・共同募金", shi: "市の条例指定", ken: "県の条例指定", ryo: "市県の条例指定" };
    document.querySelectorAll("#kifu-rows .kifu-row").forEach(row => {
      const a = toNumber((row.querySelector(".kifu-amount") || {}).value);
      if (a <= 0) return;
      const kind = (row.querySelector(".kifu-kind") || {}).value || "";
      const key = labels[kind] ? kind : "other";
      sums[key] = (sums[key] || 0) + a;
    });
    return Object.entries(sums).map(([k, v]) => `${labels[k] || "所得税のみ対象"} ${v.toLocaleString("ja-JP")}円`).join("／");
  }

  function printAllSummary() {
    recalcAll();
    const S = STATE, bd = S.bd;
    const yen = (n) => (Math.floor(Number(n) || 0)).toLocaleString("ja-JP") + "円";
    const val = (id) => { const el = $(id); return el ? (el.value || "") : ""; };
    const selLabel = (id) => { const el = $(id); const o = el && el.options[el.selectedIndex]; return o ? o.textContent : ""; };

    const incomeRows = [
      ["④ 給与（収入）", val("inp-salary"), S.salaryIncomeAdjusted],
      ["⑤ 公的年金等（収入）", val("inp-pension"), S.pensionIncome],
      ["① 営業等（収入）", val("inp-eigyo-rev"), S.eigyoIncome],
      ["② 農業（収入）", val("inp-nougyo-rev"), S.nougyoIncome],
      ["③ 不動産（収入）", val("inp-fudo-rev"), S.fudosanIncome],
      ["⑥ 雑・業務（収入）", val("inp-zatsu-b-rev"), S.zatsuBusinessIncome],
      ["⑦ 雑・その他（収入）", val("inp-zatsu-o-rev"), S.zatsuOtherIncome],
      ["配当", val("inp-haito-revenue"), S.haitoSougou + S.haitoBunri],
      ["株式等の譲渡", val("inp-kabu-taika"), S.kabuJouto],
      ["土地・建物の譲渡", val("inp-tochi-taika"), S.tochiJouto]
    ].filter(r => toNumber(r[1]) > 0)
     .map(r => `<tr><td>${escapeHTML(r[0])}</td><td class="v">${yen(toNumber(r[1]))}</td><td class="v">${yen(r[2])}</td></tr>`).join("")
     || `<tr><td colspan="3">（入力なし）</td></tr>`;

    const koujoRows = KOUJO_DATA.deductions.map(k => {
      const v = (S.koujoValues && S.koujoValues[k.id]) || 0;
      if (!v) return "";
      let detail = "";
      if (k.type === "fixed") detail = selLabel(`sel-${k.id}`);
      else if (k.type === "matrix") detail = selLabel(`sel-mode-${k.id}`) + (val(`inp-col-${k.id}`) ? `／配偶者の所得 ${yen(toNumber(val(`inp-col-${k.id}`)))}` : "");
      else if (k.type === "formula") detail = (k.input_fields || []).map(f => { const x = val(`inp-${k.id}-${f.id}`); return x ? `${f.label}：${toNumber(x).toLocaleString("ja-JP")}${f.unit || "円"}` : null; }).filter(Boolean).join("／");
      else if (k.type === "tier" && k.multiple_per_person) detail = Array.from(document.querySelectorAll(`#people-${k.id} .person-input`)).map((el, i) => el.value ? `${i + 1}人目 ${yen(toNumber(el.value))}` : null).filter(Boolean).join("／");
      return `<tr><td>${escapeHTML(k.name)}</td><td class="d">${escapeHTML(detail)}</td><td class="v">${yen(v)}</td></tr>`;
    }).join("");

    const zk = [
      ["調整控除", "", bd.chosei],
      ["配当控除", "", bd.haito],
      ["住宅ローン控除", selLabel("sel-jutaku-ritsu"), bd.jutaku],
      ["寄附金税額控除", kifuSummaryText(), bd.kifu],
      ["外国税額控除", "", bd.gaikoku],
      ["所得割の調整措置", "", bd.choseiSochi],
      ["配当割額等控除", "", bd.wariri]
    ].filter(r => (r[2].c + r[2].p) > 0)
     .map(r => `<tr><td>${escapeHTML(r[0])}</td><td class="d">${escapeHTML(r[1])}</td><td class="v">${yen(r[2].c)}</td><td class="v">${yen(r[2].p)}</td><td class="v">${yen(r[2].c + r[2].p)}</td></tr>`).join("")
     || `<tr><td colspan="5">（なし）</td></tr>`;

    const ts = new Date().toLocaleString("ja-JP", { hour12: false });
    printHTML(`
      <h1>令和9年度 市県民税の試算（参考値）</h1>
      <div class="meta">作成日時：${escapeHTML(ts)}／市県民税 計算支援（令和9年度・令和8年分の所得）／住所地：${escapeHTML(ZEIGAKU_LOGIC.getRegion().label || "")}</div>
      <div class="grid2">
        <div>
          <h2>所得</h2>
          <table><tr><th>区分</th><th class="v">収入金額</th><th class="v">所得金額</th></tr>${incomeRows}
            <tr class="final"><td>合計所得金額</td><td></td><td class="v">${yen(S.totalIncome)}</td></tr></table>
        </div>
        <div>
          <h2>所得控除</h2>
          <table><tr><th>控除</th><th>内容</th><th class="v">控除額</th></tr>${koujoRows}
            <tr class="final"><td>所得控除の合計</td><td></td><td class="v">${yen(S.koujoSum)}</td></tr></table>
        </div>
      </div>
      <h2>税額</h2>
      <table>
        <tr><th></th><th></th><th class="v">市民税</th><th class="v">県民税</th><th class="v">合計</th></tr>
        <tr><td>課税総所得金額</td><td class="d">千円未満切捨て</td><td></td><td></td><td class="v">${yen(S.taxableGeneral)}</td></tr>
        <tr><td>算出税額</td><td></td><td class="v">${yen(bd.sanshutu.c)}</td><td class="v">${yen(bd.sanshutu.p)}</td><td class="v">${yen(bd.sanshutu.c + bd.sanshutu.p)}</td></tr>
        ${zk}
        <tr><td>所得割</td><td class="d">100円未満切捨て</td><td class="v">${yen(bd.shotokuWari.c)}</td><td class="v">${yen(bd.shotokuWari.p)}</td><td class="v">${yen(S.shotokuWari)}</td></tr>
        <tr><td>均等割</td><td class="d">森林環境税（国税）${yen(bd.kintou.s)}を含む</td><td class="v">${yen(bd.kintou.c)}</td><td class="v">${yen(bd.kintou.p)}</td><td class="v">${yen(S.kintouWari)}</td></tr>
        ${S.kanpu > 0 ? `<tr><td>還付</td><td></td><td class="v">${yen(bd.kanpu.c)}</td><td class="v">${yen(bd.kanpu.p)}</td><td class="v">△${yen(S.kanpu)}</td></tr>` : ""}
        <tr class="final"><td>年税額の目安</td><td></td><td></td><td></td><td class="v">${S.yearTax < 0 ? "△" + yen(-S.yearTax) : yen(S.yearTax)}</td></tr>
      </table>
      <p class="note">この試算は参考値です。実際の税額は、お住まいの市区町村から届く税額決定通知書・納税通知書でご確認ください。<br>
      このアプリは個人が作成したもので、国・都道府県・市区町村の公式アプリではありません。</p>
    `);
  }

  function summaryText() {
    recalcAll();
    const S = STATE;
    const y = (n) => Math.floor(Number(n) || 0).toLocaleString("ja-JP") + "円";
    const lines = [
      "令和9年度 市県民税の試算（参考値）",
      `住所地：${ZEIGAKU_LOGIC.getRegion().label || ""}`,
      `年税額の目安：${S.yearTax < 0 ? "△" + y(-S.yearTax) + "（還付）" : y(S.yearTax)}`,
      `（所得割 ${y(S.shotokuWari)}／均等割 ${y(S.kintouWari)}）`,
      `合計所得金額：${y(S.totalIncome)}`,
      `所得控除の合計：${y(S.koujoSum)}`,
      `課税総所得金額：${y(S.taxableGeneral)}`,
      `算出税額：${y(S.sangoshu.value)}`,
      `税額控除の合計：${y(S.zeigakuKoujo)}`,
      "※実際の税額は市区町村の通知でご確認ください。"
    ];
    return lines.join("\n");
  }

  /* ============================================================
   * 寄附金：入力行（種類＋金額）
   * ============================================================ */
  const KIFU_KINDS = [
    ["furusato", "ふるさと納税（都道府県・市区町村）"],
    ["nisseki", "日本赤十字社の支部・共同募金会（住所地）"],
    ["shi", "市区町村が条例で指定した寄附（市民税分）"],
    ["ken", "都道府県が条例で指定した寄附（県民税分）"],
    ["ryo", "市・県の両方が条例で指定した寄附（10%）"],
    ["npo", "認定NPO法人（所得税のみ）"],
    ["kosha", "公益社団法人など（所得税のみ）"],
    ["seitou", "政党・政治団体（所得税のみ）"],
    ["sonota", "その他の寄附（所得税のみ）"]
  ];
  function addKifuRow(kind, amount) {
    const cont = $("kifu-rows");
    if (!cont) return;
    const row = document.createElement("div");
    row.className = "kifu-row";
    const sel = document.createElement("select");
    sel.className = "kifu-kind";
    sel.setAttribute("aria-label", "寄附の種類");
    KIFU_KINDS.forEach(p => { const op = document.createElement("option"); op.value = p[0]; op.textContent = p[1]; sel.appendChild(op); });
    if (kind) sel.value = kind;
    const amt = document.createElement("input");
    amt.type = "text";
    amt.inputMode = "numeric";
    amt.className = "num-input kifu-amount";
    amt.autocomplete = "off";
    amt.placeholder = "金額";
    amt.setAttribute("aria-label", "寄附の金額");
    if (amount != null && amount !== "") amt.value = amount;
    const unit = document.createElement("span"); unit.className = "unit"; unit.textContent = "円";
    const del = document.createElement("button");
    del.type = "button"; del.className = "btn-remove-kifu"; del.textContent = "×"; del.setAttribute("aria-label", "この寄附を削除");
    const hint = document.createElement("span"); hint.className = "amt-hint"; hint.setAttribute("aria-hidden", "true");
    del.addEventListener("click", () => {
      row.remove();
      if (!cont.querySelector(".kifu-row")) addKifuRow();
      recalcAll(); resetTimer();
    });
    sel.addEventListener("change", () => { recalcAll(); resetTimer(); });
    row.appendChild(sel); row.appendChild(amt); row.appendChild(unit); row.appendChild(del); row.appendChild(hint);
    cont.appendChild(row);
    ensureHint(amt);
    return row;
  }

  /* ============================================================
   * サンプル入力（試しに使う用）
   * ============================================================ */
  function loadSample() {
    resetForms();
    $("inp-salary").value = "4200000";
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    set("inp-shakai_hoken-amount", "620000");
    set("inp-seimei_hoken-new_ippan", "60000");
    set("inp-seimei_hoken-new_kaigo", "30000");
    const mode = $("sel-mode-haigusha"); if (mode) mode.value = "general";
    set("inp-col-haigusha", "0");
    set("inp-fuyou-tokutei", "1");
    set("inp-fuyou-nensho", "1");
    const kr = $("kifu-rows");
    kr.innerHTML = "";
    addKifuRow("furusato", "20000");
    recalcAll();
    refreshHints();
  }

  /* ============================================================
   * 税額シミュレーション（非課税ライン・ふるさと納税・未使用の控除）
   * ============================================================ */
  const yenS = (n) => (Math.round(Number(n) || 0)).toLocaleString("ja-JP") + "円";

  function buildFurusato(S) {
    const cityZ = S.cityAfterChosei || 0, prefZ = S.prefAfterChosei || 0;
    const base = cityZ + prefZ;
    const rate = (S.tokurei && S.tokurei.rate) || 84895;     // 特例控除割合（1/100,000）
    const genkaiPct = (S.tokurei && S.tokurei.shotoku) || 0;  // 所得税の限界税率（%）
    const genkai = genkaiPct / 100;
    const totalIncome = S.totalIncome || 0;
    if (base <= 0) return { ok: false, reason: "所得割が0円のため、ふるさと納税による住民税の控除はありません。" };

    const jisshitsu = (x) => {
      if (x <= 2000) return x;
      const kf = ZEIGAKU_LOGIC.calc_kifukin({ furusato: x, total_income: totalIncome, hantei_gaku: S.hanteiGaku,
                                              city_after_chosei: cityZ, pref_after_chosei: prefZ });
      const shotokuKeigen = (x - 2000) * genkai * 1.021;
      return Math.max(0, x - kf.value - shotokuKeigen);
    };
    // 実質2,000円で済む上限：特例控除が所得割の20%に届く寄附額。
    // 市・県それぞれの上限（調整控除後の所得割×20%）と、特例控除の市県の割合
    // （3/5・2/5、指定都市は4/5・1/5）から、先に上限に届くほうで決まる。
    const fr = ZEIGAKU_LOGIC.getRates().fifths;
    const capCity = Math.floor(cityZ * 20 / 100), capPref = Math.floor(prefZ * 20 / 100);
    const tokuMax = Math.min(capCity * 5 / fr.c, capPref * 5 / fr.p);
    let otoku = Math.floor(tokuMax / (rate / 100000)) + 2000;
    otoku = Math.min(otoku, Math.floor(totalIncome * 0.30));
    otoku = Math.max(2000, otoku);
    const xmax = Math.max(Math.floor(otoku * 1.6), otoku + 20000);
    const N = 80, pts = [];
    for (let i = 0; i <= N; i++) { const x = Math.round(xmax * i / N); pts.push({ x, f: jisshitsu(x) }); }
    return { ok: true, otoku, xmax, pts, current: S.kifuFurusato || 0, genkaiPct, rate };
  }

  function buildWanstop(S, F) {
    const cityZ = S.cityAfterChosei || 0, prefZ = S.prefAfterChosei || 0;
    const base = cityZ + prefZ;
    const g = ((S.tokurei && S.tokurei.shotoku) || 0) / 100;
    const rate = ((S.tokurei && S.tokurei.rate) || 84895) / 100000;
    if (F < 2001 || base <= 0) return null;
    const taisho = F - 2000;
    const kihon = Math.floor(taisho * 0.10);
    const tokuRaw = Math.floor(taisho * rate);
    // 特例控除は市・県それぞれ「調整控除後の所得割×20%」が上限
    const fr = ZEIGAKU_LOGIC.getRates().fifths;
    const tCity = Math.floor(tokuRaw * fr.c / 5), tPref = tokuRaw - tCity;
    const toku = Math.max(0, Math.min(tCity, Math.floor(cityZ * 20 / 100)) + Math.min(tPref, Math.floor(prefZ * 20 / 100)));
    const shotokuKeigen = Math.floor(taisho * g * 1.021);
    const shinkokuTotal = shotokuKeigen + kihon + toku;
    const shinkokuTokurei = rate > 0 ? Math.floor(toku * (g * 1.021) / rate) : 0;
    const wanstopTotal = kihon + toku + shinkokuTokurei;
    return {
      shinkoku: { shotoku: shotokuKeigen, juumin: kihon + toku, total: shinkokuTotal, jiko: F - shinkokuTotal },
      wanstop: { juumin: wanstopTotal, total: wanstopTotal, jiko: F - wanstopTotal },
      diff: shinkokuTotal - wanstopTotal
    };
  }

  function buildHikazei(S) {
    const j = S.hikazeiJudge || {}, inc = S.totalIncome || 0, out = [];
    if (j.shotoku_hikazei) out.push("<b>所得割は非課税</b>です。");
    else {
      const kijun = j.shotoku_kijun || 0, diff = inc - kijun;
      out.push(`いまは<b>所得割がかかります</b>（非課税になる基準 ${yenS(kijun)}）。`);
      if (diff > 0) out.push(`合計所得があと <b>${yenS(diff)}</b> 少なければ、所得割は非課税です。`);
      if (!S.hasShougaiEtc && inc <= 1350000) out.push("本人が<b>障害者・未成年・寡婦・ひとり親</b>のどれかに当てはまれば、合計所得135万円以下で非課税です<span class='sim-note'>（要件を満たす場合）</span>。");
    }
    if (j.kintou_hikazei) out.push("<b>均等割も非課税</b>です。");
    else {
      const kK = j.kintou_kijun || 0, dK = inc - kK;
      if (dK > 0) out.push(`均等割まで非課税になるのは、合計所得が ${yenS(kK)} 以下のときです（あと ${yenS(dK)}）。`);
    }
    return out.map(s => `<p>${s}</p>`).join("");
  }

  function buildMikoujo(S) {
    const kv = S.koujoValues || {};
    const zero = KOUJO_DATA.deductions.filter(k => (kv[k.id] || 0) === 0);
    if (!zero.length) return "<p>主な所得控除はひととおり入っています。</p>";
    const li = zero.map(k => `<li><b>${escapeHTML(k.name)}</b></li>`).join("");
    return `<p>次の控除はまだ0円です。当てはまるものがあれば入力すると、税額が下がります。</p><ul class="sim-koujo-list">${li}</ul>`;
  }

  function cssVar(name, fb) {
    try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb; } catch (e) { return fb; }
  }

  function drawChart(cv, fd) {
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 320, H = cv.clientHeight || 240;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const C = {
      grid: cssVar("--line", "#e3dccd"), text: cssVar("--text-2", "#4a5868"), faint: cssVar("--text-3", "#7b8592"),
      line: cssVar("--brand", "#1f4e79"), ok: cssVar("--good", "#2a7a46"), okSoft: cssVar("--good-soft", "#e3f1e7"),
      cur: cssVar("--accent", "#b55a26")
    };
    const padL = 46, padR = 12, padT = 22, padB = 36;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const xmax = fd.xmax;
    const fmax = Math.max.apply(null, fd.pts.map(p => p.f)) || 1;
    const ymax = Math.ceil(fmax / 5000) * 5000 || 5000;
    const X = (x) => padL + plotW * (x / xmax);
    const Y = (f) => padT + plotH * (1 - f / ymax);
    const font = getComputedStyle(document.body).fontFamily;

    ctx.fillStyle = C.okSoft;
    ctx.fillRect(X(0), padT, X(fd.otoku) - X(0), plotH);

    ctx.strokeStyle = C.grid; ctx.fillStyle = C.faint; ctx.lineWidth = 1;
    ctx.font = `11px ${font}`;
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const f = ymax * i / 4, y = Y(f);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(f >= 10000 ? (f / 10000) + "万" : f.toLocaleString("ja-JP"), padL - 6, y);
    }
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let k = 0; k <= 4; k++) {
      const xx = xmax * k / 4;
      ctx.fillText(xx >= 10000 ? (Math.round(xx / 1000) / 10) + "万" : Math.round(xx).toLocaleString("ja-JP"), X(xx), padT + plotH + 6);
    }
    ctx.fillStyle = C.text;
    ctx.fillText("ふるさと納税の額（円）", padL + plotW / 2, padT + plotH + 20);

    ctx.strokeStyle = C.faint; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(X(0), Y(2000)); ctx.lineTo(X(xmax), Y(2000)); ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = C.line; ctx.lineWidth = 2.4; ctx.beginPath();
    fd.pts.forEach((p, idx) => { const x = X(p.x), y = Y(p.f); if (idx) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();

    ctx.strokeStyle = C.ok; ctx.lineWidth = 1.6; ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(X(fd.otoku), padT); ctx.lineTo(X(fd.otoku), padT + plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.ok; ctx.font = `bold 11px ${font}`; ctx.textBaseline = "bottom";
    const ox = Math.min(Math.max(X(fd.otoku), padL + 50), W - padR - 50);
    ctx.fillText("上限の目安 " + Math.round(fd.otoku).toLocaleString("ja-JP") + "円", ox, padT - 4);

    if (fd.current > 0 && fd.current <= xmax) {
      const cx = X(fd.current);
      ctx.strokeStyle = C.cur; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, padT + plotH); ctx.stroke();
      // 上限の目安のラベル（上）と重ならないよう、グラフの中ほどに置く
      ctx.fillStyle = C.cur; ctx.textBaseline = "middle";
      const label = "入力中 " + fd.current.toLocaleString("ja-JP");
      const tw = ctx.measureText(label).width;
      const leftSide = cx - 6 - tw > padL + 4;
      ctx.textAlign = leftSide ? "right" : "left";
      ctx.fillText(label, leftSide ? cx - 6 : cx + 6, padT + plotH * 0.42);
      ctx.textAlign = "center";
    }
  }

  function buildTaxSim() {
    recalcAll();
    const S = STATE;
    if ((S.totalIncome || 0) <= 0) return { html: "<div class='sim-section'><p>先に「所得」の画面で収入を入力してください。</p></div>", after: null };
    const fd = buildFurusato(S);
    const sum = `<div class='sim-grid'>
      <div><span>合計所得</span><b>${yenS(S.totalIncome)}</b></div>
      <div><span>課税総所得</span><b>${yenS(S.taxableGeneral)}</b></div>
      <div><span>所得割</span><b>${yenS(S.shotokuWari)}</b></div>
      <div><span>均等割</span><b>${yenS(S.kintouWari)}</b></div>
      <div class='sim-grid-total'><span>年税額の目安</span><b>${yenS(S.yearTax)}</b></div></div>`;

    let furuHtml;
    if (fd.ok) {
      const compareF = (fd.current && fd.current >= 2000) ? fd.current : fd.otoku;
      const ws = buildWanstop(S, compareF);
      const wsLabel = (fd.current && fd.current >= 2000) ? `入力中のふるさと納税 ${yenS(compareF)}` : `上限の目安 ${yenS(compareF)} まで寄附した場合`;
      let wanstopHtml = "";
      if (ws) {
        wanstopHtml = `<p style="margin-top:12px"><b>ワンストップ特例と申告の比較</b> <span class="sim-note">（${escapeHTML(wsLabel)}）</span></p>
          <div class="sim-ws-wrap"><table class="sim-ws-table">
          <tr><th></th><th>申告</th><th>ワンストップ</th></tr>
          <tr><td>所得税の軽減</td><td>${yenS(ws.shinkoku.shotoku)}</td><td>—</td></tr>
          <tr><td>住民税の軽減</td><td>${yenS(ws.shinkoku.juumin)}</td><td>${yenS(ws.wanstop.juumin)}</td></tr>
          <tr><td>軽減の合計</td><td><b>${yenS(ws.shinkoku.total)}</b></td><td><b>${yenS(ws.wanstop.total)}</b></td></tr>
          <tr><td>自己負担</td><td>${yenS(ws.shinkoku.jiko)}</td><td>${yenS(ws.wanstop.jiko)}</td></tr></table></div>`;
        wanstopHtml += ws.diff > 100
          ? `<p class="sim-note">この額だと<b>申告したほうが約${yenS(ws.diff)}有利</b>です（特例控除が所得割の20%の上限を超えるため）。</p>`
          : `<p class="sim-note">この額なら、どちらでも自己負担はほぼ2,000円です。</p>`;
        wanstopHtml += `<p class="sim-note">確定申告や住民税の申告をすると、ワンストップ特例は使えなくなります。申告書にはふるさと納税をすべて書いてください。</p>`;
      }
      furuHtml = `<p>今の入力内容では、<b>自己負担2,000円</b>で寄附できる目安は <b class="sim-hl">${Math.round(fd.otoku).toLocaleString("ja-JP")}円</b> までです。これを超えた分は控除されず、自己負担になります。</p>
        <canvas id="sim-furu-canvas" class="sim-canvas" role="img" aria-label="ふるさと納税の額と実質負担のグラフ"></canvas>
        <p class="sim-note">緑の帯：自己負担2,000円で収まる範囲／青い線：実質の負担額（所得税の軽減を含む概算）／橙の線：入力中の額。特例控除割合 ${(fd.rate / 1000).toFixed(3)}%。</p>
        ${wanstopHtml}`;
    } else {
      furuHtml = `<p>${escapeHTML(fd.reason)}</p>`;
    }

    const html =
      `<div class="sim-section"><h3>今の試算</h3>${sum}</div>` +
      `<div class="sim-section"><h3>非課税になるライン</h3>${buildHikazei(S)}</div>` +
      `<div class="sim-section"><h3>ふるさと納税の目安</h3>${furuHtml}</div>` +
      `<div class="sim-section"><h3>まだ使っていない控除</h3>${buildMikoujo(S)}</div>` +
      `<div class="sim-disclaimer">住民税をもとにした概算です。実際の控除の限度額や税額は、所得税の申告内容や各種の要件によって変わります。令和9年中のふるさと納税（令和10年度分）からは、特例控除額に193万円の上限ができます。</div>`;
    const after = fd.ok ? () => { const cv = $("sim-furu-canvas"); if (cv) requestAnimationFrame(() => drawChart(cv, fd)); } : null;
    return { html, after };
  }

  /* ============================================================
   * 起動・イベント
   * ============================================================ */
  function init() {
    renderKoujoForms();
    addKifuRow();
    renderAllExpenseBlocks();
    decorateNumInputs(document);

    // 数字欄：全角→半角・数字以外を除去（入力の直後に）
    document.addEventListener("input", (e) => {
      const t = e.target;
      if (t && t.matches && t.matches("input.num-input")) {
        const before = t.value;
        const after = normalizeDigits(before).replace(/^0+(?=\d)/, "");
        if (after !== before) t.value = after;
        ensureHint(t);
      }
    }, true);

    document.addEventListener("input", (e) => {
      if (e.target.matches('.expense-add-form [data-role="desc"]')) {
        handleExpenseDescInput(e.target.closest(".expense-add-form"));
        return;
      }
      if (e.target.closest(".expense-add-form")) return;   // レシート入力欄は計算に直結しない
      if (e.target.matches('input.num-input, input[type="date"], input[type="text"]')) {
        recalcAll();
        resetTimer();
      }
    });
    document.addEventListener("change", (e) => {
      if (e.target.matches('.expense-add-form [data-role="category"]')) {
        handleExpenseCategoryChange(e.target.closest(".expense-add-form"));
        return;
      }
      if (e.target.matches('input[type="checkbox"], select, input[type="radio"]')) {
        recalcAll();
        resetTimer();
      }
    });

    // 青色申告特別控除のボタン
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-aoiro-target]");
      if (!btn) return;
      const inp = $(btn.getAttribute("data-aoiro-target"));
      if (inp) {
        inp.value = btn.getAttribute("data-aoiro-value") === "0" ? "" : btn.getAttribute("data-aoiro-value");
        ensureHint(inp);
        recalcAll();
        resetTimer();
      }
    });

    // 経費内訳のボタン
    document.addEventListener("click", (e) => {
      const typeOf = (el) => {
        const block = el.closest("[data-expense-type]");
        const key = block && block.getAttribute("data-expense-type");
        return EXPENSE_TYPES.find(t => t.key === key);
      };
      const addBtn = e.target.closest('.expense-add-form [data-role="add"]');
      if (addBtn) { const t = typeOf(addBtn); if (t) addExpenseRow(t); return; }
      const delBtn = e.target.closest("button[data-delete-id]");
      if (delBtn) { const t = typeOf(delBtn); if (t) deleteExpenseRow(t, Number(delBtn.getAttribute("data-delete-id"))); return; }
      const applyBtn = e.target.closest('.expense-summary [data-role="apply"]');
      if (applyBtn) { const t = typeOf(applyBtn); if (t) applyExpenseToField(t); return; }
      const csvBtn = e.target.closest('.expense-summary [data-role="export-csv"]');
      if (csvBtn) { const t = typeOf(csvBtn); if (t) exportExpenseCSV(t); return; }
      const prtBtn = e.target.closest('.expense-summary [data-role="print"]');
      if (prtBtn) { const t = typeOf(prtBtn); if (t) printExpenseView(t); return; }
    });

    const addKifuBtn = $("btn-add-kifu");
    if (addKifuBtn) addKifuBtn.addEventListener("click", () => {
      const row = addKifuRow();
      const inp = row && row.querySelector(".kifu-amount");
      if (inp) inp.focus();
    });

    const loader = $("json-loader");
    if (loader) loader.addEventListener("change", function () { loadJSONFile(this.files[0]); this.value = ""; });

    recalcAll();
  }

  // 公開（スマホ画面の制御スクリプトから使う）
  window.APP = {
    STATE,
    recalcAll,
    clearAll,
    exportState,
    importState,
    downloadJSON,
    loadJSONFile,
    printAllSummary,
    summaryText,
    loadSample,
    buildTaxSim,
    refreshHints,
    showToast,
    manYen,
    init
  };
  window.clearAll = clearAll;
  window.downloadJSON = downloadJSON;
  window.loadJSONFile = loadJSONFile;
  window.printAllSummary = printAllSummary;
  window.addKifuRow = addKifuRow;
})();
