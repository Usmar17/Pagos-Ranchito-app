// Pagos PWA (offline) - edición local + export/import
const STORAGE_KEY = "pagos_app_v1_data";
const BASE_URL = "./data.json";

let baseData = null;
let state = { records: [], columns: [] };

function isPaid(v){
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toUpperCase();
  return s === "PAGADO" || s === "PAGADA" || s === "PAGÓ" || s === "PAGO";
}

function toNumber(v){
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[^0-9.,-]/g,"").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function computeOwnerSummary(records){
  const byOwner = new Map();
  for (const r of records){
    const owner = r.propietario || "(Sin nombre)";
    if (!byOwner.has(owner)) byOwner.set(owner, {owner, rows:0, paid:0, pending:0, sumPending:0});
    const o = byOwner.get(owner);
    o.rows += 1;

    const rowTotal = toNumber(r["TOTALES"]);
    const rowPaid = isPaid(r["TOTALES"]) || (rowTotal !== null && rowTotal === 0);

    if (rowPaid){
      o.paid += 1;
    } else {
      o.pending += 1;
      if (rowTotal !== null) o.sumPending += rowTotal;
    }
  }
  return Array.from(byOwner.values()).sort((a,b)=> (b.sumPending - a.sumPending));
}

async function loadBase(){
  const res = await fetch(BASE_URL, {cache:"no-store"});
  baseData = await res.json();
  state.columns = baseData.columns || [];
  state.records = baseData.records || [];
}

function loadLocal(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try{
    const parsed = JSON.parse(raw);
    if (parsed && parsed.records) {
      state = parsed;
      return true;
    }
  }catch(e){}
  return false;
}

