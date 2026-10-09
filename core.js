"use strict";
/* Payslip Desk core: Excel reading, checks, payslip layout and PDF making. Shared by the web app. */
const HOOKS = window.PSD_HOOKS || (window.PSD_HOOKS = {});
const hook = (n,...a)=>{ try{ return HOOKS[n] ? HOOKS[n](...a) : undefined; }catch(e){ console.error(e); } };
/* ================= Company profiles ================= */
const COMPANIES = {
  re: { code:"RE", name:"Rajendra Engineering", legal:"RAJENDRA ENGINEERING", logo:"assets/re-logo.png",
        addr:"18 B, Sri Sai Garden, Kattor Street, Kalapatti, Coimbatore, Tamil Nadu – 641048",
        phone:"+91 99521 88033", email:"rajendraengg2018@gmail.com", gstin:"33AAXFR4747C1ZX",
        pfCode:"CBCBE3774703000", esiCode:"56001513010000699" },
  rsa:{ code:"RSA", name:"RS Automation", legal:"RS AUTOMATION", logo:"",
        addr:"SF No. 1082/1B, Sri Sai Garden, Kattoor Street, Kalapatty, Coimbatore, Tamil Nadu – 641048",
        phone:"", email:"rsautomation22@gmail.com", gstin:"33FBDPS5189D1ZG",
        pfCode:"CBCBE3783856000", esiCode:"56001516950000699", mark:"assets/rs-mark.png", brand:"#0000BA" }
};

/* ================= Settings ================= */
const DEF = { pfCeilOverride:"", pfWagePct:80, pfEE:12, eps:8.33, edli:0.5, esiCeiling:21000, esiEE:0.75, esiER:3.25,
  baseDays:26, otHoursPerDay:8, dailyOtDiv:12, dailyMax:5000, esiExemptDaily:176, tol:1, newJoinerDays:90,
  bonusAmt:500, workingDaysOverride:"" };
const SETFIELDS = [
  ["pfCeilOverride","PF ceiling override (₹, blank = automatic)","text"],["pfWagePct","PF wages as % of gross","number"],
  ["pfEE","PF employee %","number"],["eps","EPS (pension) %","number"],["edli","EDLI %","number"],
  ["esiCeiling","ESI wage ceiling (₹/month)","number"],["esiEE","ESI employee %","number"],["esiER","ESI employer %","number"],
  ["baseDays","Days in a salary month","number"],["otHoursPerDay","OT: hours per day (monthly staff)","number"],
  ["dailyOtDiv","OT: hours per day (daily-rate staff)","number"],["dailyMax","Rates below this are daily rates (₹)","number"],
  ["esiExemptDaily","ESI employee share exempt up to daily wage (₹)","number"],["tol","Allowed difference (₹)","number"],
  ["newJoinerDays","Days before moving to PF & ESI sheet","number"],
  ["bonusAmt","Attendance bonus (₹)","number"],["workingDaysOverride","Working days this month (blank = automatic)","text"]];
const store = {
  get(k,d){ try{ const v = localStorage.getItem("psd:"+k); return v==null? d : JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem("psd:"+k, JSON.stringify(v)); }catch(e){} }
};
let S = Object.assign({}, DEF);

/* ================= State ================= */
const now = new Date();
const state = {
  company: COMPANIES[store.get("company","re")] ? store.get("company","re") : "re",
  y: now.getFullYear(), m: now.getMonth()+1,
  files:{ salary:null, nopf:null, master:null },
  wb:{ salary:null, nopf:null },
  parsed:{ salary:null, nopf:null, master:null },
  emps:[], notices:[], blockers:[], filter:"all", open:null, example:false,
  over: {},      // company:name -> {lang, reason}       (synced to Firestore)
  mo: {},        // company:yyyy-mm:name -> {addReason, bonusOk}
  colmap: {},    // company -> {HEADERKEY: target}
  session:{}, gen:null
};

