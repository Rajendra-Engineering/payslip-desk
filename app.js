/* Payslip Desk – Firebase layer: Google login, roles, shared settings, month lock / Final, records, archive. */
import { firebaseConfig, MAIN_OWNER } from "./firebase-config.js";

const FB_VER = "10.12.2";
const params = new URLSearchParams(location.search);
const MOCK = params.get("mock") && ["localhost","127.0.0.1","app"].includes(location.hostname);
const MAX_MANAGERS = 5;
const KEEP_MONTHS = 12;

let DB = null;                 // data adapter (Firebase or in-memory mock for local testing)
const me = { email:"", name:"", role:"" };   // role: main | owner | manager
const cache = { masters:{}, monthDoc:null, ctxKey:"", mailer:{}, users:[], months:[], logs:[] };
const ui = { tab:"payslips", finalAsk:false, recBusy:null, recMsg:"", archive:null, peopleMsg:"", coMsg:"" };

const H = window.PSD_HOOKS;
const $ = s => document.querySelector(s);
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const isOwner = () => me.role==="main" || me.role==="owner";
const ymOf = (y,m) => `${y}-${String(m).padStart(2,"0")}`;
const ymLabel = ym => { const [y,m]=ym.split("-").map(Number); return `${MONTHS[m-1]} ${y}`; };
const curYm = () => ymOf(state.y, state.m);
const when = iso => { if(!iso) return ""; const d=new Date(iso); return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})+" "+d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}); };
function toast(msg, bad){ const t=$("#toast"); t.textContent=msg; t.className="toast show"+(bad?" bad":""); clearTimeout(toast._t); toast._t=setTimeout(()=>t.className="toast",4200); }
const fail = (what) => (err) => { console.error(err); toast(`${what}: ${err && err.code==="permission-denied" ? "you don't have permission for this." : (err && err.message) || err}`, true); };