function saveLocal(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function resetToBase(){
  state = { records: structuredClone(baseData.records), columns: structuredClone(baseData.columns) };
  saveLocal();
  render();
}

function uniqOwners(records){
  const set = new Set(records.map(r=> (r.propietario||"").trim()).filter(Boolean));
  return ["(Todos)", ...Array.from(set).sort((a,b)=>a.localeCompare(b,'es'))];
}

function el(id){ return document.getElementById(id); }

function render(){
  const q = (el("q").value || "").trim().toLowerCase();
  const ownerFilter = el("filterOwner").value || "(Todos)";

  let rows = state.records.slice();
  if (ownerFilter !== "(Todos)") rows = rows.filter(r => (r.propietario||"") === ownerFilter);
  if (q) rows = rows.filter(r => String(r.propietario||"").toLowerCase().includes(q));

  const grouped = new Map();
  for (const r of rows){
    const owner = r.propietario || "(Sin nombre)";
    if (!grouped.has(owner)) grouped.set(owner, []);
    grouped.get(owner).push(r);
  }

  const cards = el("cards");
  cards.innerHTML = "";
  for (const [owner, items] of Array.from(grouped.entries()).sort((a,b)=>a[0].localeCompare(b[0],'es'))){
    const sum = items.reduce((acc, it)=>{
      const t = toNumber(it["TOTALES"]);
      if (t !== null && t > 0) acc.pending += 1;
      if (t !== null && t === 0) acc.paid += 1;
      if (isPaid(it["TOTALES"])) acc.paid += 1;
      return acc;
    }, {pending:0, paid:0});

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${escapeHtml(owner)}</h3>
      <div class="meta">
        <span class="badge">${items.length} registro(s)</span>
        <span class="badge">Pendientes aprox: ${sum.pending}</span>
      </div>
      <div class="list">
        ${items.map(r => `
          <div class="item">
            <div>
              <b>NP ${escapeHtml(String(r.np))}</b><br/>
              <small>TOTAL: ${formatMoney(r["TOTALES"])}</small>
            </div>
            <button class="secondary" data-edit="${r.np}">Ver / Editar</button>
          </div>
        `).join("")}
      </div>
    `;
    cards.appendChild(card);
  }

  cards.querySelectorAll("[data-edit]").forEach(btn=>{
    btn.addEventListener("click", ()=> openEditor(Number(btn.getAttribute("data-edit"))));
  });

  const owners = uniqOwners(state.records);
  const totalRecords = state.records.length;
  const ownersCount = owners.length - 1;

  const summary = el("summary");
  summary.innerHTML = `
    <span class="badge">Propietarios: <b>${ownersCount}</b></span>
    <span class="badge">Registros: <b>${totalRecords}</b></span>
    <span class="badge">Edición local: <b>Activa</b></span>
  `;

  const top = el("topDebtors");
  const ownerSummary = computeOwnerSummary(state.records).slice(0,6);
  top.innerHTML = `<div class="hint"><b>Top pendientes</b> (aprox. con base en “TOTALES”)</div>` +
    ownerSummary.map(o => `
      <div class="item">
        <div>
          <b>${escapeHtml(o.owner)}</b><br/>
          <small>Pendientes: ${o.pending} • Suma pendientes: ${money(o.sumPending)}</small>
        </div>
      </div>
    `).join("");
}

function money(n){
  try{ return new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(n); }
  catch(e){ return "$"+Number(n||0).toFixed(2); }
}

function formatMoney(v){
  if (v === null || v === undefined) return "-";
  if (isPaid(v)) return "PAGADO";
  const n = toNumber(v);
  if (n === null) return escapeHtml(String(v));
  return money(n);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

// ===== Editor =====
let editingNP = null;

function openEditor(np){
  editingNP = np;
  const rec = state.records.find(r=>r.np===np);
  if (!rec) return;

  el("modal").style.display = "flex";
  el("modalTitle").textContent = `NP ${np} • ${rec.propietario || ""}`;

  const form = el("form");
  form.innerHTML = "";

  const fields = [
    {key:"propietario", label:"PROPIETARIO"},
    ...state.columns.map(c=>({key:c, label:c}))
  ];

  for (const f of fields){
    const wrap = document.createElement("div");
    const val = rec[f.key] ?? "";
    wrap.innerHTML = `
      <div class="field">
        <label>${escapeHtml(f.label)}</label>
        <input data-k="${escapeHtml(f.key)}" value="${escapeHtml(String(val))}" />
      </div>
    `;
    form.appendChild(wrap);
  }

  el("modalHint").innerHTML = "Tip: escribe <b>PAGADO</b> o un monto. Los cambios se guardan en el teléfono.";
}

function closeEditor(){
  el("modal").style.display = "none";
  editingNP = null;
}

function saveEditor(){
  const rec = state.records.find(r=>r.np===editingNP);
  if (!rec) return;
  el("form").querySelectorAll("input[data-k]").forEach(inp=>{
    const k = inp.getAttribute("data-k");
    const v = inp.value;
    rec[k] = (v.trim()==="") ? null : v;
  });
  saveLocal();
  closeEditor();
  render();
}

function deleteRecord(){
  if (editingNP === null) return;
  state.records = state.records.filter(r=>r.np!==editingNP);
  saveLocal();
  closeEditor();
  render();
}

function newRecord(){
  const max = state.records.reduce((m,r)=> Math.max(m, Number(r.np)||0), 0);
  const np = max + 1;
  const rec = { np, propietario: "" };
  for (const c of state.columns) rec[c] = null;
  state.records.push(rec);
  saveLocal();
  openEditor(np);
}

// ===== Export / Import =====
function exportJSON(){
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pagos_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJSON(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const parsed = JSON.parse(reader.result);
      if (!parsed || !parsed.records || !Array.isArray(parsed.records)) throw new Error("Formato inválido");
      state = parsed;
      saveLocal();
      render();
      alert("Importación lista ✅");
    }catch(e){
      alert("No se pudo importar: " + e.message);
    }
  };
  reader.readAsText(file);
}

// ===== Service worker =====
async function registerSW(){
  if (!("serviceWorker" in navigator)) return;
  try{ await navigator.serviceWorker.register("./sw.js"); }catch(e){}
}

async function init(){
  await loadBase();
  if (!loadLocal()){
    resetToBase();
  }

  const ownerSel = el("filterOwner");
  function refreshOwnerOptions(){
    const owners = uniqOwners(state.records);
    ownerSel.innerHTML = owners.map(o=>`<option>${escapeHtml(o)}</option>`).join("");
  }
  refreshOwnerOptions();

  el("q").addEventListener("input", render);
  ownerSel.addEventListener("change", render);
  el("btnExport").addEventListener("click", exportJSON);
  el("btnReset").addEventListener("click", ()=>{
    if (confirm("¿Reiniciar a la versión original del Excel? Se perderán cambios locales.")) resetToBase();
    refreshOwnerOptions();
  });
  el("fileImport").addEventListener("change", (e)=>{
    const file = e.target.files?.[0];
    if (file) importJSON(file);
    e.target.value = "";
    refreshOwnerOptions();
  });
  el("btnNew").addEventListener("click", ()=>{
    newRecord();
    refreshOwnerOptions();
  });

  el("btnClose").addEventListener("click", closeEditor);
  el("btnSave").addEventListener("click", saveEditor);
  el("btnDelete").addEventListener("click", ()=>{
    if (confirm("¿Eliminar este registro?")) deleteRecord();
  });
  el("modal").addEventListener("click", (e)=>{
    if (e.target.id === "modal") closeEditor();
  });

  render();
  registerSW();
}

init();