/* ================= Helpers ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = s => String(s==null?"":s).toUpperCase().replace(/[^A-Z0-9]/g,"");
const r2 = n => Math.round((+n||0)*100)/100;
const rnd = n => { n=+n||0; return Math.sign(n)*Math.round(Math.abs(n)); };
const fmt0 = n => (n<0?"−":"") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");
const fmt2 = n => (n<0?"−":"") + "₹" + Math.abs(r2(n)).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const amt0 = n => (n<0?"−":"") + Math.abs(rnd(n)).toLocaleString("en-IN");
const numfmt = n => (Math.round(n*100)/100).toLocaleString("en-IN");
const ceilR = n => Math.ceil(n - 1e-9);
const sum = a => a.reduce((s,x)=>s+(+x||0),0);
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_TA = ["ஜனவரி","பிப்ரவரி","மார்ச்","ஏப்ரல்","மே","ஜூன்","ஜூலை","ஆகஸ்ட்","செப்டம்பர்","அக்டோபர்","நவம்பர்","டிசம்பர்"];
const MONTHS_HI = ["जनवरी","फ़रवरी","मार्च","अप्रैल","मई","जून","जुलाई","अगस्त","सितंबर","अक्टूबर","नवंबर","दिसंबर"];
function pfCeilingAuto(y,m){ const k=y*100+m; if(k<202609) return 15000; if(k===202609) return Math.round(15000*16/30 + 25000*14/30); return 25000; }
function pfCeiling(){ const o = parseFloat(S.pfCeilOverride); return isFinite(o)&&o>0 ? o : pfCeilingAuto(state.y,state.m); }
function workingDaysAuto(y,m){ const d=new Date(y,m,0).getDate(); let n=0; for(let i=1;i<=d;i++) if(new Date(y,m-1,i).getDay()!==0) n++; return n; }
function workingDays(){ const o=parseFloat(S.workingDaysOverride); return isFinite(o)&&o>0 ? o : workingDaysAuto(state.y,state.m); }
function fmtDate(d){ if(!d) return ""; return String(d.getDate()).padStart(2,"0")+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+d.getFullYear(); }
function toDate(v){
  if(v==null||v==="") return null;
  if(v instanceof Date && !isNaN(v)){ const d=new Date(v.getTime()+12*3600000); return new Date(d.getFullYear(),d.getMonth(),d.getDate()); }
  if(typeof v==="number" && v>20000 && v<80000){ const d=new Date(Math.round((v-25569)*86400000)); return new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()); }
  const s=String(v).trim(); let m=s.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2,4})$/);
  if(m){ let y=+m[3]; if(y<100) y+=2000; return new Date(y,+m[2]-1,+m[1]); }
  m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(m) return new Date(+m[1],+m[2]-1,+m[3]);
  return null;
}
function langOf(v){ const n=norm(v); if(n==="TA"||n.startsWith("TAM")) return "ta"; if(n==="HI"||n.startsWith("HIN")) return "hi"; if(n==="EN"||n.startsWith("ENG")) return "en"; return ""; }
const overKey = name => state.company+":"+norm(name);
const moKey = name => `${state.company}:${state.y}-${String(state.m).padStart(2,"0")}:${norm(name)}`;
const getMo = name => state.mo[moKey(name)] || {};
function setMo(name, patch){ const k=moKey(name); state.mo[k] = Object.assign({}, state.mo[k], patch); hook("onMo", k, state.mo[k]); }
function setOver(name, patch){ const k=overKey(name); state.over[k] = Object.assign({}, state.over[k], patch); hook("onOver", k, state.over[k]); }

/* ================= Number to words ================= */
const EN1=["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
const EN10=["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
function en2(n){ return n<20? EN1[n] : EN10[Math.floor(n/10)] + (n%10? " "+EN1[n%10] : ""); }
function en3(n){ const h=Math.floor(n/100), r=n%100; return (h? EN1[h]+" Hundred"+(r?" ":"") : "") + (r? en2(r) : ""); }
function enWords(n){ if(n===0) return "Zero"; const p=[]; const cr=Math.floor(n/1e7); n%=1e7; const l=Math.floor(n/1e5); n%=1e5; const t=Math.floor(n/1e3); n%=1e3;
  if(cr) p.push(enWords(cr)+" Crore"); if(l) p.push(en2(l)+" Lakh"); if(t) p.push(en2(t)+" Thousand"); if(n) p.push(en3(n)); return p.join(" "); }
const HI = "शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानवे बानवे तिरानवे चौरानवे पंचानवे छियानवे सत्तानवे अट्ठानवे निन्यानवे".split(" ");
function hiWords(n){ if(n===0) return HI[0]; const p=[]; const cr=Math.floor(n/1e7); n%=1e7; const l=Math.floor(n/1e5); n%=1e5; const t=Math.floor(n/1e3); n%=1e3; const h=Math.floor(n/100); n%=100;
  if(cr) p.push(hiWords(cr)+" करोड़"); if(l) p.push(HI[l]+" लाख"); if(t) p.push(HI[t]+" हज़ार"); if(h) p.push(HI[h]+" सौ"); if(n) p.push(HI[n]); return p.join(" "); }
const TA1=["","ஒன்று","இரண்டு","மூன்று","நான்கு","ஐந்து","ஆறு","ஏழு","எட்டு","ஒன்பது"];
const TA1T=["பத்து","பதினொன்று","பன்னிரண்டு","பதிமூன்று","பதினான்கு","பதினைந்து","பதினாறு","பதினேழு","பதினெட்டு","பத்தொன்பது"];
const TA10=["","","இருபது","முப்பது","நாற்பது","ஐம்பது","அறுபது","எழுபது","எண்பது","தொண்ணூறு"];
const TA10C=["","","இருபத்தி","முப்பத்தி","நாற்பத்தி","ஐம்பத்தி","அறுபத்தி","எழுபத்தி","எண்பத்தி","தொண்ணூற்றி"];
const TA100=["","நூறு","இருநூறு","முன்னூறு","நானூறு","ஐநூறு","அறுநூறு","எழுநூறு","எண்ணூறு","தொள்ளாயிரம்"];
const TA100C=["","நூற்று","இருநூற்று","முன்னூற்று","நானூற்று","ஐநூற்று","அறுநூற்று","எழுநூற்று","எண்ணூற்று","தொள்ளாயிரத்து"];
function ta2(n){ if(n<10) return TA1[n]; if(n<20) return TA1T[n-10]; const t=Math.floor(n/10),u=n%10; return u? TA10C[t]+" "+TA1[u] : TA10[t]; }
function ta3(n){ const h=Math.floor(n/100), r=n%100; if(!h) return ta2(r); return r? TA100C[h]+" "+ta2(r) : TA100[h]; }
function taMult(n){ return ta2(n).replace(/ஒன்று$/,"ஒரு"); }
function taWords(n){ if(n===0) return "பூஜ்ஜியம்"; const p=[]; const cr=Math.floor(n/1e7); let rest=n%1e7; const l=Math.floor(rest/1e5); rest%=1e5; const t=Math.floor(rest/1e3); const u=rest%1e3;
  const more1 = (n%1e7)>0, more2 = (n%1e5)>0, more3 = u>0;
  if(cr) p.push((cr===1?"ஒரு":taWords(cr).replace(/ஒன்று$/,"ஒரு"))+(more1?" கோடியே":" கோடி"));
  if(l) p.push(taMult(l)+(more2?" லட்சத்து":" லட்சம்"));
  if(t) p.push(t===1? (more3?"ஆயிரத்து":"ஆயிரம்") : taMult(t)+(more3?" ஆயிரத்து":" ஆயிரம்"));
  if(u) p.push(ta3(u)); return p.join(" "); }
function wordsEN(v){ const neg=v<0; v=Math.abs(rnd(v)); return (neg?"Minus ":"")+"Rupees "+enWords(v)+" Only"; }
function wordsHI(v){ const neg=v<0; v=Math.abs(rnd(v)); return (neg?"ऋण ":"")+hiWords(v)+" रुपये मात्र"; }
function wordsTA(v){ const neg=v<0; v=Math.abs(rnd(v)); return (neg?"கழித்தல் ":"")+taWords(v)+" ரூபாய் மட்டும்"; }

/* ================= Labels ================= */
const L = {
  title:["Payslip","சம்பளச் சீட்டு","वेतन पर्ची"], period:["Pay period","ஊதியக் காலம்","वेतन अवधि"],
  name:["Employee name","பணியாளர் பெயர்","कर्मचारी का नाम"], empId:["Employee ID","பணியாளர் எண்","कर्मचारी कोड"],
  desig:["Designation","பதவி","पद"], doj:["Date of joining","சேர்ந்த தேதி","कार्यग्रहण तिथि"],
  uan:["UAN (PF)","UAN (PF)","UAN (PF)"], esiNo:["ESI number","ESI எண்","ESI संख्या"],
  rate:["Wage rate","ஊதிய விகிதம்","वेतन दर"], perMonth:["per month","மாதத்திற்கு","प्रति माह"], perDay:["per day","நாளொன்றுக்கு","प्रति दिन"],
  days:["Days worked","வேலை செய்த நாட்கள்","कार्य दिवस"], otHrs:["Overtime hours","கூடுதல் நேரம் (மணி)","ओवरटाइम (घंटे)"],
  mode:["Paid by","செலுத்தும் முறை","भुगतान माध्यम"], bank:["Bank transfer","வங்கி பரிமாற்றம்","बैंक ट्रांसफर"], cash:["Cash","ரொக்கம்","नकद"],
  group:["Category","பிரிவு","श्रेणी"], gPf:["PF & ESI","PF & ESI","PF और ESI"], gNo:["Without PF/ESI","PF/ESI இல்லாமல்","PF/ESI के बिना"],
  earnings:["Earnings","வருமானம்","आय"], deductions:["Deductions","பிடித்தங்கள்","कटौतियाँ"],
  basic:["Wages for days worked","வேலை நாட்களுக்கான ஊதியம்","कार्य दिवसों का वेतन"],
  ot:["Overtime wages","கூடுதல் நேர ஊதியம்","ओवरटाइम वेतन"],
  bonus:["Attendance bonus","வருகை ஊக்கத்தொகை","उपस्थिति बोनस"],
  round:["Rounding off","முழுமையாக்கல்","राउंड ऑफ"],
  totalEarn:["Total earnings","மொத்த வருமானம்","कुल आय"],
  esi:["ESI – employee share","ESI – தொழிலாளர் பங்கு","ESI – कर्मचारी अंश"],
  pf:["PF – employee share","PF – தொழிலாளர் பங்கு","PF – कर्मचारी अंश"],
  advance:["Advance recovery","முன்பணம் பிடித்தம்","अग्रिम वसूली"], totalDed:["Total deductions","மொத்த பிடித்தம்","कुल कटौती"],
  net:["Net pay","நிகர ஊதியம்","शुद्ध वेतन"], inWords:["In words","எழுத்தில்","शब्दों में"],
  advBal:["Advance balance still to be recovered","இன்னும் பிடிக்க வேண்டிய முன்பணம்","शेष अग्रिम राशि (वसूली बाकी)"],
  employer:["Paid by the company for you (not deducted from your pay)","உங்களுக்காக நிறுவனம் செலுத்தியது (உங்கள் ஊதியத்திலிருந்து பிடிக்கப்படவில்லை)","कंपनी द्वारा आपके लिए जमा (आपके वेतन से नहीं काटा गया)"],
  epsL:["Pension (EPS)","ஓய்வூதியம் (EPS)","पेंशन (EPS)"], epfErL:["PF – company share","PF – நிறுவனப் பங்கு","PF – कंपनी अंश"],
  edliL:["PF insurance (EDLI)","PF காப்பீடு (EDLI)","PF बीमा (EDLI)"], esiErL:["ESI – company share","ESI – நிறுவனப் பங்கு","ESI – कंपनी अंश"],
  pfWages:["PF wages","PF ஊதியம்","PF वेतन"], esiWages:["ESI wages","ESI ஊதியம்","ESI वेतन"],
  notDed:["{x} not deducted this month","இம்மாதம் {x} பிடிக்கப்படவில்லை","इस माह {x} नहीं काटा गया"],
  computer:["This is a computer-generated payslip.","இது கணினியில் உருவாக்கப்பட்ட சம்பளச் சீட்டு.","यह कंप्यूटर द्वारा बनाई गई वेतन पर्ची है।"],
  empSign:["Employee signature","பணியாளர் கையொப்பம்","कर्मचारी के हस्ताक्षर"], authSign:["Authorised signatory","அங்கீகரிக்கப்பட்ட கையொப்பம்","अधिकृत हस्ताक्षरकर्ता"],
  queries:["Questions about this payslip? Email","இந்தச் சீட்டு பற்றி சந்தேகமா? மின்னஞ்சல் அனுப்பவும்:","इस पर्ची के बारे में प्रश्न? ईमेल करें:"]
};
const REASONS = {
  probation:["On probation","தகுதிகாண் காலத்தில் உள்ளார்","परिवीक्षा अवधि में"],
  aadhaar:["Aadhaar card pending, so UAN/ESI number not yet created","ஆதார் அட்டை இல்லாததால் UAN/ESI எண் இன்னும் உருவாக்கப்படவில்லை","आधार कार्ड लंबित है, इसलिए UAN/ESI संख्या अभी नहीं बनी"],
  above:["Wages above the PF/ESI ceiling","ஊதியம் PF/ESI உச்சவரம்பை விட அதிகம்","वेतन PF/ESI सीमा से अधिक"],
  parttime:["Part-time / casual worker","பகுதி நேர / தற்காலிக பணியாளர்","अंशकालिक / अस्थायी कर्मचारी"],
  other:["Other reason (please ask the office)","இதர காரணம் (அலுவலகத்தை அணுகவும்)","अन्य कारण (कृपया कार्यालय से पूछें)"]
};
const LI = {en:0, ta:1, hi:2};
function tr(key, lang){ return L[key][LI[lang]||0]; }
function lab(key, lang, cls){ const e=L[key][0]; if(lang==="en" || L[key][LI[lang]]===e) return `<span class="lab ${cls||""}"><span class="en">${esc(e)}</span></span>`; return `<span class="lab ${cls||""}"><span class="en">${esc(e)}</span><span class="rg">${esc(L[key][LI[lang]])}</span></span>`; }
function labTxt(en, rg, lang){ return lang==="en"||!rg ? `<span class="lab"><span class="en">${esc(en)}</span></span>` : `<span class="lab"><span class="en">${esc(en)}</span><span class="rg">${esc(rg)}</span></span>`; }

/* ================= Excel columns ================= */
const SYN_PF = {
  sno:["SNO","SLNO","SERIALNO"], name:["NAME","EMPLOYEENAME"], rate:["12HRS","8HRS","RATE","SALARYRATE","MONTHLYSALARY","FIXEDSALARY","SALARY"],
  days:["NOOFWORKINGDAYS","WORKINGDAYS","DAYSWORKED","NOOFDAYS","DAYS"], otHrs:["OTHRS","OTHOURS"], basic:["BASICSALARY","BASIC","EARNEDBASIC"],
  gross:["GROSSWAGES","GROSS"], esi:["ESIC","ESI"], pf:["EPF","PF"], ot:["OTWAGES","OTSALARY"], advance:["ADVANCEDEDUCTION","ADVANCE"],
  payable:["PAYABLEWAGES","WAGESPAYABLE","NETPAY"], esiWages:["ESIWAGES"], esiEEc:["ESIEE"], pfWages:["EPFWAGES","PFWAGES"], pfEEc:["EPFEE"],
  eps:["EPSER","EPS"], epfER:["EPFER"], edli:["EDLI"] };
const SYN_NO = {
  sno:["SNO","SLNO","SERIALNO"], name:["NAME","EMPLOYEENAME"], rate:["BASICSALARY","RATE","SALARY","12HRS","8HRS","SALARYRATE"],
  days:["NOOFWORKINGDAYS","WORKINGDAYS","DAYSWORKED","NOOFDAYS","DAYS"], otHrs:["OT","OTHRS","OTHOURS"], basic:["GROSSWAGES","EARNEDWAGES","GROSS"],
  ot:["OTSALARY","OTWAGES"], net:["NETSALARY"], advance:["ADVANCE","ADVANCEDEDUCTION"], payable:["WAGESPAYABLE","PAYABLEWAGES","NETPAY"] };
const SYN_OPT = { empId:["EMPID","EMPLOYEEID","EMPCODE","EMPNO","EMPLOYEECODE"], desig:["DESIGNATION","ROLE"], doj:["DATEOFJOINING","DOJ","JOININGDATE","JOINEDON","DATEOFJOININGDDMMYYYY"],
  uan:["UAN","UANNO"], esiNo:["ESINO","ESINUMBER","IPNO","ESIIPNO"], lang:["LANGUAGE","LANG","LANGUAGEENTAHI"], mode:["PAYMENTMODE","MODE","PAIDBY","PAYMENT"],
  advBal:["ADVANCEBALANCE","ADVBALANCE","BALANCEADVANCE","ADVANCEBALANCEAFTERTHISMONTH"], bonus:["ATTENDANCEBONUS","ATTBONUS","BONUS"] };
const REQ = { pf:["name","rate","days","basic","esi","pf","advance","payable"], nopf:["name","rate","days","basic","advance","payable"] };
const PF_HINT = ["ESIC","EPF","ESIEE","EPFEE","EPFWAGES","ESIWAGES","EPSER","EDLI"];
const KNOWN_IGNORE = ["WAGESAFTERESICPF","NETWAGESBEFOREADVANCE","BASIDA","BASICDA","BASICPLUSDA","DEDUCTION","ESIANDPFCALCULATION","WAGESOTHERS"];
const FIELD_LABEL = { sno:"S.No", name:"Employee name", rate:"Wage rate", days:"Days worked", otHrs:"OT hours", basic:"Wages for days worked", gross:"Gross wages",
  esi:"ESI deduction", pf:"PF deduction", ot:"OT wages", net:"Net salary", advance:"Advance deduction", payable:"Payable wages", esiWages:"ESI wages",
  esiEEc:"ESI EE", pfWages:"EPF wages", pfEEc:"EPF EE", eps:"EPS (employer)", epfER:"EPF (employer)", edli:"EDLI", empId:"Employee ID", desig:"Designation",
  doj:"Date of joining", uan:"UAN", esiNo:"ESI number", lang:"Language", mode:"Payment mode", advBal:"Advance balance", bonus:"Attendance bonus" };
const MODE_VALS = ["AC","CASH","BANK","NEFT","UPI","GPAY","CHEQUE","IMPS","ACCOUNT"];

function sheetGrid(ws){
  const ref = XLSX.utils.decode_range(ws["!ref"]||"A1:A1");
  const fill = {};
  (ws["!merges"]||[]).forEach(mg=>{ const top = ws[XLSX.utils.encode_cell(mg.s)]; if(!top) return;
    for(let r=mg.s.r;r<=mg.e.r;r++) for(let c=mg.s.c;c<=mg.e.c;c++) fill[r+","+c]=top; });
  const cell = (r,c) => ws[XLSX.utils.encode_cell({r,c})] || null;
  const hdr = (r,c) => { const x = cell(r,c) || fill[r+","+c]; return x && x.v!=null ? String(x.v).trim() : ""; };
  return {ref, cell, hdr};
}
function cnum(x){ if(!x) return 0; if(typeof x.v==="number") return x.v; const n=parseFloat(String(x.v).replace(/[,₹\s]/g,"")); return isFinite(n)?n:0; }
function constList(f){ const out=[]; if(!f) return out; let s=String(f).replace(/^=/,"").trim(), m;
  while((m = s.match(/([+-])\s*(\d+(?:\.\d+)?)\s*$/))){ const before = s.slice(0, m.index).trim(); if(!before || /[*\/^(,]$/.test(before)) break;
    out.push((m[1]==="-"?-1:1)*parseFloat(m[2])); s = before; }
  return out; }

function parseWorkbook(wb){
  const out = { blocks:[], title:"", month:null, minCap:null, minCapCell:"" };
  const custom = state.colmap[state.company] || {};
  wb.SheetNames.forEach(sn=>{
    const ws = wb.Sheets[sn]; if(!ws || !ws["!ref"]) return;
    const G = sheetGrid(ws);
    for(let r=G.ref.s.r; r<=Math.min(G.ref.e.r, G.ref.s.r+4); r++) for(let c=G.ref.s.c; c<=Math.min(G.ref.e.c,G.ref.s.c+40); c++){
      const x=G.cell(r,c); if(!x||typeof x.v!=="string") continue; const t=x.v.toUpperCase();
      if(!out.title && r===G.ref.s.r) out.title = x.v.trim();
      if(!out.month){ const mm = t.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\b[\s'’.\-]*(\d{2,4})/); if(mm){ const mi=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"].indexOf(mm[1]); let y=+mm[2]; if(y<100) y+=2000; out.month={y,m:mi+1}; } }
    }
    if(!out.month){ const mm = sn.toUpperCase().match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s'’.\-]*(\d{2,4})/); if(mm){ let y=+mm[2]; if(y<100) y+=2000; out.month={y, m:["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"].indexOf(mm[1])+1}; } }
    for(let r=G.ref.s.r; r<=G.ref.e.r; r++) for(let c=G.ref.s.c; c<=G.ref.e.c; c++){
      const x=G.cell(r,c); if(!x) continue; const t=norm(x.v);
      if(!(SYN_PF.name.includes(t) || custom[t]==="name")) continue;
      const b = readBlock(G, r, c, sn, custom);
      if(b && b.isMaster){ out.master = Object.assign(out.master||{}, parseMaster({SheetNames:[sn], Sheets:{[sn]:ws}})); out.masterSheet = sn; continue; }
      if(b && b.rows.length) out.blocks.push(b);
      if(b && b.minCap!=null && out.minCap==null){ out.minCap=b.minCap; out.minCapCell=b.minCapCell; }
    }
  });
  return out;
}
function readBlock(G, r, cName, sheetName, custom){
  const has = (rr,cc) => G.hdr(rr,cc)!=="";
  let c0 = cName; if(cName>G.ref.s.c && has(r,cName-1)) c0 = cName-1;
  const snoNum = rr => { const x=G.cell(rr,c0); return x && typeof x.v==="number"; };
  let dataStart = r+1; while(dataStart<=r+3 && !snoNum(dataStart) && !(c0===cName && G.cell(dataStart,cName))) dataStart++;
  const hasSub = dataStart > r+1;
  const hasAt = cc => has(r,cc) || (hasSub && has(r+1,cc));
  const allSyn = Object.assign({}, SYN_PF, SYN_NO, SYN_OPT);
  const known = cc => { const ts=[norm(G.hdr(r,cc)), hasSub? norm(G.hdr(r+1,cc)):""]; return ts.some(t=>t && (custom[t] || Object.values(allSyn).some(l=>l.includes(t)))); };
  let c1 = cName;
  for(;;){ if(c1+1<=G.ref.e.c && hasAt(c1+1)){ c1++; continue; }
    let j=c1+2, ok=false; for(; j<=Math.min(c1+3,G.ref.e.c); j++){ if(hasAt(j)){ ok=known(j); break; } }
    if(ok){ c1=j; continue; } break; }
  const cols = [];
  for(let c=c0;c<=c1;c++){ const sub = hasSub? G.hdr(r+1,c) : "", main = G.hdr(r,c);
    cols.push({c, letter:XLSX.utils.encode_col(c), texts:[norm(sub), norm(main)].filter(Boolean), disp:(sub||main).replace(/\s+/g," ").trim()}); }
  const type = cols.some(col=>col.texts.some(t=>PF_HINT.includes(t) || ["esi","pf","esiWages","pfWages"].includes(custom[t]))) ? "pf" : "nopf";
  const syn = Object.assign({}, type==="pf"? SYN_PF : SYN_NO, SYN_OPT);
  const map = {}, extras = [], used = new Set(), mapHdr = {};
  for(const col of cols){ for(const t of col.texts){ const tg=custom[t]; if(!tg) continue;
      if(tg==="ignore"){ used.add(col.c); break; }
      if(tg==="earn"||tg==="ded"){ extras.push({c:col.c, label:col.disp, kind:tg, letter:col.letter}); used.add(col.c); break; }
      if(map[tg]==null){ map[tg]=col.c; mapHdr[tg]=col; used.add(col.c); break; } } }
  // Template extra columns: headers starting with EARNING / DEDUCTION get their own payslip line ("EARNING: Festival incentive")
  for(const col of cols){ if(used.has(col.c)) continue; const t0 = col.texts[0]||""; const m = t0.match(/^(EARNING|DEDUCTION)/);
    if(!m || t0==="DEDUCTION") continue;
    const kind = m[1]==="EARNING" ? "earn" : "ded";
    let label = col.disp.replace(/^\s*(earning|deduction)s?\s*\d*\s*[:\-–—]?\s*/i, "").trim();
    if(!label) label = kind==="earn" ? "Other earning" : "Other deduction";
    extras.push({c:col.c, label, kind, letter:col.letter}); used.add(col.c); }
  for(const col of cols){ if(used.has(col.c)) continue; for(const t of col.texts){ let hit=null;
      for(const k in syn){ if(map[k]!=null) continue; if(syn[k].includes(t)){ hit=k; break; } }
      if(hit){ map[hit]=col.c; mapHdr[hit]=col; used.add(col.c); break; } } }
  if(map.name==null){ map.name=cName; }
  // An "Employee details" sheet (name + details, no wages) is read as employee details, not as a payroll block
  if(map.rate==null && map.days==null && map.payable==null && ["empId","desig","doj","uan","esiNo","lang","advBal"].some(k=>map[k]!=null)) return { isMaster:true, sheet:sheetName };
  if(map.mode==null){ for(let c=c1+1;c<=Math.min(c1+2,G.ref.e.c);c++){ const vals=[]; for(let rr=dataStart; rr<dataStart+6; rr++){ const x=G.cell(rr,c); if(x&&x.v!=null) vals.push(norm(x.v)); }
      if(vals.length && vals.every(v=>MODE_VALS.includes(v))){ map.mode=c; mapHdr.mode={letter:XLSX.utils.encode_col(c), disp:"(no header – AC/CASH)"}; break; } } }
  // data rows
  const rows = []; let minCap=null, minCapCell="", lastRow=dataStart;
  for(let rr=dataStart; rr<=G.ref.e.r; rr++){
    const sno = map.sno!=null ? G.cell(rr,map.sno) : null; const nm = G.cell(rr,map.name);
    if(map.sno!=null){ if(!sno || typeof sno.v!=="number") break; } else if(!nm || typeof nm.v!=="string") break;
    lastRow = rr;
    if(!nm || nm.v==null || String(nm.v).trim()==="") continue;
    const o = { sheet:sheetName, row:rr+1, type, v:{}, f:{}, raw:{} };
    for(const k in map){ const x=G.cell(rr,map[k]); o.raw[k]=x? x.v : null; o.v[k]=cnum(x); o.f[k]= x && x.f ? String(x.f) : ""; }
    o.extras = extras.map(x=>({label:x.label, kind:x.kind, letter:x.letter, amt:cnum(G.cell(rr,x.c))}));
    o.name = String(nm.v).trim();
    o.letter = k => map[k]!=null ? XLSX.utils.encode_col(map[k]) : "";
    rows.push(o);
    if(type==="pf" && o.f.pfWages && minCap==null){ const mm=o.f.pfWages.match(/MIN\(\s*(\d+)/i); if(mm){ minCap=+mm[1]; minCapCell=XLSX.utils.encode_cell({r:rr,c:map.pfWages}); } }
  }
  // unrecognised columns
  const unknown = [], ignoredKnown = [];
  for(const col of cols){ if(used.has(col.c) || col.c===map.name || !col.disp) continue;
    if(col.texts.some(t=>KNOWN_IGNORE.includes(t))){ ignoredKnown.push(col); continue; }
    let numeric=false; for(let rr=dataStart; rr<=lastRow; rr++){ const x=G.cell(rr,col.c); if(x && typeof x.v==="number" && x.v!==0){ numeric=true; break; } }
    unknown.push({key:col.texts[0], disp:col.disp, letter:col.letter, numeric}); }
  const missing = REQ[type].filter(k=>map[k]==null);
  return { type, rows, map, mapHdr, extras, unknown, ignoredKnown, missing, minCap, minCapCell, sheet:sheetName,
           range:`${XLSX.utils.encode_col(c0)}–${XLSX.utils.encode_col(c1)}` };
}
function parseMaster(wb){
  const res = {};
  wb.SheetNames.forEach(sn=>{ const ws=wb.Sheets[sn]; if(!ws||!ws["!ref"]) return; const G=sheetGrid(ws);
    for(let r=G.ref.s.r;r<=Math.min(G.ref.e.r,G.ref.s.r+10);r++) for(let c=G.ref.s.c;c<=G.ref.e.c;c++){
      const x=G.cell(r,c); if(!x||norm(x.v)!=="NAME") continue;
      const map={}; for(let cc=G.ref.s.c; cc<=G.ref.e.c; cc++){ const t=norm(G.hdr(r,cc)); for(const k in SYN_OPT) if(map[k]==null && SYN_OPT[k].includes(t)) map[k]=cc; }
      for(let rr=r+1; rr<=G.ref.e.r; rr++){ const n=G.cell(rr,c); if(!n||n.v==null||String(n.v).trim()==="") continue;
        const o={}; for(const k in map){ const v=G.cell(rr,map[k]); o[k]= v? (k==="doj"? (v.v instanceof Date? v.v : (v.w && toDate(v.w)) || toDate(v.v)) : v.v) : null; }
        res[norm(n.v)] = o; }
      return; } });
  return res;
}
function reparse(){ ["salary","nopf"].forEach(k=>{ if(state.wb[k]) state.parsed[k] = parseWorkbook(state.wb[k]); }); }

/* ================= Build employees + checks ================= */
function allBlocks(){ const out=[];
  if(state.parsed.salary) state.parsed.salary.blocks.forEach(b=>out.push(Object.assign({src:"salary", file:state.files.salary},b)));
  if(state.parsed.nopf) state.parsed.nopf.blocks.forEach(b=>out.push(Object.assign({src:"nopf", file:state.files.nopf},b)));
  return out; }
function buildEmployees(){
  state.notices = []; state.blockers = [];
  const master = state.parsed.master || {};
  const emps = []; const seen = {};
  const ceil = pfCeiling();
  allBlocks().forEach(b=>{
    const where = `${b.file} · sheet ${b.sheet} · ${b.type==="pf"?"PF & ESI":"without PF/ESI"} block`;
    if(b.missing.length){ state.blockers.push(`${where}: required column${b.missing.length>1?"s":""} not found: <b>${b.missing.map(k=>FIELD_LABEL[k]).join(", ")}</b>. Match ${b.missing.length>1?"them":"it"} under “Columns read”.`); return; }
    const pend = b.unknown.filter(u=>u.numeric);
    if(pend.length) state.blockers.push(`${where}: new column${pend.length>1?"s":""} with amounts: <b>${pend.map(u=>`“${esc(u.disp)}” (${u.letter})`).join(", ")}</b>. Choose what ${pend.length>1?"they are":"it is"} under “Columns read”.`);
    b.rows.forEach(row=>{
      const key = b.type+":"+norm(row.name);
      if(seen[key]){ state.notices.push({sev:"warn", html:`<b>${esc(row.name)}</b> appears twice (${esc(seen[key])} and row ${row.row}). Only the first is used.`}); return; }
      seen[key] = "row "+row.row;
      emps.push(evaluate(row, b, master[norm(row.name)]||{}, ceil));
    });
  });
  emps.forEach((e,i)=>e.idx=i);
  state.emps = emps;
  const P = state.parsed.salary;
  if(P){
    const co = COMPANIES[state.company];
    if(P.title){ const t=norm(P.title); const other = Object.entries(COMPANIES).find(([k,c])=>k!==state.company && t.includes(norm(c.legal)));
      if(other) state.blockers.push(`The salary sheet title says <b>${esc(P.title)}</b>, but <b>${esc(co.name)}</b> is selected in Step 1.`); }
    if(P.minCap!=null && Math.abs(P.minCap-ceil)>0.5) state.notices.push({sev:"err", html:`The EPF WAGES formula (cell ${esc(P.minCapCell)}) caps PF wages at <b>₹${numfmt(P.minCap)}</b>, but the ceiling for ${MONTHS[state.m-1]} ${state.y} is <b>₹${numfmt(ceil)}</b>. Change <code>MIN(${P.minCap},…)</code> to <code>MIN(${ceil},…)</code> in every row.`});
    if(!P.blocks.length) state.blockers.push(`No employee rows found in ${esc(state.files.salary)}. The sheet needs a header cell that says <b>NAME</b>.`);
  }
  if(state.parsed.nopf && !state.parsed.nopf.blocks.length) state.blockers.push(`No employee rows found in ${esc(state.files.nopf)}. The sheet needs a header cell that says <b>NAME</b>.`);
}

function evaluate(row, block, ms, ceil){
  const v=row.v, f=row.f, t=row.type;
  const e = { key:t+":"+norm(row.name), name:row.name, group:t, row:row.row, sheet:row.sheet, src:block.src, flags:[] };
  const flag = (sev, text, extra) => e.flags.push(Object.assign({sev, text}, extra||{}));
  const pick = k => (row.raw[k]!=null && row.raw[k]!=="" ? row.raw[k] : (ms[k]!=null && ms[k]!=="" ? ms[k] : null));
  e.empId = pick("empId"); e.desig = pick("desig"); e.uan = pick("uan"); e.esiNo = pick("esiNo");
  e.doj = toDate(pick("doj")); e.advBal = pick("advBal"); e.advBal = e.advBal==null? null : (+e.advBal||0);
  const modeV = norm(pick("mode")); e.mode = modeV==="CASH" ? "cash" : (modeV ? "bank" : "");
  e.langSheet = langOf(pick("lang"));
  const ov = state.over[overKey(row.name)] || {};
  e.lang = ov.lang || e.langSheet || "en";
  e.reason = ov.reason || "";
  const mo = getMo(row.name);
  const tol = +S.tol || 1;
  const col = k => row.letter(k) ? `column ${row.letter(k)}` : "";

  e.rate = v.rate; e.days = v.days; e.otHrs = v.otHrs;
  e.rateType = e.rate>0 && e.rate < S.dailyMax ? "daily" : "monthly";
  e.monthlyEquiv = e.rateType==="daily" ? e.rate*S.baseDays : e.rate;
  e.basic = v.basic;
  const cOT = constList(f.ot).map(a=>({a, k:"ot"}));
  // values-only sheet: OT that is exactly one bonus above the expected OT is treated as a bonus hidden in OT
  { const r0=v.rate, rt = r0>0 && r0 < S.dailyMax ? "daily":"monthly"; const eo = rt==="daily" ? r0/S.dailyOtDiv*v.otHrs : r0/S.baseDays/S.otHoursPerDay*v.otHrs;
    if(!f.ot && S.bonusAmt && r0>0 && Math.abs(v.ot - eo - S.bonusAmt) <= (+S.tol||1)) cOT.push({a:+S.bonusAmt, k:"otv"}); }
  const cPay = constList(f.payable).map(a=>({a, k:"payable"}));
  const cNet = t==="nopf" ? constList(f.net).map(a=>({a, k:"net"})) : [];
  const consts = [...cOT, ...cPay, ...cNet];
  e.otConst = sum(cOT.map(x=>x.a));
  e.ot = v.ot - e.otConst;
  e.esi = t==="pf"? v.esi : 0; e.pf = t==="pf"? v.pf : 0;
  e.advance = v.advance; e.payable = v.payable;
  e.extras = (row.extras||[]).filter(x=>Math.abs(x.amt)>0.004);
  const exE = sum(e.extras.filter(x=>x.kind==="earn").map(x=>x.amt)), exD = sum(e.extras.filter(x=>x.kind==="ded").map(x=>x.amt));
  const bonusCol = block.map.bonus!=null ? v.bonus : 0;
  e.residual = r2(e.payable - (e.basic + e.ot + bonusCol + exE - exD - e.esi - e.pf - e.advance));
  e.esiWagesCol = v.esiWages; e.pfWagesCol = v.pfWages; e.eps = v.eps; e.epfER = v.epfER; e.edli = v.edli;

  // ---- attendance bonus & added amounts ----
  const B = +S.bonusAmt || 0;
  let hits = consts.filter(x=>B && Math.abs(x.a-B) < 0.005);
  let fromValue = false;
  const formulaConsts = consts.filter(x=>x.k!=="otv");
  if(!formulaConsts.length && B && bonusCol===0){
    const rest = e.residual - sum(consts.map(x=>x.a));
    if(Math.abs(rest - B) <= tol){ hits.push({a:B,k:"value"}); fromValue=true; }
    else if(Math.abs(rest - 2*B) <= tol){ hits.push({a:B,k:"value"},{a:B,k:"value"}); fromValue=true; }
  }
  const bonusFromExtra = bonusCol>0 ? 0 : (hits.length ? B : 0);
  e.bonus = bonusCol + bonusFromExtra;
  e.dupBonus = hits.length>1 || (bonusCol>0 && hits.length>0);
  e.addOther = r2(e.residual - bonusFromExtra);
  if(Math.abs(e.addOther) < 0.005) e.addOther = 0;
  e.addReason = (mo.addReason||"").trim();
  const where = x => x.k==="otv" ? `the OT wages (${col("ot")}), which are ₹${numfmt(x.a)} more than OT hours × rate` : x.k==="ot" ? `the OT wages formula (${col("ot")})` : x.k==="payable" ? `the payable formula (${col("payable")})` : x.k==="net" ? `the net salary formula (${col("net")})` : "the payable amount";
  if(e.bonus>0 && !e.dupBonus) flag("info", bonusCol>0 ? `Attendance bonus ${fmt0(e.bonus)} from the bonus column.` : (fromValue && hits[0].k==="value") ? `Payable is ₹${numfmt(B)} more than earnings − deductions; treated as the attendance bonus.` : `Attendance bonus ₹${numfmt(B)} ${hits[0].k==="otv"?"found in":"typed into"} ${where(hits[0])}.`);
  if(e.dupBonus) flag("err", `Attendance bonus counted twice: ${bonusCol>0? `bonus column ${col("bonus")} and `:""}${hits.map(x=>`₹${numfmt(x.a)} in ${where(x)}`).join(" and ")}. Fix the Excel, or type below what the extra amount is for.`);
  if(e.addOther){
    const otherConsts = consts.filter(x=>!(B && Math.abs(x.a-B)<0.005));
    const src = otherConsts.length ? `in ${otherConsts.map(where).join(" and ")}` : (e.dupBonus ? "(the second bonus)" : "— payable doesn't equal earnings − deductions");
    const txt = `${e.addOther>0?"Extra amount":"Amount deducted"} of ${fmt2(Math.abs(e.addOther))} ${src}.`;
    if(e.addReason) flag("info", `${txt} Shown on the payslip as “${e.addReason}”.`);
    else flag("act", `${txt} Type what it is for; this becomes its line on the payslip.`, {block:true, needsAdd:true});
  }
  const wd = workingDays();
  if(e.bonus>0 && e.days < wd){
    if(mo.bonusOk) flag("info", `Attendance bonus confirmed with ${numfmt(e.days)} of ${wd} working days.`);
    else flag("act", `Attendance bonus given, but worked ${numfmt(e.days)} of ${wd} working days. Tick to confirm it is correct.`, {block:true, needsBonus:true});
  }
  if(e.bonus===0 && !hits.length && e.basic>0 && e.days >= wd) flag("warn", `Worked ${numfmt(e.days)} of ${wd} working days but no attendance bonus was given.`);

  // ---- attendance / arithmetic ----
  if(e.days===0 && Math.abs(e.payable)<0.005){ flag("info","No days worked this month. Left out of the payslips (tick Include to add it)."); e.defaultInclude=false; }
  else e.defaultInclude=true;
  if(e.payable < -0.004) flag("err",`Payable is negative (${fmt2(e.payable)}). Advance recovery of ${fmt0(e.advance)} is more than the wages earned.`);
  const expBasic = e.rateType==="daily" ? e.rate*e.days : e.rate/S.baseDays*e.days;
  if(e.rate>0 && Math.abs(expBasic - e.basic) > tol) flag("warn",`Wages for days worked are ${fmt2(e.basic)} in the sheet; expected ${fmt2(expBasic)} (${e.rateType==="daily"? `₹${numfmt(e.rate)} × ${numfmt(e.days)} days` : `₹${numfmt(e.rate)} ÷ ${S.baseDays} × ${numfmt(e.days)} days`}).`);
  if(t==="pf" && block.map.gross!=null && Math.abs(v.gross - v.basic) > tol) flag("warn",`Gross wages (${fmt2(v.gross)}) differ from wages for days worked (${fmt2(v.basic)}). If OT is added to gross and again to net, it is counted twice.`);
  const expOT = e.rateType==="daily" ? e.rate/S.dailyOtDiv*e.otHrs : e.rate/S.baseDays/S.otHoursPerDay*e.otHrs;
  if(e.rate>0 && Math.abs(expOT - e.ot) > tol){
    const alt = e.rateType==="daily" ? e.rate/S.otHoursPerDay*e.otHrs : null;
    flag("warn",`OT wages are ${fmt2(e.ot)}; expected ${fmt2(expOT)} for ${numfmt(e.otHrs)} hrs (${e.rateType==="daily"? `daily rate ÷ ${S.dailyOtDiv} hrs` : `rate ÷ ${S.baseDays} ÷ ${S.otHoursPerDay} hrs`}).` + (alt!=null && Math.abs(alt-e.ot)<=tol ? ` The sheet uses an ${S.otHoursPerDay}-hour day for this person.` : ""));
  }
  if(t==="nopf" && block.map.net!=null){ const netExp = e.basic + v.ot; if(Math.abs((v.net - sum(cNet.map(x=>x.a))) - netExp) > tol) flag("warn",`Net salary column (${fmt2(v.net)}) is not wages + OT salary (${fmt2(netExp)}).`); }

  // ---- statutory ----
  const pfWagesExp = Math.min(ceil, Math.round(e.basic*S.pfWagePct/100));
  e.pfWagesExp = pfWagesExp; e.pfExp = Math.round(pfWagesExp*S.pfEE/100);
  const esiCovered = e.monthlyEquiv <= S.esiCeiling;
  const esiExempt = e.rateType==="daily" && e.rate <= S.esiExemptDaily;
  e.esiCovered = esiCovered;
  const esiBase = Math.round(e.basic) + e.ot;   // attendance bonus kept out of ESI wages
  e.esiExp = esiCovered && !esiExempt ? ceilR(esiBase*S.esiEE/100) : 0;
  const pfMandatory = Math.round(e.monthlyEquiv*S.pfWagePct/100) <= ceil;
  e.missing = [];
  if(t==="pf"){
    if(e.basic>0){
      if(esiCovered && e.esi===0 && e.esiExp>0){ e.missing.push("ESI"); }
      else if(esiCovered && e.esi>0 && Math.abs(e.esi-e.esiExp)>tol){
        let why = "";
        if(e.otConst && Math.abs(e.esi - ceilR((esiBase+e.otConst)*S.esiEE/100))<=tol) why = ` The sheet's ESI wages include the ₹${numfmt(e.otConst)} typed into the OT formula; the attendance bonus is kept out of ESI wages.`;
        else if(Math.abs(e.esi - ceilR(Math.round(e.basic)*S.esiEE/100))<=tol) why = " The sheet leaves OT out of ESI wages; OT counts as wages for ESI.";
        flag("warn",`ESI is ${fmt0(e.esi)}; expected ${fmt0(e.esiExp)} (${S.esiEE}% of ESI wages ${fmt2(esiBase)}: wages + OT, without the bonus).${why}`);
      }
      if(!esiCovered && e.esi>0) flag("warn",`Rate (${fmt0(e.monthlyEquiv)}/month) is above the ₹${numfmt(S.esiCeiling)} ESI ceiling, yet ₹${numfmt(e.esi)} ESI was deducted` + (Math.abs(ceilR(e.ot*S.esiEE/100)-e.esi)<=tol || Math.abs(e.esiWagesCol - e.ot)<=tol || Math.abs(e.esiWagesCol - v.ot)<=tol ? " — on OT wages only. Either the person is covered (deduct on all wages) or not (deduct nothing)." : ". Check whether this employee is covered for this contribution period."));
      if(e.pf===0 && e.pfExp>0) e.missing.push("PF");
      else if(e.pf>0 && Math.abs(e.pf-e.pfExp)>tol) flag("warn",`PF is ${fmt0(e.pf)}; expected ${fmt0(e.pfExp)} (${S.pfEE}% of PF wages ${fmt0(pfWagesExp)} = ${S.pfWagePct}% of ${fmt0(e.basic)}, capped at the ₹${numfmt(ceil)} ceiling).`);
      if(e.pf>0 && block.map.eps!=null && e.eps===0) flag("info","No pension (EPS) share; the full employer 12% goes to PF. Fine if the employee is 58+ or not eligible for EPS.");
      if(e.missing.length){
        const txt = `No ${e.missing.join(" or ")} deducted although the wages are within the ceiling (expected ${e.missing.map(x=>x==="PF"? "PF "+fmt0(e.pfExp) : "ESI "+fmt0(e.esiExp)).join(", ")}).`;
        flag(e.reason? "info":"warn", e.reason? txt+" Reason recorded: "+REASONS[e.reason][0]+"." : txt+" Choose a reason; it is printed on the payslip.", {needsReason:true});
      }
    }
  } else {
    const within = [];
    if(pfMandatory) within.push("PF"); if(esiCovered && !esiExempt) within.push("ESI");
    e.missing = within.length? within : ["PF","ESI"];
    if(within.length){
      const txt = `Not on PF/ESI, but wages are within the ${within.join(" and ")} ceiling${within.length>1?"s":""}.`;
      flag(e.reason? "info":"warn", e.reason? txt+" Reason recorded: "+REASONS[e.reason][0]+"." : txt+" Choose a reason; it is printed on the payslip.", {needsReason:true});
    } else { if(!e.reason) e.reasonAuto="above"; }
    if(e.doj){
      const monthEnd = new Date(state.y, state.m, 0);
      const d = Math.floor((monthEnd - e.doj)/86400000);
      if(d > S.newJoinerDays) flag("warn",`Joined ${fmtDate(e.doj)}: ${d} days by month end. The ${S.newJoinerDays}-day period is over; move to the PF & ESI sheet.`);
      else flag("info",`Joined ${fmtDate(e.doj)}: day ${Math.max(d,0)} of ${S.newJoinerDays}.`);
    } else flag("info","No joining date. Add it in the employee details file to track the 3-month period.");
  }
  e.esiWagesShow = e.esiWagesCol || (e.esi>0? esiBase : 0);
  e.esiER = e.esi>0 ? ceilR(e.esiWagesShow*S.esiER/100) : 0;
  const order = {act:0, err:1, warn:2, info:3};
  e.flags.sort((a,b)=>order[a.sev]-order[b.sev]);
  return e;
}

function blocked(e){ return e.flags.some(f=>f.block); }
function statusOf(e){
  const sess = state.session[e.key] || {};
  const inc = sess.include!=null ? sess.include : e.defaultInclude;
  if(!inc) return "off";
  if(blocked(e)) return "act";
  const open = e.flags.filter(x=>x.sev==="warn"||x.sev==="err");
  if(!open.length) return "ok";
  if(sess.reviewed) return "rev";
  return open.some(x=>x.sev==="err") ? "err" : "warn";
}
const included = e => { const s=state.session[e.key]||{}; return s.include!=null? s.include : e.defaultInclude; };

/* ================= Payslip ================= */
function slipLines(e){
  const earn=[], ded=[];
  earn.push({k:"basic", a:rnd(e.basic), x: e.rateType==="daily"? `${numfmt(e.days)} × ₹${numfmt(e.rate)}` : `₹${numfmt(e.rate)} ÷ ${S.baseDays} × ${numfmt(e.days)}`});
  if(Math.abs(e.ot)>0.004 || e.otHrs) earn.push({k:"ot", a:rnd(e.ot), x: e.otHrs? `${numfmt(e.otHrs)} hrs` : ""});
  if(e.bonus>0) earn.push({k:"bonus", a:rnd(e.bonus)});
  e.extras.filter(x=>x.kind==="earn").forEach(x=>earn.push({k:"txt", t:x.label, a:rnd(x.amt)}));
  if(e.addOther>0) earn.push({k:"txt", t:e.addReason||"Other addition", a:rnd(e.addOther)});
  if(e.esi>0) ded.push({k:"esi", a:rnd(e.esi), x:`${S.esiEE}%`});
  if(e.pf>0) ded.push({k:"pf", a:rnd(e.pf), x:`${S.pfEE}%`});
  if(e.group==="pf"){ if(!ded.some(d=>d.k==="esi") && e.esiCovered) ded.push({k:"esi",a:0,x:`${S.esiEE}%`}); if(!ded.some(d=>d.k==="pf")) ded.push({k:"pf",a:0,x:`${S.pfEE}%`}); }
  if(e.advance) ded.push({k:"advance", a:rnd(e.advance)});
  e.extras.filter(x=>x.kind==="ded").forEach(x=>ded.push({k:"txt", t:x.label, a:rnd(x.amt)}));
  if(e.addOther<0) ded.push({k:"txt", t:e.addReason||"Other deduction", a:rnd(-e.addOther)});
  const net = rnd(e.payable);
  let te = sum(earn.map(x=>x.a)), td = sum(ded.map(x=>x.a));
  const diff = net - (te - td);
  if(diff>0) earn.push({k:"round", a:diff}); else if(diff<0) ded.push({k:"round", a:-diff});
  te = sum(earn.map(x=>x.a)); td = sum(ded.map(x=>x.a));
  return {earn, ded, te, td, net};
}
function slipHTML(e, langOverride){
  const lang = langOverride || e.lang || "en";
  const co = COMPANIES[state.company];
  const ln = slipLines(e);
  const mi = state.m-1;
  const monthEn = `${MONTHS[mi]} ${state.y}`;
  const monthRg = lang==="ta"? `${MONTHS_TA[mi]} ${state.y}` : lang==="hi"? `${MONTHS_HI[mi]} ${state.y}` : "";
  const lineLab = x => x.k==="txt" ? labTxt(x.t, "", lang) : lab(x.k, lang);
  const line = x => `<div class="ln"><div>${lineLab(x)}${x.x?`<span class="x">${esc(x.x)}</span>`:""}</div><div class="a">${amt0(x.a)}</div></div>`;
  const info = [];
  const cellI = (k, val) => info.push(`<div class="c"><div class="k">${lab(k,lang)}</div><div class="v">${val}</div></div>`);
  cellI("name", esc(e.name));
  cellI("group", lab(e.group==="pf"?"gPf":"gNo", lang));
  if(e.empId!=null) cellI("empId", esc(e.empId));
  if(e.desig) cellI("desig", esc(e.desig));
  if(e.doj) cellI("doj", esc(fmtDate(e.doj)));
  if(e.uan) cellI("uan", esc(e.uan));
  if(e.esiNo) cellI("esiNo", esc(e.esiNo));
  cellI("rate", `₹${numfmt(e.rate)} <span style="font-weight:400">${esc(tr(e.rateType==="daily"?"perDay":"perMonth","en"))}${lang!=="en"?" · "+esc(tr(e.rateType==="daily"?"perDay":"perMonth",lang)):""}</span>`);
  cellI("days", esc(numfmt(e.days)));
  cellI("otHrs", esc(numfmt(e.otHrs||0)));
  if(e.mode) cellI("mode", esc(tr(e.mode,"en")) + (lang!=="en"? " · "+esc(tr(e.mode,lang)) : ""));
  if(info.length%2) info[info.length-1] = info[info.length-1].replace('class="c"','class="c wide"');
  const pad = (arr, n) => { const out=arr.map(line); for(let i=arr.length;i<n;i++) out.push(`<div class="ln"><div>&nbsp;<span class="x">&nbsp;</span></div><div></div></div>`); return out.join(""); };
  const rowsN = Math.max(ln.earn.length, ln.ded.length);
  let note = "";
  const reasonKey = e.reason || e.reasonAuto || "";
  if(e.group==="nopf" || (e.missing.length && e.reason)){
    const x = e.group==="nopf" ? "PF/ESI" : e.missing.join("/");
    const en = L.notDed[0].replace("{x}",x) + (reasonKey? ": "+REASONS[reasonKey][0] : ".");
    const rg = lang==="en"? "" : L.notDed[LI[lang]].replace("{x}",x) + (reasonKey? ": "+REASONS[reasonKey][LI[lang]] : ".");
    note = `<div class="nt"><b>${esc(en)}</b>${rg?`<span class="rg">${esc(rg)}</span>`:""}</div>`;
  }
  let er = "";
  if(e.group==="pf" && (e.pf>0 || e.esi>0)){
    const ercells = [];
    if(e.pf>0){ ercells.push([labTxt(L.epsL[0]+` (${S.eps}%)`, lang!=="en"? L.epsL[LI[lang]]:"", lang), e.eps]);
      ercells.push([labTxt(L.epfErL[0]+` (${r2(S.pfEE-S.eps)}%)`, lang!=="en"? L.epfErL[LI[lang]]:"", lang), e.epfER]);
      if(e.edli) ercells.push([labTxt(L.edliL[0]+` (${S.edli}%)`, lang!=="en"? L.edliL[LI[lang]]:"", lang), e.edli]); }
    if(e.esi>0) ercells.push([labTxt(L.esiErL[0]+` (${S.esiER}%)`, lang!=="en"? L.esiErL[LI[lang]]:"", lang), e.esiER]);
    const wages = [];
    if(e.pf>0 && e.pfWagesCol) wages.push(`${esc(L.pfWages[0])}${lang!=="en"?" / "+esc(L.pfWages[LI[lang]]):""}: <b>₹${amt0(e.pfWagesCol)}</b>`);
    if(e.esi>0 && e.esiWagesShow) wages.push(`${esc(L.esiWages[0])}${lang!=="en"?" / "+esc(L.esiWages[LI[lang]]):""}: <b>₹${amt0(e.esiWagesShow)}</b>`);
    er = `<div class="er"><div class="eh">${esc(L.employer[0])}${lang!=="en"?`<span class="rg"> · ${esc(L.employer[LI[lang]])}</span>`:""}</div>
      <div class="eg">${ercells.map(c=>`<div><div class="k">${c[0]}</div><div class="v">₹${amt0(c[1])}</div></div>`).join("")}</div>
      ${wages.length?`<div style="margin-top:6px;font-size:10px;color:#4A5272">${wages.join(" &nbsp;·&nbsp; ")}</div>`:""}</div>`;
  }
  const advBal = e.advBal!=null ? `<div class="ab">${lab("advBal",lang)}<span class="a">₹${amt0(e.advBal)}</span></div>` : "";
  const wordsRg = lang==="ta"? wordsTA(ln.net) : lang==="hi"? wordsHI(ln.net) : "";
  const hdLeft = co.logo ? `<img src="${co.logo}" alt="${esc(co.name)}">` : co.mark ? `<div class="lockup"><img src="${co.mark}" alt=""><span class="co" style="color:${co.brand||"#172153"}">${esc(co.legal)}</span></div>` : `<div class="co">${esc(co.legal)}</div>`;
  const addr = [co.addr? esc(co.addr):"", [co.phone?"Ph: "+esc(co.phone):"", co.email? esc(co.email):""].filter(Boolean).join(" · "),
     [co.gstin?"GSTIN: <b>"+esc(co.gstin)+"</b>":"", co.pfCode?"PF Code: <b>"+esc(co.pfCode)+"</b>":""].filter(Boolean).join(" · "),
     co.esiCode?"ESI Code: <b>"+esc(co.esiCode)+"</b>":""].filter(Boolean).join("<br>");
  const q = co.email ? `${esc(L.queries[0])} <b>${esc(co.email)}</b>${lang!=="en"? `<br>${esc(L.queries[LI[lang]])} <b>${esc(co.email)}</b>`:""}` : "";
  return `<div class="slip">
    ${state.example?'<div class="ex">EXAMPLE</div>':""}
    <div class="hd"><div>${hdLeft}</div><div class="addr">${addr|| "&nbsp;"}</div></div>
    <div class="tbar"><div class="t">${esc(L.title[0])}${lang!=="en"?`<span class="rg">${esc(L.title[LI[lang]])}</span>`:""}</div>
      <div class="m"><div style="font-size:10.5px;color:#5B6380">${esc(L.period[0])}${lang!=="en"?" · "+esc(L.period[LI[lang]]):""}</div><div class="mv">${esc(monthEn)}${monthRg?` · ${esc(monthRg)}`:""}</div></div></div>
    <div class="info">${info.join("")}</div>
    <div class="money">
      <div class="col"><div class="h">${lab("earnings",lang)}<span class="amt">₹</span></div>${pad(ln.earn,rowsN)}<div class="sp"></div><div class="tot">${lab("totalEarn",lang)}<span class="a">${amt0(ln.te)}</span></div></div>
      <div class="col"><div class="h">${lab("deductions",lang)}<span class="amt">₹</span></div>${pad(ln.ded,rowsN)}<div class="sp"></div><div class="tot">${lab("totalDed",lang)}<span class="a">${amt0(ln.td)}</span></div></div>
    </div>
    <div class="net"><div class="nl">${esc(L.net[0])}${lang!=="en"?`<br><span class="rg">${esc(L.net[LI[lang]])}</span>`:""}</div><div class="nv">₹${amt0(ln.net)}</div>
      <div class="w"><span class="k">${esc(L.inWords[0])}:</span> <b>${esc(wordsEN(ln.net))}</b>${wordsRg?`<span class="rg"><span class="k">${esc(L.inWords[LI[lang]])}:</span> <b>${esc(wordsRg)}</b></span>`:""}</div></div>
    ${advBal}${note}${er}
    <div class="grow"></div>
    <div class="sig"><div><div class="above">&nbsp;</div><div class="s">${lab("empSign",lang)}</div></div><div><div class="above r">For ${esc(co.name)}</div><div class="s r">${lab("authSign",lang)}</div></div></div>
    <div class="ft"><span>${esc(L.computer[0])}${lang!=="en"?"<br>"+esc(L.computer[LI[lang]]):""}</span><span style="text-align:right">${q}</span></div>
  </div>`;
}

function slipOverflows(el){ const last = el.querySelector(".ft"); return el.scrollHeight > el.clientHeight + 1 || (last && last.getBoundingClientRect().bottom > el.getBoundingClientRect().top + 1123 - 20); }
function fitSlip(el){ if(slipOverflows(el)) el.classList.add("compact"); if(slipOverflows(el)) el.classList.add("compact2"); return !slipOverflows(el); }

/* ================= Rendering: setup ================= */
function renderSetup(){
  $("#companySeg").innerHTML = Object.entries(COMPANIES).map(([k,c])=>`<button type="button" data-co="${k}" aria-pressed="${state.company===k}">${esc(c.name)}</button>`).join("");
  $("#mSel").innerHTML = MONTHS.map((m,i)=>`<option value="${i+1}"${state.m===i+1?" selected":""}>${m}</option>`).join("");
  $("#ySel").value = state.y;
  const c = pfCeiling(); const auto = !(parseFloat(S.pfCeilOverride)>0);
  $("#ceilNote").textContent = `₹${numfmt(c)}` + (auto? (state.y*100+state.m===202609? " (Sept 2026 split: 16 days at ₹15,000 + 14 at ₹25,000)" : "") : " (override)");
  const wdAuto = !(parseFloat(S.workingDaysOverride)>0); const dim = new Date(state.y,state.m,0).getDate();
  $("#wdNote").textContent = `${workingDays()}` + (wdAuto? ` (${dim} days − ${dim-workingDaysAuto(state.y,state.m)} Sundays)` : " (set in rules)");
  $("#setGrid").innerHTML = SETFIELDS.map(([k,l,tp])=>`<div class="field"><label for="s_${k}">${esc(l)}</label><input id="s_${k}" data-set="${k}" type="${tp}" ${tp==="number"?'step="any"':""} value="${esc(S[k])}" ${hook("canEditSettings")===false?"disabled":""}></div>`).join("");
  const rb=$("#resetSet"); if(rb) rb.hidden = hook("canEditSettings")===false;
  const co = COMPANIES[state.company];
  $("#companyNote").innerHTML = !co.pfCode ? `<div class="notice info">${esc(co.name)}'s PF code is not added yet, so its payslips don't show one.</div>` : "";
}
function colsHTML(){
  const blocks = allBlocks(); if(!blocks.length) return "";
  const assignable = t => Object.keys(Object.assign({}, t==="pf"? SYN_PF : SYN_NO, SYN_OPT)).filter(k=>k!=="sno");
  return blocks.map(b=>{
    const pend = b.unknown.filter(u=>u.numeric);
    const bad = b.missing.length || pend.length;
    const st = b.missing.length ? `<span class="pill err">${b.missing.length} required missing</span>` : pend.length ? `<span class="pill warn">${pend.length} new column${pend.length>1?"s":""} to sort</span>` : `<span class="pill ok">All required columns found</span>`;
    const found = Object.keys(b.mapHdr).filter(k=>k!=="sno").map(k=>`<div class="cf"><b>${esc(FIELD_LABEL[k]||k)}</b>“${esc(b.mapHdr[k].disp)}” · col ${esc(b.mapHdr[k].letter)}</div>`);
    b.extras.forEach(x=>found.push(`<div class="cf"><b>Extra ${x.kind==="earn"?"earning":"deduction"}</b>“${esc(x.label)}” · col ${esc(x.letter)}</div>`));
    const miss = b.missing.map(k=>`<div class="cf miss"><b>${esc(FIELD_LABEL[k])}</b>Not found. Pick it from a column below, or fix the header in Excel.</div>`);
    const free = assignable(b.type).filter(k=>b.map[k]==null);
    const unk = b.unknown.map(u=>`<div class="unk${u.numeric?" need":""}"><span>Column ${esc(u.letter)} “<b>${esc(u.disp)}</b>”${u.numeric?" has amounts. What is it?":" (text) is not used."}</span>
      <select data-colmap="${esc(u.key)}" aria-label="What is column ${esc(u.letter)}"><option value="">— choose —</option><option value="ignore">Not needed (ignore)</option><option value="earn">Extra earning (own line on payslip)</option><option value="ded">Extra deduction (own line on payslip)</option>${free.map(k=>`<option value="${k}">${esc(FIELD_LABEL[k]||k)}${REQ[b.type].includes(k)?" (required)":""}</option>`).join("")}</select></div>`);
    const ign = b.ignoredKnown.length ? `<div class="hint">Not needed for payslips: ${b.ignoredKnown.map(c=>`“${esc(c.disp)}” (${c.letter})`).join(", ")}.</div>` : "";
    return `<details class="cols"${bad?" open":""}><summary>Columns read · ${esc(b.file)} · ${esc(b.sheet)} · ${b.type==="pf"?"PF & ESI":"without PF/ESI"} block (${esc(b.range)}) ${st}</summary>
      <div class="colbody">${miss.length?`<div class="colgrid">${miss.join("")}</div>`:""}${unk.join("")}<div class="colgrid">${found.join("")}</div>${ign}</div></details>`;
  }).join("") + (Object.keys(state.colmap[state.company]||{}).length ? `<div><button class="link" type="button" id="resetCols">Forget my column choices for ${esc(COMPANIES[state.company].name)}</button></div>` : "");
}
function renderFiles(){
  [["salary","Salary"],["nopf","Nopf"],["master","Master"]].forEach(([k,K])=>{
    const f = state.files[k]; $("#drop"+K).classList.toggle("has", !!f);
    $("#fn"+K).innerHTML = f? `${esc(f)} <button class="link clear" type="button" data-clear="${k}">remove</button>` : "";
  });
  $("#tplBtn").disabled = !state.emps.length;
  const n = [];
  if(state.example) n.push(`<div class="notice info"><b>Example data.</b> These are made-up employees so you can see how the tool works. Upload your own salary sheet to replace them.</div>`);
  if(state.parsed.salary){
    const P=state.parsed.salary; const nb = P.blocks.map(b=>`${b.rows.length} ${b.type==="pf"?"PF & ESI":"without PF/ESI"}`).join(" + ");
    n.push(`<div class="notice ok">Read <b>${esc(state.files.salary)}</b>: ${nb||"no"} employees${P.month?` · month detected: <b>${MONTHS[P.month.m-1]} ${P.month.y}</b>`:""}.</div>`);
  }
  state.blockers.forEach(h=>n.push(`<div class="notice err">${h}</div>`));
  state.notices.forEach(x=>n.push(`<div class="notice ${x.sev}">${x.html}</div>`));
  if(state.parsed.master){ const cnt = Object.keys(state.parsed.master).length; const matched = state.emps.filter(e=>state.parsed.master[norm(e.name)]).length;
    n.push(`<div class="notice ${matched<state.emps.length?"warn":"ok"}">Employee details: ${cnt} people in the file, matched to ${matched} of ${state.emps.length} employees by name.${matched<state.emps.length?" Names must be spelled the same in both files.":""}</div>`); }
  $("#fileNotices").innerHTML = n.join("");
  $("#colsPanel").innerHTML = colsHTML();
}

/* ================= Rendering: review ================= */
function renderReview(){
  const body = $("#reviewBody");
  if(!state.emps.length){
    body.innerHTML = `<div class="empty">
      <div class="s"><b>Upload the salary sheet</b><span>The same Excel you prepare each month. Columns are found by their header names.</span></div>
      <div class="s"><b>Every row is recalculated</b><span>Wages for days worked, OT, attendance bonus, ESI on the ₹21,000 ceiling, PF on the current ceiling, advances and net pay.</span></div>
      <div class="s"><b>Fix or accept each flag</b><span>Items marked “Action needed” must be answered before payslips can be made.</span></div>
      <div class="s"><b>One PDF per employee</b><span>English, or English with Tamil or Hindi, chosen per employee.</span></div></div>`;
    return;
  }
  const inc = state.emps.filter(included);
  const st = state.emps.map(statusOf);
  const att = st.filter(s=>s==="warn"||s==="err"||s==="act").length;
  const act = st.filter(s=>s==="act").length;
  const total = inc.reduce((s,e)=>s+slipLines(e).net,0);
  const pfN = inc.filter(e=>e.group==="pf").length, noN = inc.filter(e=>e.group==="nopf").length;
  const cnt = {all:state.emps.length, att, ok: st.filter(s=>s==="ok"||s==="rev").length, off: st.filter(s=>s==="off").length};
  const list = state.emps.filter((e,i)=> state.filter==="all" || (state.filter==="att" && (st[i]==="warn"||st[i]==="err"||st[i]==="act")) || (state.filter==="ok" && (st[i]==="ok"||st[i]==="rev")) || (state.filter==="off" && st[i]==="off"));
  const needR = state.emps.filter(e=>!e.reason && e.flags.some(f=>f.needsReason)).length;
  const pillTxt = {ok:"OK", warn:"Check", err:"Error", rev:"Reviewed", off:"Not included", act:"Action needed"};
  const rows = list.map(e=>{
    const s = statusOf(e); const lnz = slipLines(e); const isOpen = state.open===e.key;
    const langSel = `<select data-lang="${e.idx}" aria-label="Payslip language for ${esc(e.name)}">${[["en","English"],["ta","+ Tamil"],["hi","+ Hindi"]].map(([v,t])=>`<option value="${v}"${e.lang===v?" selected":""}>${t}</option>`).join("")}</select>`;
    let det = "";
    if(isOpen){
      const needs = e.flags.some(f=>f.needsReason) || e.group==="nopf";
      const reasonSel = needs ? `<div class="field"><label for="rs_${e.idx}">Reason PF/ESI not deducted (printed on payslip)</label><select id="rs_${e.idx}" data-reason="${e.idx}"><option value="">— choose —</option>${Object.entries(REASONS).map(([k,v])=>`<option value="${k}"${e.reason===k?" selected":""}>${esc(v[0])}</option>`).join("")}</select></div>` : "";
      const mo = getMo(e.name);
      const addInp = (e.addOther || e.addReason) ? `<div class="field actrow"><label for="ad_${e.idx}">What is the ${e.addOther>=0?"extra amount":"deducted amount"} of ${fmt0(Math.abs(e.addOther))} for? (payslip line name)</label><input type="text" id="ad_${e.idx}" data-addreason="${e.idx}" maxlength="40" placeholder="e.g. Travel allowance" value="${esc(mo.addReason||"")}"></div>` : "";
      const wd = workingDays();
      const bonusChk = (e.bonus>0 && e.days < wd) ? `<label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" data-bonusok="${e.idx}" ${mo.bonusOk?"checked":""}> Confirm attendance bonus with ${numfmt(e.days)} of ${wd} days</label>` : "";
      const sess = state.session[e.key]||{};
      const openFlags = e.flags.filter(f=>f.sev==="warn"||f.sev==="err").length;
      det = `<tr class="det"><td colspan="10"><div class="detgrid">
        <div style="display:grid;gap:10px;min-width:0">
          ${e.flags.length? `<ul class="flags">${e.flags.map(f=>`<li><span class="sev ${f.sev}">${f.sev==="act"?"ACTION":f.sev==="err"?"ERROR":f.sev==="warn"?"CHECK":"NOTE"}</span><span>${esc(f.text)}</span></li>`).join("")}</ul>` : `<div class="notice ok">Everything matches the rules.</div>`}
          <div class="kv"><span>Source</span><span>${esc(e.sheet)}, row ${e.row} (${e.src==="nopf"?"without-PF/ESI file":"salary sheet"})</span>
            <span>Rate</span><span>₹${numfmt(e.rate)} ${e.rateType==="daily"?"per day":"per month"}</span>
            <span>Payable in Excel</span><span>${fmt2(e.payable)} → payslip ${fmt0(lnz.net)}</span>
            ${e.group==="pf"?`<span>PF wages (sheet / expected)</span><span>₹${numfmt(e.pfWagesCol)} / ₹${numfmt(e.pfWagesExp)}</span><span>ESI covered</span><span>${e.esiCovered?"Yes":"No"} (₹${numfmt(e.monthlyEquiv)}/month vs ₹${numfmt(S.esiCeiling)})</span>`:""}
          </div>
        </div>
        <div class="ctrls">
          ${addInp}${bonusChk}${reasonSel}
          ${openFlags?`<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-reviewed="${e.idx}" ${sess.reviewed?"checked":""}> I've checked the flags above; mark as reviewed</label>`:""}
          <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-include="${e.idx}" ${included(e)?"checked":""}> Include in payslips</label>
          <button class="btn sm" type="button" data-preview="${e.idx}">Preview payslip</button>
        </div></div></td></tr>`;
    }
    return `<tr class="emp${s==="off"?" off":""}" data-row="${e.idx}" aria-expanded="${isOpen}">
      <td><span class="pill ${s}">${pillTxt[s]}</span></td>
      <td class="nm">${esc(e.name)}</td>
      <td class="grp">${e.group==="pf"?"PF & ESI":"Without PF/ESI"}</td>
      <td class="n">${numfmt(e.days)}</td>
      <td class="n">${fmt0(lnz.te)}</td>
      <td class="n">${fmt0(lnz.td)}</td>
      <td class="n"><b>${fmt0(lnz.net)}</b></td>
      <td>${langSel}</td>
      <td class="n">${e.flags.filter(f=>f.sev!=="info").length||""}</td>
      <td><button class="btn sm" type="button" data-preview="${e.idx}">View</button></td></tr>${det}`;
  }).join("");
  body.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="v">${inc.length}</div><div class="k">payslips to make (${pfN} PF &amp; ESI · ${noN} without)</div></div>
      <div class="stat ${act?"bad":att?"att":""}"><div class="v">${att}</div><div class="k">need attention${act?` · ${act} need action`:""}</div></div>
      <div class="stat"><div class="v">${fmt0(total)}</div><div class="k">total net pay</div></div>
      <div class="stat"><div class="v">₹${numfmt(pfCeiling())}</div><div class="k">PF ceiling used · ESI ₹${numfmt(S.esiCeiling)} · ${workingDays()} working days</div></div>
    </div>
    <div class="filters" style="margin:14px 0 10px">
      ${[["all","All"],["att","Need attention"],["ok","OK"],["off","Not included"]].map(([k,t])=>`<button class="chip" type="button" data-filter="${k}" aria-pressed="${state.filter===k}">${t} (${cnt[k]})</button>`).join("")}
      <span class="hint" style="margin-left:auto">Click a row to see its checks.</span>
    </div>
    <div class="row" style="margin-bottom:10px;gap:8px;align-items:center">
      <span class="hint">Set language for everyone:</span>
      <button class="btn sm" type="button" data-alllang="en">English</button><button class="btn sm" type="button" data-alllang="ta">+ Tamil</button><button class="btn sm" type="button" data-alllang="hi">+ Hindi</button>
    </div>
    ${needR? `<div class="row" style="margin-bottom:12px;gap:8px;align-items:center"><label class="hint" for="bulkReason">${needR} without a PF/ESI reason. Give them all:</label>
      <select id="bulkReason">${Object.entries(REASONS).map(([k,v])=>`<option value="${k}">${esc(v[0])}</option>`).join("")}</select>
      <button class="btn sm" type="button" id="bulkReasonBtn">Apply to the ${needR}</button></div>`:""}
    <div class="tablewrap"><table class="rev"><thead><tr><th>Status</th><th>Name</th><th>Group</th><th class="n">Days</th><th class="n">Earnings</th><th class="n">Deductions</th><th class="n">Net pay</th><th>Language</th><th class="n">Flags</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="10" class="hint" style="padding:16px">No employees in this filter.</td></tr>`}</tbody></table></div>`;
}

/* ================= Rendering: generate ================= */
function renderGen(){
  const body = $("#genBody");
  if(!state.emps.length && !state.blockers.length){ body.innerHTML = `<p class="hint" style="margin:0">Payslips can be made once a salary sheet is loaded.</p>`; return; }
  const inc = state.emps.filter(included);
  const blockedEmps = inc.filter(blocked);
  const att = state.emps.filter(e=>{ const s=statusOf(e); return s==="warn"||s==="err"; }).length;
  const gate = (!state.example && hook("monthGate")) || {};
  const stop = state.blockers.length || blockedEmps.length || gate.block;
  const g = state.gen;
  const tag = `${COMPANIES[state.company].code}_${state.y}-${String(state.m).padStart(2,"0")}`;
  const stopMsg = stop ? `<div class="notice err" style="margin-bottom:12px"><b>Payslips can't be made yet.</b>${state.blockers.length?` Fix the file problems listed in Step 2.`:""}${blockedEmps.length?` ${blockedEmps.length} employee${blockedEmps.length>1?"s need":" needs"} action: ${blockedEmps.slice(0,8).map(e=>`<button class="link" type="button" data-goto="${e.idx}">${esc(e.name)}</button>`).join(", ")}${blockedEmps.length>8?"…":""}. Or untick “Include” for them.`:""}</div>` : "";
  body.innerHTML = `${gate.html||""}${stopMsg}
    ${!stop && att? `<div class="notice warn" style="margin-bottom:12px"><b>${att} employee${att>1?"s":""} still ha${att>1?"ve":"s"} flags.</b> You can make the payslips anyway; they show the figures from your Excel.</div>`:""}
    <div class="row" style="align-items:center">
      <button class="btn primary" type="button" id="genBtn" ${!inc.length||stop||(g&&g.busy)?"disabled":""}>Make ${inc.length} payslip${inc.length!==1?"s":""}</button>
      <span class="hint">One A4 PDF per employee, named like <code>${tag}_01_NAME.pdf</code>, plus one combined file for printing. Amounts are rounded to the nearest rupee.</span>
    </div>
    ${g? `<div style="margin-top:14px;display:grid;gap:10px">
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${g.total}" aria-valuenow="${g.done}"><div style="width:${Math.round(100*g.done/Math.max(1,g.total))}%"></div></div>
      <div class="hint">${g.busy? `Making payslip ${g.done+1} of ${g.total}: ${esc(g.current||"")}` : g.error? esc(g.error) : `Done: ${g.total} payslips ready.`}</div>
      ${!g.busy && !g.error? `<div class="row"><button class="btn primary" type="button" id="saveZip">Save payslips (.zip)</button><button class="btn" type="button" id="saveAll">Save print file (one PDF)</button></div><div class="hint" id="saveMsg"></div>`:""}
    </div>`:""}${(!state.example && hook("genExtra"))||""}`;
}
function renderAll(){ renderSetup(); renderFiles(); renderReview(); renderGen(); }
function refresh(){ buildEmployees(); renderFiles(); renderReview(); renderGen(); hook("onContext"); }

/* ================= File loading ================= */
async function readFile(file){ const ab = await file.arrayBuffer(); return XLSX.read(ab, {type:"array", cellFormula:true, cellDates:true, cellNF:false}); }
async function loadFile(kind, file){
  try{
    const wb = await readFile(file);
    if(state.example){ state.example=false; state.wb.salary=null; state.parsed.salary=null; state.files.salary=null; }
    if(kind==="master"){ state.parsed.master = parseMaster(wb); hook("onMaster", state.parsed.master); }
    else {
      state.wb[kind] = wb; const p = parseWorkbook(wb); state.parsed[kind] = p;
      if(kind==="salary" && p.month){ state.y=p.month.y; state.m=p.month.m; reparse(); }
      if(p.master && Object.keys(p.master).length){ state.parsed.master = Object.assign({}, state.parsed.master||{}, p.master); state.files.master = `${file.name} · ${p.masterSheet} sheet`; hook("onMaster", p.master); }
    }
    state.files[kind] = file.name; state.gen=null;
    renderSetup(); refresh();
    if(kind==="salary") hook("onSalaryLoaded");
  }catch(err){ console.error(err); $("#fileNotices").insertAdjacentHTML("afterbegin", `<div class="notice err">Could not read ${esc(file.name)}: ${esc(err.message||err)}. Save it as .xlsx and try again.</div>`); }
}
function clearFile(kind){ state.files[kind]=null; state.parsed[kind]=null; if(kind!=="master") state.wb[kind]=null; if(kind==="salary") state.example=false; state.gen=null; refresh(); }

/* ================= Downloads ================= */
let dl = null; (async()=>{ try{ if(window.claude && claude.use) dl = await claude.use("downloads"); }catch(e){ dl=null; } })();
async function saveFile(filename, blob){
  if(dl){ try{ await dl.save({filename, data:blob}); return "saved"; }catch(err){ if(err && err.code==="declined") return "declined"; if(err && err.code==="rate_limited") return "busy"; if(!["unavailable","not_granted","capability_disabled","capability_removed"].includes(err&&err.code)) return "error:"+(err&&err.message||""); } }
  try{ const url = URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 30000); return "saved"; }
  catch(e){ return "error:"+e.message; }
}

/* ================= PDF generation ================= */
async function fontsReady(){ try{ await Promise.all([
  document.fonts.load('400 12px "Noto Sans"'), document.fonts.load('700 12px "Noto Sans"'),
  document.fonts.load('400 12px "Noto Sans Tamil"',"தமிழ்"), document.fonts.load('700 12px "Noto Sans Tamil"',"தமிழ்"),
  document.fonts.load('400 12px "Noto Sans Devanagari"',"हिन्दी"), document.fonts.load('700 12px "Noto Sans Devanagari"',"हिन्दी"),
  document.fonts.load('800 20px "Archivo"',"PAYSLIP") ]); await document.fonts.ready; }catch(e){} }
function fileSafe(s){ return String(s).toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_|_$/g,""); }
async function makePdfs(list, opt){
  opt = opt||{}; const scale = opt.scale||2, q = opt.quality||0.9;
  if(!window.html2canvas || !window.jspdf || !window.JSZip) throw new Error("The PDF tools did not load. Check the internet connection and reload the page.");
  await fontsReady();
  const { jsPDF } = window.jspdf;
  const all = new jsPDF({unit:"mm", format:"a4", compress:true});
  const zip = new JSZip();
  const tag = `${COMPANIES[state.company].code}_${state.y}-${String(state.m).padStart(2,"0")}`;
  const stage = $("#stage");
  for(let i=0;i<list.length;i++){
    const e = list[i]; if(opt.onStep) opt.onStep(i, e);
    stage.innerHTML = slipHTML(e);
    const imgs = stage.querySelectorAll("img"); await Promise.all([...imgs].map(im=> im.complete? 0 : new Promise(r=>{ im.onload=im.onerror=r; })));
    fitSlip(stage.firstElementChild);
    const canvas = await html2canvas(stage.firstElementChild, {scale, backgroundColor:"#ffffff", logging:false, useCORS:true, width:794, height:1123, windowWidth:900});
    const jpg = canvas.toDataURL("image/jpeg", q);
    const one = new jsPDF({unit:"mm", format:"a4", compress:true});
    one.setProperties({title:`Payslip ${e.name} ${MONTHS[state.m-1]} ${state.y}`, author:COMPANIES[state.company].name});
    one.addImage(jpg, "JPEG", 0, 0, 210, 297);
    if(i>0) all.addPage();
    all.addImage(jpg, "JPEG", 0, 0, 210, 297);
    zip.file(`${tag}_${String(i+1).padStart(2,"0")}_${fileSafe(e.name)}.pdf`, one.output("arraybuffer"));
    await new Promise(r=>setTimeout(r,0));
  }
  stage.innerHTML = "";
  all.setProperties({title:`Payslips ${COMPANIES[state.company].name} ${MONTHS[state.m-1]} ${state.y}`});
  return { zip: await zip.generateAsync({type:"blob"}), all: all.output("blob"), tag };
}
async function generate(){
  const inc = state.emps.filter(included);
  if(!inc.length || state.blockers.length || inc.some(blocked)) return;
  const gate = (!state.example && hook("monthGate")) || {}; if(gate.block) return;
  state.gen = {busy:true, done:0, total:inc.length, current:""}; renderGen();
  try{
    const r = await makePdfs(inc, {onStep:(i,e)=>{ state.gen.done=i; state.gen.current=e.name; renderGen(); }});
    Object.assign(state.gen, r, {busy:false, done:inc.length}); renderGen();
    if(!state.example) hook("onGenerated", {count:inc.length, total:sum(inc.map(e=>slipLines(e).net))});
  }catch(err){ console.error(err); state.gen = {busy:false, done:0, total:inc.length, error:"Could not make the payslips: "+(err.message||err)}; renderGen(); }
}
/* Saved copy of one employee's payslip figures (for Records / re-making later) */
const SNAP_KEYS = ["name","group","rate","rateType","days","otHrs","basic","ot","bonus","extras","addOther","addReason","esi","pf","advance","payable","esiCovered","missing","reason","reasonAuto","empId","desig","uan","esiNo","mode","advBal","lang","eps","epfER","edli","pfWagesCol","esiWagesShow","esiER"];
function snapshotEmp(e){ const o={}; SNAP_KEYS.forEach(k=>{ const v=e[k]; o[k] = v===undefined? null : v; }); o.doj = e.doj? e.doj.toISOString() : null; o.net = slipLines(e).net; return o; }
function empFromSnap(o){ const e=Object.assign({}, o); e.doj = o.doj? new Date(o.doj) : null; e.extras = o.extras||[]; e.missing = o.missing||[]; e.flags=[]; return e; }

/* ================= Template ================= */
async function downloadTemplate(){
  const m = state.parsed.master || {};
  const rows = [["NAME","GROUP","EMP ID","DESIGNATION","DATE OF JOINING (DD-MM-YYYY)","UAN","ESI NO","LANGUAGE (EN / TA / HI)","ADVANCE BALANCE (after this month)"]];
  state.emps.forEach(e=>{ const x=m[norm(e.name)]||{}; rows.push([e.name, e.group==="pf"?"PF & ESI":"Without PF/ESI", x.empId??e.empId??"", x.desig??e.desig??"", e.doj? fmtDate(e.doj) : "", x.uan??e.uan??"", x.esiNo??e.esiNo??"", (e.lang||"en").toUpperCase(), x.advBal??""]); });
  const ws = XLSX.utils.aoa_to_sheet(rows); ws["!cols"]=[{wch:24},{wch:16},{wch:10},{wch:18},{wch:18},{wch:15},{wch:14},{wch:14},{wch:18}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "EMPLOYEE DETAILS");
  const out = XLSX.write(wb, {bookType:"xlsx", type:"array"});
  const r = await saveFile(`${COMPANIES[state.company].code}_Employee_Details.xlsx`, new Blob([out], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  if(r.startsWith("error")) $("#fileNotices").insertAdjacentHTML("afterbegin", `<div class="notice err">Could not save the template. ${esc(r.slice(6))}</div>`);
}

/* ================= Example data ================= */
function exampleWorkbook(){
  const mon = `${MONTHS[state.m-1].toUpperCase()} ${state.y}`;
  const ws = {};
  const set = (a, v, f) => { ws[a] = typeof v==="number"? {t:"n", v} : {t:"s", v:String(v)}; if(f) ws[a].f=f; };
  set("A1", COMPANIES[state.company].legal); set("A2", "ESI AND PF WAGES "+mon);
  const H3 = {A:"SL.NO",B:"NAME",C:"12 HRS",D:"NO OF WORKING DAYS",E:"OT HRS",F:"BASIC SALARY",G:"GROSS WAGES",H:"DEDUCTION",J:"WAGES AFTER ESIC & PF",K:"OT WAGES",L:"NET WAGES BEFORE ADVANCE",M:"ADVANCE DEDUCTION",N:"PAYABLE WAGES",Q:"ESI AND PF CALCULATION"};
  const H4 = {H:"ESIC",I:"EPF",Q:"ESI WAGES",R:"ESI EE",S:"EPF WAGES",T:"EPF EE",U:"EPS ER",V:"EPF ER",W:"EDLI"};
  Object.entries(H3).forEach(([c,t])=>set(c+"3",t)); Object.entries(H4).forEach(([c,t])=>set(c+"4",t));
  const wd = workingDays();
  const people = [["EXAMPLE A.KUMAR",45000,26,0,0,0],["EXAMPLE S.LATHA",19000,wd,12,0,500],["EXAMPLE R.VIJAY",24000,25,30,2000,0],["EXAMPLE M.RAJ",750,wd,8,0,500],["EXAMPLE P.SURESH",780,24,0,1000,0]];
  people.forEach((p,i)=>{ const r=5+i; const [nm,rate,days,ot,adv,extra]=p; const daily=rate<5000;
    const F = daily? rate*days : rate/26*days; const K = daily? rate/12*ot : rate/26/8*ot;
    const cov = (daily? rate*26 : rate) <= 21000; const Q = cov? Math.round(F)+K : 0; const R = Math.ceil(Q*0.0075-1e-9);
    const S_ = Math.min(15000, Math.round(F*0.8)); const T = Math.round(S_*0.12); const U = Math.round(S_*0.0833);
    const noPF = i===4; const Tn = noPF?0:T, Rn = noPF?0:R;
    const N = F - Rn - Tn + K - adv + extra;
    set("A"+r,i+1); set("B"+r,nm); set("C"+r,rate); set("D"+r,days); set("E"+r,ot);
    set("F"+r,F, daily?`C${r}*D${r}`:`C${r}/26*D${r}`); set("G"+r,F,`F${r}`); set("H"+r,Rn, noPF?"":`R${r}`); set("I"+r,Tn, noPF?"":`T${r}`);
    set("J"+r,F-Rn-Tn,`G${r}-H${r}-I${r}`); set("K"+r,K, daily?`C${r}/12*E${r}`:`C${r}/26/8*E${r}`); set("L"+r,F-Rn-Tn+K,`J${r}+K${r}`);
    set("M"+r,adv); set("N"+r,N, extra?`L${r}-M${r}+${extra}`:`L${r}-M${r}`);
    set("Q"+r, noPF?0:Q); set("R"+r,Rn); set("S"+r,noPF?0:S_,`MIN(15000,ROUND(G${r}*80%,0))`); set("T"+r,Tn); set("U"+r,noPF?0:U); set("V"+r,noPF?0:Tn-U); set("W"+r,noPF?0:Math.round(S_*0.005));
  });
  set("Y4","WAGES OTHERS");
  ["S.NO","NAME","BASIC SALARY","NO.OF.WORKING DAYS","OT","GROSS WAGES","OT SALARY","NET SALARY","ADVANCE","WAGES PAYABLE"].forEach((t,i)=>set(XLSX.utils.encode_col(24+i)+"5",t));
  [["EXAMPLE K.ARUN",16000,24,10,1000,"AC"],["EXAMPLE D.RAM",600,22,6,0,"CASH"]].forEach((p,i)=>{ const r=6+i; const [nm,rate,days,ot,adv,mode]=p; const daily=rate<5000;
    const AD = daily? rate*days : rate/26*days; const AE = daily? rate/12*ot : rate/26/8*ot;
    [i+1,nm,rate,days,ot,AD,AE,AD+AE,adv,AD+AE-adv,mode].forEach((v,j)=>set(XLSX.utils.encode_col(24+j)+r, v)); });
  ws["!ref"]="A1:AI12"; ws["!merges"]=[XLSX.utils.decode_range("A1:M1"),XLSX.utils.decode_range("A2:M2"),XLSX.utils.decode_range("H3:I3"),XLSX.utils.decode_range("Q3:W3"),XLSX.utils.decode_range("Y4:AH4")];
  ["A","B","C","D","E","F","G","J","K","L","M","N"].forEach(c=>ws["!merges"].push(XLSX.utils.decode_range(`${c}3:${c}4`)));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "EXAMPLE");
  return XLSX.read(XLSX.write(wb,{bookType:"xlsx",type:"array"}), {type:"array", cellFormula:true});
}
function loadExample(){
  state.wb = {salary: exampleWorkbook(), nopf:null}; state.parsed.nopf=null; state.parsed.master=null;
  state.parsed.salary = parseWorkbook(state.wb.salary);
  state.files = {salary:"example-salary.xlsx", nopf:null, master:null}; state.example = true; state.gen=null;
  refresh(); renderSetup();
}

/* ================= Preview ================= */
let pvIdx = null;
function showPreview(idx){
  pvIdx = idx; const e = state.emps[idx];
  $("#pvTitle").textContent = e.name; $("#pvLang").value = e.lang;
  drawPreview(); const d=$("#pvDlg"); if(!d.open) d.showModal(); requestAnimationFrame(drawPreview);
}
function drawPreview(){
  if(pvIdx==null) return; const e = state.emps[pvIdx];
  const inner = $("#pvInner"); inner.innerHTML = slipHTML(e, $("#pvLang").value); fitSlip(inner.firstElementChild);
  const avail = Math.min(794, $("#pvDlg .dlg-b").clientWidth - 32);
  const sc = avail>0 ? avail/794 : 1;
  inner.style.transform = `scale(${sc})`; const box=$("#pvBox"); box.style.width = (794*sc)+"px"; box.style.height=(1123*sc)+"px";
}

/* ================= Events ================= */
document.addEventListener("click", async ev=>{
  const t = ev.target.closest("button, tr.emp, input[type=checkbox]"); if(!t) return;
  if(hook("onClick", t, ev)===true) return;
  if(t.dataset.co){ state.company=t.dataset.co; store.set("company",state.company); hook("onCompany"); state.gen=null; if(state.example){ loadExample(); return; } reparse(); renderSetup(); refresh(); return; }
  if(t.dataset.clear){ ev.preventDefault(); clearFile(t.dataset.clear); return; }
  if(t.dataset.filter){ state.filter=t.dataset.filter; renderReview(); return; }
  if(t.dataset.preview!=null){ ev.stopPropagation(); showPreview(+t.dataset.preview); return; }
  if(t.dataset.goto!=null){ const e=state.emps[+t.dataset.goto]; state.open=e.key; state.filter="all"; renderReview(); const tr=document.querySelector(`tr.emp[data-row="${e.idx}"]`); if(tr) tr.scrollIntoView({block:"center"}); return; }
  if(t.dataset.alllang){ state.emps.forEach(e=>setOver(e.name,{lang:t.dataset.alllang})); state.gen=null; refresh(); return; }
  if(t.dataset.reviewed!=null){ const e=state.emps[+t.dataset.reviewed]; state.session[e.key]=Object.assign({},state.session[e.key],{reviewed:t.checked}); renderReview(); renderGen(); return; }
  if(t.dataset.include!=null){ const e=state.emps[+t.dataset.include]; state.session[e.key]=Object.assign({},state.session[e.key],{include:t.checked}); state.gen=null; renderReview(); renderGen(); return; }
  if(t.dataset.bonusok!=null){ const e=state.emps[+t.dataset.bonusok]; setMo(e.name,{bonusOk:t.checked}); state.gen=null; refresh(); return; }
  if(t.matches("tr.emp")){ if(ev.target.closest("select")) return; const e=state.emps[+t.dataset.row]; state.open = state.open===e.key? null : e.key; renderReview(); return; }
  if(t.id==="genBtn"){ generate(); return; }
  if(t.id==="saveZip"||t.id==="saveAll"){ const g=state.gen; const msg=$("#saveMsg");
    const r = t.id==="saveZip"? await saveFile(`${g.tag}_Payslips.zip`, g.zip) : await saveFile(`${g.tag}_Payslips_Print.pdf`, g.all);
    if(msg) msg.textContent = r==="saved"? "Saved." : r==="declined"? "Not saved." : r==="busy"? "A save prompt is already open." : "Could not save: "+r.slice(6); return; }
  if(t.id==="tplBtn"){ downloadTemplate(); return; }
  if(t.id==="exampleBtn"){ loadExample(); return; }
  if(t.id==="bulkReasonBtn"){ const r=$("#bulkReason").value; state.emps.forEach(e=>{ if(!e.reason && e.flags.some(f=>f.needsReason)) setOver(e.name,{reason:r}); }); state.gen=null; refresh(); return; }
  if(t.id==="resetCols"){ delete state.colmap[state.company]; hook("onColmap", state.company, {}); reparse(); state.gen=null; refresh(); return; }
  if(t.id==="pvClose"){ $("#pvDlg").close(); return; }
  if(t.id==="resetSet"){ if(hook("canEditSettings")===false) return; S=Object.assign({},DEF); hook("onSettings", S); state.gen=null; renderSetup(); refresh(); return; }
});
document.addEventListener("change", ev=>{
  const t=ev.target;
  if(t.id==="fSalary"&&t.files[0]) loadFile("salary", t.files[0]);
  else if(t.id==="fNopf"&&t.files[0]) loadFile("nopf", t.files[0]);
  else if(t.id==="fMaster"&&t.files[0]) loadFile("master", t.files[0]);
  else if(t.id==="mSel"||t.id==="ySel"){ state.m=+$("#mSel").value; state.y=+$("#ySel").value||state.y; state.gen=null; renderSetup(); refresh(); }
  else if(t.dataset.set){ if(hook("canEditSettings")===false) return; const k=t.dataset.set; S[k] = t.type==="number"? (parseFloat(t.value)||0) : t.value; hook("onSettings", S); state.gen=null; renderSetup(); refresh(); }
  else if(t.dataset.lang!=null){ const e=state.emps[+t.dataset.lang]; setOver(e.name,{lang:t.value}); e.lang=t.value; state.gen=null; renderGen(); }
  else if(t.dataset.reason!=null){ const e=state.emps[+t.dataset.reason]; setOver(e.name,{reason:t.value}); state.gen=null; refresh(); }
  else if(t.dataset.addreason!=null){ const e=state.emps[+t.dataset.addreason]; setMo(e.name,{addReason:t.value.trim()}); state.gen=null; refresh(); }
  else if(t.dataset.colmap!=null){ const cm = state.colmap[state.company] = state.colmap[state.company] || {}; if(t.value) cm[t.dataset.colmap]=t.value; else delete cm[t.dataset.colmap]; hook("onColmap", state.company, cm); reparse(); state.gen=null; refresh(); }
  else if(t.id==="pvLang") drawPreview();
  if(t.type==="file") t.value="";
});
["Salary","Nopf","Master"].forEach(K=>{ const d=$("#drop"+K); d.addEventListener("dragover",e=>{e.preventDefault(); d.classList.add("over");}); d.addEventListener("dragleave",()=>d.classList.remove("over")); d.addEventListener("drop",e=>{ e.preventDefault(); d.classList.remove("over"); const f=e.dataTransfer.files[0]; if(f) loadFile(K==="Salary"?"salary":K==="Nopf"?"nopf":"master", f); }); });
$("#pvDlg").addEventListener("click", e=>{ if(e.target.id==="pvDlg") $("#pvDlg").close(); });
window.addEventListener("resize", ()=>{ if($("#pvDlg").open) drawPreview(); });

window.coreStart = function(){ renderAll(); try{ if(window.XLSX) loadExample(); }catch(e){ console.error(e); } };
