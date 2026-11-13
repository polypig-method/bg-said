/* BG Said — front end. Reads data/latest.json written by engine/bgsaid.py. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const TH_M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const SECTOR_TH = {
  "Information Technology": "เทคโนโลยี", "Financials": "การเงิน", "Health Care": "สุขภาพ",
  "Consumer Discretionary": "สินค้าฟุ่มเฟือย", "Consumer Staples": "สินค้าจำเป็น", "Industrials": "อุตสาหกรรม",
  "Energy": "พลังงาน", "Materials": "วัสดุ", "Utilities": "สาธารณูปโภค", "Real Estate": "อสังหาฯ",
  "Communication Services": "สื่อสาร",
};
const CHECKS = [
  ["stable", "กำไรสม่ำเสมอ", "EPS บวกทุกปีที่มีข้อมูล"],
  ["liquidity", "สภาพคล่อง", "Current ratio ≥ 1.5"],
  ["debt", "หนี้ต่ำ", "Debt/Equity ≤ 1.0"],
  ["dividend", "จ่ายปันผล", "มีเงินปันผล"],
  ["pe", "P/E ≤ 15", "ไม่แพงเกินไปเทียบกำไร"],
  ["pepb", "P/E × P/B ≤ 22.5", "เกณฑ์ Graham Number"],
];

let D = null;               // latest.json
let HIST = [];              // history.json
let sortKey = "mos", sortAsc = false;

const thDate = iso => { const d = new Date(iso + "T12:00:00"); return `${d.getDate()} ${TH_M[d.getMonth()]} ${d.getFullYear() + 543}`; };
const usd = v => v == null ? "—" : "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v, d = 0) => v == null ? "—" : (v * 100).toFixed(d) + "%";
const fx = (v, d = 1) => v == null ? "—" : Number(v).toFixed(d);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sec = s => SECTOR_TH[s] || s;
const dots = x => `<span class="dots" title="คุณภาพ ${x.quality}/6">${CHECKS.map(([k]) => `<i class="${x.checks[k] ? "on" : ""}"></i>`).join("")}</span>`;

/* ---------- load ---------- */
async function load() {
  try {
    const [a, b] = await Promise.all([
      fetch("data/latest.json", { cache: "no-cache" }).then(r => r.json()),
      fetch("data/history.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : []).catch(() => []),
    ]);
    D = a; HIST = b;
  } catch (e) {
    $("#meta").textContent = "โหลดข้อมูลไม่สำเร็จ";
    $("#top5").innerHTML = `<div class="empty">ยังไม่มีข้อมูล — รอรอบอัปเดตหลังตลาดปิด</div>`;
    return;
  }
  D.bySym = Object.fromEntries(D.stocks.map(x => [x.sym, x]));
  $("#meta").innerHTML = `${thDate(D.market_date)}<br>AAA ${D.aaa_yield.toFixed(2)}%`;
  renderToday(); initAll(); initLab(); renderHist();
  $("#src").textContent = `อัปเดต ${new Date(D.generated_at).toLocaleString("th-TH")} · ${D.stats.fetched}/${D.stats.universe} หุ้น · AAA ณ ${D.aaa_date}`;
}

/* ---------- today ---------- */
function card(x, i) {
  const ratio = x.value ? Math.max(0, Math.min(1, x.price / x.value)) : 0;
  return `<button class="card" data-sym="${x.sym}">
    <div class="rank">${i + 1}</div>
    <div class="who"><div class="sym">${x.sym}</div><div class="nm">${esc(x.name)}</div><div class="sec">${sec(x.sector)}</div></div>
    <div class="mosbox"><div class="mos">${pct(x.mos)}</div><div class="lbl">ต่ำกว่ามูลค่า</div></div>
    <div class="bar"><div class="track"><div class="fill" style="width:${(ratio * 100).toFixed(1)}%"></div></div>
      <div class="legend"><span>ราคา <b>${usd(x.price)}</b></span><span>มูลค่า Graham <b>${usd(x.value)}</b></span></div></div>
    <div class="facts">${dots(x)}<span>g ${fx(x.g)}%</span><span>P/E ${fx(x.pe)}</span><span>P/B ${fx(x.pb, 2)}</span>${x.div_yield ? `<span>ปันผล ${pct(x.div_yield, 1)}</span>` : ""}</div>
  </button>`;
}
function renderToday() {
  $("#top5").innerHTML = D.top5.length ? D.top5.map(card).join("") : `<div class="empty">วันนี้ไม่มีหุ้นที่ผ่านเกณฑ์</div>`;
  const p = D.params;
  $("#formulaStrip").innerHTML = `<b>V = EPS × (8.5 + 2g) × 4.4 ÷ ${D.aaa_yield.toFixed(2)}</b><br>g = ค่าต่ำกว่าระหว่างการเติบโตย้อนหลังกับคาดการณ์ (${p.g_min}–${p.g_max}%) · คุณภาพ ≥ ${p.min_quality}/6 · ไม่เกิน ${p.max_per_sector ?? 2} ตัวต่อกลุ่ม`;
  const s = D.stats;
  $("#stats").innerHTML = [
    [s.fetched, "หุ้นที่สแกน"], [s.undervalued, "ต่ำกว่ามูลค่า"],
    [D.stocks.filter(x => x.mos > 0 && x.quality >= p.min_quality && x.checks.stable).length, "ผ่านเกณฑ์คุณภาพ"],
  ].map(([v, k]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join("");
}

/* ---------- all ---------- */
function initAll() {
  const sectors = [...new Set(D.stocks.map(x => x.sector))].sort();
  $("#sector").innerHTML = `<option value="">ทุกกลุ่ม</option>` + sectors.map(s => `<option value="${esc(s)}">${sec(s)}</option>`).join("");
  ["q", "sector", "qual"].forEach(id => $("#" + id).addEventListener("input", renderAll));
  $$("#tbl th").forEach(th => th.addEventListener("click", () => {
    const k = th.dataset.k;
    if (sortKey === k) sortAsc = !sortAsc; else { sortKey = k; sortAsc = k === "sym" || k === "pe"; }
    renderAll();
  }));
  renderAll();
}
function renderAll() {
  const q = $("#q").value.trim().toLowerCase(), s = $("#sector").value, mq = +$("#qual").value;
  let rows = D.stocks.filter(x => (!s || x.sector === s) && x.quality >= mq &&
    (!q || x.sym.toLowerCase().includes(q) || (x.name || "").toLowerCase().includes(q)));
  rows.sort((a, b) => {
    const A = a[sortKey], B = b[sortKey];
    if (A == null && B == null) return 0; if (A == null) return 1; if (B == null) return -1;
    const r = typeof A === "string" ? A.localeCompare(B) : A - B;
    return sortAsc ? r : -r;
  });
  $$("#tbl th").forEach(th => { th.classList.toggle("sorted", th.dataset.k === sortKey); th.classList.toggle("asc", sortAsc); });
  $("#tbl tbody").innerHTML = rows.map(x => `<tr data-sym="${x.sym}">
    <td><span class="s">${x.sym}</span><span class="n">${esc(x.name)}</span></td>
    <td class="num ${x.mos == null ? "na" : x.mos > 0 ? "pos" : "neg"}">${pct(x.mos)}</td>
    <td class="num">${usd(x.price)}</td><td class="num">${usd(x.value)}</td>
    <td class="num">${fx(x.g)}</td><td class="num">${fx(x.pe)}</td><td class="num">${x.quality}</td></tr>`).join("");
  $("#allCount").textContent = `${rows.length} หุ้น · แตะเพื่อดูการคำนวณ`;
}

/* ---------- detail sheet ---------- */
function openSheet(sym) {
  const x = D.bySym[sym]; if (!x) return;
  const Y = D.aaa_yield;
  const eh = x.eps_hist || [];
  const mx = Math.max(...eh.map(Math.abs), 0.01);
  const calc = x.value != null
    ? `V = ${fx(x.eps, 2)} × (8.5 + 2×${fx(x.g)}) × 4.4 ÷ ${Y.toFixed(2)}<br>
       &nbsp;&nbsp;= ${fx(x.eps, 2)} × ${fx(8.5 + 2 * x.g, 1)} × ${(4.4 / Y).toFixed(3)}<br>
       <span class="res">= ${usd(x.value)}</span> &nbsp;vs ราคา ${usd(x.price)} → MOS <b class="${x.mos > 0 ? "pos" : "neg"}">${pct(x.mos, 1)}</b>`
    : `คำนวณไม่ได้ — ${x.eps == null ? "ไม่มีข้อมูล EPS" : x.eps <= 0 ? "EPS ติดลบ (ขาดทุน)" : "ไม่มีข้อมูลการเติบโต"}`;
  const flags = (x.flags || []).map(f => ({
    g_capped: "g ถูกจำกัดที่ 15%", balance_na: "กลุ่มนี้ไม่วัดสภาพคล่อง/หนี้", mos_outlier: "MOS สูงผิดปกติ ตรวจข้อมูลก่อน",
  }[f])).filter(Boolean).map(t => `<span class="flag">${t}</span>`).join("");
  $("#sheetBody").innerHTML = `
    <div class="sh-head"><div><div class="sym">${x.sym}</div><div class="nm">${esc(x.name)} · ${sec(x.sector)}</div></div>
      <button class="close" aria-label="ปิด">×</button></div>
    ${flags ? `<div style="margin-top:8px">${flags}</div>` : ""}
    <div class="calc">${calc}</div>
    <div class="kv">
      <div><div class="k">EPS (TTM)</div><div class="v">${fx(x.eps, 2)}</div></div>
      <div><div class="k">EPS ปีหน้า (คาด)</div><div class="v">${fx(x.fwd_eps, 2)}</div></div>
      <div><div class="k">Graham Number</div><div class="v">${usd(x.graham_number)}</div></div>
      <div><div class="k">โตย้อนหลัง</div><div class="v">${fx(x.hist_g)}%</div></div>
      <div><div class="k">โตปีหน้า</div><div class="v">${fx(x.fwd_g)}%</div></div>
      <div><div class="k">g ที่ใช้</div><div class="v">${fx(x.g)}%</div></div>
      <div><div class="k">P/E</div><div class="v">${fx(x.pe)}</div></div>
      <div><div class="k">P/B</div><div class="v">${fx(x.pb, 2)}</div></div>
      <div><div class="k">ปันผล</div><div class="v">${pct(x.div_yield, 1)}</div></div>
    </div>
    ${eh.length ? `<h3>EPS รายปี</h3>
      <div class="epsbars">${eh.map(v => `<div class="${v < 0 ? "neg" : ""}" style="height:${(Math.abs(v) / mx * 100).toFixed(0)}%"></div>`).join("")}</div>
      <div class="epslbl">${eh.map(v => `<span>${fx(v, 2)}</span>`).join("")}</div>` : ""}
    <h3>เกณฑ์คุณภาพ ${x.quality}/6</h3>
    <ul class="clist">${CHECKS.map(([k, t, d]) => `<li><span class="ic ${x.checks[k] ? "ok" : "no"}">${x.checks[k] ? "✓" : "✗"}</span><span><b>${t}</b> <span class="hint">${d}</span></span></li>`).join("")}</ul>
    <div class="links">
      <a href="https://finance.yahoo.com/quote/${x.sym.replace(".", "-")}" target="_blank" rel="noopener">Yahoo Finance ↗</a>
      <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${x.sym}&type=10-K" target="_blank" rel="noopener">งบ 10-K (SEC) ↗</a>
    </div>`;
  $("#sheet").showModal();
  $(".close", $("#sheet")).onclick = () => $("#sheet").close();
}
$("#sheet").addEventListener("click", e => { if (e.target.id === "sheet") e.target.close(); });
document.addEventListener("click", e => {
  const el = e.target.closest("[data-sym]");
  if (el && D) openSheet(el.dataset.sym);
});

/* ---------- lab ---------- */
const LAB_KEY = "bgsaid.lab";
function labDefaults() { return { gmax: D.params.g_max, y: D.aaa_yield, base: 8.5, minq: D.params.min_quality, useFwd: true }; }
function initLab() {
  let st = labDefaults();
  try { Object.assign(st, JSON.parse(localStorage.getItem(LAB_KEY) || "{}"), { y: labDefaults().y }); } catch (e) {}
  const set = s => { $("#gmax").value = s.gmax; $("#yv").value = s.y; $("#base").value = s.base; $("#minq").value = s.minq; $("#useFwd").checked = s.useFwd; };
  set(st);
  ["gmax", "yv", "base", "minq", "useFwd"].forEach(id => $("#" + id).addEventListener("input", runLab));
  $("#reset").onclick = () => { set(labDefaults()); runLab(); };
  runLab();
}
function runLab() {
  const gmax = +$("#gmax").value, Y = +$("#yv").value, base = +$("#base").value, minq = +$("#minq").value, useFwd = $("#useFwd").checked;
  $("#o-gmax").textContent = gmax + "%"; $("#o-y").textContent = Y.toFixed(2) + "%";
  $("#o-base").textContent = base; $("#o-minq").textContent = minq + "/6";
  try { localStorage.setItem(LAB_KEY, JSON.stringify({ gmax, base, minq, useFwd })); } catch (e) {}
  const rows = D.stocks.map(x => {
    const parts = [x.hist_g, useFwd ? x.fwd_g : null].filter(v => v != null);
    if (!(x.eps > 0) || !parts.length) return null;
    const g = Math.max(0, Math.min(gmax, Math.min(...parts)));
    const value = x.eps * (base + 2 * g) * 4.4 / Y;
    return { ...x, g, value, mos: (value - x.price) / value };
  }).filter(x => x && x.mos > 0 && x.mos <= D.params.mos_sanity && x.checks.stable && x.quality >= minq)
    .sort((a, b) => b.mos - a.mos);
  const per = {}, top = [];
  for (const x of rows) { if ((per[x.sector] || 0) < (D.params.max_per_sector ?? 2)) { top.push(x); per[x.sector] = (per[x.sector] || 0) + 1; } if (top.length === 5) break; }
  $("#labTop").innerHTML = top.length ? top.map((x, i) => card(x, i)).join("") : `<div class="empty">ไม่มีหุ้นผ่านเงื่อนไขนี้</div>`;
}

/* ---------- history ---------- */
function renderHist() {
  if (!HIST.length) { $("#hist").innerHTML = `<div class="empty">ยังไม่มีประวัติ</div>`; return; }
  $("#hist").innerHTML = HIST.slice().reverse().map(d => `<div class="day"><div class="d">${thDate(d.date)} · AAA ${d.aaa.toFixed(2)}%</div>
    <div class="chips">${d.top5.map(t => `<button class="chip" ${D.bySym[t.sym] ? `data-sym="${t.sym}"` : ""}>${t.sym}<small>${pct(t.mos)}</small></button>`).join("")}</div></div>`).join("");
}

/* ---------- tabs ---------- */
function show(v) {
  $$(".view").forEach(s => s.hidden = s.id !== "v-" + v);
  $$(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  if (location.hash.slice(1) !== v) history.replaceState(null, "", "#" + v);
  window.scrollTo(0, 0);
}
$$(".tabs button").forEach(b => b.addEventListener("click", () => show(b.dataset.v)));
window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (["today", "all", "lab", "hist", "about"].includes(v)) show(v); });
show(["today", "all", "lab", "hist", "about"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "today");

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
load();