/* ---------------- Data adapters ---------------- */
async function firebaseAdapter(){
  const base = `https://www.gstatic.com/firebasejs/${FB_VER}`;
  const [{ initializeApp }, A, F] = await Promise.all([ import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`), import(`${base}/firebase-firestore.js`) ]);
  const app = initializeApp(firebaseConfig); const auth = A.getAuth(app); const db = F.getFirestore(app);
  const ref = p => F.doc(db, ...p.split("/"));
  const col = p => F.collection(db, ...p.split("/"));
  return {
    onAuth: cb => A.onAuthStateChanged(auth, u => cb(u ? { email:(u.email||"").toLowerCase(), name:u.displayName||u.email, verified:u.emailVerified } : null)),
    signIn: () => A.signInWithPopup(auth, new A.GoogleAuthProvider()),
    signOut: () => A.signOut(auth),
    get: async p => { const s = await F.getDoc(ref(p)); return s.exists() ? s.data() : null; },
    set: (p, d, merge=true) => F.setDoc(ref(p), d, { merge }),
    del: p => F.deleteDoc(ref(p)),
    list: async (p, o={}) => { let q = col(p); const parts=[]; if(o.where) parts.push(F.where(o.where[0], o.where[1], o.where[2])); if(o.orderBy) parts.push(F.orderBy(o.orderBy, o.dir||"asc")); if(o.limit) parts.push(F.limit(o.limit)); if(parts.length) q = F.query(q, ...parts);
      const s = await F.getDocs(q); return s.docs.map(d => ({ id:d.id, ...d.data() })); },
    add: (p, d) => F.addDoc(col(p), d),
    batch: async ops => { for(let i=0;i<ops.length;i+=450){ const b = F.writeBatch(db); ops.slice(i,i+450).forEach(o => o.op==="del" ? b.delete(ref(o.p)) : b.set(ref(o.p), o.d, { merge:o.merge!==false })); await b.commit(); } }
  };
}
/* In-memory stand-in used only for local testing (?mock=owner|manager|stranger on localhost). Mirrors the security rules. */
function mockAdapter(kind){
  const W = window.__MOCKDB = JSON.parse(sessionStorage.getItem("mockdb")||"{}");
  const save = () => sessionStorage.setItem("mockdb", JSON.stringify(W));
  const email = kind==="owner" ? MAIN_OWNER : kind==="owner2" ? "owner2@gmail.com" : kind==="manager" ? "manager1@gmail.com" : "stranger@gmail.com";
  if(!sessionStorage.getItem("mockseed")){ W["users/manager1@gmail.com"] = { role:"manager" }; W["users/owner2@gmail.com"] = { role:"owner" }; sessionStorage.setItem("mockseed","1"); save(); }
  const role = () => email===MAIN_OWNER ? "owner" : (W["users/"+email]||{}).role;
  const deny = () => { const e = new Error("Missing or insufficient permissions."); e.code="permission-denied"; throw e; };
  const member = () => !!role();
  const owner = () => role()==="owner";
  const canWrite = (p, op, d) => {
    const s = p.split("/");
    if(!member()) return false;
    if(s[0]==="users") return owner() && s[1]!==MAIN_OWNER && (op==="del" || ["owner","manager"].includes(d.role));
    if(s[0]==="config") return owner();
    if(s[0]==="logs") return op!=="del" ? (op==="add" ? d.by===email : owner()) : owner();
    if(s[0]==="companies"){
      if(s.length===2) return owner();
      if(["employees","prefs","colmap"].includes(s[2])) return true;
      if(s[2]==="months"){
        const mp = s.slice(0,4).join("/"); const cur = W[mp];
        if(s.length===4){ if(op==="del") return owner(); if(!cur) return true; return owner() || cur.status!=="final"; }
        if(op==="del") return owner(); return owner() || !cur || cur.status!=="final";
      }
    }
    return false;
  };
  const merge = (a,b) => { const o = Object.assign({}, a); for(const k in b){ o[k] = (b[k] && typeof b[k]==="object" && !Array.isArray(b[k]) && o[k] && typeof o[k]==="object") ? merge(o[k], b[k]) : b[k]; } return o; };
  const clone = x => JSON.parse(JSON.stringify(x));
  return {
    onAuth: cb => { setTimeout(()=> cb(sessionStorage.getItem("mockout") ? null : { email, name: kind, verified:true }), 0); },
    signIn: async () => { sessionStorage.removeItem("mockout"); location.reload(); },
    signOut: async () => { sessionStorage.setItem("mockout","1"); location.reload(); },
    get: async p => { if(!member() && !p.startsWith("users/"+email)) deny(); if(!member()) deny(); return W[p] ? clone(W[p]) : null; },
    set: async (p, d, m=true) => { if(!canWrite(p, "set", d)) deny(); W[p] = m ? merge(W[p]||{}, clone(d)) : clone(d); save(); },
    del: async p => { if(!canWrite(p, "del")) deny(); delete W[p]; save(); },
    list: async (p, o={}) => { if(!member()) deny(); const n = p.split("/").length; let r = Object.keys(W).filter(k => k.startsWith(p+"/") && k.split("/").length===n+1).map(k => ({ id:k.split("/").pop(), ...clone(W[k]) }));
      if(o.where) r = r.filter(x => x[o.where[0]]===o.where[2]);
      if(o.orderBy) r.sort((a,b)=> (a[o.orderBy]>b[o.orderBy]?1:a[o.orderBy]<b[o.orderBy]?-1:0) * (o.dir==="desc"?-1:1)); if(o.limit) r = r.slice(0,o.limit); return r; },
    add: async (p, d) => { if(!canWrite(p+"/x", "add", d)) deny(); W[p+"/"+Math.random().toString(36).slice(2,10)] = clone(d); save(); },
    batch: async ops => { for(const o of ops) if(!canWrite(o.p, o.op==="del"?"del":"set", o.d)) deny(); for(const o of ops){ if(o.op==="del") delete W[o.p]; else W[o.p] = o.merge===false ? clone(o.d) : merge(W[o.p]||{}, clone(o.d)); } save(); }
  };
}

/* ---------------- Hooks used by the payslip core ---------------- */
const coFromKey = k => k.split(":")[0];
H.canEditSettings = () => isOwner();
H.onSettings = (s) => { DB.set("config/settings", { ...s, updatedBy:me.email, updatedAt:new Date().toISOString() }).then(()=>toast("Rates saved for everyone.")).catch(fail("Could not save the rates")); };
H.onOver = (k, v) => { const [co, n] = k.split(":"); DB.set(`companies/${co}/prefs/${n}`, v).catch(fail("Could not save the choice")); };
H.onMo = (k, v) => { const [co, ym, n] = k.split(":"); if(cache.monthDoc && cache.monthDoc.status==="final"){ toast("This month is Final, so changes are not saved.", true); return; }
  DB.set(`companies/${co}/months/${ym}`, { status:"open", mo:{ [n]: v } }).catch(fail("Could not save")); };
H.onColmap = (co, map) => { DB.set(`companies/${co}/colmap/map`, { map: map||{} }, false).catch(fail("Could not save the column choice")); };
H.onMaster = (map) => {
  const co = state.company; const ops = [];
  Object.entries(map).forEach(([n, o]) => { const d = {}; for(const k in o){ const v=o[k]; d[k] = v instanceof Date ? v.toISOString() : (v==null ? null : v); } ops.push({ p:`companies/${co}/employees/${n}`, d }); });
  cache.masters[co] = Object.assign({}, cache.masters[co]||{}, map);
  state.parsed.master = cache.masters[co];
  DB.batch(ops).then(()=>{ toast(`Saved details of ${ops.length} employees for everyone.`); state.files.master = `Saved details · ${Object.keys(cache.masters[co]).length} employees`; renderFiles(); }).catch(fail("Could not save employee details"));
};
H.onCompany = () => { useMaster(); setTimeout(()=>{ renderTabs(); if(ui.tab==="records") loadRecords(); }, 0); };
H.onContext = () => { if(state.example) return; const key = `${state.company}:${curYm()}`; if(key===cache.ctxKey) return; cache.ctxKey = key; loadMonth(state.company, curYm()); };
H.onSalaryLoaded = () => { if(state.example) return; const ym=curYm(), co=state.company;
  setTimeout(async ()=>{ await loadMonth(co, ym); const md = cache.monthDoc;
    if(md && md.status==="final") return;
    DB.set(`companies/${co}/months/${ym}`, { status:"open", lock:{ by:me.email, name:me.name, at:new Date().toISOString() } }).catch(()=>{}); }, 0); };
H.monthGate = () => {
  const md = cache.monthDoc; const co = COMPANIES[state.company].name; const ml = `${MONTHS[state.m-1]} ${state.y}`;
  if(md && md.status==="final") return { block:true, html:`<div class="notice info" style="margin-bottom:12px"><b>${esc(ml)} is Final for ${esc(co)}.</b> Marked Final by ${esc(md.finalByName||md.finalBy||"")} on ${esc(when(md.finalAt))}. To get the payslips again, use <button class="link" type="button" data-act="goRecords">Records → Re-make</button>${isOwner()? ", or reopen the month there to make changes":". To change anything, ask an owner to reopen the month"}.</div>` };
  if(md && md.lock && md.lock.by!==me.email && (Date.now()-new Date(md.lock.at).getTime()) < 3*3600e3) return { block:false, html:`<div class="notice warn" style="margin-bottom:12px"><b>${esc(md.lock.name||md.lock.by)}</b> started ${esc(ml)} for ${esc(co)} at ${esc(when(md.lock.at))}. Check with them before making payslips, so the work isn't done twice.</div>` };
  return { block:false, html:"" };
};
H.genExtra = () => {
  const g = state.gen; if(!g || g.busy || g.error) return "";
  const md = cache.monthDoc; if(md && md.status==="final") return "";
  const ml = `${MONTHS[state.m-1]} ${state.y}`;
  if(!ui.finalAsk) return `<div class="finalbox"><div><b>Payslips are correct and handed out?</b><div class="hint">Mark ${esc(ml)} as Final to save the figures for ${KEEP_MONTHS} months (so any payslip can be made again) and lock the month against changes.</div></div><button class="btn" type="button" data-act="finalAsk">Mark ${esc(ml)} as Final</button></div>`;
  return `<div class="finalbox ask"><div><b>Lock ${esc(ml)} for ${esc(COMPANIES[state.company].name)}?</b><div class="hint">${state.emps.filter(included).length} payslips will be saved. After this only an owner can reopen the month.</div></div><div class="row"><button class="btn primary" type="button" data-act="finalDo">Yes, mark Final</button><button class="btn" type="button" data-act="finalCancel">Cancel</button></div></div>`;
};
H.onGenerated = ({count, total}) => {
  const co = state.company, ym = curYm(); const rec = { by:me.email, name:me.name, at:new Date().toISOString(), count, total };
  DB.set(`companies/${co}/months/${ym}`, { status:"open", lastMade:rec }).catch(()=>{});
  DB.add("logs", { co, month:ym, action:"made", by:me.email, name:me.name, at:rec.at, count, total }).catch(()=>{});
  ui.finalAsk = false;
};
H.onClick = (t) => {
  const a = t.dataset.act; if(!a) return false;
  const fn = ACTIONS[a]; if(fn){ fn(t); return true; } return false;
};

/* ---------------- Loading shared data ---------------- */
function useMaster(){ const m = cache.masters[state.company] || {}; state.parsed.master = Object.keys(m).length ? m : null; state.files.master = Object.keys(m).length ? `Saved details · ${Object.keys(m).length} employees` : null; }
async function loadMonth(co, ym){
  try{ const d = await DB.get(`companies/${co}/months/${ym}`); if(co!==state.company || ym!==curYm()) return;
    cache.monthDoc = d; ui.finalAsk = false;
    Object.keys(state.mo).filter(k=>k.startsWith(`${co}:${ym}:`)).forEach(k=>delete state.mo[k]);
    if(d && d.mo) Object.entries(d.mo).forEach(([n,v])=> state.mo[`${co}:${ym}:${n}`] = v);
    refresh(); }
  catch(e){ console.error(e); }
}
async function loadShared(){
  const settings = await DB.get("config/settings");
  if(settings){ const s = Object.assign({}, DEF); for(const k in DEF) if(settings[k]!==undefined) s[k]=settings[k]; S = s; }
  else if(isOwner()) await DB.set("config/settings", { ...DEF });
  cache.mailer = (await DB.get("config/mailer")) || {};
  for(const co of Object.keys(COMPANIES)){
    const d = await DB.get(`companies/${co}`);
    const fields = ["name","legal","addr","phone","email","gstin","pfCode","esiCode"];
    if(d) fields.forEach(f=>{ if(d[f]!==undefined) COMPANIES[co][f]=d[f]; });
    else if(isOwner()){ const o={}; fields.forEach(f=>o[f]=COMPANIES[co][f]); await DB.set(`companies/${co}`, o); }
    (await DB.list(`companies/${co}/prefs`)).forEach(p => { const {id, ...v} = p; state.over[`${co}:${id}`] = v; });
    const cm = await DB.get(`companies/${co}/colmap/map`); if(cm && cm.map) state.colmap[co] = cm.map;
    const emps = await DB.list(`companies/${co}/employees`); const m = {};
    emps.forEach(x => { const {id, ...v} = x; if(v.doj) v.doj = new Date(v.doj); m[id] = v; }); cache.masters[co] = m;
  }
}

/* ---------------- Tabs ---------------- */
function renderTabs(){
  const tabs = [["payslips","Payslips"],["records","Records"],["people","People"],["company","Company details"]];
  $("#tabs").innerHTML = tabs.map(([k,t])=>`<button type="button" data-act="tab" data-tab="${k}" aria-pressed="${ui.tab===k}">${t}</button>`).join("");
  ["payslips","records","people","company"].forEach(k => $("#tab-"+k).hidden = ui.tab!==k);
  $("#who").innerHTML = `<span class="role ${me.role}">${me.role==="main"?"Main owner":me.role==="owner"?"Owner":"Manager"}</span><span class="em">${esc(me.email)}</span><button class="btn sm" type="button" data-act="signOut">Sign out</button>`;
}
function coSeg(){ return `<div class="seg" role="group" aria-label="Company">${Object.entries(COMPANIES).map(([k,c])=>`<button type="button" data-co="${k}" aria-pressed="${state.company===k}">${esc(c.name)}</button>`).join("")}</div>`; }
const monthAgeDue = ym => { const [y,m]=ym.split("-").map(Number); const now=new Date(); return (now.getFullYear()*12+now.getMonth()) - (y*12+m-1) > KEEP_MONTHS; };

/* ---------------- Records ---------------- */
async function loadRecords(){
  const co = state.company; $("#recBody").innerHTML = `<p class="hint">Loading…</p>`;
  try{
    cache.months = (await DB.list(`companies/${co}/months`)).sort((a,b)=> a.id<b.id?1:-1);
    cache.logs = (await DB.list("logs", { where:["co","==",co] })).sort((a,b)=> a.at<b.at?1:-1).slice(0,40);
  }catch(e){ fail("Could not load records")(e); cache.months=[]; cache.logs=[]; }
  renderRecords();
}
function renderRecords(){
  const co = state.company; const months = cache.months;
  const due = months.filter(m=>m.status==="final" && monthAgeDue(m.id));
  const rows = months.map(m => {
    const st = m.status==="final" ? `<span class="pill ok">Final</span>` : `<span class="pill warn">Open</span>`;
    const made = m.lastMade ? `${esc(m.lastMade.count)} slips · ₹${Number(m.lastMade.total||0).toLocaleString("en-IN")}<br><span class="hint">by ${esc(m.lastMade.name||m.lastMade.by)} · ${esc(when(m.lastMade.at))}</span>` : `<span class="hint">Not made yet</span>`;
    const fin = m.status==="final" ? `${esc(m.finalByName||m.finalBy)}<br><span class="hint">${esc(when(m.finalAt))}</span>` : (m.lock ? `<span class="hint">Started by ${esc(m.lock.name||m.lock.by)} · ${esc(when(m.lock.at))}</span>` : "");
    const busy = ui.recBusy && ui.recBusy.ym===m.id;
    const acts = [];
    if(m.status==="final") acts.push(`<button class="btn sm" type="button" data-act="remake" data-ym="${m.id}" ${ui.recBusy?"disabled":""}>Re-make payslips</button>`);
    if(m.status==="final" && isOwner()) acts.push(`<button class="btn sm" type="button" data-act="reopen" data-ym="${m.id}" ${ui.recBusy?"disabled":""}>Reopen</button>`);
    if(m.status==="final" && isOwner()) acts.push(`<button class="btn sm${monthAgeDue(m.id)?" primary":""}" type="button" data-act="archive" data-ym="${m.id}" ${ui.recBusy?"disabled":""}>Archive${monthAgeDue(m.id)?" (due)":""}</button>`);
    return `<tr><td><b>${esc(ymLabel(m.id))}</b>${monthAgeDue(m.id)&&m.status==="final"?`<br><span class="hint">Older than ${KEEP_MONTHS} months</span>`:""}</td><td>${st}</td><td>${made}</td><td>${fin}</td><td><div class="row" style="gap:6px">${acts.join("")}</div>${busy?`<div class="hint" style="margin-top:6px">${esc(ui.recBusy.msg||"")}</div>`:""}</td></tr>`;
  }).join("");
  const arch = ui.archive && ui.archive.co===co ? archiveBox() : "";
  const remade = ui.remade && ui.remade.co===co ? `<div class="finalbox"><div><b>${esc(ymLabel(ui.remade.ym))}: ${ui.remade.count} payslips made again from the saved records.</b></div><div class="row"><button class="btn primary" type="button" data-act="saveRemakeZip">Save payslips (.zip)</button><button class="btn" type="button" data-act="saveRemakeAll">Save print file (one PDF)</button></div></div>` : "";
  const logs = cache.logs.map(l=>`<tr><td>${esc(when(l.at))}</td><td>${esc(l.name||l.by)}</td><td>${esc({made:"Made payslips",final:"Marked Final",reopen:"Reopened",archived:"Archived and deleted",remade:"Re-made payslips"}[l.action]||l.action)}</td><td>${esc(l.month?ymLabel(l.month):"")}</td><td class="n">${l.count!=null?esc(l.count):""}</td><td class="n">${l.total!=null?"₹"+Number(l.total).toLocaleString("en-IN"):""}</td></tr>`).join("");
  $("#recBody").innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:12px">${coSeg()}<span class="hint">Final months are kept for ${KEEP_MONTHS} months, then archived to the company email and deleted.</span></div>
    ${due.length && isOwner()? `<div class="notice warn" style="margin-bottom:12px"><b>${due.length} month${due.length>1?"s are":" is"} older than ${KEEP_MONTHS} months:</b> ${due.map(m=>esc(ymLabel(m.id))).join(", ")}. Archive ${due.length>1?"them":"it"} to ${esc(COMPANIES[co].email)} and delete from the tool.</div>`:""}
    ${ui.recMsg? `<div class="notice info" style="margin-bottom:12px">${ui.recMsg}</div>`:""}
    ${remade}${arch}
    <div class="tablewrap"><table class="rev"><thead><tr><th>Month</th><th>Status</th><th>Payslips made</th><th>Final / started</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="hint" style="padding:16px">No months yet for ${esc(COMPANIES[co].name)}. Months appear here once a salary sheet is uploaded.</td></tr>`}</tbody></table></div>
    <h3 style="margin:20px 0 8px;font-family:var(--f-display);font-stretch:80%">Activity log</h3>
    <div class="tablewrap"><table class="rev"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Month</th><th class="n">Slips</th><th class="n">Net pay</th></tr></thead><tbody>${logs || `<tr><td colspan="6" class="hint" style="padding:16px">Nothing yet.</td></tr>`}</tbody></table></div>`;
}
async function withMonthContext(ym, md, fn){
  const saved = { S, y:state.y, m:state.m, ex:state.example, co:Object.assign({}, COMPANIES[state.company]) };
  try{ const [y,m] = ym.split("-").map(Number); S = Object.assign({}, DEF, md.settings||{}); state.y=y; state.m=m; state.example=false;
    if(md.company) Object.assign(COMPANIES[state.company], md.company);
    return await fn(); }
  finally{ S = saved.S; state.y=saved.y; state.m=saved.m; state.example=saved.ex; Object.assign(COMPANIES[state.company], saved.co); }
}
async function getRecordEmps(co, ym){ const recs = (await DB.list(`companies/${co}/months/${ym}/records`)).sort((a,b)=>(a.order||0)-(b.order||0)); return recs.map(r=>empFromSnap(r)); }

/* ---------------- Archive ---------------- */
function archiveBox(){
  const a = ui.archive; const co = COMPANIES[a.co];
  const mail = cache.mailer && cache.mailer.url;
  return `<div class="finalbox ask" style="display:grid;gap:10px"><div><b>Archive ${esc(ymLabel(a.ym))} for ${esc(co.name)}</b>
    <div class="hint">${a.ready? `Ready: ${esc(a.files.map(f=>f.name+" ("+Math.round(f.blob.size/1024)+" KB)").join(", "))}.` : "Makes an Excel file of the month's figures, and optionally a zip of the payslips (smaller copies)."}</div></div>
    ${!a.ready? `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="arcPdf" ${a.pdf?"checked":""}> Include payslip PDFs</label>
      <div class="row"><button class="btn primary" type="button" data-act="arcBuild" ${a.busy?"disabled":""}>Prepare archive</button><button class="btn" type="button" data-act="arcCancel">Cancel</button></div>` :
    `<div class="row">${mail? `<button class="btn primary" type="button" data-act="arcMail" ${a.busy||a.mailed?"disabled":""}>${a.mailed?"Emailed ✓":"Email to "+esc(co.email)}</button>`:`<span class="hint">Email isn't set up yet (Company details → Archive email). Download the files instead.</span>`}
      ${a.files.map((f,i)=>`<button class="btn" type="button" data-act="arcSave" data-i="${i}">Download ${esc(f.name.split(".").pop().toUpperCase())}${a.saved&&a.saved[i]?" ✓":""}</button>`).join("")}</div>
      <div class="row"><button class="btn${a.mailed||(a.saved&&a.saved.some(Boolean))?" primary":""}" type="button" data-act="arcDelete" ${a.mailed||(a.saved&&a.saved.some(Boolean))?"":"disabled"} ${a.busy?"disabled":""}>${a.confirmDel?"Click again to delete permanently":"Delete this month from the tool"}</button><button class="btn" type="button" data-act="arcCancel">Close</button>
      <span class="hint">${a.mailed||(a.saved&&a.saved.some(Boolean))? "Deletes the saved figures and log of this month from the tool." : "Email or download the files first."}</span></div>`}
    ${a.msg? `<div class="hint">${esc(a.msg)}</div>`:""}</div>`;
}
function archiveWorkbook(emps, md, ym, co){
  const rows = [["Name","Category","Days worked","Rate","Rate type","Wages for days worked","OT hours","OT wages","Attendance bonus","Other earnings","ESI","PF","Advance","Other deductions","Net pay (rounded)","Language","PF/ESI note"]];
  emps.forEach(e=>{ const ex = e.extras||[]; const oe = ex.filter(x=>x.kind==="earn").reduce((s,x)=>s+x.amt,0) + (e.addOther>0?e.addOther:0); const od = ex.filter(x=>x.kind==="ded").reduce((s,x)=>s+x.amt,0) + (e.addOther<0?-e.addOther:0);
    rows.push([e.name, e.group==="pf"?"PF & ESI":"Without PF/ESI", e.days, e.rate, e.rateType, r2(e.basic), e.otHrs||0, r2(e.ot), e.bonus||0, r2(oe), e.esi, e.pf, e.advance, r2(od), e.net, (e.lang||"en").toUpperCase(), e.reason? REASONS[e.reason][0] : (e.reasonAuto? REASONS[e.reasonAuto][0] : "")]); });
  const ws = XLSX.utils.aoa_to_sheet(rows); ws["!cols"] = rows[0].map((h,i)=>({wch: i===0?24:14}));
  const info = XLSX.utils.aoa_to_sheet([["Company", COMPANIES[co].name],["Month", ymLabel(ym)],["Payslips", emps.length],["Total net pay", emps.reduce((s,e)=>s+(e.net||0),0)],["Made by", (md.lastMade&&(md.lastMade.name||md.lastMade.by))||""],["Marked Final by", md.finalByName||md.finalBy||""],["Final on", md.finalAt||""],["Archived by", me.email],["Archived on", new Date().toISOString()]]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Payslips"); XLSX.utils.book_append_sheet(wb, info, "Details");
  return new Blob([XLSX.write(wb, {bookType:"xlsx", type:"array"})], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
const blobB64 = blob => new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(",")[1]); r.onerror=rej; r.readAsDataURL(blob); });

/* ---------------- People ---------------- */
async function loadPeople(){ try{ cache.users = await DB.list("users"); }catch(e){ fail("Could not load people")(e); cache.users=[]; } renderPeople(); }
function renderPeople(){
  const users = cache.users.filter(u=>u.id!==MAIN_OWNER).sort((a,b)=> (a.role===b.role? (a.id<b.id?-1:1) : a.role==="owner"?-1:1));
  const mgrs = users.filter(u=>u.role==="manager").length;
  const row = (email, role, removable, extra) => `<tr><td><b>${esc(email)}</b>${extra?`<br><span class="hint">${extra}</span>`:""}</td><td><span class="role ${role}">${role==="main"?"Main owner":role==="owner"?"Owner":"Manager"}</span></td><td>${removable && isOwner()? `<button class="btn sm" type="button" data-act="rmUser" data-email="${esc(email)}">${ui.rmAsk===email?"Click again to remove":"Remove"}</button>`:""}</td></tr>`;
  $("#peopleBody").innerHTML = `
    <div class="tablewrap"><table class="rev" style="min-width:0"><thead><tr><th>Gmail</th><th>Role</th><th></th></tr></thead><tbody>
      ${row(MAIN_OWNER, "main", false, "Permanent. Cannot be removed.")}
      ${users.map(u=>row(u.id, u.role, true, u.addedBy? `Added by ${esc(u.addedBy)}` : "")).join("")}
    </tbody></table></div>
    ${isOwner()? `<form id="addUser" class="row" style="margin-top:14px;align-items:flex-end">
      <div class="field" style="flex:1;min-width:220px"><label for="newEmail">Gmail address</label><input type="text" id="newEmail" placeholder="name@gmail.com" autocomplete="off"></div>
      <div class="field"><label for="newRole">Role</label><select id="newRole"><option value="manager">Manager</option><option value="owner">Owner</option></select></div>
      <button class="btn primary" type="submit">Add</button></form>
      <p class="hint">Managers: ${mgrs} of ${MAX_MANAGERS}. They can upload, review, choose reasons, make payslips and mark months Final. Owners can also change rates and company details, reopen and archive months, and manage people.</p>`
    : `<p class="hint">Only owners can add or remove people.</p>`}
    ${ui.peopleMsg? `<div class="notice ${ui.peopleMsg.startsWith("✓")?"ok":"err"}">${esc(ui.peopleMsg)}</div>`:""}`;
}

/* ---------------- Company details ---------------- */
const CO_FIELDS = [["name","Company name (shown in the tool)"],["legal","Name on payslip header (when no logo)"],["addr","Address"],["phone","Phone (leave blank to hide)"],["email","Email for payslip questions and archives"],["gstin","GSTIN"],["pfCode","PF establishment code"],["esiCode","ESI employer code"]];
function renderCompany(){
  const dis = isOwner()? "" : "disabled";
  $("#companyBody").innerHTML = Object.entries(COMPANIES).map(([k,c])=>`<form class="panel coform" data-co-form="${k}" style="margin-bottom:14px"><h3 style="margin:0 0 10px;font-family:var(--f-display);font-stretch:80%">${esc(c.name)}</h3>
    <div class="setgrid">${CO_FIELDS.map(([f,l])=>`<div class="field"${f==="addr"?' style="grid-column:1/-1"':""}><label for="co_${k}_${f}">${esc(l)}</label><input type="text" id="co_${k}_${f}" name="${f}" value="${esc(c[f]||"")}" ${dis}></div>`).join("")}</div>
    ${isOwner()? `<button class="btn primary sm" type="submit" style="margin-top:10px">Save ${esc(c.name)}</button>`:""}</form>`).join("") +
  `<form class="panel" id="mailerForm"><h3 style="margin:0 0 6px;font-family:var(--f-display);font-stretch:80%">Archive email (Google Apps Script)</h3>
    <p class="hint" style="margin:0 0 10px">Archives are emailed from the company Gmail through a small Apps Script. Set it up once using the README, then paste its web app URL and the secret word here.</p>
    <div class="setgrid"><div class="field" style="grid-column:1/-1"><label for="mailUrl">Apps Script web app URL</label><input type="text" id="mailUrl" value="${esc(cache.mailer.url||"")}" ${dis} placeholder="https://script.google.com/macros/s/…/exec"></div>
    <div class="field"><label for="mailTok">Secret word</label><input type="text" id="mailTok" value="${isOwner()?esc(cache.mailer.token||""):""}" ${dis}></div></div>
    ${isOwner()? `<div class="row" style="margin-top:10px"><button class="btn primary sm" type="submit">Save</button><button class="btn sm" type="button" data-act="mailTest" ${cache.mailer.url?"":"disabled"}>Send a test email</button></div>`:""}</form>
    ${ui.coMsg? `<div class="notice info" style="margin-top:10px">${esc(ui.coMsg)}</div>`:""}`;
}
async function sendMail(to, subject, body, files){
  const payload = { token:cache.mailer.token||"", to, subject, body, files: await Promise.all(files.map(async f=>({ name:f.name, mime:f.blob.type||"application/octet-stream", b64: await blobB64(f.blob) }))) };
  const r = await fetch(cache.mailer.url, { method:"POST", body: JSON.stringify(payload) });
  const t = await r.text(); let j; try{ j = JSON.parse(t); }catch(e){ throw new Error("The mail script did not answer properly. Check the URL and that it is deployed for 'Anyone'."); }
  if(!j.ok) throw new Error(j.error || "Mail script refused the request.");
  return j;
}

/* ---------------- Actions ---------------- */
const ACTIONS = {
  tab: t => { ui.tab = t.dataset.tab; renderTabs(); if(ui.tab==="records") loadRecords(); if(ui.tab==="people") loadPeople(); if(ui.tab==="company") renderCompany(); window.scrollTo(0,0); },
  goRecords: () => ACTIONS.tab({dataset:{tab:"records"}}),
  signOut: () => DB.signOut(),
  finalAsk: () => { ui.finalAsk = true; renderGen(); },
  finalCancel: () => { ui.finalAsk = false; renderGen(); },
  finalDo: async () => {
    const co = state.company, ym = curYm(); const inc = state.emps.filter(included);
    if(!inc.length || inc.some(blocked) || state.blockers.length){ toast("Fix the items marked Action needed first.", true); return; }
    const at = new Date().toISOString(); const total = inc.reduce((s,e)=>s+slipLines(e).net,0);
    const c = COMPANIES[co]; const coSnap = { name:c.name, legal:c.legal, addr:c.addr, phone:c.phone, email:c.email, gstin:c.gstin, pfCode:c.pfCode, esiCode:c.esiCode };
    const ops = inc.map((e,i)=>({ p:`companies/${co}/months/${ym}/records/${norm(e.name)}_${e.group}`, d:Object.assign(snapshotEmp(e), {order:i}), merge:false }));
    ops.push({ p:`companies/${co}/months/${ym}`, d:{ status:"final", finalBy:me.email, finalByName:me.name, finalAt:at, count:inc.length, total, settings:Object.assign({},S), company:coSnap, lock:null } });
    try{ await DB.batch(ops); await DB.add("logs", { co, month:ym, action:"final", by:me.email, name:me.name, at, count:inc.length, total });
      ui.finalAsk=false; cache.ctxKey=""; await loadMonth(co, ym); toast(`${MONTHS[state.m-1]} ${state.y} is now Final for ${c.name}.`); }
    catch(e){ fail("Could not mark the month Final")(e); }
  },
  remake: async t => {
    const ym = t.dataset.ym, co = state.company; const md = cache.months.find(m=>m.id===ym); if(!md) return;
    ui.recBusy = { ym, msg:"Loading saved figures…" }; ui.remade=null; renderRecords();
    try{ const emps = await getRecordEmps(co, ym);
      const out = await withMonthContext(ym, md, () => makePdfs(emps, { onStep:(i,e)=>{ ui.recBusy.msg = `Making payslip ${i+1} of ${emps.length}: ${e.name}`; renderRecords(); } }));
      ui.remade = { co, ym, count:emps.length, ...out };
      DB.add("logs", { co, month:ym, action:"remade", by:me.email, name:me.name, at:new Date().toISOString(), count:emps.length }).catch(()=>{});
    }catch(e){ fail("Could not re-make the payslips")(e); }
    ui.recBusy = null; renderRecords();
  },
  saveRemakeZip: async () => { const r=ui.remade; await saveFile(`${r.tag}_Payslips.zip`, r.zip); },
  saveRemakeAll: async () => { const r=ui.remade; await saveFile(`${r.tag}_Payslips_Print.pdf`, r.all); },
  reopen: async t => {
    const ym=t.dataset.ym, co=state.company;
    if(ui.reopenAsk!==ym){ ui.reopenAsk=ym; t.textContent="Click again to reopen"; return; }
    ui.reopenAsk=null; ui.recBusy={ym, msg:"Reopening…"}; renderRecords();
    try{ const recs = await DB.list(`companies/${co}/months/${ym}/records`);
      await DB.batch([...recs.map(r=>({op:"del", p:`companies/${co}/months/${ym}/records/${r.id}`})), { p:`companies/${co}/months/${ym}`, d:{ status:"open", reopenedBy:me.email, reopenedAt:new Date().toISOString() } }]);
      await DB.add("logs", { co, month:ym, action:"reopen", by:me.email, name:me.name, at:new Date().toISOString() });
      ui.recMsg = `${ymLabel(ym)} is open again. Upload the corrected salary sheet in Payslips, make the payslips, and mark it Final again.`;
      cache.ctxKey=""; if(ym===curYm()) loadMonth(co, ym);
    }catch(e){ fail("Could not reopen")(e); }
    ui.recBusy=null; loadRecords();
  },
  archive: t => { ui.archive = { co:state.company, ym:t.dataset.ym, pdf:true }; renderRecords(); },
  arcCancel: () => { ui.archive=null; renderRecords(); },
  arcBuild: async () => {
    const a = ui.archive; a.pdf = !!($("#arcPdf")||{}).checked; a.busy=true; a.msg="Preparing…"; renderRecords();
    try{ const md = cache.months.find(m=>m.id===a.ym); const emps = await getRecordEmps(a.co, a.ym);
      const tag = `${COMPANIES[a.co].code}_${a.ym}`;
      a.files = [{ name:`${tag}_Payslip_Records.xlsx`, blob: archiveWorkbook(emps, md, a.ym, a.co) }];
      if(a.pdf){ const out = await withMonthContext(a.ym, md, () => makePdfs(emps, { scale:1.4, quality:0.72, onStep:(i)=>{ a.msg=`Making payslip PDF ${i+1} of ${emps.length}…`; renderRecords(); } }));
        a.files.push({ name:`${tag}_Payslips.zip`, blob: out.zip }); }
      const size = a.files.reduce((s,f)=>s+f.blob.size,0);
      a.ready = true; a.saved = a.files.map(()=>false); a.msg = size > 18*1024*1024 ? "These files are too large for one email (Gmail allows 25 MB). Download them instead, or prepare again without PDFs." : "";
      a.tooBig = size > 18*1024*1024;
    }catch(e){ a.msg = "Could not prepare: "+(e.message||e); }
    a.busy=false; renderRecords();
  },
  arcSave: async t => { const a=ui.archive; const i=+t.dataset.i; const r = await saveFile(a.files[i].name, a.files[i].blob); if(r==="saved"){ a.saved[i]=true; renderRecords(); } },
  arcMail: async () => {
    const a=ui.archive; if(a.tooBig){ toast("Too large to email. Download the files instead.", true); return; }
    a.busy=true; a.msg=`Emailing ${COMPANIES[a.co].email}…`; renderRecords();
    try{ await sendMail(COMPANIES[a.co].email, `Payslip archive – ${COMPANIES[a.co].name} – ${ymLabel(a.ym)}`, `Attached: payslip figures${a.pdf?" and payslips":""} for ${ymLabel(a.ym)}, archived from Payslip Desk by ${me.email}.`, a.files);
      a.mailed=true; a.msg=`Emailed to ${COMPANIES[a.co].email}.`; }
    catch(e){ a.msg = "Email failed: "+(e.message||e)+" Download the files instead."; }
    a.busy=false; renderRecords();
  },
  arcDelete: async () => {
    const a=ui.archive; if(!a.confirmDel){ a.confirmDel=true; renderRecords(); return; }
    a.busy=true; a.msg="Deleting…"; renderRecords();
    try{ const recs = await DB.list(`companies/${a.co}/months/${a.ym}/records`);
      await DB.batch([...recs.map(r=>({op:"del", p:`companies/${a.co}/months/${a.ym}/records/${r.id}`})), {op:"del", p:`companies/${a.co}/months/${a.ym}`}]);
      await DB.add("logs", { co:a.co, month:a.ym, action:"archived", by:me.email, name:me.name, at:new Date().toISOString(), count:recs.length });
      ui.recMsg = `${ymLabel(a.ym)} was archived${a.mailed?` to ${esc(COMPANIES[a.co].email)}`:""} and deleted from the tool.`; ui.archive=null;
    }catch(e){ a.busy=false; a.msg="Could not delete: "+(e.message||e); renderRecords(); return; }
    loadRecords();
  },
  rmUser: async t => { const em=t.dataset.email; if(ui.rmAsk!==em){ ui.rmAsk=em; renderPeople(); return; } ui.rmAsk=null;
    try{ await DB.del(`users/${em}`); ui.peopleMsg=`✓ Removed ${em}.`; }catch(e){ ui.peopleMsg = "Could not remove: "+(e.message||e); } loadPeople(); },
  mailTest: async () => { ui.coMsg="Sending test email…"; renderCompany();
    try{ await sendMail(COMPANIES[state.company].email, "Payslip Desk test email", `This is a test from Payslip Desk, sent by ${me.email}. Archive emails will arrive like this.`, []); ui.coMsg=`Test email sent to ${COMPANIES[state.company].email}.`; }
    catch(e){ ui.coMsg="Test failed: "+(e.message||e); } renderCompany(); }
};
document.addEventListener("submit", async ev => {
  const f = ev.target;
  if(f.id==="addUser"){ ev.preventDefault();
    const email = $("#newEmail").value.trim().toLowerCase(), role = $("#newRole").value;
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ ui.peopleMsg="Enter a full email address, e.g. name@gmail.com."; renderPeople(); return; }
    if(email===MAIN_OWNER || cache.users.some(u=>u.id===email)){ ui.peopleMsg=`${email} already has access.`; renderPeople(); return; }
    if(role==="manager" && cache.users.filter(u=>u.role==="manager").length >= MAX_MANAGERS){ ui.peopleMsg=`There are already ${MAX_MANAGERS} managers. Remove one first.`; renderPeople(); return; }
    try{ await DB.set(`users/${email}`, { role, addedBy:me.email, addedAt:new Date().toISOString() }, false); ui.peopleMsg=`✓ Added ${email} as ${role}. They can now sign in with that Gmail.`; }
    catch(e){ ui.peopleMsg = "Could not add: "+(e.code==="permission-denied"?"only owners can add people.":(e.message||e)); }
    loadPeople(); return; }
  if(f.dataset.coForm){ ev.preventDefault(); const co=f.dataset.coForm; const d={}; CO_FIELDS.forEach(([k])=> d[k]=f.elements[k].value.trim());
    try{ await DB.set(`companies/${co}`, d); Object.assign(COMPANIES[co], d); ui.coMsg=`Saved ${d.name}. New payslips will use these details.`; renderSetup(); renderGen(); }
    catch(e){ ui.coMsg="Could not save: "+(e.message||e); } renderCompany(); return; }
  if(f.id==="mailerForm"){ ev.preventDefault(); const d={ url:$("#mailUrl").value.trim(), token:$("#mailTok").value.trim() };
    try{ await DB.set("config/mailer", d, false); cache.mailer=d; ui.coMsg="Archive email settings saved."; }catch(e){ ui.coMsg="Could not save: "+(e.message||e); } renderCompany(); }
});

/* ---------------- Start ---------------- */
function showGate(html){ $("#gate").hidden=false; $("#app").hidden=true; $("#gateBody").innerHTML = html; }
async function start(){
  try{ DB = MOCK ? mockAdapter(params.get("mock")) : await firebaseAdapter(); }
  catch(e){ showGate(`<div class="notice err">Could not load the login service. Check the internet connection and reload.</div>`); return; }
  let started = false;
  DB.onAuth(async u => {
    if(!u){ showGate(`<p>Sign in with the Gmail account your owner added.</p><button class="btn primary" type="button" id="signIn">Sign in with Google</button>`); return; }
    showGate(`<p class="hint">Checking access for ${esc(u.email)}…</p>`);
    me.email = u.email; me.name = u.name || u.email;
    if(u.email === MAIN_OWNER) me.role = "main";
    else { try{ const d = await DB.get(`users/${u.email}`); me.role = d && d.role || ""; }catch(e){ me.role = ""; } }
    if(!me.role){ showGate(`<div class="notice err"><b>${esc(u.email)}</b> doesn't have access to Payslip Desk.</div><p class="hint">Ask an owner to add this Gmail under People, then sign in again.</p><button class="btn" type="button" id="signOutGate">Use a different Gmail</button>`); return; }
    try{ await loadShared(); }catch(e){ showGate(`<div class="notice err">Could not load shared settings: ${esc(e.message||e)}</div>`); return; }
    $("#gate").hidden=true; $("#app").hidden=false;
    renderTabs(); useMaster();
    if(!started){ started=true; window.coreStart(); useMaster(); renderFiles(); }
  });
}
document.addEventListener("click", ev => {
  const t = ev.target.closest("#signIn, #signOutGate"); if(!t) return;
  if(t.id==="signIn") DB.signIn().catch(e=>{ if(e && e.code==="auth/popup-blocked") toast("The sign-in window was blocked. Allow pop-ups for this site and try again.", true); else if(e && e.code!=="auth/popup-closed-by-user") toast("Sign-in failed: "+(e.message||e), true); });
  else DB.signOut();
});
if(MOCK) window.__PSD = { get DB(){ return DB; }, cache, ui, me, renderRecords, renderPeople };
start();
