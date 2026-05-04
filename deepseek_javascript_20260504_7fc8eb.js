"use strict";

// ═══════════════════════════════════════════════
// Multi‑outlet engine — parses Apps Script JSON,
// stores all tabs, and injects the active one
// into the global dashboard arrays.
// ═══════════════════════════════════════════════

var SHEET_COLORS = ['#f59e0b','#60a5fa','#22c55e','#a78bfa','#f87171','#38bdf8','#e879f9','#facc15','#4ade80','#fb923c','#818cf8','#2dd4bf'];
var SHEET_DATA = {};
var SHEET_REGISTRY = [];
var activeSheetId = '';

function loadRegistry(){
  try { SHEET_REGISTRY = JSON.parse(localStorage.getItem('sjp_outlets')||'[]'); } catch(e){ SHEET_REGISTRY=[]; }
  activeSheetId = localStorage.getItem('sjp_active_outlet')||'';
  if(!activeSheetId && SHEET_REGISTRY.length) {
    var last = SHEET_REGISTRY[SHEET_REGISTRY.length-1];
    var tabs = Object.keys(SHEET_DATA).filter(function(k){ return SHEET_DATA[k].outletId === last.id; });
    if(tabs.length) activeSheetId = tabs[tabs.length-1];
  }
}

function saveRegistry(){
  localStorage.setItem('sjp_outlets', JSON.stringify(SHEET_REGISTRY));
  localStorage.setItem('sjp_active_outlet', activeSheetId);
}

