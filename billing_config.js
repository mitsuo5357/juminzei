/* ============================================================
 * billing_config.js — シミュレーション（節税のヒント）の課金の設定
 *
 * ★公開する前に、YOUR_… のところを実際の値に書き換えてください。
 * ★書き換えたら sw.js の CACHE の番号も上げてください（利用者の端末に届くように）。
 * ============================================================ */
window.BILLING_CONFIG = {
  // false にすると課金をやめて、シミュレーションを全員に無料で開放します
  // （兼業許可が切れたときなど。売るのを止めるには Play Console でアイテムを「無効」にします）
  enabled: true,

  // Play Console で作るアプリ内アイテム（1回限りのアイテム）の ID。あとから変えられません
  productId: "sim_unlock",

  // 購入確認サーバー（server/worker.js を Cloudflare Workers に置いたもの）の URL
  verifyUrl: "https://juminzei-billing.YOUR_SUBDOMAIN.workers.dev/verify",

  // ブラウザで開いた人に案内する Google Play のページ
  playStoreUrl: "https://play.google.com/store/apps/details?id=io.github.YOUR_GITHUB_NAME.juminzei",

  // 特定商取引法に基づく表記のページ
  tokushohoUrl: "tokushoho.html",

  // true にすると、ブラウザ（iPhone・パソコンなど）ではシミュレーションを無料で使えます。
  // ただし Android の人もブラウザで開けば使えてしまうので、ふつうは false のままで。
  freeOnWeb: false
};
