/* =============================================
   STUDYMAP — app.js  v4
   • Exam notes
   • Drag-select calendar in plan modal
   • Per-plan sequential/parallel book mode
   • Copy days between plans
   • Live daily-pages preview before save
   ============================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBo95-iAXID2q5qfc8B2bLIlRA83u0-3Mo",
  authDomain: "uni-study-plan.firebaseapp.com",
  projectId: "uni-study-plan",
  storageBucket: "uni-study-plan.firebasestorage.app",
  messagingSenderId: "257253916300",
  appId: "1:257253916300:web:6958a566aed513d68445a9"
};
const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
const db    = getFirestore(fbApp);

const PRESET_COLORS = [
  '#ff0022','#c8001a','#e8002b','#ff4d63',
  '#3548c0','#1565c0','#5c946e','#2e7d32',
  '#7c4dff','#e65100','#ad1457','#6a1b9a',
  '#00695c','#0277bd','#f57f17','#4e342e'
];

// ===== STATE =====
// studyBlock shape: { id, label, color, examIds:[], startDate, endDate, activeWeekdays:[0-6], tasks:[{id,text}], autoItems:[{type:'book'|'slides'|'video',examId,bookIdx}] }
// autoItems sharing the same unit (pp/slides/min) are pooled together into ONE combined daily target,
// even across different exams — the person then logs actual amounts per individual material.
let state = {
  exams: [], studyBlocks: [], calendar: {},
  calMonth: new Date().getMonth(), calYear: new Date().getFullYear(),
  selectedDay: null, editingExamId: null, editingBlockId: null,
  currentUser: null,
};
let simRows = window.simRows = []; // ephemeral scenario rows — on window for inline HTML handlers
let saveDebounceTimer = null;

// ===== FIRESTORE =====
function userDocRef(uid) { return doc(db,'users',uid); }

async function loadFromFirestore(uid) {
  showSync('Caricamento...','loading');
  try {
    const snap = await getDoc(userDocRef(uid));
    if (snap.exists()) {
      const d = snap.data();
      state.exams       = d.exams       || [];
      state.studyBlocks = d.studyBlocks || [];
      state.calendar    = d.calendar    || {};
      migrateBlocks();
    }
    hideSync();
  } catch(e) { showSync('Errore caricamento','error'); console.error(e); }
}

function saveToFirestore() {
  if (!state.currentUser) return;
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    showSync('Salvataggio...','loading');
    try {
      await setDoc(userDocRef(state.currentUser.uid), {
        exams: state.exams,
        studyBlocks: state.studyBlocks,
        calendar: state.calendar, updatedAt: Date.now(),
      });
      showSync('Salvato ✓','success'); setTimeout(hideSync,1800);
    } catch(e) { showSync('Errore salvataggio','error'); console.error(e); }
  }, 800);
}
function save() { saveToFirestore(); }
function showSync(msg,type='loading') {
  document.getElementById('syncIndicator').className='sync-indicator '+type;
  document.getElementById('syncMsg').textContent=msg;
}
function hideSync() { document.getElementById('syncIndicator').className='sync-indicator hidden'; }

// ===== AUTH =====
const provider = new GoogleAuthProvider();
document.getElementById('btnGoogleLogin').addEventListener('click', async()=>{ try{await signInWithPopup(auth,provider);}catch(e){alert(e.message);} });
document.getElementById('btnLogout').addEventListener('click', async()=>{ if(confirm('Vuoi uscire?')) await signOut(auth); });
onAuthStateChanged(auth, async user=>{
  if (user) {
    state.currentUser = user;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('sidebar').style.display='';
    document.getElementById('main').style.display='';
    const av=document.getElementById('userAvatar');
    av.src=user.photoURL||''; av.style.display=user.photoURL?'':'none';
    document.getElementById('userName').textContent=user.displayName||user.email||'';
    document.getElementById('dashGreeting').textContent=`Ciao, ${(user.displayName||'Studente').split(' ')[0]}! 👋`;
    await loadFromFirestore(user.uid);
    renderAll();
  } else {
    state.currentUser=null; state.exams=[];state.studyBlocks=[];state.calendar={};
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('sidebar').style.display='none';
    document.getElementById('main').style.display='none';
  }
});

// ===== UTILS =====
function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2); }
function fmt(d){ if(!d)return''; return new Date(d+'T00:00:00').toLocaleDateString('it-IT',{day:'2-digit',month:'long',year:'numeric'}); }
function fmtShort(d){ if(!d)return''; return new Date(d+'T00:00:00').toLocaleDateString('it-IT',{day:'2-digit',month:'short'}); }
function today(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function daysUntil(ds){ if(!ds)return null; return Math.ceil((new Date(ds+'T00:00:00')-new Date(today()+'T00:00:00'))/86400000); }

// ===== BLOCK HELPERS =====
// One-time upgrade of old blocks (single examId, autoItems without their own examId)
// to the new multi-exam shape. Safe to run repeatedly.
function migrateBlocks() {
  state.studyBlocks.forEach(b => {
    if (!b.examIds) b.examIds = b.examId ? [b.examId] : [];
    if (b.autoItems) {
      b.autoItems = b.autoItems.map(it => it.examId ? it : { ...it, examId: b.examId || b.examIds[0] || null });
    }
  });
}
function blockExamIds(block) { return block.examIds || (block.examId ? [block.examId] : []); }
// Weekdays a block is active on. Falls back to legacy excludeWeekends flag for old blocks.
function blockActiveWeekdays(block) {
  if (block.activeWeekdays && block.activeWeekdays.length) return block.activeWeekdays;
  if (block.excludeWeekends) return [1,2,3,4,5];
  return [0,1,2,3,4,5,6];
}
function blockDays(block) {
  const days = [];
  if (!block.startDate || !block.endDate) return days;
  const activeDows = blockActiveWeekdays(block);
  let cur = new Date(block.startDate + 'T00:00:00');
  const end = new Date(block.endDate + 'T00:00:00');
  while (cur <= end) {
    if (activeDows.includes(cur.getDay())) {
      const ds = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
      days.push(ds);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}
function blocksForDate(dateStr) {
  return state.studyBlocks.filter(b => {
    if (dateStr < b.startDate || dateStr > b.endDate) return false;
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    return blockActiveWeekdays(b).includes(dow);
  });
}
// Remaining/total for a single tracked material, wherever its exam is (used to build pools)
function itemRemaining(item) {
  const exam = state.exams.find(e => e.id === item.examId); if (!exam) return null;
  if (item.type === 'book') {
    const b = (exam.books || [])[item.bookIdx]; if (!b) return null;
    return { total:b.totalPages||0, done:b.pagesRead||0, label:b.title||`Libro ${item.bookIdx+1}`, unit:'pp', icon:'📖', examName:exam.name, examColor:exam.color };
  } else if (item.type === 'slides') {
    return { total:exam.slidesTotal||0, done:exam.slidesDone||0, label:'Slides', unit:'slides', icon:'🖥️', examName:exam.name, examColor:exam.color };
  } else if (item.type === 'video') {
    return { total:exam.videoTotal||0, done:exam.videoDone||0, label:'Video', unit:'min', icon:'🎬', examName:exam.name, examColor:exam.color };
  }
  return null;
}
function unitLabel(u){ return u==='pp'?'Pagine':u==='slides'?'Slides':u==='min'?'Video':u; }
function unitIcon(u){ return u==='pp'?'📖':u==='slides'?'🖥️':u==='min'?'🎬':''; }
// Combined pace of a POOL of materials (possibly from different exams) sharing the same unit,
// computed live for a given date: (sum of what's left across all of them) ÷ study-days left.
// Finished materials drop out of the pool automatically.
function poolPaceOnDate(block, items, dateStr) {
  const allDays = blockDays(block);
  if (allDays.indexOf(dateStr) === -1) return null;
  const t = today();
  const fromIdx = allDays.findIndex(d => d >= t);
  const daysLeft = fromIdx === -1 ? 1 : Math.max(1, allDays.length - fromIdx);
  const enriched = items.map(it => ({ item: it, info: itemRemaining(it) })).filter(g => g.info);
  const active = enriched.filter(g => (g.info.total - g.info.done) > 0);
  if (!active.length) return { done:true };
  const totalRemaining = active.reduce((s,g)=>s+Math.max(0,g.info.total-g.info.done),0);
  const perDay = Math.ceil(totalRemaining / daysLeft);
  return { done:false, perDay, totalRemaining, daysLeft, active };
}
function autoItemKey(block, item) { return `${block.id}|${item.examId}|${item.type}|${item.bookIdx ?? 'x'}`; }
// Log the actual amount done for ONE material on a given date; updates that material's exam
// counters incrementally (delta-based) so switching the number up/down stays consistent.
window.applyAutoLog = function(dateStr, blockId, examId, type, bookIdxRaw, newAmountRaw) {
  const block = state.studyBlocks.find(b => b.id === blockId); if (!block) return;
  const exam = state.exams.find(e => e.id === examId); if (!exam) return;
  const bookIdx = (bookIdxRaw === '' || bookIdxRaw == null) ? null : +bookIdxRaw;
  const newAmount = Math.max(0, Math.round(+newAmountRaw || 0));
  const key = `${block.id}|${examId}|${type}|${bookIdx ?? 'x'}`;
  if (!state.calendar[dateStr]) state.calendar[dateStr] = {};
  if (!state.calendar[dateStr].autoLog) state.calendar[dateStr].autoLog = {};
  const prevApplied = state.calendar[dateStr].autoLog[key] || 0;
  const delta = newAmount - prevApplied;
  if (type === 'book') {
    const b = exam.books[bookIdx]; if (!b) return;
    b.pagesRead = Math.min(b.totalPages || 0, Math.max(0, (b.pagesRead||0) + delta));
  } else if (type === 'slides') {
    exam.slidesDone = Math.min(exam.slidesTotal || 0, Math.max(0, (exam.slidesDone||0) + delta));
  } else if (type === 'video') {
    exam.videoDone = Math.min(exam.videoTotal || 0, Math.max(0, (exam.videoDone||0) + delta));
  }
  state.calendar[dateStr].autoLog[key] = newAmount;
  save();
  renderDashboard();
  if (document.getElementById('view-calendario')?.classList.contains('active')) {
    renderCalendar();
    if (state.selectedDay) renderDayPanel(state.selectedDay);
  }
  if (document.getElementById('view-esami')?.classList.contains('active')) renderExamsGrid();
};
// Renders one POOL (all materials sharing a unit, e.g. all "pp" from every selected exam) as a
// single combined target, with one editable input per material so amounts can be split freely.
function renderAutoPoolRow(block, unit, items, dateStr, dayData) {
  const pace = poolPaceOnDate(block, items, dateStr);
  if (!pace) return '';
  const poolKey = `${block.id}|${unit}`;
  if (pace.done) {
    return `<div class="day-auto-row done"><span class="day-auto-icon">${unitIcon(unit)}</span><span class="day-auto-label">${unitLabel(unit)}</span><span class="day-auto-donebadge">✓ finito</span></div>`;
  }
  let sum = 0;
  const rows = pace.active.map(({item,info})=>{
    const key = autoItemKey(block, item);
    const logged = dayData.autoLog?.[key];
    if (logged != null) sum += (+logged || 0);
    const val = (logged != null) ? logged : '';
    return `<div class="day-auto-pool-item">
      <span class="day-auto-pool-item-label" style="color:${info.examColor}">${info.label}<small> · ${info.examName}</small></span>
      <input type="number" min="0" class="day-auto-pool-input" placeholder="0" title="Quante/i ${unit} hai fatto da qui oggi?"
        data-poolkey="${poolKey}" data-blockid="${block.id}" data-examid="${item.examId}" data-type="${item.type}" data-bookidx="${item.bookIdx ?? ''}" value="${val}">
    </div>`;
  }).join('');
  const singleItem = pace.active.length === 1;
  return `<div class="day-auto-pool">
    <div class="day-auto-pool-header">
      <span class="day-auto-icon">${unitIcon(unit)}</span>
      <span class="day-auto-label">${unitLabel(unit)}${pace.active.length>1?` <small>(${pace.active.length} fonti)</small>`:''}</span>
      <span class="day-auto-target">oggi <strong>${pace.perDay}</strong> ${unit} <span class="day-auto-pool-sum" data-poolkey="${poolKey}">· inserite: ${sum}</span></span>
      ${singleItem?`<button type="button" class="day-auto-pool-fillbtn" title="Segna ${pace.perDay} ${unit} come fatto" data-poolkey="${poolKey}" data-target="${pace.perDay}">✓</button>`:''}
    </div>
    <div class="day-auto-pool-items">${rows}</div>
  </div>`;
}
// Manual tasks (checkbox) + auto-calculated items (numeric log) for a block on a given date
function renderBlockDayContent(block, dateStr, dayData) {
  const tasks = block.tasks || [];
  const autoItems = block.autoItems || [];
  let html = '';
  if (tasks.length) {
    html += `<div class="day-task-list">${tasks.map(t=>{
      const done = !!(dayData.completions?.[t.id]);
      return `<label class="day-task-row${done?' done':''}">
        <input type="checkbox" class="day-task-cb" data-blockid="${block.id}" data-taskid="${t.id}"${done?' checked':''}>
        <span>${t.text}</span>
      </label>`;
    }).join('')}</div>`;
  }
  if (autoItems.length) {
    const groups = {};
    autoItems.forEach(it => { const info = itemRemaining(it); if (!info) return; (groups[info.unit] = groups[info.unit] || []).push(it); });
    html += `<div class="day-auto-list">${Object.keys(groups).map(unit=>renderAutoPoolRow(block,unit,groups[unit],dateStr,dayData)).join('')}</div>`;
  }
  if (!tasks.length && !autoItems.length) {
    html += '<p style="font-size:12px;color:var(--ink-light);margin:4px 0">Nessuna attività in questo blocco</p>';
  }
  return html;
}
// Attach checkbox + numeric-input listeners after inserting block-day HTML (used by both Dashboard and Calendar)
function attachBlockDayListeners(container, dateStr) {
  container.querySelectorAll('.day-task-cb').forEach(cb=>{
    cb.addEventListener('change',()=>{
      if(!state.calendar[dateStr])state.calendar[dateStr]={};
      if(!state.calendar[dateStr].completions)state.calendar[dateStr].completions={};
      state.calendar[dateStr].completions[cb.dataset.taskid]=cb.checked;
      cb.closest('label').classList.toggle('done',cb.checked);
      save();renderCalendar();renderDashboard();
    });
  });
  container.querySelectorAll('.day-auto-pool-input').forEach(inp=>{
    inp.addEventListener('input',()=>updatePoolSumDisplay(container, inp.dataset.poolkey));
    inp.addEventListener('change',()=>{
      if(inp.value==='')return;
      applyAutoLog(dateStr, inp.dataset.blockid, inp.dataset.examid, inp.dataset.type, inp.dataset.bookidx, inp.value);
    });
  });
  container.querySelectorAll('.day-auto-pool-fillbtn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const input = container.querySelector(`.day-auto-pool-input[data-poolkey="${btn.dataset.poolkey}"]`);
      if(!input)return;
      input.value = btn.dataset.target;
      applyAutoLog(dateStr, input.dataset.blockid, input.dataset.examid, input.dataset.type, input.dataset.bookidx, input.value);
    });
  });
}
// Live-updates the "inserite: N" total next to a pool's target as the person types, before saving
function updatePoolSumDisplay(container, poolKey) {
  const inputs = container.querySelectorAll(`.day-auto-pool-input[data-poolkey="${poolKey}"]`);
  let sum = 0; inputs.forEach(i=>sum += (+i.value || 0));
  const sumEl = container.querySelector(`.day-auto-pool-sum[data-poolkey="${poolKey}"]`);
  if (sumEl) sumEl.textContent = `· inserite: ${sum}`;
}
// Reference date used to show a block's "at a glance" pace on its card (today if within range, else next/last study day)
function blockReferenceDate(block) {
  const days = blockDays(block); if (!days.length) return null;
  const t = today();
  if (days.includes(t)) return t;
  return days.find(d => d > t) || days[days.length-1];
}
// Build a map { dateStr: [block,...] } for the visible month range
function buildDateBlockMap(fromDate, toDate) {
  const map = {};
  state.studyBlocks.forEach(block => {
    blockDays(block).forEach(d => {
      if (d >= fromDate && d <= toDate) {
        if (!map[d]) map[d] = [];
        map[d].push(block);
      }
    });
  });
  return map;
}

// ===== EXAM DAILY PACE =====
function examDailyPace(exam) {
  const chosen = (exam.appells || []).find(a => a.chosen);
  if (!chosen?.date) return null;
  const du = daysUntil(chosen.date);
  if (du === null || du <= 0) return null;
  const items = [];
  (exam.books || []).forEach((b, i) => {
    if (!b.totalPages) return;
    const rem = Math.max(0, b.totalPages - (b.pagesRead || 0));
    if (rem > 0) items.push({ label: b.title || `Libro ${i+1}`, remaining: rem, perDay: Math.ceil(rem / du), unit: 'pp' });
  });
  if (exam.hasSlides && exam.slidesTotal) {
    const rem = Math.max(0, exam.slidesTotal - (exam.slidesDone || 0));
    if (rem > 0) items.push({ label: 'Slides', remaining: rem, perDay: Math.ceil(rem / du), unit: 'slides' });
  }
  if (exam.hasVideo && exam.videoTotal) {
    const rem = Math.max(0, exam.videoTotal - (exam.videoDone || 0));
    if (rem > 0) items.push({ label: 'Video', remaining: rem, perDay: Math.ceil(rem / du), unit: 'min' });
  }
  return { daysLeft: du, date: chosen.date, items };
}

// Trackable materials of an exam (books with pages, slides, video) — used by block auto-calc
function examMaterials(exam) {
  if (!exam) return [];
  const items = [];
  (exam.books || []).forEach((b, i) => {
    if (!b.totalPages) return;
    items.push({ type:'book', bookIdx:i, label:b.title||`Libro ${i+1}`, icon:'📖', unit:'pp', total:b.totalPages, done:b.pagesRead||0 });
  });
  if (exam.hasSlides && exam.slidesTotal) items.push({ type:'slides', bookIdx:null, label:'Slides', icon:'🖥️', unit:'slides', total:exam.slidesTotal, done:exam.slidesDone||0 });
  if (exam.hasVideo && exam.videoTotal)   items.push({ type:'video',  bookIdx:null, label:'Video',  icon:'🎬', unit:'min',    total:exam.videoTotal,  done:exam.videoDone||0 });
  return items;
}
// Same, but across several exams at once — each material tagged with its own examId/name/color
function materialsForExams(examIds) {
  const items = [];
  (examIds || []).forEach(examId => {
    const exam = state.exams.find(e => e.id === examId); if (!exam) return;
    examMaterials(exam).forEach(m => items.push({ ...m, examId, examName:exam.name, examColor:exam.color }));
  });
  return items;
}
function matKey(m) { return `${m.examId}|${m.type}|${m.bookIdx ?? 'x'}`; }

// ===== NAVIGATION =====
document.querySelectorAll('.nav-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('view-'+btn.dataset.view).classList.add('active');
    const v=btn.dataset.view;
    if(v==='dashboard') renderDashboard();
    if(v==='esami')     renderExamsGrid();
    if(v==='piani')     renderPlanningView();
    if(v==='calendario'){renderCalendar();}
  });
});
// Toggle sidebar - different behavior on mobile vs desktop
function isMobile() { return window.innerWidth <= 680; }
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (isMobile()) {
    // On mobile, toggle mobile-open class and overlay
    sidebar.classList.toggle('mobile-open');
    overlay.classList.toggle('active');
  } else {
    // On desktop, toggle collapsed class
    sidebar.classList.toggle('collapsed');
  }
}
document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
document.getElementById('mobileHamburger').addEventListener('click', toggleSidebar);
if (document.getElementById('sidebarOverlay')) {
  document.getElementById('sidebarOverlay').addEventListener('click', () => {
    if (isMobile()) {
      document.getElementById('sidebar').classList.remove('mobile-open');
      document.getElementById('sidebarOverlay').classList.remove('active');
    }
  });
}

// Close sidebar on nav click (mobile)
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (isMobile()) {
      document.getElementById('sidebar').classList.remove('mobile-open');
      document.getElementById('sidebarOverlay').classList.remove('active');
    }
  });
});

// Handle window resize
window.addEventListener('resize', () => {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (window.innerWidth > 680) {
    // Return to desktop mode
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('active');
  }
});
(()=>{
  const d=new Date();
  const days=['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  const months=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  document.getElementById('headerDate').innerHTML=`<strong>${days[d.getDay()]}</strong><br>${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
})();

function renderAll(){ renderSidebarExams(); renderDashboard(); renderExamsGrid(); renderPlanningView(); }

// ===== SIDEBAR =====
function renderSidebarExams(){
  const el=document.getElementById('examList');
  if(!state.exams.length){el.innerHTML='<p style="font-size:12px;color:rgba(255,255,255,.3);padding:4px 8px;">Nessun esame ancora</p>';return;}
  el.innerHTML=state.exams.map(e=>`<div class="exam-sidebar-item${e.completed?' completed':''}" onclick="goToExam('${e.id}')"><span class="exam-dot" style="background:${e.color}"></span><span>${e.name}</span></div>`).join('');
}
window.goToExam=function(id){
  document.querySelector('[data-view="esami"]').click();
  setTimeout(()=>document.getElementById('exam-card-'+id)?.scrollIntoView({behavior:'smooth',block:'start'}),100);
};

// ===== DASHBOARD =====
function renderDashboard(){ renderTodayTasks(); renderProgressBars(); renderUpcoming(); }

function renderTodayTasks(){
  const el=document.getElementById('todayTasks');
  const t=today(); const dayData=state.calendar[t]||{};
  const todayBlocks=blocksForDate(t);
  const examsWithPace=state.exams.filter(e=>examDailyPace(e));
  if(!todayBlocks.length&&!examsWithPace.length){
    el.innerHTML='<p style="color:var(--ink-light);font-size:13px;padding:8px 0;">Nessun blocco attivo oggi e nessun appello impostato.</p>';
    return;
  }
  let html='';
  // Block tasks + auto-calculated pages/activities for today
  todayBlocks.forEach(block=>{
    html+=`<div class="day-block-section" style="border-left:3px solid ${block.color}">
      <div class="day-block-name">${block.label}</div>
      ${renderBlockDayContent(block,t,dayData)}
    </div>`;
  });
  // Exam paces (informational, based on chosen appello date)
  examsWithPace.forEach(e=>{
    const pace=examDailyPace(e);
    html+=`<div class="today-task">
      <div class="today-task-color" style="background:${e.color}"></div>
      <div class="today-task-info">
        <div class="today-task-name">${e.name}</div>
        <div class="today-task-sub">⚡ Appello ${fmt(pace.date)}: ${pace.items.map(i=>`<strong>${i.perDay} ${i.unit}/g</strong> ${i.label}`).join(' · ')}</div>
      </div>
      <div class="today-task-pages">${pace.daysLeft}gg</div>
    </div>`;
  });
  el.innerHTML = html || '<p style="color:var(--ink-light);font-size:13px;">Nessun dato per oggi.</p>';
  attachBlockDayListeners(el, t);
}

function renderProgressBars(){
  const el=document.getElementById('progressBars');
  if(!state.exams.length){el.innerHTML='<p style="color:var(--ink-light);font-size:13px;">Aggiungi un esame.</p>';return;}
  el.innerHTML=state.exams.map(e=>{
    const pct=Math.round(examProgress(e)*100);
    return `<div class="progress-item">
      <div class="progress-header"><span class="progress-name">${e.name}</span><span class="progress-pct">${pct}%</span></div>
      <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pct}%;background:${e.color}"></div></div>
    </div>`;
  }).join('');
}

function renderUpcoming(){
  const el=document.getElementById('upcomingExams');
  let appells=[];
  state.exams.forEach(e=>(e.appells||[]).forEach(a=>appells.push({date:a.date,chosen:a.chosen,name:e.name,color:e.color})));
  appells.sort((a,b)=>a.date.localeCompare(b.date));
  const future=appells.filter(a=>a.date>=today()).slice(0,6);
  if(!future.length){el.innerHTML='<p style="color:var(--ink-light);font-size:13px;">Nessun appello imminente.</p>';return;}
  el.innerHTML=future.map(a=>{
    const du=daysUntil(a.date);
    return `<div class="upcoming-item">
      <div class="upcoming-date">${fmt(a.date)} · ${du===0?'oggi':du+' giorni'}</div>
      <div class="upcoming-name" style="color:${a.color}">${a.name}</div>
      ${a.chosen?'<div class="upcoming-chosen">✓ Appello scelto</div>':''}
    </div>`;
  }).join('');
}

function examProgress(exam){
  let total=0,done=0;
  (exam.books||[]).forEach(b=>{const tp=b.totalPages||0;total+=tp*3;done+=Math.min(b.pagesRead||0,tp)+Math.min(b.pagesUnderlined||0,tp)+Math.min(b.pagesStudied||0,tp);});
  if(exam.hasSlides){total+=exam.slidesTotal||0;done+=Math.min(exam.slidesDone||0,exam.slidesTotal||0);}
  if(exam.hasVideo) {total+=exam.videoTotal||0; done+=Math.min(exam.videoDone||0,exam.videoTotal||0);}
  return total?done/total:0;
}

// ===== EXAMS GRID =====
function renderExamsGrid(){
  const el=document.getElementById('examsGrid');
  if(!state.exams.length){el.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">🎓</div><p>Nessun esame. Clicca "+ Nuovo esame".</p></div>`;return;}
  el.innerHTML=state.exams.map((e,i)=>renderExamCard(e,i,state.exams.length)).join('');
}
window.moveExam=function(id,dir){
  const idx=state.exams.findIndex(e=>e.id===id); if(idx<0)return;
  const newIdx=idx+dir; if(newIdx<0||newIdx>=state.exams.length)return;
  const [item]=state.exams.splice(idx,1);
  state.exams.splice(newIdx,0,item);
  save(); renderSidebarExams(); renderExamsGrid(); renderDashboard();
};

function renderExamCard(e,idx,total){
  const chosenAppell=(e.appells||[]).find(a=>a.chosen);
  const du=chosenAppell?daysUntil(chosenAppell.date):null;

  const notesHtml = e.notes ? `
    <div class="exam-notes-block">
      <div class="exam-notes-label">📝 Note & modalità</div>
      <div class="exam-notes-text">${e.notes.replace(/\n/g,'<br>')}</div>
    </div>` : '';

  const booksHtml=(e.books||[]).map((b,bi)=>{
    const tp=b.totalPages||0,r=v=>tp?Math.round((v||0)/tp*100):0,tc=b.totalChapters||0;
    const trackConfig = getBookTrackConfig(b, e); // configurazione specifica di questo libro

    // Build track rows based on configuration
    let trackRows = '';
    trackConfig.forEach(track => {
      if (track.type === 'predefined') {
        if (track.field === 'pagesRead') {
          trackRows += `<div class="book-track"><span class="book-track-label">${track.label}</span><div class="book-track-bar"><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${r(b.pagesRead)}%;background:${e.color}88"></div></div></div><span class="text-mono" style="font-size:11px">${b.pagesRead||0}</span></div>`;
        } else if (track.field === 'pagesUnderlined') {
          trackRows += `<div class="book-track"><span class="book-track-label">${track.label}</span><div class="book-track-bar"><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${r(b.pagesUnderlined)}%;background:${e.color}bb"></div></div></div><span class="text-mono" style="font-size:11px">${b.pagesUnderlined||0}</span></div>`;
        } else if (track.field === 'pagesStudied') {
          trackRows += `<div class="book-track"><span class="book-track-label">${track.label}</span><div class="book-track-bar"><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${r(b.pagesStudied)}%;background:${e.color}"></div></div></div><span class="text-mono" style="font-size:11px">${b.pagesStudied||0}</span></div>`;
        } else if (track.field === 'chapters' && tc) {
          trackRows += `<div class="chapter-tracks mt-8"><div class="chapter-badge">📚 Letti <span class="chapter-count">${b.chaptersRead||0}/${tc}</span></div><div class="chapter-badge">🃏 Anki <span class="chapter-count">${b.chaptersAnki||0}/${tc}</span></div><div class="chapter-badge">✅ Studiati <span class="chapter-count">${b.chaptersStudied||0}/${tc}</span></div></div>`;
        }
      }
    });
    
    return `<div class="book-row">
      <div class="book-title-row"><span class="book-title">${b.title||'Libro senza titolo'}</span><span class="book-pages">${tp} pp · ${tc} cap</span></div>
      <div class="book-progress-tracks">
        ${trackRows}
      </div>
      <button class="btn-ghost mt-8" style="font-size:12px;padding:5px 10px" onclick="event.stopPropagation();openProgressModal('${e.id}',${bi})">Aggiorna progresso</button>
    </div>`;
  }).join('');

  const materialsHtml=(e.hasSlides||e.hasVideo)?`<div class="material-row">
    ${e.hasSlides?`<div class="material-chip">🖥️ Slides <span class="material-pct">${e.slidesTotal?Math.round((e.slidesDone||0)/e.slidesTotal*100):0}%</span></div>`:''}
    ${e.hasVideo?`<div class="material-chip">🎬 Video <span class="material-pct">${e.videoTotal?Math.round((e.videoDone||0)/e.videoTotal*100):0}%</span></div>`:''}
  </div>`:'';

  return `<div class="exam-card" id="exam-card-${e.id}" onclick="openExamModal('${e.id}')" title="Clicca per modificare l'esame">
    <div class="exam-card-header">
      <div class="exam-card-title-row"><div class="exam-card-stripe" style="background:${e.color}"></div><span class="exam-card-name">${e.name}</span></div>
      <div class="exam-card-actions">
        <button class="btn-icon" onclick="event.stopPropagation();moveExam('${e.id}',-1)" title="Sposta su"${idx===0?' disabled':''}>▲</button>
        <button class="btn-icon" onclick="event.stopPropagation();moveExam('${e.id}',1)" title="Sposta giù"${idx===total-1?' disabled':''}>▼</button>
        ${e.moodle?`<a class="exam-moodle" href="${e.moodle}" target="_blank" onclick="event.stopPropagation()">Moodle</a>`:''}
        <button class="btn-icon${e.completed?' completed':''} " onclick="event.stopPropagation();completeExam('${e.id}')" title="${e.completed?'Esame completato':'Segnare come sostenuto'}">✅</button>
        <button class="btn-icon" onclick="event.stopPropagation();openExamModal('${e.id}')">✏️</button>
        <button class="btn-icon" onclick="event.stopPropagation();deleteExam('${e.id}')">🗑️</button>
      </div>
    </div>
    <div class="exam-card-body">
      ${notesHtml}
      ${chosenAppell?`<div class="exam-appell-chosen">📅 Appello: <strong>${fmt(chosenAppell.date)}</strong>${du!==null?`<span class="days-left">${du>0?du+' gg':du===0?'oggi':'passato'}</span>`:''}</div>`:''}
      ${(()=>{const pace=examDailyPace(e);if(!pace||!pace.items.length)return'';return`<div class="exam-pace-block"><div class="exam-pace-title">⚡ Ritmo necessario — <strong>${pace.daysLeft} giorni</strong> al ${fmtShort(pace.date)}</div><div class="exam-pace-items">${pace.items.map(i=>`<span class="pace-chip"><strong>${i.perDay} ${i.unit}/g</strong> ${i.label} <small>(${i.remaining} rimaste)</small></span>`).join('')}</div></div>`;})()}
      ${booksHtml?`<div class="books-section-title">📚 LIBRI</div>${booksHtml}`:''}
      ${materialsHtml}
    </div>
  </div>`;
}

// ===== COLOR PICKER =====
function renderColorPicker(cid, selected, colors){
  const el=document.getElementById(cid);
  const visibleCount = 6;
  const visibleColors = colors.slice(0, visibleCount);
  const hiddenColors = colors.slice(visibleCount);
  
  let html = '<div class="color-picker-visible">';
  visibleColors.forEach(c => {
    html += `<div class="color-swatch ${c===selected?'selected':''}" style="background:${c}" data-color="${c}" onclick="selectSwatch(this,'${cid}')"></div>`;
  });
  
  if(hiddenColors.length > 0){
    html += `<button type="button" class="color-picker-dropdown-btn" onclick="toggleColorDropdown('${cid}')">▼</button>`;
    html += '<div class="color-picker-dropdown hidden" id="' + cid + '-dropdown">';
    hiddenColors.forEach(c => {
      html += `<div class="color-swatch ${c===selected?'selected':''}" style="background:${c}" data-color="${c}" onclick="selectSwatch(this,'${cid}')"></div>`;
    });
    html += '</div>';
  }
  html += '</div>';
  
  el.innerHTML = html;
  el.dataset.selected = selected || colors[0];
}
window.toggleColorDropdown=function(cid){
  const dropdown = document.getElementById(cid + '-dropdown');
  const btn = dropdown?.previousElementSibling;
  if(dropdown){
    dropdown.classList.toggle('hidden');
    if(btn) btn.classList.toggle('open');
  }
};
window.selectSwatch=function(swatch,cid){
  document.querySelectorAll(`#${cid} .color-swatch`).forEach(s=>s.classList.remove('selected'));
  swatch.classList.add('selected'); 
  document.getElementById(cid).dataset.selected=swatch.dataset.color;
  const dropdown = document.getElementById(cid + '-dropdown');
  if(dropdown && !dropdown.classList.contains('hidden')){
    dropdown.classList.add('hidden');
    const btn = dropdown.previousElementSibling;
    if(btn) btn.classList.remove('open');
  }
};
function addCustomSwatch(cid,hex){
  const el=document.getElementById(cid);
  let ex=el.querySelector(`[data-color="${hex}"]`);
  if(!ex){const d=document.createElement('div');d.className='color-swatch';d.style.background=hex;d.dataset.color=hex;d.onclick=()=>window.selectSwatch(d,cid);el.appendChild(d);}
  el.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected'));
  (ex||el.lastElementChild).classList.add('selected'); el.dataset.selected=hex;
}
document.getElementById('applyCustomColor').addEventListener('click',()=>addCustomSwatch('colorPicker',document.getElementById('examCustomColor').value));

// ===== EXAM MODAL =====
['btnAddExam','btnAddExam2'].forEach(id=>document.getElementById(id)?.addEventListener('click',()=>openExamModal(null)));

// ===== BOOK TRACK CONFIGURATION (per libro) =====
const DEFAULT_TRACK_CONFIG = [
  { id: 'pages_read', label: '📖 Lette', icon: '📖', type: 'predefined', field: 'pagesRead' },
  { id: 'pages_underlined', label: '✏️ Sottolineate', icon: '✏️', type: 'predefined', field: 'pagesUnderlined' },
  { id: 'pages_studied', label: '🧠 Studiate', icon: '🧠', type: 'predefined', field: 'pagesStudied' },
  { id: 'chapters', label: '📚 Capitoli', icon: '📚', type: 'predefined', field: 'chapters' },
];

// Config di un libro: usa quella propria del libro, altrimenti (migrazione da esami vecchi)
// quella salvata a livello di esame, altrimenti quella di default.
function getBookTrackConfig(book, exam) {
  if (book && book.trackConfig) return book.trackConfig;
  if (exam && exam.bookTrackConfig) return exam.bookTrackConfig;
  return DEFAULT_TRACK_CONFIG.slice();
}

// Mostra/nasconde nel form i campi non presenti nella config del libro
function applyBookFieldVisibility(entryEl, config) {
  const ids = new Set((config || []).map(c => c.id));
  entryEl.querySelectorAll('.b-track-field').forEach(field => {
    field.classList.toggle('hidden', !ids.has(field.dataset.trackId));
  });
}

let editingBookEntryEl = null;

window.openBookTrackModal = function(entryEl) {
  editingBookEntryEl = entryEl;
  const config = JSON.parse(entryEl.dataset.trackConfig || '[]');

  document.getElementById('bookTrackModalCheckboxes').innerHTML = DEFAULT_TRACK_CONFIG.map(c => `
    <div class="track-checkbox-item">
      <input type="checkbox" id="bmtrack-${c.id}" class="book-track-modal-cb" data-track-id="${c.id}" ${config.some(conf => conf.id === c.id) ? 'checked' : ''}>
      <label for="bmtrack-${c.id}">${c.label}</label>
    </div>
  `).join('');

  const custom = config.filter(c => c.type === 'custom');
  document.getElementById('bookTrackModalCustomList').innerHTML = custom.map(c => `
    <div class="custom-track-tag" data-custom-track-id="${c.id}">
      <span>${c.label}</span>
      <button type="button" onclick="this.closest('.custom-track-tag').remove()">✕</button>
    </div>
  `).join('');

  openModal('bookTrackModal');
};

document.getElementById('bookTrackModalAddCustomBtn').addEventListener('click', () => {
  const input = document.getElementById('bookTrackModalCustomInput');
  const text = input.value.trim();
  if (!text) return;
  const customList = document.getElementById('bookTrackModalCustomList');
  const trackId = 'custom_' + uid();
  const tag = document.createElement('div');
  tag.className = 'custom-track-tag';
  tag.setAttribute('data-custom-track-id', trackId);
  tag.innerHTML = `<span>${text}</span><button type="button" onclick="this.closest('.custom-track-tag').remove()">✕</button>`;
  customList.appendChild(tag);
  input.value = '';
});
document.getElementById('bookTrackModalCustomInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('bookTrackModalAddCustomBtn').click(); }
});

document.getElementById('bookTrackModalSaveBtn').addEventListener('click', () => {
  if (!editingBookEntryEl) return;
  const checked = [...document.querySelectorAll('.book-track-modal-cb:checked')].map(cb => cb.dataset.trackId);
  const predefined = DEFAULT_TRACK_CONFIG.filter(c => checked.includes(c.id));
  const custom = [...document.querySelectorAll('#bookTrackModalCustomList .custom-track-tag')].map(tag => ({
    id: tag.dataset.customTrackId, label: tag.querySelector('span').textContent, icon: '🏷️', type: 'custom', field: null
  }));
  const config = [...predefined, ...custom];
  editingBookEntryEl.dataset.trackConfig = JSON.stringify(config);
  applyBookFieldVisibility(editingBookEntryEl, config);
  editingBookEntryEl = null;
  closeModal('bookTrackModal');
});

function getExamTrackConfig(exam) {
  if (!exam) return DEFAULT_TRACK_CONFIG.slice();
  if (!exam.bookTrackConfig) return DEFAULT_TRACK_CONFIG.slice();
  return exam.bookTrackConfig;
}

function renderBookTrackConfig(exam) {
  const cbDiv = document.getElementById('bookTrackCheckboxes');
  const customDiv = document.getElementById('customTracksList');
  if (!cbDiv || !customDiv) return;
  
  const config = getExamTrackConfig(exam);
  const custom = config.filter(c => c.type === 'custom');
  
  cbDiv.innerHTML = DEFAULT_TRACK_CONFIG.map(c => `
    <div class="track-checkbox-item">
      <input type="checkbox" id="track-${c.id}" class="book-track-cb" data-track-id="${c.id}" ${config.some(conf => conf.id === c.id) ? 'checked' : ''}>
      <label for="track-${c.id}">${c.label}</label>
    </div>
  `).join('');
  
  customDiv.innerHTML = custom.map(c => `
    <div class="custom-track-tag" data-custom-track-id="${c.id}">
      <span>${c.label}</span>
      <button type="button" onclick="removeCustomTrack('${c.id}')">✕</button>
    </div>
  `).join('');
}

function collectBookTrackConfig() {
  const checked = [...document.querySelectorAll('.book-track-cb:checked')].map(cb => cb.dataset.trackId);
  const predefined = DEFAULT_TRACK_CONFIG.filter(c => checked.includes(c.id));
  
  const customTags = document.querySelectorAll('.custom-track-tag');
  const custom = Array.from(customTags).map(tag => ({
    id: tag.dataset.customTrackId,
    label: tag.querySelector('span').textContent,
    icon: '🏷️',
    type: 'custom',
    field: null
  }));
  
  return [...predefined, ...custom];
}

window.removeCustomTrack = function(trackId) {
  const tag = document.querySelector(`.custom-track-tag[data-custom-track-id="${trackId}"]`);
  if (tag) tag.remove();
};

window.openExamModal=function(examId){
  state.editingExamId=examId;
  const exam=examId?state.exams.find(e=>e.id===examId):null;
  document.getElementById('examModalTitle').textContent=exam?'Modifica Esame':'Nuovo Esame';
  document.getElementById('examName').value=exam?exam.name:'';
  document.getElementById('examMoodle').value=exam?(exam.moodle||''):'';
  document.getElementById('examNotes').value=exam?(exam.notes||''):'';
  renderColorPicker('colorPicker',exam?exam.color:PRESET_COLORS[0],PRESET_COLORS);
  if(exam) document.getElementById('examCustomColor').value=exam.color;

  const ac=document.getElementById('appellDates');
  renderAppellRows(ac,exam?(exam.appells||[]):[]);
  document.getElementById('addAppellBtn').onclick=()=>renderAppellRows(ac,[...collectAppells(),{date:'',chosen:false}]);

  const bc=document.getElementById('booksList');
  renderBookEntries(bc,exam?(exam.books||[]):[],exam);
  document.getElementById('addBookBtn').onclick=()=>renderBookEntries(bc,[...collectBooks(),{title:'',totalPages:0,totalChapters:0}],exam);

  const hasSl=document.getElementById('hasSlidesi'),slD=document.getElementById('slidesDetail');
  hasSl.checked=!!(exam&&exam.hasSlides); slD.classList.toggle('hidden',!hasSl.checked);
  document.getElementById('slidesTotal').value=exam?(exam.slidesTotal||''):'';
  document.getElementById('slidesDone').value=exam?(exam.slidesDone||''):'';
  hasSl.onchange=()=>slD.classList.toggle('hidden',!hasSl.checked);

  const hasV=document.getElementById('hasVideo'),vD=document.getElementById('videoDetail');
  hasV.checked=!!(exam&&exam.hasVideo); vD.classList.toggle('hidden',!hasV.checked);
  document.getElementById('videoTotal').value=exam?(exam.videoTotal||''):'';
  document.getElementById('videoDone').value=exam?(exam.videoDone||''):'';
  hasV.onchange=()=>vD.classList.toggle('hidden',!hasV.checked);

  openModal('examModal');
};

function renderAppellRows(container,appells){
  container.innerHTML=appells.map((a,i)=>`<div class="appell-row">
    <span class="appell-label">📅</span>
    <input type="date" class="appell-date" value="${a.date||''}">
    <label><input type="checkbox" class="appell-chosen-check" ${a.chosen?'checked':''}> scelto</label>
    <button class="btn-icon" onclick="this.closest('.appell-row').remove()">✕</button>
  </div>`).join('');
  container.querySelectorAll('.appell-chosen-check').forEach(cb=>cb.addEventListener('change',()=>{
    if(cb.checked) container.querySelectorAll('.appell-chosen-check').forEach(c=>{if(c!==cb)c.checked=false;});
  }));
}
function collectAppells(){
  return [...document.getElementById('appellDates').querySelectorAll('.appell-row')].map(row=>({
    date:row.querySelector('.appell-date').value, chosen:row.querySelector('.appell-chosen-check').checked,
  }));
}
function renderBookEntries(container,books,exam){
  container.innerHTML=books.map((b,i)=>`<div class="book-entry">
    <div class="book-entry-header">
      <strong>Libro ${i+1}</strong>
      <div class="book-entry-header-actions">
        <button class="btn-icon" title="Configura metriche" onclick="event.stopPropagation();openBookTrackModal(this.closest('.book-entry'))">⚙️</button>
        <button class="btn-icon" onclick="this.closest('.book-entry').remove()">✕</button>
      </div>
    </div>
    <div class="form-row"><div class="form-group"><label>Titolo</label><input type="text" class="b-title" value="${b.title||''}"></div></div>
    <div class="form-row">
      <div class="form-group"><label>Pagine totali</label><input type="number" class="b-totalpages" value="${b.totalPages||''}"></div>
      <div class="form-group b-track-field" data-track-id="pages_read"><label>Pagine lette</label><input type="number" class="b-pagesread" value="${b.pagesRead||''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group b-track-field" data-track-id="pages_underlined"><label>Pag. sottolineate</label><input type="number" class="b-pagesunderlined" value="${b.pagesUnderlined||''}"></div>
      <div class="form-group b-track-field" data-track-id="pages_studied"><label>Pag. studiate</label><input type="number" class="b-pagesstudied" value="${b.pagesStudied||''}"></div>
    </div>
    <div class="form-row b-track-field" data-track-id="chapters">
      <div class="form-group"><label>Capitoli totali</label><input type="number" class="b-totalchapters" value="${b.totalChapters||''}"></div>
      <div class="form-group"><label>Cap. letti</label><input type="number" class="b-chaptersread" value="${b.chaptersRead||''}"></div>
    </div>
    <div class="form-row b-track-field" data-track-id="chapters">
      <div class="form-group"><label>Cap. Anki</label><input type="number" class="b-chaptersanki" value="${b.chaptersAnki||''}"></div>
      <div class="form-group"><label>Cap. studiati</label><input type="number" class="b-chaptersstudied" value="${b.chaptersStudied||''}"></div>
    </div>
  </div>`).join('');

  [...container.querySelectorAll('.book-entry')].forEach((entryEl,i)=>{
    const config=getBookTrackConfig(books[i],exam);
    entryEl.dataset.trackConfig=JSON.stringify(config);
    applyBookFieldVisibility(entryEl,config);
  });
}
function collectBooks(){
  return [...document.getElementById('booksList').querySelectorAll('.book-entry')].map(e=>({
    title:e.querySelector('.b-title').value,
    totalPages:+e.querySelector('.b-totalpages').value||0,
    pagesRead:+e.querySelector('.b-pagesread').value||0,
    pagesUnderlined:+e.querySelector('.b-pagesunderlined').value||0,
    pagesStudied:+e.querySelector('.b-pagesstudied').value||0,
    totalChapters:+e.querySelector('.b-totalchapters').value||0,
    chaptersRead:+e.querySelector('.b-chaptersread').value||0,
    chaptersAnki:+e.querySelector('.b-chaptersanki').value||0,
    chaptersStudied:+e.querySelector('.b-chaptersstudied').value||0,
    trackConfig:JSON.parse(e.dataset.trackConfig||'[]'),
  }));
}

document.getElementById('saveExamBtn').addEventListener('click',()=>{
  const name=document.getElementById('examName').value.trim();
  if(!name){alert('Inserisci il nome!');return;}
  const color=document.getElementById('colorPicker').dataset.selected||PRESET_COLORS[0];
  const existingExam=state.editingExamId?state.exams.find(e=>e.id===state.editingExamId):null;
  const exam={
    id:state.editingExamId||uid(),name,color,
    moodle:document.getElementById('examMoodle').value.trim(),
    notes:document.getElementById('examNotes').value.trim(),
    appells:collectAppells(),books:collectBooks(),
    hasSlides:document.getElementById('hasSlidesi').checked,
    slidesTotal:+document.getElementById('slidesTotal').value||0,
    slidesDone:+document.getElementById('slidesDone').value||0,
    hasVideo:document.getElementById('hasVideo').checked,
    videoTotal:+document.getElementById('videoTotal').value||0,
    videoDone:+document.getElementById('videoDone').value||0,
    completed:existingExam?.completed||false,
  };
  if(state.editingExamId){const i=state.exams.findIndex(e=>e.id===state.editingExamId);if(i>=0)state.exams[i]=exam;}
  else state.exams.push(exam);
  save(); closeModal('examModal'); renderSidebarExams(); renderExamsGrid(); renderDashboard();
});
window.completeExam=function(id){
  const idx=state.exams.findIndex(e=>e.id===id); if(idx<0)return;
  state.exams[idx].completed=!state.exams[idx].completed;
  if(state.exams[idx].completed){
    // Sposta in fondo se marcato come completato
    const [item]=state.exams.splice(idx,1);
    state.exams.push(item);
  } else {
    // Se de-marcato, riporta all'inizio dei non-completati
    const [item]=state.exams.splice(idx,1);
    const firstCompletedIdx=state.exams.findIndex(e=>e.completed);
    if(firstCompletedIdx===-1) state.exams.push(item);
    else state.exams.splice(firstCompletedIdx,0,item);
  }
  save(); renderSidebarExams(); renderExamsGrid(); renderDashboard();
};
window.deleteExam=function(id){
  if(!confirm('Eliminare questo esame?'))return;
  state.exams=state.exams.filter(e=>e.id!==id);
  save(); renderSidebarExams(); renderExamsGrid(); renderDashboard();
};

// ===== PROGRESS MODAL =====
window.openProgressModal=function(examId,bookIdx){
  const exam=state.exams.find(e=>e.id===examId), book=exam.books[bookIdx];
  const trackConfig=getBookTrackConfig(book,exam);
  const has=id=>trackConfig.some(c=>c.id===id);
  document.getElementById('progressModalTitle').textContent=`📖 ${book.title||'Libro'}`;
  document.getElementById('progressModalBody').innerHTML=`
    ${has('pages_read')?`<div class="form-group"><label>Pagine lette</label><input type="number" id="pm-pagesread" value="${book.pagesRead||0}"></div>`:''}
    ${has('pages_underlined')?`<div class="form-group"><label>Pagine sottolineate</label><input type="number" id="pm-pagesunderlined" value="${book.pagesUnderlined||0}"></div>`:''}
    ${has('pages_studied')?`<div class="form-group"><label>Pagine studiate</label><input type="number" id="pm-pagesstudied" value="${book.pagesStudied||0}"></div>`:''}
    ${(has('chapters')&&book.totalChapters)?`
    <div class="form-group"><label>Capitoli letti</label><input type="number" id="pm-chapread" value="${book.chaptersRead||0}"></div>
    <div class="form-group"><label>Capitoli Anki</label><input type="number" id="pm-chapanki" value="${book.chaptersAnki||0}"></div>
    <div class="form-group"><label>Capitoli studiati</label><input type="number" id="pm-chapstudied" value="${book.chaptersStudied||0}"></div>`:''}`;
  document.getElementById('saveProgressBtn').onclick=()=>{
    if(has('pages_read')) book.pagesRead=+document.getElementById('pm-pagesread')?.value||0;
    if(has('pages_underlined')) book.pagesUnderlined=+document.getElementById('pm-pagesunderlined')?.value||0;
    if(has('pages_studied')) book.pagesStudied=+document.getElementById('pm-pagesstudied')?.value||0;
    if(has('chapters')&&book.totalChapters){
      book.chaptersRead=+document.getElementById('pm-chapread')?.value||0;
      book.chaptersAnki=+document.getElementById('pm-chapanki')?.value||0;
      book.chaptersStudied=+document.getElementById('pm-chapstudied')?.value||0;
    }
    save(); closeModal('progressModal'); renderExamsGrid(); renderDashboard();
  };
  openModal('progressModal');
};

window.deleteBlock=function(id){
  if(!confirm('Eliminare questo blocco?'))return;
  state.studyBlocks=state.studyBlocks.filter(b=>b.id!==id);
  save(); renderPlanningView();
  if(document.getElementById('view-calendario').classList.contains('active')) renderCalendar();
};

// ===== PLANNING VIEW =====
function renderPlanningView(){
  const simSel=document.getElementById('simExam'); if(!simSel)return;
  const cur=simSel.value;
  simSel.innerHTML='<option value="">— Seleziona esame —</option>'+
    state.exams.map(e=>`<option value="${e.id}"${e.id===cur?' selected':''}>${e.name}</option>`).join('');
  simSel.onchange=()=>renderSimResults();
  renderSimRows(); renderSimResults();
  const el=document.getElementById('blocksGrid'); if(!el)return;
  if(!state.studyBlocks.length){
    el.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">📋</div><p>Nessun blocco ancora.</p><button class="btn-primary" style="margin-top:12px" onclick="openBlockModal(null)">+ Crea il primo blocco</button></div>`;
    return;
  }
  el.innerHTML=state.studyBlocks.map(block=>{
    const examIds=blockExamIds(block);
    const exams=examIds.map(id=>state.exams.find(e=>e.id===id)).filter(Boolean);
    const days=blockDays(block).length;
    const wdLabels=['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
    const activeDows=blockActiveWeekdays(block);
    const wdSummary=activeDows.length===7?'':' · '+(activeDows.length===5&&!activeDows.includes(0)&&!activeDows.includes(6)?'solo feriali':activeDows.slice().sort().map(d=>wdLabels[d]).join('/'));
    const refDate=blockReferenceDate(block);
    let autoHtml='';
    if(refDate&&(block.autoItems||[]).length){
      const groups={};
      block.autoItems.forEach(it=>{ const info=itemRemaining(it); if(!info)return; (groups[info.unit]=groups[info.unit]||[]).push(it); });
      autoHtml=Object.keys(groups).map(unit=>{
        const pace=poolPaceOnDate(block,groups[unit],refDate);
        if(!pace)return'';
        return pace.done?`<span class="pace-chip">✓ ${unitLabel(unit)} finite</span>`:`<span class="pace-chip"><strong>${pace.perDay} ${unit}/g</strong> ${unitLabel(unit)}${groups[unit].length>1?` <small>(${groups[unit].length} fonti)</small>`:''}</span>`;
      }).join('');
    }
    return `<div class="block-card" style="border-left:4px solid ${block.color}">
      <div class="block-card-header">
        <div>
          <div class="block-card-title">${block.label}</div>
          <div class="block-card-meta">📅 ${fmtShort(block.startDate)} → ${fmtShort(block.endDate)} · <strong>${days} giorn${days===1?'o':'i'}</strong>${wdSummary}</div>
          ${exams.length?`<div class="block-card-exam">🎓 ${exams.map(e=>`<span style="color:${e.color}">${e.name}</span>`).join(' · ')}</div>`:''}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="btn-icon" onclick="openBlockModal('${block.id}')">✏️</button>
          <button class="btn-icon" onclick="deleteBlock('${block.id}')">🗑️</button>
        </div>
      </div>
      ${autoHtml?`<div class="exam-pace-items" style="margin-bottom:8px">${autoHtml}</div>`:''}
      ${block.tasks.length?`<ul class="block-card-tasks">${block.tasks.map(t=>`<li>${t.text}</li>`).join('')}</ul>`:''}
      ${(!block.tasks.length&&!autoHtml)?'<p style="color:var(--ink-light);font-size:12px;padding:4px 0">Nessuna attività</p>':''}
    </div>`;
  }).join('');
}

// ===== SCENARIO SIMULATOR =====
window.addSimRow=function(type){
  simRows.push(type==='days'?{type:'days',days:15}:{type:'date',date:'',excl:false});
  renderSimRows(); renderSimResults();
};
window.renderSimRows=renderSimRows;
window.renderSimResults=renderSimResults;
function renderSimRows(){
  const container=document.getElementById('simScenarioRows'); if(!container)return;
  if(!simRows.length){container.innerHTML='<p style="color:var(--ink-light);font-size:13px;padding:8px 0">Aggiungi uno scenario cliccando i pulsanti qui sotto →</p>';return;}
  container.innerHTML=simRows.map((row,i)=>{
    if(row.type==='days') return `<div class="sim-row">
      <span class="sim-row-label">Scenario ${i+1}: se studiassi</span>
      <input type="number" class="sim-days-input" min="1" max="365" value="${row.days}"
        onchange="window.simRows[${i}].days=Math.max(1,+this.value||15);window.renderSimResults()">
      <span>giorni</span>
      <button class="btn-icon" onclick="window.simRows.splice(${i},1);window.renderSimRows();window.renderSimResults()">✕</button>
    </div>`;
    return `<div class="sim-row">
      <span class="sim-row-label">Scenario ${i+1}: fino al</span>
      <input type="date" class="sim-date-input" value="${row.date}"
        onchange="window.simRows[${i}].date=this.value;window.renderSimResults()">
      <label style="display:flex;align-items:center;gap:4px;font-size:13px"><input type="checkbox"${row.excl?' checked':''}
        onchange="window.simRows[${i}].excl=this.checked;window.renderSimResults()"> no WE</label>
      <button class="btn-icon" onclick="window.simRows.splice(${i},1);window.renderSimRows();window.renderSimResults()">✕</button>
    </div>`;
  }).join('');
}
function renderSimResults(){
  const examId=document.getElementById('simExam')?.value;
  const exam=state.exams.find(e=>e.id===examId);
  const el=document.getElementById('simResultsArea'); if(!el)return;
  if(!exam||!simRows.length){el.innerHTML='';return;}
  // Compute days per scenario
  const scenarios=simRows.map((row,i)=>{
    let days; const t=today();
    if(row.type==='days'){days=Math.max(1,row.days||1);}
    else if(!row.date||row.date<t){days=0;}
    else{
      let cur=new Date(t+'T00:00:00'),end=new Date(row.date+'T00:00:00');days=0;
      while(cur<=end){const dow=cur.getDay();if(!row.excl||(dow!==0&&dow!==6))days++;cur.setDate(cur.getDate()+1);}
    }
    const label=row.type==='days'?`${row.days} gg`:(row.excl?`al ${fmtShort(row.date)}<br><small>no WE — ${days}gg</small>`:`al ${fmtShort(row.date)}<br><small>${days} gg</small>`);
    return{...row,idx:i,days,label};
  });
  // Materials remaining
  const materials=[];
  (exam.books||[]).forEach((b,i)=>{
    if(!b.totalPages)return;
    materials.push({label:b.title||`Libro ${i+1}`,rem:Math.max(0,b.totalPages-(b.pagesRead||0)),unit:'pp'});
  });
  if(exam.hasSlides&&exam.slidesTotal) materials.push({label:'🖥️ Slides',rem:Math.max(0,exam.slidesTotal-(exam.slidesDone||0)),unit:'slides'});
  if(exam.hasVideo&&exam.videoTotal)   materials.push({label:'🎬 Video', rem:Math.max(0,exam.videoTotal-(exam.videoDone||0)),unit:'min'});
  if(!materials.length){el.innerHTML='<p style="color:var(--ink-light);font-size:13px;margin-top:12px">Inserisci i materiali nell\'esame (pagine totali, slides, ecc.) per vedere i calcoli.</p>';return;}
  let html=`<div class="sim-table-wrap"><table class="sim-table"><thead><tr><th>Materiale</th><th>Rimaste</th>${scenarios.map(s=>`<th>${s.label}</th>`).join('')}</tr></thead><tbody>`;
  materials.forEach(m=>{
    html+=`<tr><td>${m.label}</td><td class="text-mono">${m.rem} ${m.unit}</td>`;
    scenarios.forEach(s=>{
      if(s.days<=0){html+=`<td class="sim-cell warn">data passata</td>`;return;}
      if(!m.rem){html+=`<td class="sim-cell done">✓ finito</td>`;return;}
      html+=`<td class="sim-cell"><strong>${Math.ceil(m.rem/s.days)}</strong> ${m.unit}/g</td>`;
    });
    html+='</tr>';
  });
  html+='</tbody></table></div>';
  el.innerHTML=html;
}

// ===== BLOCK MODAL =====
// Multi-select exam picker (chips) — a block can now pool materials from several exams at once
function renderBlockExamPicker(selectedIds){
  const picker=document.getElementById('blockExamPicker'); if(!picker)return;
  if(!state.exams.length){ picker.innerHTML='<p style="font-size:12px;color:var(--ink-light)">Nessun esame creato ancora.</p>'; return; }
  picker.innerHTML=state.exams.map(e=>{
    const active=selectedIds.includes(e.id);
    return `<button type="button" class="exam-chip${active?' active':''}" data-examid="${e.id}" style="${active?`background:${e.color};border-color:${e.color}`:''}">${e.name}</button>`;
  }).join('');
  picker.querySelectorAll('.exam-chip').forEach(chip=>{
    chip.onclick=()=>{
      const nowActive=!chip.classList.contains('active');
      chip.classList.toggle('active',nowActive);
      const exam=state.exams.find(ex=>ex.id===chip.dataset.examid);
      chip.style.background=nowActive&&exam?exam.color:'';
      chip.style.borderColor=nowActive&&exam?exam.color:'';
      renderBlockMaterialsSection();
    };
  });
}
function getSelectedExamIdsFromUI(){
  return [...document.querySelectorAll('#blockExamPicker .exam-chip.active')].map(c=>c.dataset.examid);
}
function renderBlockTaskEntries(container,tasks){
  container.innerHTML=tasks.map(t=>`<div class="block-task-entry">
    <input type="text" class="block-task-text" value="${(t.text||'').replace(/"/g,'&quot;')}" placeholder="es. ripetere ad alta voce cap 2, 2 capovolte...">
    <button class="btn-icon" onclick="this.closest('.block-task-entry').remove()">✕</button>
  </div>`).join('');
}
function collectBlockTasks(){
  return[...document.querySelectorAll('.block-task-entry')].map(e=>({
    id:uid(),text:e.querySelector('.block-task-text').value.trim()
  })).filter(t=>t.text);
}

// --- Weekday picker (Lun-Dom chips) ---
function initWeekdayPicker(activeDows){
  const picker=document.getElementById('blockWeekdayPicker'); if(!picker)return;
  picker.querySelectorAll('.wd-chip').forEach(chip=>{
    const dow=+chip.dataset.dow;
    chip.classList.toggle('active',activeDows.includes(dow));
    chip.onclick=()=>{ chip.classList.toggle('active'); updateBlockDaysPreview(); };
  });
}
function getSelectedWeekdaysFromUI(){
  return [...document.querySelectorAll('#blockWeekdayPicker .wd-chip.active')].map(c=>+c.dataset.dow);
}
document.getElementById('wdPresetAll')?.addEventListener('click',()=>{
  document.querySelectorAll('#blockWeekdayPicker .wd-chip').forEach(c=>c.classList.add('active'));
  updateBlockDaysPreview();
});
document.getElementById('wdPresetWeekdays')?.addEventListener('click',()=>{
  document.querySelectorAll('#blockWeekdayPicker .wd-chip').forEach(c=>c.classList.toggle('active',['1','2','3','4','5'].includes(c.dataset.dow)));
  updateBlockDaysPreview();
});

// --- Auto-calculated materials picker (now spans every selected exam, pooled by unit) ---
// Tracks materials the person explicitly UNchecked during this modal session (default = all checked),
// so toggling exams on/off never loses the checks already made on the others.
let editingBlockUncheckedTemp=new Set();
function renderBlockMaterialsSection(){
  const examIds=getSelectedExamIdsFromUI();
  const section=document.getElementById('blockMaterialsSection');
  const list=document.getElementById('blockMaterialsList');
  if(!section||!list)return;
  if(!examIds.length){ section.classList.add('hidden'); list.innerHTML=''; return; }
  const materials=materialsForExams(examIds);
  section.classList.remove('hidden');
  if(!materials.length){
    list.innerHTML=`<p style="font-size:12px;color:var(--ink-light)">Aggiungi pagine totali, slides o video agli esami selezionati per attivare il calcolo automatico.</p>`;
    return;
  }
  const start=document.getElementById('blockStart').value, end=document.getElementById('blockEnd').value;
  const activeDows=getSelectedWeekdaysFromUI();
  let nDays=0;
  if(start&&end&&end>=start&&activeDows.length){
    let cur=new Date(start+'T00:00:00'),endDate=new Date(end+'T00:00:00');
    while(cur<=endDate){ if(activeDows.includes(cur.getDay()))nDays++; cur.setDate(cur.getDate()+1); }
  }
  const groups={};
  materials.forEach(m=>{ (groups[m.unit]=groups[m.unit]||[]).push(m); });
  list.innerHTML=Object.keys(groups).map(unit=>{
    const items=groups[unit];
    const checkedItems=items.filter(m=>!editingBlockUncheckedTemp.has(matKey(m)));
    const totalRemaining=checkedItems.reduce((s,m)=>s+Math.max(0,m.total-m.done),0);
    const perDay=(nDays>0&&checkedItems.length)?Math.ceil(totalRemaining/nDays):null;
    return `<div class="block-material-group">
      <div class="block-material-group-header">${unitIcon(unit)} <strong>${unitLabel(unit)}</strong>${perDay!=null?` <span class="block-material-pace">— <strong>${perDay} ${unit}/g</strong> combinat${unit==='pp'?'e':'i'} (${totalRemaining} rimaste in totale)</span>`:''}</div>
      ${items.map(m=>{
        const checked=!editingBlockUncheckedTemp.has(matKey(m));
        const remaining=Math.max(0,m.total-m.done);
        return `<label class="block-material-row${checked?' checked':''}">
          <input type="checkbox" class="block-material-cb" data-examid="${m.examId}" data-type="${m.type}" data-bookidx="${m.bookIdx??''}" ${checked?'checked':''} onchange="toggleBlockMaterial(this)">
          <span class="block-material-icon">${m.icon}</span>
          <span class="block-material-label">${m.label} <small style="color:${m.examColor};font-weight:600">· ${m.examName}</small></span>
          <span class="block-material-pace">${remaining} ${m.unit} rimaste</span>
        </label>`;
      }).join('')}
    </div>`;
  }).join('');
}
window.toggleBlockMaterial=function(cb){
  const key=`${cb.dataset.examid}|${cb.dataset.type}|${cb.dataset.bookidx||'x'}`;
  if(cb.checked) editingBlockUncheckedTemp.delete(key); else editingBlockUncheckedTemp.add(key);
  renderBlockMaterialsSection();
};
function collectBlockAutoItems(){
  return [...document.querySelectorAll('.block-material-cb:checked')].map(cb=>({
    examId:cb.dataset.examid, type:cb.dataset.type, bookIdx: cb.dataset.bookidx===''?null:+cb.dataset.bookidx
  }));
}

window.updateBlockDaysPreview=function(){
  const start=document.getElementById('blockStart')?.value;
  const end=document.getElementById('blockEnd')?.value;
  const el=document.getElementById('blockDaysPreview'); if(!el){renderBlockMaterialsSection();return;}
  const activeDows=getSelectedWeekdaysFromUI();
  if(!start||!end){el.textContent='';renderBlockMaterialsSection();return;}
  if(end<start){el.innerHTML='⚠️ La data di fine è prima di quella di inizio';renderBlockMaterialsSection();return;}
  let count=0,cur=new Date(start+'T00:00:00'),endDate=new Date(end+'T00:00:00');
  while(cur<=endDate){if(activeDows.includes(cur.getDay()))count++;cur.setDate(cur.getDate()+1);}
  el.innerHTML=`📅 <strong>${count} giorn${count===1?'o':'i'}</strong> di studio · dal ${fmt(start)} al ${fmt(end)}`;
  renderBlockMaterialsSection();
};
document.getElementById('btnAddBlock').addEventListener('click',()=>openBlockModal(null));
window.openBlockModal=function(blockId){
  state.editingBlockId=blockId;
  const block=blockId?state.studyBlocks.find(b=>b.id===blockId):null;
  document.getElementById('blockModalTitle').textContent=block?'Modifica Blocco':'Nuovo Blocco di Studio';
  document.getElementById('blockLabel').value=block?.label||'';
  document.getElementById('blockStart').value=block?.startDate||'';
  document.getElementById('blockEnd').value=block?.endDate||'';
  const examIds=block?blockExamIds(block):[];
  renderBlockExamPicker(examIds);
  const tc=document.getElementById('blockTasksList');
  renderBlockTaskEntries(tc,block?.tasks?.length?block.tasks:[{text:''}]);
  document.getElementById('addBlockTaskBtn').onclick=()=>renderBlockTaskEntries(tc,[...collectBlockTasks(),{text:''}]);

  initWeekdayPicker(block?blockActiveWeekdays(block):[1,2,3,4,5,6,0]);

  // Rebuild the "unchecked" set from what was actually saved (everything else defaults to checked)
  editingBlockUncheckedTemp=new Set();
  if(block){
    const savedKeys=new Set((block.autoItems||[]).map(matKey));
    materialsForExams(examIds).forEach(m=>{ if(!savedKeys.has(matKey(m))) editingBlockUncheckedTemp.add(matKey(m)); });
  }

  updateBlockDaysPreview();
  openModal('blockModal');
};
document.getElementById('saveBlockBtn').addEventListener('click',()=>{
  const label=document.getElementById('blockLabel').value.trim();
  const startDate=document.getElementById('blockStart').value;
  const endDate=document.getElementById('blockEnd').value;
  if(!startDate||!endDate){alert('Inserisci le date!');return;}
  if(endDate<startDate){alert('La data di fine deve essere dopo quella di inizio!');return;}
  const activeWeekdays=getSelectedWeekdaysFromUI();
  if(!activeWeekdays.length){alert('Seleziona almeno un giorno della settimana!');return;}
  const examIds=getSelectedExamIdsFromUI();
  const firstExam=examIds[0]?state.exams.find(e=>e.id===examIds[0]):null;
  const tasks=collectBlockTasks();
  const autoItems=collectBlockAutoItems();
  const block={
    id:state.editingBlockId||uid(),
    label:label||`Blocco ${fmtShort(startDate)}–${fmtShort(endDate)}`,
    examIds,color:firstExam?.color||'#3548c0',
    startDate,endDate,
    activeWeekdays,
    tasks, autoItems,
  };
  if(state.editingBlockId){const i=state.studyBlocks.findIndex(b=>b.id===state.editingBlockId);if(i>=0)state.studyBlocks[i]=block;}
  else state.studyBlocks.push(block);
  save();closeModal('blockModal');renderPlanningView();
  if(document.getElementById('view-calendario').classList.contains('active'))renderCalendar();
});

// ===== CALENDAR =====
function renderCalendar(){
  const months=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  document.getElementById('calMonthLabel').textContent=`${months[state.calMonth]} ${state.calYear}`;
  const firstDay=new Date(state.calYear,state.calMonth,1).getDay();
  const startOffset=(firstDay+6)%7;
  const daysInMonth=new Date(state.calYear,state.calMonth+1,0).getDate();
  const daysInPrev=new Date(state.calYear,state.calMonth,0).getDate();
  const todayStr=today();
  const fromDate=`${state.calYear}-${String(state.calMonth+1).padStart(2,'0')}-01`;
  const toDate=`${state.calYear}-${String(state.calMonth+1).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;
  const dateBlockMap=buildDateBlockMap(fromDate,toDate);
  let html='<div class="cal-weekdays">';
  ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'].forEach(d=>html+=`<div class="cal-weekday">${d}</div>`);
  html+='</div><div class="cal-days">';
  for(let i=startOffset-1;i>=0;i--) html+=`<div class="cal-day other-month"><span class="cal-day-num">${daysInPrev-i}</span></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const ds=`${state.calYear}-${String(state.calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayData=state.calendar[ds]||{};
    const dayBlocks=dateBlockMap[ds]||[];
    const isActive=dayBlocks.length>0;
    const isToday=ds===todayStr;
    const appellExams=state.exams.filter(e=>(e.appells||[]).some(a=>a.date===ds));
    let pills='';
    const seen=new Set();
    dayBlocks.forEach(block=>{
      if(seen.has(block.id))return;seen.add(block.id);
      const allDone=(block.tasks||[]).length>0&&(block.tasks||[]).every(t=>dayData.completions?.[t.id]);
      pills+=`<span class="cal-pill" style="background:${block.color};opacity:${allDone?1:0.75}">${allDone?'✓ ':''}${block.label.split(' ')[0]}</span>`;
    });
    const cls=['cal-day',isToday?'today':'',isActive?'study-day':'',appellExams.length?'has-appell':''].filter(Boolean).join(' ');
    html+=`<div class="${cls}" onclick="handleDayClick('${ds}')"><span class="cal-day-num">${d}</span><div class="cal-day-pills">${pills}</div></div>`;
  }
  const rem=(7-(startOffset+daysInMonth)%7)%7;
  for(let i=1;i<=rem;i++) html+=`<div class="cal-day other-month"><span class="cal-day-num">${i}</span></div>`;
  html+='</div>';
  document.getElementById('calGrid').innerHTML=html;
}
document.getElementById('calPrev').addEventListener('click',()=>{state.calMonth--;if(state.calMonth<0){state.calMonth=11;state.calYear--;}renderCalendar();});
document.getElementById('calNext').addEventListener('click',()=>{state.calMonth++;if(state.calMonth>11){state.calMonth=0;state.calYear++;}renderCalendar();});

window.handleDayClick=function(dateStr){state.selectedDay=dateStr;renderDayPanel(dateStr);};

function renderDayPanel(dateStr){
  const panel=document.getElementById('dayPanel');
  const dayData=state.calendar[dateStr]||{};
  const dayBlocks=blocksForDate(dateStr);
  const appellExams=state.exams.filter(e=>(e.appells||[]).some(a=>a.date===dateStr));
  const months=['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  const [y,m,d]=dateStr.split('-');
  const dateLabel=`${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;

  const appellHtml=appellExams.map(e=>`<div class="day-appell-badge" style="border-left:3px solid ${e.color}">📅 <strong style="color:${e.color}">${e.name}</strong> — giorno dell'appello!</div>`).join('');

  let blocksHtml='';
  if(dayBlocks.length){
    blocksHtml=dayBlocks.map(block=>{
      const tasks=block.tasks||[];
      const doneCnt=tasks.filter(t=>dayData.completions?.[t.id]).length;
      return `<div class="day-block-section" style="border-left:3px solid ${block.color}">
        <div class="day-block-name">${block.label}${tasks.length?` <small>(${doneCnt}/${tasks.length})</small>`:''}</div>
        ${renderBlockDayContent(block,dateStr,dayData)}
      </div>`;
    }).join('');
  } else {
    blocksHtml='<p class="day-no-blocks">Nessun blocco attivo. Vai su <strong>Pianifica</strong> per creare un blocco di studio con attività.</p>';
  }

  panel.innerHTML=`
    <div class="day-panel-title">${dateLabel}</div>
    ${appellHtml}
    ${blocksHtml}
    <div class="day-note-section">
      <label class="day-note-label">📝 Note del giorno</label>
      <textarea id="dayNoteInput" class="day-note-input" rows="3" placeholder="Hai fatto di più? Di meno? Note libere…">${dayData.note||''}</textarea>
    </div>
    <button class="btn-primary" style="margin-top:12px;width:100%" onclick="saveDayPanel('${dateStr}')">💾 Salva note</button>
  `;

  attachBlockDayListeners(panel, dateStr);
}

window.saveDayPanel=function(dateStr){
  if(!state.calendar[dateStr])state.calendar[dateStr]={};
  state.calendar[dateStr].note=document.getElementById('dayNoteInput')?.value||'';
  save();
  showSync('Note salvate ✓','success');setTimeout(hideSync,1800);
};



// ===== MODALS =====
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>closeModal(btn.dataset.close)));
document.querySelectorAll('.modal-overlay').forEach(ov=>ov.addEventListener('click',e=>{if(e.target===ov)ov.classList.remove('open');}));

// ===== INIT =====
document.getElementById('sidebar').style.display='none';
document.getElementById('main').style.display='none';