// ── Safe numeric parser: empty / null / undefined → 0 ──
function safeNum(val) {
  if (val === '' || val === null || val === undefined || val === 'NA') return 0;
  var n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

// ── Parse the multi‑tab Apps Script JSON ──
function parseAppsScriptTabs(json){
  if(json.status !== 'success' || !json.tabs) throw new Error('Invalid multi‑tab response');
  var parsedTabs = {};

  json.tabs.forEach(function(tab){
    var data = tab.data;
    if(!data || !data.length) return;

    // Employee‑data tabs are stored separately
    if(tab.name.toLowerCase().indexOf('employee') !== -1) {
      window.TEAM_DATA = data;
      return;
    }

    var keys = Object.keys(data[0]);
    // Date keys are everything except the fixed metadata columns
    var dateKeys = keys.filter(function(k){
      var kl = k.toLowerCase().trim();
      return kl !== 'particulars' && kl !== 'target' && kl !== 'run rate' && kl !== 'mtd' && k !== '';
    });

    // ── Helper: find a row by case‑insensitive substring ──
    var findRow = function(name){
      var nl = name.toLowerCase().trim();
      return data.find(function(x){
        return x.Particulars && String(x.Particulars).toLowerCase().trim().indexOf(nl) !== -1;
      });
    };

    // ── Helper: get numeric value from row & date‑key ──
    var getVal = function(row, dKey){
      if(!row) return 0;
      return safeNum(row[dKey]);
    };

    // ── Locate core rows (flexible matching) ──
    var revRow = findRow('Net Revenue') || findRow('Revenue');
    var rmRow  = findRow('RM Indent');
    var cpRow  = findRow('CP Indent');
    var pkRow  = findRow('Packaging');
    var hkRow  = findRow('HK Materials');
    var guRow  = findRow('Gail Gas consumption Unit') || findRow('Gas consumption Unit');
    var gvRow  = findRow('Gail gas consumption Value') || findRow('Gas consumption Value');
    var wqRow  = findRow('Water consumption Unit');
    var wvRow  = findRow('Water consumption Value');
    // Petty cash – matches "Total Petty cash expenses " with trailing space
    var ptRow  = findRow('Petty cash');

    // ── Dynamic TARGET from the Net Revenue row ──
    var tgt = 14200000;   // fallback
    if(revRow && revRow['Target'] !== undefined && revRow['Target'] !== '' && revRow['Target'] !== 'NA') {
      var pt = parseFloat(revRow['Target']);
      if(!isNaN(pt) && pt > 1000) tgt = pt;   // skip tiny ratio values
    }

    // ── Collect ALL rows into TARGETS, RUN_RATES, MTDS ──
    var TARGETS = {}, RUN_RATES = {}, MTDS = {};
    // dynamicRows will hold day‑by‑day arrays for every non‑core row
    var dynamicRows = {};

    data.forEach(function(row){
      var p = (row.Particulars || '').trim();
      if(!p) return;
      TARGETS[p]  = safeNum(row['Target']);
      RUN_RATES[p] = safeNum(row['Run Rate']);
      MTDS[p]      = safeNum(row['MTD']);

      var pLower = p.toLowerCase();
      // Skip core rows (they are handled separately below)
      if(pLower.indexOf('net revenue') !== -1 || pLower === 'revenue') return;
      if((pLower.indexOf('rm indent') !== -1 || pLower.indexOf('cp indent') !== -1) && pLower.indexOf('total') === -1) return;
      if(pLower.indexOf('packaging') !== -1 && pLower.indexOf('total') === -1) return;
      if(pLower.indexOf('hk material') !== -1 && pLower.indexOf('total') === -1) return;
      if(pLower.indexOf('gail gas') !== -1 && pLower.indexOf('total') === -1) return;
      if(pLower.indexOf('gas consumption') !== -1 && pLower.indexOf('total') === -1 && pLower.indexOf('lpg') === -1) return;
      if(pLower.indexOf('water consumption') !== -1 && pLower.indexOf('total') === -1) return;
      if(pLower.indexOf('petty cash') !== -1) return;

      // Everything else → dynamic
      dynamicRows[p] = [];
    });

    // ── Populate daily arrays ──
    var nd=[], nr=[], nrm=[], ncp=[], npk=[], nhk=[], ngu=[], ngv=[], nwq=[], nwv=[], npt=[];

    for(var i=0; i<dateKeys.length; i++){
      var dKey = dateKeys[i];
      var rv = revRow ? revRow[dKey] : '';

      // Skip future dates that have no revenue
      if(rv === '' || rv === null || rv === undefined) continue;

      // ── Friendly date formatting ──
      var parts = dKey.split('\n');
      var dStr = parts.length > 1 ? parts[1] : parts[0];
      var match = dStr.match(/(\d{1,2})\s*([a-zA-Z]{3,})/);
      if(match){
        var dateNum = match[1];
        var monthStr = match[2].substring(0,3);
        var dObj = new Date(dateNum + ' ' + monthStr + ' 2026');
        if(!isNaN(dObj.getTime())){
          var dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
          dStr = dayNames[dObj.getDay()] + ' ' + dateNum + ' ' + monthStr;
        }
      }

      nd.push(dStr);
      nr.push(parseFloat(rv) || 0);
      nrm.push(getVal(rmRow, dKey));
      ncp.push(getVal(cpRow, dKey));
      npk.push(getVal(pkRow, dKey));
      nhk.push(getVal(hkRow, dKey));
      ngu.push(getVal(guRow, dKey));
      ngv.push(getVal(gvRow, dKey));
      nwq.push(getVal(wqRow, dKey));
      nwv.push(getVal(wvRow, dKey));
      npt.push(getVal(ptRow, dKey));

      // Dynamic rows
      Object.keys(dynamicRows).forEach(function(dr){
        var dynRow = findRow(dr);
        dynamicRows[dr].push(getVal(dynRow, dKey));
      });
    }

    // ── MONTH_DAYS from actual data ──
    var actualMonthDays = nd.length || dateKeys.length || 30;

    parsedTabs[tab.name] = {
      DATES: nd, REV: nr, RM: nrm, CP: ncp, PKG: npk, HK: nhk,
      GASU: ngu, GASV: ngv, WATQ: nwq, WATV: nwv, PETTY: npt,
      TARGET: tgt, MONTH_DAYS: actualMonthDays,
      DYNAMIC: dynamicRows,
      TARGETS: TARGETS,
      RUN_RATES: RUN_RATES,
      MTDS: MTDS
    };
  });
  return parsedTabs;
}

// ── Fetch one outlet by URL, store in SHEET_DATA ──
async function fetchOutletData(outletId, url){
  var r = await fetch(url);
  var json = await r.json();
  var parsedTabs = parseAppsScriptTabs(json);

  var savedKeys = [];
  Object.keys(parsedTabs).forEach(function(tabName){
    var compositeId = outletId + '__' + tabName;
    parsedTabs[tabName].id = compositeId;
    parsedTabs[tabName].outletId = outletId;
    parsedTabs[tabName].tabName = tabName;
    SHEET_DATA[compositeId] = parsedTabs[tabName];
    savedKeys.push(compositeId);
  });
  return savedKeys;
}

// ── Apply a sheet's data to global arrays ──
function applySheetToGlobals(compositeId){
  var d = SHEET_DATA[compositeId];
  if(!d) return;
  function inject(arr,vals){ arr.length=0; for(var i=0;i<vals.length;i++) arr.push(vals[i]); }
  inject(DATES,d.DATES); inject(REV,d.REV); inject(RM,d.RM); inject(CP,d.CP);
  inject(PKG,d.PKG); inject(HK,d.HK); inject(GASU,d.GASU); inject(GASV,d.GASV);
  inject(WATQ,d.WATQ); inject(WATV,d.WATV); inject(PETTY,d.PETTY);
  window.TARGET = d.TARGET;
  window.MONTH_DAYS = d.MONTH_DAYS;
  window.DYNAMIC_DATA = d.DYNAMIC || {};
  window.TARGETS = d.TARGETS || {};
  window.RUN_RATES = d.RUN_RATES || {};
  window.MTDS = d.MTDS || {};
  activeSheetId = compositeId;
  saveRegistry();
}

// ── Switch active sheet ──
function switchActiveSheet(compositeId){
  if(!compositeId||!SHEET_DATA[compositeId]) return;
  applySheetToGlobals(compositeId);
  var d = SHEET_DATA[compositeId];
  var entry = SHEET_REGISTRY.find(function(s){return s.id===d.outletId;});
  document.getElementById('hdrTitle').innerHTML = (entry?entry.label:'Dashboard')+' - '+d.tabName;
  document.getElementById('hdrSub').textContent = 'MIS Dashboard · '+DATES.length+' days · Jagan';
  killAllCharts();
  Object.keys(builtPages).forEach(function(k){ delete builtPages[k]; });
  renderUI();
  setTimeout(function(){ buildPageCharts('overview'); },80);
  document.getElementById('srcInfoEl').textContent = 'Active: '+(entry?entry.label:'')+' ('+d.tabName+') · '+DATES.length+' days';
}

// ── Render outlet list on Data Source page ──
function renderSheetList(){
  var el = document.getElementById('sheetListEl');
  if(!SHEET_REGISTRY.length){ el.innerHTML='<div style="text-align:center;padding:24px;color:var(--m1);font-size:12px">No outlets added yet.</div>'; return; }

  el.innerHTML = SHEET_REGISTRY.map(function(s){
    var outletTabs = Object.keys(SHEET_DATA).filter(function(k){ return SHEET_DATA[k].outletId === s.id; });
    var isSynced = outletTabs.length > 0;
    var statusColor = isSynced ? '#22c55e' : '#f59e0b';
    var sid = s.id;

    var html = '<div class="sheet-card" style="border-color:var(--b2); flex-direction:column; align-items:stretch;">'
      +'<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--b1); padding-bottom:12px; margin-bottom:12px;">'
        +'<div style="display:flex; align-items:center; gap:12px;">'
          +'<div class="sheet-dot" style="background:'+s.color+'"></div>'
          +'<div class="sheet-info">'
            +'<div class="sheet-label">'+s.label+'</div>'
            +'<div class="sheet-url">'+s.url.substring(0,60)+'...</div>'
            +'<div class="sheet-meta" style="color:'+statusColor+'">'+(isSynced?'[OK] '+outletTabs.length+' months found':'[WAIT] Not synced')+(s.lastSynced?' · '+s.lastSynced:'')+'</div>'
          +'</div>'
        +'</div>'
        +'<div class="sheet-actions">'
          +'<button class="icon-btn" data-action="sync" data-sid="'+sid+'" title="Sync Outlet">Sync</button>'
          +'<button class="icon-btn" data-action="edit" data-sid="'+sid+'" title="Edit">Edit</button>'
          +'<button class="icon-btn danger" data-action="remove" data-sid="'+sid+'" title="Remove">Remove</button>'
        +'</div>'
      +'</div>';

    if(isSynced) {
      html += '<div style="display:flex; gap:8px; flex-wrap:wrap;">';
      outletTabs.forEach(function(compKey){
         var d = SHEET_DATA[compKey];
         var isAct = (compKey === activeSheetId);
         html += '<button data-action="activate" data-sid="'+compKey+'" style="background:'+(isAct?'#166534':'var(--s2)')+'; border:1px solid '+(isAct?'#22c55e':'var(--b2)')+'; color:'+(isAct?'#fff':'var(--m1)')+'; padding:4px 10px; border-radius:12px; font-size:11px; cursor:pointer;">'
              + d.tabName + ' ('+d.DATES.length+'d)'
              + '</button>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }).join('');

  el.onclick = function(ev){
    var btn = ev.target.closest('[data-action]');
    if(!btn) return;
    var action = btn.getAttribute('data-action');
    var sid = btn.getAttribute('data-sid');
    if(action==='activate') setActiveSheet(sid);
    else if(action==='sync') syncOneSheet(sid);
    else if(action==='edit') editSheet(sid);
    else if(action==='remove') removeSheet(sid);
  };
}

function setActiveSheet(compositeId){
  if(!SHEET_DATA[compositeId]){ showToast('Sync this sheet first.'); return; }
  switchActiveSheet(compositeId);
  renderSheetList();
  renderSheetDropdown();
  document.querySelectorAll('.nav-btn').forEach(function(b){ b.classList.remove('active'); });
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  document.querySelector('[data-page="overview"]').classList.add('active');
  document.getElementById('page-overview').classList.add('active');
  setTimeout(function(){ buildPageCharts('overview'); }, 80);
}

function renderSheetDropdown(){
  var sel = document.getElementById('sheetSelectorDrop');
  sel.innerHTML = '<option value="">-- Select Month --</option>';
  SHEET_REGISTRY.forEach(function(s){
    var outletTabs = Object.keys(SHEET_DATA).filter(function(k){ return SHEET_DATA[k].outletId === s.id; });
    if(outletTabs.length) {
      sel.innerHTML += '<optgroup label="'+s.label+'">';
      outletTabs.forEach(function(compKey){
         var d = SHEET_DATA[compKey];
         sel.innerHTML += '<option value="'+compKey+'"'+(compKey===activeSheetId?' selected':'')+'>'+d.tabName+' ('+d.DATES.length+'d)</option>';
      });
      sel.innerHTML += '</optgroup>';
    } else {
      sel.innerHTML += '<option value="" disabled>'+s.label+' (Not synced)</option>';
    }
  });
  sel.value = activeSheetId || '';
}

function openAddSheet(){
  document.getElementById('addSheetModalTitle').textContent = '+ Add Outlet';
  document.getElementById('addSheetLabel').value = '';
  document.getElementById('addSheetUrl').value = '';
  document.getElementById('addSheetEditId').value = '';
  document.getElementById('addSheetErr').textContent = '';
  openModal('addSheetModal');
}

function editSheet(id){
  var s = SHEET_REGISTRY.find(function(x){return x.id===id;});
  if(!s) return;
  document.getElementById('addSheetModalTitle').textContent = 'Edit Outlet';
  document.getElementById('addSheetLabel').value = s.label;
  document.getElementById('addSheetUrl').value = s.url;
  document.getElementById('addSheetEditId').value = id;
  document.getElementById('addSheetErr').textContent = '';
  openModal('addSheetModal');
}

async function saveSheet(){
  var label = document.getElementById('addSheetLabel').value.trim();
  var url = document.getElementById('addSheetUrl').value.trim();
  var editId = document.getElementById('addSheetEditId').value;
  if(!label||!url){ document.getElementById('addSheetErr').textContent='Both fields required.'; return; }
  if(url.indexOf('/macros/s/')===-1){ document.getElementById('addSheetErr').textContent='Must be an Apps Script /exec URL.'; return; }

  if(editId){
    var existing = SHEET_REGISTRY.find(function(x){return x.id===editId;});
    if(existing){ existing.label=label; existing.url=url; }
  } else {
    var id = 'outlet_'+Date.now();
    SHEET_REGISTRY.push({id:id, label:label, url:url, color:SHEET_COLORS[SHEET_REGISTRY.length%SHEET_COLORS.length], lastSynced:null});
    editId = id;
  }
  saveRegistry();
  closeModal('addSheetModal');
  renderSheetList();
  renderSheetDropdown();
  populateAnaSelectors();
  await syncOneSheet(editId);
}

function removeSheet(id){
  SHEET_REGISTRY = SHEET_REGISTRY.filter(function(s){return s.id!==id;});
  Object.keys(SHEET_DATA).forEach(function(k){
    if(SHEET_DATA[k].outletId === id) delete SHEET_DATA[k];
  });
  if(activeSheetId && activeSheetId.indexOf(id)===0){ activeSheetId=''; DATES.length=0; REV.length=0; }
  saveRegistry(); renderSheetList(); renderSheetDropdown(); populateAnaSelectors();
}

async function syncOneSheet(id){
  var s = SHEET_REGISTRY.find(function(x){return x.id===id;});
  if(!s) return;
  try{
    var savedKeys = await fetchOutletData(id, s.url);
    s.lastSynced = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    saveRegistry();
    renderSheetList();
    renderSheetDropdown();
    populateAnaSelectors();
    if((!activeSheetId || activeSheetId.indexOf(id)===0) && savedKeys.length){
      switchActiveSheet(savedKeys[savedKeys.length-1]);
    }
  } catch(e){
    showToast('[ERR] Failed: '+e.message);
  }
}

async function syncAllSheets(){
  showToast('Syncing all outlets...');
  for(var i=0;i<SHEET_REGISTRY.length;i++){
    await syncOneSheet(SHEET_REGISTRY[i].id);
  }
  showToast('[OK] All outlets synced!');
}

// ═══════════════════════════════════════════════
// ANALYSIS ENGINE (cross‑sheet compare)
// ═══════════════════════════════════════════════
function populateAnaSelectors(){
  var opts = '';
  SHEET_REGISTRY.forEach(function(s){
    var outletTabs = Object.keys(SHEET_DATA).filter(function(k){ return SHEET_DATA[k].outletId === s.id; });
    if(outletTabs.length) {
      opts += '<optgroup label="'+s.label+'">';
      outletTabs.forEach(function(compKey){
         opts += '<option value="'+compKey+'">'+s.label+' - '+SHEET_DATA[compKey].tabName+'</option>';
      });
      opts += '</optgroup>';
    }
  });
  ['anaDateSheetA','anaDateSheetB','anaWeekSheetA','anaWeekSheetB'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.innerHTML = '<option value="">-- Select --</option>'+opts;
  });
}

function populateAnaDates(side){
  var compositeId = document.getElementById('anaDateSheet'+side).value;
  var sel = document.getElementById('anaDate'+side);
  sel.innerHTML = '<option value="">-- Date --</option>';
  if(!compositeId||!SHEET_DATA[compositeId]) return;
  SHEET_DATA[compositeId].DATES.forEach(function(d,i){ sel.innerHTML+='<option value="'+i+'">'+d+'</option>'; });
}

function deltaPill(a,b){
  if(!a||!b) return '';
  var pct=((a-b)/b*100).toFixed(1);
  var cls=pct>0?'delta-pos':pct<0?'delta-neg':'delta-neu';
  return '<span class="delta-pill '+cls+'">'+(pct>0?'Up ':'Dn ')+Math.abs(pct)+'%</span>';
}

function cmpSection(title){
  return '<div style="margin:24px 0 10px;padding:8px 12px;background:var(--s2);border-radius:8px;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--amb);border-left:3px solid var(--amb)">'+title+'</div>';
}

function cmpRow(label,a,b,fmt){
  var va=fmt?fmt(a):fmtL(a), vb=fmt?fmt(b):fmtL(b);
  return '<div class="cmp-grid-row" style="display:grid;grid-template-columns:minmax(140px, 1fr) 100px 100px 80px;align-items:center;padding:12px 0;border-bottom:1px solid var(--b1);font-size:13px">'
    +'<span style="color:var(--m1);font-weight:500">'+label+'</span>'
    +'<span style="color:#f59e0b;font-family:\'DM Mono\',monospace;font-weight:700;text-align:right">'+va+'</span>'
    +'<span style="color:#60a5fa;font-family:\'DM Mono\',monospace;font-weight:700;text-align:right">'+vb+'</span>'
    +'<div style="text-align:right">'+deltaPill(a,b)+'</div></div>';
}

function runDateVsDate(){
  var sA=document.getElementById('anaDateSheetA').value, iA=parseInt(document.getElementById('anaDateA').value);
  var sB=document.getElementById('anaDateSheetB').value, iB=parseInt(document.getElementById('anaDateB').value);
  if(!sA||!sB||isNaN(iA)||isNaN(iB)){ showToast('Select both tabs and dates.'); return; }
  var dA=SHEET_DATA[sA], dB=SHEET_DATA[sB];
  var eA=SHEET_REGISTRY.find(function(x){return x.id===dA.outletId;}), eB=SHEET_REGISTRY.find(function(x){return x.id===dB.outletId;});
  var pct = function(v){ return v.toFixed(1)+'%'; };
  var el=document.getElementById('anaDateResult');
  var html = '<div class="card card-body" style="padding:20px">'
    +'<div class="cmp-grid-header" style="display:grid;grid-template-columns:minmax(140px, 1fr) 100px 100px 80px;align-items:center;padding:0 0 16px;border-bottom:2px solid var(--b2);margin-bottom:10px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px">'
      +'<span style="color:var(--m1)">Particulars</span>'
      +'<span style="text-align:right;color:'+eA.color+'">'+dA.DATES[iA]+'<div style="font-size:8px;font-weight:400;text-transform:none">'+dA.tabName+'</div></span>'
      +'<span style="text-align:right;color:'+eB.color+'">'+dB.DATES[iB]+'<div style="font-size:8px;font-weight:400;text-transform:none">'+dB.tabName+'</div></span>'
      +'<span style="text-align:right;color:var(--m1)">Trend</span>'
    +'</div>'
    +cmpSection('Core Revenue')
    +cmpRow('Net Revenue',dA.REV[iA],dB.REV[iB])
    +cmpSection('Critical Indents')
    +cmpRow('RM Indent',dA.RM[iA],dB.RM[iB])
    +cmpRow('CP Indent',dA.CP[iA],dB.CP[iB])
    +cmpRow('Total Indent',dA.RM[iA]+dA.CP[iA],dB.RM[iB]+dB.CP[iB])
    +cmpRow('Indent %', (dA.RM[iA]+dA.CP[iA])/(dA.REV[iA]||1)*100, (dB.RM[iB]+dB.CP[iB])/(dB.REV[iB]||1)*100, pct)
    +cmpSection('Utilities & Ops')
    +cmpRow('GAIL Gas Value',dA.GASV[iA],dB.GASV[iB])
    +cmpRow('Water Value',dA.WATV[iA],dB.WATV[iB])
    +cmpRow('Packaging',dA.PKG[iA],dB.PKG[iB])
    +cmpRow('HK Materials',dA.HK[iA],dB.HK[iB])
    +cmpRow('Petty Cash',dA.PETTY[iA],dB.PETTY[iB]);
  var dKeys = Object.keys(dA.DYNAMIC || {}).filter(function(k){
     var kl = k.toLowerCase();
     return kl.indexOf('revenue')===-1 && kl.indexOf('indent')===-1 && kl.indexOf('gas')===-1 && kl.indexOf('water')===-1 && kl.indexOf('hk')===-1 && kl.indexOf('packaging')===-1 && kl.indexOf('petty')===-1;
  });
  if(dKeys.length) {
    html += cmpSection('Other Cost Drivers');
    dKeys.sort(function(k1, k2){
       var val1 = ((dA.DYNAMIC[k1]?dA.DYNAMIC[k1][iA]:0) + (dB.DYNAMIC && dB.DYNAMIC[k1] ? dB.DYNAMIC[k1][iB] : 0));
       var val2 = ((dA.DYNAMIC[k2]?dA.DYNAMIC[k2][iA]:0) + (dB.DYNAMIC && dB.DYNAMIC[k2] ? dB.DYNAMIC[k2][iB] : 0));
       return val2 - val1;
    });
    dKeys.forEach(function(k){
      if(dB.DYNAMIC && dB.DYNAMIC[k] !== undefined){
        html += cmpRow(k, dA.DYNAMIC[k][iA], dB.DYNAMIC[k][iB]);
      }
    });
  }
  html += '</div>';
  el.innerHTML = html;
}

// ═══════════════════════════════════════════════
// TEAM DASHBOARD LOGIC
// ═══════════════════════════════════════════════
function parseSheetDate(val) {
  if(!val) return null;
  if(val instanceof Date) return val;
  var s = String(val).trim();
  if(!s) return null;
  var d = new Date(s);
  if(!isNaN(d.getTime())) return d;
  var parts = s.split(/[-/.]/);
  if(parts.length === 3) {
    var p0=parseInt(parts[0]), p1=parseInt(parts[1]), p2=parseInt(parts[2]);
    var y = p2, m = p1, day = p0;
    if(parts[0].length === 4) { y=p0; m=p1; day=p2; }
    if(y < 100) y += 2000;
    var finalD = new Date(y, m-1, day);
    return isNaN(finalD.getTime()) ? null : finalD;
  }
  return null;
}

function buildTeamCharts() {
  if(!window.TEAM_DATA || !window.TEAM_DATA.length) {
    var el = document.getElementById('teamKpiGrid');
    if(el) el.innerHTML = '<div style="padding:20px;color:var(--m1)">Sync "Employee onboarding data" tab to view insights.</div>';
    return;
  }
  var raw = window.TEAM_DATA;
  var filter = document.getElementById('teamTimeSlicer') ? document.getElementById('teamTimeSlicer').value : 'all';
  var outletFilter = document.getElementById('teamOutletSlicer') ? document.getElementById('teamOutletSlicer').value : 'all';
  var now = new Date();
  var data = raw.filter(function(r){
    if(outletFilter !== 'all') {
      var loc = String(r['Work Location'] || r['Location'] || '').toLowerCase();
      if(loc.indexOf(outletFilter) === -1) return false;
    }
    if(filter === 'all') return true;
    var keys = Object.keys(r);
    var dKey = keys.find(k => k.toLowerCase().indexOf('joining')!==-1 || k.toLowerCase().indexOf('hired')!==-1 || k.toLowerCase()==='date');
    var dtStr = r[dKey] || '';
    var d = parseSheetDate(dtStr);
    if(!d) return filter === 'all';
    var dNorm = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var nowNorm = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if(filter === '7d') return (nowNorm - dNorm) <= (7 * 24 * 60 * 60 * 1000);
    if(filter === 'mtd') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if(filter === 'lm') {
      var lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
    }
    if(filter === '3m') return (nowNorm - dNorm) <= (90 * 24 * 60 * 60 * 1000);
    if(filter === 'custom') {
      var sVal = document.getElementById('teamStart').value;
      var eVal = document.getElementById('teamEnd').value;
      if(!sVal || !eVal) return true;
      var start = parseSheetDate(sVal), end = parseSheetDate(eVal);
      if(!start || !end) return true;
      var sNorm = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
      var eNorm = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
      return dNorm >= sNorm && dNorm <= eNorm;
    }
    return true;
  });

  window.LAST_FILTERED_TEAM = data;
  var total = data.length;
  var locMap = {}, monthMap = {}, refMap = {}, desigMap = {};
  var idToName = {};

  data.forEach(function(r){
    var loc = r['Location'] || r['Work Location'] || r['Store'] || 'Unknown';
    locMap[loc] = (locMap[loc]||0) + 1;
    var rawDes = r['Designation'] || r['Role'] || r['Dept'] || r['Designation '] || 'Other';
    var des = String(rawDes).trim().toLowerCase().split(' ').map(function(w){ return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
    desigMap[des] = (desigMap[des]||0) + 1;
    var rawRef = '';
    var keys = Object.keys(r);
    var refKeyHeader = keys.find(k => k.toLowerCase().indexOf('refer') !== -1) || keys[7];
    rawRef = String(r[refKeyHeader] || '').trim();
    var refKey = 'HR';
    if(rawRef && rawRef.toLowerCase() !== 'direct' && rawRef.toLowerCase() !== 'n/a' && rawRef !== '0') {
      var idMatch = rawRef.match(/\d{4,}/);
      if(idMatch) {
        var id = idMatch[0];
        refKey = 'ID: ' + id;
        if(!idToName[id]) {
          var nameOnly = rawRef.replace('Id no - ','').replace('name - ','').replace('Name - ','').replace(id, '').replace(/[-]/g,'').trim();
          if(nameOnly) idToName[id] = nameOnly;
        }
      }
    }
    refMap[refKey] = (refMap[refKey]||0) + 1;
    var dt = r['Date of Joining'] || r['Joining Date'] || r['Hired Date'] || r['Date'] || '';
    var mLabel = 'Unknown';
    if(dt) {
      var dObj = parseSheetDate(dt);
      if(dObj) mLabel = dObj.toLocaleString('default', { month: 'short', year: '2-digit' });
    }
    monthMap[mLabel] = (monthMap[mLabel]||0) + 1;
  });

  var top3List = Object.keys(refMap)
    .filter(function(k){ return k.startsWith('ID: '); })
    .sort(function(a,b){ return refMap[b] - refMap[a]; })
    .slice(0, 3)
    .map(function(k){
      var id = k.replace('ID: ','');
      return (idToName[id] || id) + ' ('+refMap[k]+')';
    }).join(', ');

  var teamKpis = [
    {l:'TOTAL EMPLOYEES', v:total, s:'Active on roster', c:'#60a5fa'},
    {l:'TOTAL LOCATIONS', v:Object.keys(locMap).length, s:'Total Branches', c:'#22c55e'},
    {l:'NEW ONBOARDED',   v:monthMap[new Date().toLocaleString('default',{month:'short',year:'2-digit'})]||0, s:'This month', c:'#f59e0b'},
    {l:'TOP REFERRERS',   v:top3List || 'None', s:'Top 3 performers', c:'#a78bfa'}
  ];
  var kpiEl = document.getElementById('teamKpiGrid');
  if(kpiEl) kpiEl.innerHTML = teamKpis.map(function(k){
    return '<div class="kpi-card"><div class="kpi-lbl">'+k.l+'</div>'
          +'<div class="kpi-val" style="color:'+k.c+'">'+k.v+'</div>'
          +'<div class="kpi-sub">'+k.s+'</div></div>';
  }).join('');

  killChart('chTeamLoc');
  var cLoc = document.getElementById('chartTeamLoc');
  if(cLoc) CI.chTeamLoc = new Chart(cLoc, {
    type:'pie', data:{
      labels:Object.keys(locMap),
      datasets:[{data:Object.values(locMap), backgroundColor:SHEET_COLORS, borderWidth:0}]
    },
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{color:'#94a3b8',font:{size:10}}}}}
  });

  killChart('chTeamDesig');
  var cDes = document.getElementById('chartTeamDesig');
  var desKeys = Object.keys(desigMap).sort((a,b)=>desigMap[b]-desigMap[a]);
  if(cDes) CI.chTeamDesig = new Chart(cDes, {
    type:'doughnut', data:{
      labels:desKeys,
      datasets:[{data:desKeys.map(k=>desigMap[k]), backgroundColor:SHEET_COLORS.slice().reverse(), borderWidth:0}]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{position:'right',labels:{color:'#94a3b8',font:{size:10}}},
        datalabels: { color: '#fff', font: { weight: 'bold', size: 10 }, formatter: function(val) { return val > 1 ? val : ''; }, anchor: 'center', align: 'center' }
      },
      cutout:'65%'
    }
  });

  killChart('chTeamMonth');
  var mKeys = Object.keys(monthMap).sort((a,b)=>new Date('01 '+a)-new Date('01 '+b));
  var cMonth = document.getElementById('chartTeamMonth');
  if(cMonth) CI.chTeamMonth = new Chart(cMonth, {
    type:'bar', data:{
      labels:mKeys,
      datasets:[{label:'Hired', data:mKeys.map(k=>monthMap[k]), backgroundColor:'#38bdf8', borderRadius:4}]
    },
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:'#64748b'}},y:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#64748b'}}}}
  });

  killChart('chTeamRef');
  var rKeysRaw = Object.keys(refMap).filter(k=>k.toLowerCase()!=='direct' && k.toLowerCase()!=='n/a' && k!=='0' && k!=='');
  var rKeys = rKeysRaw.sort((a,b)=>refMap[b]-refMap[a]).slice(0,8);
  var cRef = document.getElementById('chartTeamRef');
  if(cRef) {
    CI.chTeamRef = new Chart(cRef, {
      type:'bar', data:{
        labels: rKeys.map(function(k){
          if(k.startsWith('ID: ')) {
            var id = k.replace('ID: ','');
            return (idToName[id] ? idToName[id] + ' ('+id+')' : k);
          }
          return k;
        }),
        datasets:[{label:'Referrals', data:rKeys.map(k=>refMap[k]), backgroundColor:'#a78bfa', borderRadius:4}]
      },
      options:{
        indexAxis:'y',responsive:true,maintainAspectRatio:false,
        plugins:{
          legend:{display:false},
          datalabels: { color: '#fff', anchor: 'end', align: 'end', offset: 4, font: { weight: 'bold', size: 11 }, formatter: function(val) { return val; } }
        },
        scales:{x:{grid:{display:false},ticks:{color:'#64748b'}},y:{grid:{display:false},ticks:{color:'#64748b'}}},
        onClick: function(e, activeEls) {
          if(!activeEls.length) return;
          var idx = activeEls[0].index;
          var key = rKeys[idx];
          var idOnly = key.replace('ID: ','');
          var referred = data.filter(function(emp){
            var keys = Object.keys(emp);
            var refH = keys.find(k => k.toLowerCase().indexOf('refer') !== -1) || keys[7];
            var refVal = String(emp[refH] || '');
            return refVal.indexOf(idOnly) !== -1;
          });
          if(!referred.length) return;
          var title = (idToName[idOnly] || idOnly);
          document.getElementById('teamModalTitle').innerText = 'Referred by: ' + title;
          var html = '<table style="width:100%;border-collapse:collapse;margin-top:10px">';
          html += '<tr style="border-bottom:1px solid var(--b1);color:var(--m1)"><th style="text-align:left;padding:8px">Employee</th><th style="text-align:left;padding:8px">Designation</th><th style="text-align:left;padding:8px">Joined</th></tr>';
          referred.forEach(function(emp){
            var name = emp['Name as per Govt ID'] || emp['Name'] || 'Unknown';
            var dsg = emp['Designation'] || emp['Role'] || '-';
            var jdt = emp['Date of Joining'] || emp['Joining Date'] || '-';
            html += '<tr style="border-bottom:1px solid var(--s1)"><td style="padding:8px">'+name+'</td><td style="padding:8px">'+dsg+'</td><td style="padding:8px">'+jdt+'</td></tr>';
          });
          html += '</table>';
          document.getElementById('teamModalBody').innerHTML = html;
          document.getElementById('teamDetailModal').style.display = 'flex';
        }
      }
    });
  }
}

function toggleTeamRange(val){
  document.getElementById('teamRangeWrap').style.display = (val==='custom'?'flex':'none');
  buildTeamCharts();
}

function exportTeamData(){
  if(!window.LAST_FILTERED_TEAM || !window.LAST_FILTERED_TEAM.length) { showToast('No data to export.'); return; }
  var data = window.LAST_FILTERED_TEAM;
  var headers = Object.keys(data[0]);
  var csv = headers.join(',') + '\n';
  data.forEach(function(row){
    csv += headers.map(function(h){
      var val = String(row[h]||'').replace(/,/g, ';');
      return '"' + val + '"';
    }).join(',') + '\n';
  });
  var blob = new Blob([csv], {type:'text/csv'});
  var url = window.URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.setAttribute('hidden', '');
  a.setAttribute('href', url);
  a.setAttribute('download', 'Employee_Export_' + new Date().toLocaleDateString() + '.csv');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function closeTeamModal(){
  document.getElementById('teamDetailModal').style.display = 'none';
}

// ═══════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function(){
  loadRegistry();
  if(window.refreshKeyBadge) refreshKeyBadge();
  renderSheetList();
  renderSheetDropdown();
  populateAnaSelectors();

  if(SHEET_REGISTRY.length) {
    var targetOutlet = activeSheetId ? activeSheetId.split('__')[0] : SHEET_REGISTRY[0].id;
    syncOneSheet(targetOutlet);
  }
});