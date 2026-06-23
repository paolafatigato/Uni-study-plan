/* =============================================
   STUDYMAP — app.js  (Firebase + ES Module)
   Study Plans: per-period material selection
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

// ===== PALETTE =====
const PRESET_COLORS = [
  '#ff0022','#c8001a','#e8002b','#ff4d63',
  '#3548c0','#1565c0','#5c946e','#2e7d32',
  '#7c4dff','#e65100','#ad1457','#6a1b9a',
  '#00695c','#0277bd','#f57f17','#4e342e'
];

// ===== STATE =====
// studyPlans: array of { id, label, from, to, items: [{examId, bookIdx, type}] }
//   type: 'book' | 'slides' | 'video'
// calendar[dateStr]: { isStudyDay, overrideItems?: [{examId,bookIdx,type}]|null, logs: [...] }
//   overrideItems = null → inherit from plan; array → day-specific override

let state = {
  exams:       [],
  projects:    [],
  studyPlans:  [],   // ← NEW
  calendar:    {},
  calMonth:    new Date().getMonth(),
  calYear:     new Date().getFullYear(),
  selectedDay: null,
  editingExamId:     null,
  editingProjectId:  null,
  editingPlanId:     null,
  currentUser:       null,
};

let saveDebounceTimer = null;

// ===== FIRESTORE =====
function userDocRef(uid) { return doc(db, 'users', uid); }

async function loadFromFirestore(uid) {
  showSync('Caricamento...', 'loading');
  try {
    const snap = await getDoc(userDocRef(uid));
    if (snap.exists()) {
      const data = snap.data();
      state.exams      = data.exams      || [];
      state.projects   = data.projects   || [];
      state.studyPlans = data.studyPlans || [];
      state.calendar   = data.calendar   || {};
    }
    hideSync();
  } catch(e) { showSync('Errore caricamento', 'error'); console.error(e); }
}

function saveToFirestore() {
  if (!state.currentUser) return;
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    showSync('Salvataggio...', 'loading');
    try {
      await setDoc(userDocRef(state.currentUser.uid), {
        exams: state.exams, projects: state.projects,
        studyPlans: state.studyPlans, calendar: state.calendar,
        updatedAt: Date.now(),
      });
      showSync('Salvato ✓', 'success');
      setTimeout(hideSync, 1800);
    } catch(e) { showSync('Errore salvataggio', 'error'); console.error(e); }
  }, 800);
}
function save() { saveToFirestore(); }

function showSync(msg, type='loading') {
  const el = document.getElementById('syncIndicator');
  el.className = 'sync-indicator ' + type;
  document.getElementById('syncMsg').textContent = msg;
}
function hideSync() { document.getElementById('syncIndicator').className = 'sync-indicator hidden'; }

// ===== AUTH =====
const provider = new GoogleAuthProvider();
document.getElementById('btnGoogleLogin').addEventListener('click', async () => {
  try { await signInWithPopup(auth, provider); } catch(e) { alert('Errore login: ' + e.message); }
});
document.getElementById('btnLogout').addEventListener('click', async () => {
  if (confirm('Vuoi uscire?')) await signOut(auth);
});
onAuthStateChanged(auth, async user => {
  if (user) {
    state.currentUser = user;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('sidebar').style.display = '';
    document.getElementById('main').style.display = '';
    const av = document.getElementById('userAvatar');
    av.src = user.photoURL || ''; av.style.display = user.photoURL ? '' : 'none';
    document.getElementById('userName').textContent = user.displayName || user.email || '';
    document.getElementById('dashGreeting').textContent = `Ciao, ${(user.displayName||'Studente').split(' ')[0]}! 👋`;
    await loadFromFirestore(user.uid);
    renderAll();
  } else {
    state.currentUser = null;
    state.exams=[]; state.projects=[]; state.studyPlans=[]; state.calendar={};
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('main').style.display = 'none';
  }
});

// ===== UTILS =====
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function fmt(d) {
  if (!d) return '';
  return new Date(d+'T00:00:00').toLocaleDateString('it-IT',{day:'2-digit',month:'long',year:'numeric'});
}
function fmtShort(d) {
  if (!d) return '';
  return new Date(d+'T00:00:00').toLocaleDateString('it-IT',{day:'2-digit',month:'short'});
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function daysUntil(ds) {
  if (!ds) return null;
  return Math.ceil((new Date(ds+'T00:00:00') - new Date(today()+'T00:00:00')) / 86400000);
}

// ===== MATERIAL KEY HELPERS =====
// A "material item" is identified by {examId, bookIdx (or -1 for slides/-2 for video), type}
function itemKey(examId, bookIdx, type) { return `${examId}::${bookIdx}::${type}`; }
function parseItemKey(k) {
  const [examId, bookIdx, type] = k.split('::');
  return { examId, bookIdx: +bookIdx, type };
}

// All possible study items for an exam — show ALL materials regardless of whether pages are set
function examItems(exam) {
  const items = [];
  (exam.books||[]).forEach((b,i) => {
    // Include book even if totalPages not set yet — user may add pages later
    items.push({ examId:exam.id, bookIdx:i, type:'book', label: b.title||`Libro ${i+1}`, color: exam.color });
  });
  if (exam.hasSlides) items.push({ examId:exam.id, bookIdx:-1, type:'slides', label:'Slides', color: exam.color });
  if (exam.hasVideo)  items.push({ examId:exam.id, bookIdx:-2, type:'video',  label:'Videolezioni', color: exam.color });
  // If exam has no books/slides/video at all, add a placeholder so it still appears in the picker
  if (!items.length) items.push({ examId:exam.id, bookIdx:-3, type:'exam', label:'(nessun materiale inserito)', color: exam.color });
  return items;
}

function allStudyItems() {
  return state.exams.flatMap(e => examItems(e));
}

// ===== ACTIVE ITEMS FOR A DATE =====
// Priority: day override > plan that includes this day via scheduleRules > empty
function activeItemsForDate(dateStr) {
  const dayData = state.calendar[dateStr] || {};

  // 1. Day-specific override wins always
  if (dayData.overrideItems !== undefined && dayData.overrideItems !== null) {
    return dayData.overrideItems;
  }

  // 2. Find a plan whose expanded days include this date (last one wins)
  const coveringPlan = [...state.studyPlans]
    .reverse()
    .find(p => expandPlanDays(p).includes(dateStr));

  if (coveringPlan) return coveringPlan.items || [];

  // 3. Manually marked study day with no plan → show all items as fallback
  if (dayData.isStudyDay) return allStudyItems().map(i=>({examId:i.examId,bookIdx:i.bookIdx,type:i.type}));

  // 4. Nothing → free day
  return [];
}

// A day is "active" (shows colored on calendar) if any plan expanded days includes it
// OR it was manually marked
function isDayActive(dateStr) {
  if ((state.calendar[dateStr] || {}).isStudyDay) return true;
  return state.studyPlans.some(p => expandPlanDays(p).includes(dateStr));
}

// Which plan (if any) covers this date
function coveringPlanForDate(dateStr) {
  return [...state.studyPlans].reverse().find(p => expandPlanDays(p).includes(dateStr)) || null;
}

// ===== NAVIGATION =====
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-'+btn.dataset.view).classList.add('active');
    const v = btn.dataset.view;
    if (v==='dashboard')  renderDashboard();
    if (v==='esami')      renderExamsGrid();
    if (v==='calendario') renderCalendar();
    if (v==='piani')      renderPlansView();
    if (v==='tesi')       renderProjects();
  });
});

document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
});

(function(){
  const d = new Date();
  const days=['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  const months=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  document.getElementById('headerDate').innerHTML = `<strong>${days[d.getDay()]}</strong><br>${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
})();

function renderAll() { renderSidebarExams(); renderDashboard(); }

// ===== SIDEBAR =====
function renderSidebarExams() {
  const el = document.getElementById('examList');
  if (!state.exams.length) {
    el.innerHTML = '<p style="font-size:12px;color:rgba(255,255,255,.3);padding:4px 8px;">Nessun esame ancora</p>';
    return;
  }
  el.innerHTML = state.exams.map(e =>
    `<div class="exam-sidebar-item" onclick="goToExam('${e.id}')">
      <span class="exam-dot" style="background:${e.color}"></span><span>${e.name}</span>
    </div>`).join('');
}
window.goToExam = function(id) {
  document.querySelector('[data-view="esami"]').click();
  setTimeout(() => { document.getElementById('exam-card-'+id)?.scrollIntoView({behavior:'smooth',block:'start'}); }, 100);
};

// ===== DASHBOARD =====
function renderDashboard() { renderTodayTasks(); renderProgressBars(); renderUpcoming(); }

function renderTodayTasks() {
  const el = document.getElementById('todayTasks');
  const t = today();
  const dayData = state.calendar[t] || {};
  if (!isDayActive(t)) {
    el.innerHTML = '<p style="color:var(--ink-light);font-size:13px;padding:8px 0;">Nessun piano di studio attivo oggi. Crea un Piano per assegnare le materie.</p>';
    return;
  }
  const tasks = computeDailyTasks(t);
  if (!tasks.length) {
    el.innerHTML = '<p style="color:var(--ink-light);font-size:13px;">Nessun materiale in programma oggi.</p>';
    return;
  }
  el.innerHTML = tasks.map(task => {
    const exam = state.exams.find(e => e.id===task.examId);
    const logged = (dayData.logs||[]).find(l => l.examId===task.examId && l.bookIdx===task.bookIdx && l.type===task.type);
    const done = logged ? logged.pages : 0;
    return `<div class="today-task">
      <div class="today-task-color" style="background:${exam.color}"></div>
      <div class="today-task-info">
        <div class="today-task-name">${exam.name}</div>
        <div class="today-task-sub">${task.label}</div>
      </div>
      <div class="today-task-pages">${done}/${task.target} pp</div>
    </div>`;
  }).join('');
}

function renderProgressBars() {
  const el = document.getElementById('progressBars');
  if (!state.exams.length) { el.innerHTML = '<p style="color:var(--ink-light);font-size:13px;">Aggiungi un esame.</p>'; return; }
  el.innerHTML = state.exams.map(e => {
    const pct = Math.round(examProgress(e)*100);
    return `<div class="progress-item">
      <div class="progress-header"><span class="progress-name">${e.name}</span><span class="progress-pct">${pct}%</span></div>
      <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pct}%;background:${e.color}"></div></div>
    </div>`;
  }).join('');
}

function renderUpcoming() {
  const el = document.getElementById('upcomingExams');
  let appells = [];
  state.exams.forEach(e => (e.appells||[]).forEach(a => appells.push({date:a.date,chosen:a.chosen,name:e.name,color:e.color})));
  appells.sort((a,b)=>a.date.localeCompare(b.date));
  const future = appells.filter(a=>a.date>=today()).slice(0,6);
  if (!future.length) { el.innerHTML = '<p style="color:var(--ink-light);font-size:13px;">Nessun appello imminente.</p>'; return; }
  el.innerHTML = future.map(a => {
    const du = daysUntil(a.date);
    return `<div class="upcoming-item">
      <div class="upcoming-date">${fmt(a.date)} · ${du===0?'oggi':du+' giorni'}</div>
      <div class="upcoming-name" style="color:${a.color}">${a.name}</div>
      ${a.chosen?'<div class="upcoming-chosen">✓ Appello scelto</div>':''}
    </div>`;
  }).join('');
}

// ===== EXAM PROGRESS =====
function examProgress(exam) {
  let total=0,done=0;
  (exam.books||[]).forEach(b => {
    const tp=b.totalPages||0; total+=tp*3;
    done+=Math.min(b.pagesRead||0,tp)+Math.min(b.pagesUnderlined||0,tp)+Math.min(b.pagesStudied||0,tp);
  });
  if (exam.hasSlides) { total+=exam.slidesTotal||0; done+=Math.min(exam.slidesDone||0,exam.slidesTotal||0); }
  if (exam.hasVideo)  { total+=exam.videoTotal||0;  done+=Math.min(exam.videoDone||0,exam.videoTotal||0); }
  return total ? done/total : 0;
}

// ===== DAILY TASK COMPUTATION =====
// Logic:
//   remaining = totalPages - pagesLoggedSoFar (across ALL past days including today's logs)
//   daysLeft  = days from TODAY onward (inclusive) that are active AND have this item
//              BUT: if dateStr is in the past, we still compute as if from that date
//              so the redistribution is: remaining at dateStr / active days from dateStr forward
//
// Key fix for "missed day" redistribution:
//   We count active days >= dateStr (including dateStr itself as day 1).
//   Pages logged ON dateStr count as already done, so next day remaining is smaller.
//   If dateStr passed with 0 logged, remaining stays the same but daysLeft is now one fewer.

function computeDailyTasks(dateStr) {
  const activeItems = activeItemsForDate(dateStr);
  const tasks = [];
  const todayStr = today();

  activeItems.forEach(item => {
    const exam = state.exams.find(e => e.id===item.examId);
    if (!exam) return;
    if (item.type==='exam') return; // placeholder

    let totalAmount=0, label='', alreadyDone=0;

    if (item.type==='book') {
      const book = (exam.books||[])[item.bookIdx];
      if (!book || !book.totalPages) return;
      totalAmount = book.totalPages;
      label = book.title || `Libro ${item.bookIdx+1}`;
      // Count pages logged on days STRICTLY BEFORE dateStr
      // (logs on dateStr itself are "today's work" already counted toward remaining for tomorrow)
      Object.entries(state.calendar).forEach(([d, day]) => {
        if (d < dateStr) {
          (day.logs||[]).forEach(l => {
            if (l.examId===item.examId && l.bookIdx===item.bookIdx && l.type==='book')
              alreadyDone += (l.pages||0);
          });
        }
      });
      // Also count pages logged today (so the pill shows correct "done/target")
      const todayLog = (state.calendar[dateStr]?.logs||[]).find(
        l => l.examId===item.examId && l.bookIdx===item.bookIdx && l.type==='book'
      );
      // For TARGET calculation we use only pre-dateStr logs (remaining from this day's perspective)
      // For display we expose todayLogged separately — handled in renderDayPanel
    } else if (item.type==='slides') {
      if (!exam.hasSlides || !exam.slidesTotal) return;
      totalAmount = exam.slidesTotal;
      label = 'Slides';
      alreadyDone = exam.slidesDone || 0;
    } else if (item.type==='video') {
      if (!exam.hasVideo || !exam.videoTotal) return;
      totalAmount = exam.videoTotal;
      label = 'Videolezioni (min)';
      alreadyDone = exam.videoDone || 0;
    }

    const remaining = Math.max(0, totalAmount - alreadyDone);
    if (!remaining) return;

    const chosenAppell = (exam.appells||[]).find(a=>a.chosen);
    const deadline = chosenAppell ? chosenAppell.date : null;

    // Active days from dateStr onward (inclusive) where this item appears
    // We generate them dynamically — iterate through all days in plan range
    const activeDaysForItem = getActiveDaysForItem(item, dateStr, deadline);
    const daysLeft = Math.max(1, activeDaysForItem.length);
    const target = Math.ceil(remaining / daysLeft);

    tasks.push({ examId:item.examId, bookIdx:item.bookIdx, type:item.type, label, target, remaining, daysLeft });
  });

  return tasks;
}

// Returns all active days >= fromDate (inclusive) up to optional deadline where item is scheduled
function getActiveDaysForItem(item, fromDate, deadline) {
  const days = new Set();

  // From study plans that include this item — use expanded days (respects weekends/exclusions)
  state.studyPlans.forEach(plan => {
    const hasItem = (plan.items||[]).some(i =>
      i.examId===item.examId && i.bookIdx===item.bookIdx && i.type===item.type);
    if (!hasItem) return;
    expandPlanDays(plan).forEach(ds => {
      if (ds >= fromDate && (!deadline || ds <= deadline)) days.add(ds);
    });
  });

  // From manual override days that include this item
  Object.entries(state.calendar).forEach(([ds, dayData]) => {
    if (ds < fromDate || (deadline && ds > deadline)) return;
    if ((dayData.overrideItems||[]).some(i =>
      i.examId===item.examId && i.bookIdx===item.bookIdx && i.type===item.type
    )) days.add(ds);
  });

  return [...days].sort();
}

function getStudyDays() {
  // All days either manually marked or covered by any plan (using expanded schedule rules)
  const days = new Set();
  Object.entries(state.calendar).forEach(([ds, d]) => { if (d.isStudyDay) days.add(ds); });
  state.studyPlans.forEach(plan => expandPlanDays(plan).forEach(ds => days.add(ds)));
  return [...days].sort();
}

// ===== EXAMS GRID =====
function renderExamsGrid() {
  const el = document.getElementById('examsGrid');
  if (!state.exams.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">🎓</div><p>Nessun esame aggiunto.</p></div>`;
    return;
  }
  el.innerHTML = state.exams.map(e => renderExamCard(e)).join('');
}

function renderExamCard(e) {
  const chosenAppell = (e.appells||[]).find(a=>a.chosen);
  const du = chosenAppell ? daysUntil(chosenAppell.date) : null;

  const booksHtml = (e.books||[]).map((b,bi) => {
    const tp=b.totalPages||0, r=v=>tp?Math.round((v||0)/tp*100):0, tc=b.totalChapters||0;
    return `<div class="book-row">
      <div class="book-title-row">
        <span class="book-title">${b.title||'Libro senza titolo'}</span>
        <span class="book-pages">${tp} pp · ${tc} cap</span>
      </div>
      <div class="book-progress-tracks">
        <div class="book-track"><span class="book-track-label">📖 Lette</span>
          <div class="book-track-bar"><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${r(b.pagesRead)}%;background:${e.color}88"></div></div></div>
          <span class="text-mono" style="font-size:11px;color:var(--ink-light)">${b.pagesRead||0}</span></div>
        <div class="book-track"><span class="book-track-label">✏️ Sottolineate</span>
          <div class="book-track-bar"><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${r(b.pagesUnderlined)}%;background:${e.color}bb"></div></div></div>
          <span class="text-mono" style="font-size:11px;color:var(--ink-light)">${b.pagesUnderlined||0}</span></div>
        <div class="book-track"><span class="book-track-label">🧠 Studiate</span>
          <div class="book-track-bar"><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${r(b.pagesStudied)}%;background:${e.color}"></div></div></div>
          <span class="text-mono" style="font-size:11px;color:var(--ink-light)">${b.pagesStudied||0}</span></div>
      </div>
      ${tc?`<div class="chapter-tracks mt-8">
        <div class="chapter-badge">📚 Letti <span class="chapter-count">${b.chaptersRead||0}/${tc}</span></div>
        <div class="chapter-badge">🃏 Anki <span class="chapter-count">${b.chaptersAnki||0}/${tc}</span></div>
        <div class="chapter-badge">✅ Studiati <span class="chapter-count">${b.chaptersStudied||0}/${tc}</span></div>
      </div>`:''}
      <button class="btn-ghost mt-8" style="font-size:12px;padding:5px 10px" onclick="openProgressModal('${e.id}',${bi})">Aggiorna progresso</button>
    </div>`;
  }).join('');

  const materialsHtml = (e.hasSlides||e.hasVideo) ? `<div class="material-row">
    ${e.hasSlides?`<div class="material-chip">🖥️ Slides <span class="material-pct">${e.slidesTotal?Math.round((e.slidesDone||0)/e.slidesTotal*100):0}%</span></div>`:''}
    ${e.hasVideo?`<div class="material-chip">🎬 Video <span class="material-pct">${e.videoTotal?Math.round((e.videoDone||0)/e.videoTotal*100):0}%</span></div>`:''}
  </div>` : '';

  return `<div class="exam-card" id="exam-card-${e.id}">
    <div class="exam-card-header">
      <div class="exam-card-title-row">
        <div class="exam-card-stripe" style="background:${e.color}"></div>
        <span class="exam-card-name">${e.name}</span>
      </div>
      <div class="exam-card-actions">
        ${e.moodle?`<a class="exam-moodle" href="${e.moodle}" target="_blank">Moodle</a>`:''}
        <button class="btn-icon" onclick="openExamModal('${e.id}')">✏️</button>
        <button class="btn-icon" onclick="deleteExam('${e.id}')">🗑️</button>
      </div>
    </div>
    <div class="exam-card-body">
      ${chosenAppell?`<div class="exam-appell-chosen">📅 Appello: <strong>${fmt(chosenAppell.date)}</strong>
        ${du!==null?`<span class="days-left">${du>0?du+' gg':du===0?'oggi':'passato'}</span>`:''}</div>`:''}
      ${booksHtml?`<div class="books-section-title">📚 LIBRI</div>${booksHtml}`:''}
      ${materialsHtml}
    </div>
  </div>`;
}

// ===== COLOR PICKER =====
function renderColorPicker(containerId, selected, colors) {
  const el = document.getElementById(containerId);
  el.innerHTML = colors.map(c =>
    `<div class="color-swatch ${c===selected?'selected':''}" style="background:${c}" data-color="${c}" onclick="selectSwatch(this,'${containerId}')"></div>`
  ).join('');
  el.dataset.selected = selected || colors[0];
}
window.selectSwatch = function(swatch, cid) {
  document.querySelectorAll(`#${cid} .color-swatch`).forEach(s=>s.classList.remove('selected'));
  swatch.classList.add('selected');
  document.getElementById(cid).dataset.selected = swatch.dataset.color;
};
function addCustomSwatch(cid, hex) {
  const el = document.getElementById(cid);
  let existing = el.querySelector(`[data-color="${hex}"]`);
  if (!existing) {
    const div = document.createElement('div');
    div.className='color-swatch'; div.style.background=hex;
    div.dataset.color=hex; div.onclick=()=>window.selectSwatch(div,cid);
    el.appendChild(div);
  }
  el.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected'));
  (existing||el.lastElementChild).classList.add('selected');
  el.dataset.selected = hex;
}
document.getElementById('applyCustomColor').addEventListener('click', () =>
  addCustomSwatch('colorPicker', document.getElementById('examCustomColor').value));
document.getElementById('applyProjectCustomColor').addEventListener('click', () =>
  addCustomSwatch('projectColorPicker', document.getElementById('projectCustomColor').value));

// ===== EXAM MODAL =====
['btnAddExam','btnAddExam2'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', () => openExamModal(null));
});

window.openExamModal = function(examId) {
  state.editingExamId = examId;
  const exam = examId ? state.exams.find(e=>e.id===examId) : null;
  document.getElementById('examModalTitle').textContent = exam ? 'Modifica Esame' : 'Nuovo Esame';
  document.getElementById('examName').value  = exam ? exam.name  : '';
  document.getElementById('examMoodle').value= exam ? (exam.moodle||'') : '';
  renderColorPicker('colorPicker', exam ? exam.color : PRESET_COLORS[0], PRESET_COLORS);
  if (exam) document.getElementById('examCustomColor').value = exam.color;

  const appellContainer = document.getElementById('appellDates');
  renderAppellRows(appellContainer, exam ? (exam.appells||[]) : []);
  document.getElementById('addAppellBtn').onclick = () =>
    renderAppellRows(appellContainer, [...collectAppells(), {date:'',chosen:false}]);

  const booksContainer = document.getElementById('booksList');
  renderBookEntries(booksContainer, exam ? (exam.books||[]) : []);
  document.getElementById('addBookBtn').onclick = () =>
    renderBookEntries(booksContainer, [...collectBooks(), {title:'',totalPages:0,totalChapters:0}]);

  const hasSl=document.getElementById('hasSlidesi'), slD=document.getElementById('slidesDetail');
  hasSl.checked=!!(exam&&exam.hasSlides); slD.classList.toggle('hidden',!hasSl.checked);
  document.getElementById('slidesTotal').value=exam?(exam.slidesTotal||''):'';
  document.getElementById('slidesDone').value =exam?(exam.slidesDone||''):'';
  hasSl.onchange=()=>slD.classList.toggle('hidden',!hasSl.checked);

  const hasV=document.getElementById('hasVideo'), vD=document.getElementById('videoDetail');
  hasV.checked=!!(exam&&exam.hasVideo); vD.classList.toggle('hidden',!hasV.checked);
  document.getElementById('videoTotal').value=exam?(exam.videoTotal||''):'';
  document.getElementById('videoDone').value =exam?(exam.videoDone||''):'';
  hasV.onchange=()=>vD.classList.toggle('hidden',!hasV.checked);

  openModal('examModal');
};

function renderAppellRows(container, appells) {
  container.innerHTML = appells.map((a,i)=>
    `<div class="appell-row" data-idx="${i}">
      <span class="appell-label">📅</span>
      <input type="date" class="appell-date" value="${a.date||''}">
      <label><input type="checkbox" class="appell-chosen-check" ${a.chosen?'checked':''}> scelto</label>
      <button class="btn-icon" onclick="this.closest('.appell-row').remove()">✕</button>
    </div>`).join('');
  container.querySelectorAll('.appell-chosen-check').forEach(cb =>
    cb.addEventListener('change', () => {
      if (cb.checked) container.querySelectorAll('.appell-chosen-check').forEach(c=>{ if(c!==cb) c.checked=false; });
    }));
}
function collectAppells() {
  return [...document.getElementById('appellDates').querySelectorAll('.appell-row')].map(row=>({
    date: row.querySelector('.appell-date').value,
    chosen: row.querySelector('.appell-chosen-check').checked,
  }));
}
function renderBookEntries(container, books) {
  container.innerHTML = books.map((b,i)=>
    `<div class="book-entry" data-idx="${i}">
      <div class="book-entry-header"><strong style="font-size:13px">Libro ${i+1}</strong>
        <button class="btn-icon" onclick="this.closest('.book-entry').remove()">✕</button></div>
      <div class="form-row"><div class="form-group"><label>Titolo</label><input type="text" class="b-title" value="${b.title||''}" placeholder="Titolo del libro"></div></div>
      <div class="form-row">
        <div class="form-group"><label>Pagine totali</label><input type="number" class="b-totalpages" value="${b.totalPages||''}"></div>
        <div class="form-group"><label>Pagine lette</label><input type="number" class="b-pagesread" value="${b.pagesRead||''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Pagine sottolineate</label><input type="number" class="b-pagesunderlined" value="${b.pagesUnderlined||''}"></div>
        <div class="form-group"><label>Pagine studiate</label><input type="number" class="b-pagesstudied" value="${b.pagesStudied||''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Capitoli totali</label><input type="number" class="b-totalchapters" value="${b.totalChapters||''}"></div>
        <div class="form-group"><label>Cap. letti</label><input type="number" class="b-chaptersread" value="${b.chaptersRead||''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Cap. Anki</label><input type="number" class="b-chaptersanki" value="${b.chaptersAnki||''}"></div>
        <div class="form-group"><label>Cap. studiati</label><input type="number" class="b-chaptersstudied" value="${b.chaptersStudied||''}"></div>
      </div>
    </div>`).join('');
}
function collectBooks() {
  return [...document.getElementById('booksList').querySelectorAll('.book-entry')].map(e=>({
    title: e.querySelector('.b-title').value,
    totalPages: +e.querySelector('.b-totalpages').value||0,
    pagesRead: +e.querySelector('.b-pagesread').value||0,
    pagesUnderlined: +e.querySelector('.b-pagesunderlined').value||0,
    pagesStudied: +e.querySelector('.b-pagesstudied').value||0,
    totalChapters: +e.querySelector('.b-totalchapters').value||0,
    chaptersRead: +e.querySelector('.b-chaptersread').value||0,
    chaptersAnki: +e.querySelector('.b-chaptersanki').value||0,
    chaptersStudied: +e.querySelector('.b-chaptersstudied').value||0,
  }));
}

document.getElementById('saveExamBtn').addEventListener('click', () => {
  const name = document.getElementById('examName').value.trim();
  if (!name) { alert('Inserisci il nome dell\'esame!'); return; }
  const color = document.getElementById('colorPicker').dataset.selected || PRESET_COLORS[0];
  const exam = {
    id: state.editingExamId || uid(), name, color,
    moodle: document.getElementById('examMoodle').value.trim(),
    appells: collectAppells(), books: collectBooks(),
    hasSlides: document.getElementById('hasSlidesi').checked,
    slidesTotal: +document.getElementById('slidesTotal').value||0,
    slidesDone:  +document.getElementById('slidesDone').value||0,
    hasVideo: document.getElementById('hasVideo').checked,
    videoTotal: +document.getElementById('videoTotal').value||0,
    videoDone:  +document.getElementById('videoDone').value||0,
  };
  if (state.editingExamId) {
    const idx = state.exams.findIndex(e=>e.id===state.editingExamId);
    if (idx>=0) state.exams[idx]=exam;
  } else { state.exams.push(exam); }
  save(); closeModal('examModal');
  renderSidebarExams(); renderExamsGrid(); renderDashboard();
});

window.deleteExam = function(id) {
  if (!confirm('Eliminare questo esame?')) return;
  state.exams = state.exams.filter(e=>e.id!==id);
  save(); renderSidebarExams(); renderExamsGrid(); renderDashboard();
};

// ===== PROGRESS MODAL =====
window.openProgressModal = function(examId, bookIdx) {
  const exam = state.exams.find(e=>e.id===examId);
  const book = exam.books[bookIdx];
  document.getElementById('progressModalTitle').textContent = `📖 ${book.title||'Libro'}`;
  document.getElementById('progressModalBody').innerHTML = `
    <div class="form-group"><label>Pagine lette</label><input type="number" id="pm-pagesread" value="${book.pagesRead||0}"></div>
    <div class="form-group"><label>Pagine sottolineate</label><input type="number" id="pm-pagesunderlined" value="${book.pagesUnderlined||0}"></div>
    <div class="form-group"><label>Pagine studiate</label><input type="number" id="pm-pagesstudied" value="${book.pagesStudied||0}"></div>
    ${book.totalChapters?`
    <div class="form-group"><label>Capitoli letti</label><input type="number" id="pm-chapread" value="${book.chaptersRead||0}"></div>
    <div class="form-group"><label>Capitoli Anki</label><input type="number" id="pm-chapanki" value="${book.chaptersAnki||0}"></div>
    <div class="form-group"><label>Capitoli studiati</label><input type="number" id="pm-chapstudied" value="${book.chaptersStudied||0}"></div>`:''}`;
  document.getElementById('saveProgressBtn').onclick = () => {
    book.pagesRead       = +document.getElementById('pm-pagesread').value||0;
    book.pagesUnderlined = +document.getElementById('pm-pagesunderlined').value||0;
    book.pagesStudied    = +document.getElementById('pm-pagesstudied').value||0;
    if (book.totalChapters) {
      book.chaptersRead    = +document.getElementById('pm-chapread').value||0;
      book.chaptersAnki    = +document.getElementById('pm-chapanki').value||0;
      book.chaptersStudied = +document.getElementById('pm-chapstudied').value||0;
    }
    save(); closeModal('progressModal'); renderExamsGrid(); renderDashboard();
  };
  openModal('progressModal');
};

// ===== PLAN DAYS EXPANSION =====
// A plan now stores scheduleRules: [{from, to, excludeWeekends, excludeDays:[0-6]}]
// This expands them into a sorted array of date strings
function expandPlanDays(plan) {
  const days = new Set();
  const rules = plan.scheduleRules || [];

  // Legacy support: if no rules but from/to exist, treat as one rule with no exclusions
  if (!rules.length && plan.from && plan.to) {
    rules.push({ from: plan.from, to: plan.to, excludeWeekends: false, excludeDays: [] });
  }

  rules.forEach(rule => {
    if (!rule.from || !rule.to) return;
    let cur = new Date(rule.from + 'T00:00:00');
    const end = new Date(rule.to + 'T00:00:00');
    while (cur <= end) {
      const dow = cur.getDay(); // 0=Sun,6=Sat
      const ds = cur.toISOString().slice(0,10);
      const isWeekend = dow === 0 || dow === 6;
      const isExcluded = (rule.excludeWeekends && isWeekend) || (rule.excludeDays||[]).includes(dow);
      if (!isExcluded) days.add(ds);
      cur.setDate(cur.getDate() + 1);
    }
  });

  // Apply per-day manual overrides stored in calendar
  Object.entries(state.calendar).forEach(([ds, dayData]) => {
    if (dayData._planExclude === plan.id) days.delete(ds); // manually excluded from this plan
    if (dayData._planInclude === plan.id) days.add(ds);    // manually included in this plan
  });

  return [...days].sort();
}

// ===== STUDY PLANS VIEW =====
function renderPlansView() {
  const el = document.getElementById('plansGrid');
  if (!state.studyPlans.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-state-icon">📋</div>
      <p>Nessun piano di studio. Creane uno per definire cosa studiare e quando.</p>
    </div>`;
    return;
  }
  el.innerHTML = state.studyPlans.map(p => {
    const days = expandPlanDays(p);
    const items = p.items || [];
    const byExam = {};
    items.forEach(i => { if(!byExam[i.examId]) byExam[i.examId]=[]; byExam[i.examId].push(i); });

    const examChips = Object.entries(byExam).map(([eid, its]) => {
      const exam = state.exams.find(e=>e.id===eid);
      if (!exam) return '';
      const labels = its.filter(i=>i.type!=='exam').map(i => {
        if (i.type==='slides') return '🖥️ Slides';
        if (i.type==='video') return '🎬 Video';
        const b = (exam.books||[])[i.bookIdx];
        return `📖 ${b ? (b.title||`Libro ${i.bookIdx+1}`) : '?'}`;
      });
      if (!labels.length) return '';
      return `<div class="plan-exam-chip" style="border-left:3px solid ${exam.color}">
        <strong style="color:${exam.color}">${exam.name}</strong>
        <div class="plan-chip-items">${labels.join(' · ')}</div>
      </div>`;
    }).join('');

    // Schedule summary
    const rules = p.scheduleRules || (p.from ? [{from:p.from, to:p.to, excludeWeekends:false, excludeDays:[]}] : []);
    const rulesSummary = rules.map(r => {
      let s = `${fmtShort(r.from)} → ${fmtShort(r.to)}`;
      if (r.excludeWeekends) s += ' · no weekend';
      const dayNames = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
      if ((r.excludeDays||[]).length) s += ' · escluso ' + r.excludeDays.map(d=>dayNames[d]).join(',');
      return s;
    }).join(' | ');

    return `<div class="plan-card">
      <div class="plan-card-header">
        <div>
          <div class="plan-card-title">${p.label||'Piano senza nome'}</div>
          <div class="plan-card-dates">📅 ${rulesSummary} · <strong>${days.length} giorni</strong></div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn-icon" onclick="openPlanModal('${p.id}')">✏️</button>
          <button class="btn-icon" onclick="deletePlan('${p.id}')">🗑️</button>
        </div>
      </div>
      <div class="plan-card-body">
        ${examChips || '<p style="color:var(--ink-light);font-size:13px">Nessun materiale selezionato</p>'}
      </div>
    </div>`;
  }).join('');
}

document.getElementById('btnAddPlan').addEventListener('click', () => openPlanModal(null));

window.openPlanModal = function(planId) {
  state.editingPlanId = planId;
  const plan = planId ? state.studyPlans.find(p=>p.id===planId) : null;
  document.getElementById('planModalTitle').textContent = plan ? 'Modifica Piano' : 'Nuovo Piano di Studio';
  document.getElementById('planLabel').value = plan ? (plan.label||'') : '';

  // Schedule rules
  const rules = plan
    ? (plan.scheduleRules || (plan.from ? [{from:plan.from, to:plan.to, excludeWeekends:false, excludeDays:[]}] : []))
    : [{ from:'', to:'', excludeWeekends:false, excludeDays:[] }];
  renderScheduleRules(rules);

  document.getElementById('addScheduleRuleBtn').onclick = () => {
    const current = collectScheduleRules();
    current.push({ from:'', to:'', excludeWeekends:false, excludeDays:[] });
    renderScheduleRules(current);
  };

  renderPlanItemPicker(plan ? (plan.items||[]) : []);
  openModal('planModal');
};

function renderScheduleRules(rules) {
  const container = document.getElementById('scheduleRulesList');
  const DOW = [
    {val:1,label:'Lun'},{val:2,label:'Mar'},{val:3,label:'Mer'},
    {val:4,label:'Gio'},{val:5,label:'Ven'},{val:6,label:'Sab'},{val:0,label:'Dom'}
  ];

  container.innerHTML = rules.map((r, idx) => `
    <div class="schedule-rule" data-idx="${idx}">
      <div class="schedule-rule-row">
        <div class="form-group" style="flex:0 0 auto">
          <label>Dal</label>
          <input type="date" class="sr-from" value="${r.from||''}">
        </div>
        <div class="form-group" style="flex:0 0 auto">
          <label>Al</label>
          <input type="date" class="sr-to" value="${r.to||''}">
        </div>
        <div class="form-group sr-exclude-group">
          <label>Escludi</label>
          <div class="sr-exclude-row">
            <label class="sr-toggle-label">
              <input type="checkbox" class="sr-weekend" ${r.excludeWeekends?'checked':''}>
              <span class="sr-chip weekend">Weekend</span>
            </label>
            ${DOW.map(d => `
              <label class="sr-toggle-label">
                <input type="checkbox" class="sr-dow" data-dow="${d.val}" ${(r.excludeDays||[]).includes(d.val)?'checked':''}>
                <span class="sr-chip">${d.label}</span>
              </label>`).join('')}
          </div>
        </div>
        ${rules.length > 1 ? `<button class="btn-icon" style="align-self:flex-end;margin-bottom:8px" onclick="this.closest('.schedule-rule').remove()">✕</button>` : ''}
      </div>
      <div class="sr-preview" id="sr-preview-${idx}">
        <span class="sr-preview-text">— seleziona le date —</span>
      </div>
    </div>
  `).join('');

  // Wire up live preview
  container.querySelectorAll('.schedule-rule').forEach((el, idx) => {
    const update = () => updateRulePreview(el, idx);
    el.querySelectorAll('input').forEach(inp => inp.addEventListener('change', update));
    update();
  });
}

function updateRulePreview(ruleEl, idx) {
  const from = ruleEl.querySelector('.sr-from').value;
  const to   = ruleEl.querySelector('.sr-to').value;
  if (!from || !to) return;
  const exWeekend = ruleEl.querySelector('.sr-weekend').checked;
  const exDays = [...ruleEl.querySelectorAll('.sr-dow:checked')].map(cb => +cb.dataset.dow);
  const rule = { from, to, excludeWeekends: exWeekend, excludeDays: exDays };
  const days = expandRuleDays(rule);
  const preview = ruleEl.querySelector('.sr-preview');
  preview.innerHTML = `<span class="sr-preview-count">${days.length} giorni</span>
    <span class="sr-preview-sample">${days.slice(0,5).map(d=>{
      const dt=new Date(d+'T00:00:00');
      const dow=['Dom','Lun','Mar','Mer','Gio','Ven','Sab'][dt.getDay()];
      return `${dow} ${dt.getDate()}/${dt.getMonth()+1}`;
    }).join(' · ')}${days.length>5?' …':''}</span>`;
}

function expandRuleDays(rule) {
  const days = [];
  if (!rule.from || !rule.to) return days;
  let cur = new Date(rule.from + 'T00:00:00');
  const end = new Date(rule.to + 'T00:00:00');
  while (cur <= end) {
    const dow = cur.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isExcluded = (rule.excludeWeekends && isWeekend) || (rule.excludeDays||[]).includes(dow);
    if (!isExcluded) days.push(cur.toISOString().slice(0,10));
    cur.setDate(cur.getDate()+1);
  }
  return days;
}

function collectScheduleRules() {
  return [...document.querySelectorAll('#scheduleRulesList .schedule-rule')].map(el => ({
    from: el.querySelector('.sr-from').value,
    to:   el.querySelector('.sr-to').value,
    excludeWeekends: el.querySelector('.sr-weekend').checked,
    excludeDays: [...el.querySelectorAll('.sr-dow:checked')].map(cb => +cb.dataset.dow),
  }));
}

function renderPlanItemPicker(selectedItems) {
  const container = document.getElementById('planItemPicker');
  const selectedKeys = new Set(selectedItems.map(i=>itemKey(i.examId,i.bookIdx,i.type)));

  if (!state.exams.length) {
    container.innerHTML = '<p style="color:var(--ink-light);font-size:13px;">Aggiungi prima degli esami.</p>';
    return;
  }

  container.innerHTML = state.exams.map(exam => {
    const items = examItems(exam);
    if (!items.length) return '';
    const rows = items.map(i => {
      const key = itemKey(i.examId,i.bookIdx,i.type);
      const checked = selectedKeys.has(key);
      const icon = i.type==='book'?'📖': i.type==='slides'?'🖥️':'🎬';
      return `<label class="plan-item-row ${checked?'checked':''}">
        <input type="checkbox" class="plan-item-cb" data-key="${key}"
          data-examid="${i.examId}" data-bookidx="${i.bookIdx}" data-type="${i.type}"
          ${checked?'checked':''} onchange="this.closest('label').classList.toggle('checked',this.checked)">
        <span class="plan-item-icon">${icon}</span>
        <span class="plan-item-label">${i.label}</span>
      </label>`;
    }).join('');
    return `<div class="plan-exam-group">
      <div class="plan-exam-group-header" style="color:${exam.color}">
        <span style="background:${exam.color};width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:5px"></span>
        ${exam.name}
        <button class="btn-ghost" style="font-size:11px;padding:2px 8px;margin-left:8px" onclick="toggleAllExamItems('${exam.id}', this)">Seleziona tutto</button>
      </div>
      <div class="plan-exam-items">${rows}</div>
    </div>`;
  }).join('');
}

window.toggleAllExamItems = function(examId, btn) {
  const group = btn.closest('.plan-exam-group');
  const cbs = group.querySelectorAll('.plan-item-cb');
  const allChecked = [...cbs].every(cb=>cb.checked);
  cbs.forEach(cb => { cb.checked = !allChecked; cb.closest('label').classList.toggle('checked', !allChecked); });
  btn.textContent = allChecked ? 'Seleziona tutto' : 'Deseleziona tutto';
};

function collectPlanItems() {
  return [...document.querySelectorAll('.plan-item-cb:checked')].map(cb=>({
    examId: cb.dataset.examid, bookIdx: +cb.dataset.bookidx, type: cb.dataset.type,
  }));
}

document.getElementById('savePlanBtn').addEventListener('click', () => {
  const label = document.getElementById('planLabel').value.trim();
  const rules  = collectScheduleRules();
  if (!rules.length || rules.every(r => !r.from || !r.to)) {
    alert('Aggiungi almeno un intervallo di date valido.');
    return;
  }
  const totalDays = rules.reduce((s,r) => s + expandRuleDays(r).length, 0);
  if (!totalDays) { alert('Lintervallo selezionato non produce giorni di studio (tutti esclusi?).'); return; }

  const plan = {
    id: state.editingPlanId || uid(),
    label: label || `Piano ${fmtShort(rules[0].from)}–${fmtShort(rules[rules.length-1].to)}`,
    scheduleRules: rules,
    // keep legacy from/to for backwards compat
    from: rules[0].from,
    to:   rules[rules.length-1].to,
    items: collectPlanItems(),
  };

  if (state.editingPlanId) {
    const idx = state.studyPlans.findIndex(p=>p.id===state.editingPlanId);
    if (idx>=0) state.studyPlans[idx]=plan;
  } else { state.studyPlans.push(plan); }

  save(); closeModal('planModal'); renderPlansView();
  if (document.getElementById('view-calendario').classList.contains('active')) renderCalendar();
});

window.deletePlan = function(id) {
  if (!confirm('Eliminare questo piano?')) return;
  state.studyPlans = state.studyPlans.filter(p=>p.id!==id);
  save(); renderPlansView();
};
// ===== CALENDAR =====
function renderCalendar() {
  const months=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  document.getElementById('calMonthLabel').textContent = `${months[state.calMonth]} ${state.calYear}`;

  const firstDay    = new Date(state.calYear, state.calMonth, 1).getDay();
  const startOffset = (firstDay+6)%7;
  const daysInMonth = new Date(state.calYear, state.calMonth+1, 0).getDate();
  const daysInPrev  = new Date(state.calYear, state.calMonth, 0).getDate();
  const todayStr    = today();

  let html = '<div class="cal-weekdays">';
  ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'].forEach(d=>html+=`<div class="cal-weekday">${d}</div>`);
  html += '</div><div class="cal-days">';

  for (let i=startOffset-1;i>=0;i--)
    html+=`<div class="cal-day other-month"><span class="cal-day-num">${daysInPrev-i}</span></div>`;

  for (let d=1;d<=daysInMonth;d++) {
    const ds = `${state.calYear}-${String(state.calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayData = state.calendar[ds]||{};
    const isActive = isDayActive(ds);  // covered by a plan OR manually marked
    const isManualStudy = !!dayData.isStudyDay;
    const isToday = ds===todayStr;
    const hasOverride = dayData.overrideItems !== undefined && dayData.overrideItems !== null;
    const appellExams = state.exams.filter(e=>(e.appells||[]).some(a=>a.date===ds));

    let pills = '';
    if (isActive) {
      const tasks = computeDailyTasks(ds);
      const activeItems = activeItemsForDate(ds);

      // Collect unique exam IDs from tasks + plan items
      const examIdsWithTasks = new Set(tasks.map(t=>t.examId));
      const examIdsInPlan = new Set(activeItems.filter(i=>i.type!=='exam').map(i=>i.examId));
      const allActiveExamIds = new Set([...examIdsWithTasks, ...examIdsInPlan]);

      allActiveExamIds.forEach(eid => {
        const ex = state.exams.find(e=>e.id===eid);
        if (!ex) return;
        const total = tasks.filter(x=>x.examId===eid).reduce((s,x)=>s+x.target, 0);
        const label = total > 0 ? `${ex.name.split(' ')[0]} ${total}pp` : ex.name.split(' ')[0];
        pills+=`<span class="cal-pill" style="background:${ex.color};opacity:${total>0?1:0.65}">${label}</span>`;
      });
    }

    const cls=['cal-day',
      isToday?'today':'',
      isActive?'study-day':'',
      isManualStudy&&!isActive?'manual-study':'',  // manually marked but no plan
      appellExams.length?'has-appell':'',
      hasOverride?'has-override':''].filter(Boolean).join(' ');
    html+=`<div class="${cls}" onclick="handleDayClick('${ds}')">
      <span class="cal-day-num">${d}</span>
      ${hasOverride?'<span class="override-dot" title="Override manuale">✦</span>':''}
      <div class="cal-day-pills">${pills}</div>
    </div>`;
  }

  const totalCells = startOffset+daysInMonth;
  const rem = (7-(totalCells%7))%7;
  for (let i=1;i<=rem;i++)
    html+=`<div class="cal-day other-month"><span class="cal-day-num">${i}</span></div>`;
  html+='</div>';
  document.getElementById('calGrid').innerHTML=html;
}

document.getElementById('calPrev').addEventListener('click',()=>{
  state.calMonth--; if(state.calMonth<0){state.calMonth=11;state.calYear--;} renderCalendar();
});
document.getElementById('calNext').addEventListener('click',()=>{
  state.calMonth++; if(state.calMonth>11){state.calMonth=0;state.calYear++;} renderCalendar();
});

// ===== DAY MANUAL INCLUDE/EXCLUDE =====
// Toggle a day in/out of its covering plan (manual override of schedule rule)
window.toggleDayExclude = function(dateStr) {
  if (!state.calendar[dateStr]) state.calendar[dateStr] = {};
  const dayData = state.calendar[dateStr];
  const plan = coveringPlanForDate(dateStr);

  if (dayData._planExclude) {
    // Re-include: remove the exclude flag
    delete dayData._planExclude;
    delete dayData._planInclude;
  } else {
    // Exclude: mark with the plan id so expandPlanDays skips it
    if (plan) dayData._planExclude = plan.id;
    else { dayData.isStudyDay = false; }
  }
  save(); renderDayPanel(dateStr); renderCalendar(); renderDashboard();
};

// Force-include a day that's not in any plan (manual study day)
window.forceIncludeDay = function(dateStr) {
  if (!state.calendar[dateStr]) state.calendar[dateStr] = {};
  state.calendar[dateStr].isStudyDay = true;
  save(); renderDayPanel(dateStr); renderCalendar(); renderDashboard();
  showSync('Giorno aggiunto manualmente ✓', 'success'); setTimeout(hideSync, 1500);
};

window.handleDayClick = function(ds) {
  state.selectedDay = ds;
  renderDayPanel(ds);
};

function renderDayPanel(dateStr) {
  const panel = document.getElementById('dayPanel');
  const dayData = state.calendar[dateStr]||{};
  const isStudy = !!dayData.isStudyDay;
  const isActive = isDayActive(dateStr); // plan-covered OR manually marked
  const hasOverride = dayData.overrideItems !== undefined && dayData.overrideItems !== null;

  const months=['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  const [y,m,d]=dateStr.split('-');
  const label=`${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;

  const appellExams = state.exams.filter(e=>(e.appells||[]).some(a=>a.date===dateStr));
  const appellHtml = appellExams.map(e=>
    `<div style="font-size:13px;padding:6px 0;border-bottom:1px solid var(--border)">
      📅 <strong style="color:${e.color}">${e.name}</strong> — appello
    </div>`).join('');

  // Find covering plan info (using expanded schedule rules)
  const coveringPlan = coveringPlanForDate(dateStr);
  const manualExcluded = (state.calendar[dateStr]||{})._planExclude;
  const manualIncluded = (state.calendar[dateStr]||{})._planInclude;

  const planBadge = hasOverride
    ? `<div class="plan-badge override">✦ Override materiali <button class="btn-link" onclick="clearDayOverride('${dateStr}')">← Ripristina</button></div>`
    : coveringPlan
      ? `<div class="plan-badge" style="justify-content:space-between">
          <span>📋 Piano: <strong>${coveringPlan.label}</strong></span>
          <button class="btn-link" onclick="toggleDayExclude('${dateStr}')" style="font-size:11px">
            ${manualExcluded ? '✅ Riattiva giorno' : '❌ Escludi da piano'}
          </button>
         </div>`
      : isStudy
        ? `<div class="plan-badge override">📌 Segnato manualmente
            <button class="btn-link" onclick="toggleDayExclude('${dateStr}')">Rimuovi</button>
           </div>`
        : `<div class="plan-badge none">Nessun piano attivo · <button class="btn-link" onclick="forceIncludeDay('${dateStr}')">+ Aggiungi giorno</button></div>`;

  const tasks = isActive ? computeDailyTasks(dateStr) : [];
  const activeItems = isActive ? activeItemsForDate(dateStr) : [];

  // Materials in plan but without pages yet (can't compute target but should show)
  const tasksExamIds = new Set(tasks.map(t=>t.examId+':'+t.bookIdx+':'+t.type));
  const planItemsWithNoPages = activeItems.filter(i => {
    if (i.type==='exam') return false;
    return !tasksExamIds.has(i.examId+':'+i.bookIdx+':'+i.type);
  });

  let tasksHtml = '';
  if (tasks.length || planItemsWithNoPages.length) {
    const taskRows = tasks.map(t => {
      const exam = state.exams.find(e=>e.id===t.examId);
      const logged=(dayData.logs||[]).find(l=>l.examId===t.examId&&l.bookIdx===t.bookIdx&&l.type===t.type);
      const done=logged?logged.pages:0;
      return `<div class="day-book-entry" data-examid="${t.examId}" data-bookidx="${t.bookIdx}" data-type="${t.type}">
        <div class="day-book-entry-name" style="color:${exam.color}">${exam.name}</div>
        <div class="day-book-entry-name" style="font-weight:normal;font-size:13px">${t.label}</div>
        <div class="day-book-entry-target">Target: <span>${t.target} unità</span></div>
        <div class="day-input-row"><label>Fatte oggi:</label>
          <input type="number" class="day-pages-input" value="${done}" min="0">
        </div>
      </div>`;
    }).join('');

    const noPageRows = planItemsWithNoPages.map(i => {
      const exam = state.exams.find(e=>e.id===i.examId);
      if (!exam) return '';
      let label = i.type==='slides' ? 'Slides' : i.type==='video' ? 'Videolezioni' :
        ((exam.books||[])[i.bookIdx]?.title || `Libro ${i.bookIdx+1}`);
      return `<div class="day-book-entry no-pages" style="opacity:0.6">
        <div class="day-book-entry-name" style="color:${exam.color}">${exam.name}</div>
        <div class="day-book-entry-name" style="font-weight:normal;font-size:13px">${label}</div>
        <div class="day-book-entry-target" style="color:var(--ink-light)">⚠️ Inserisci le pagine totali nell'esame per calcolare il target</div>
      </div>`;
    }).join('');

    tasksHtml = `<div class="day-book-tasks">${taskRows}${noPageRows}</div>`;
  } else if (isStudy) {
    tasksHtml = '<p style="color:var(--ink-light);font-size:13px;margin-top:8px">Nessun materiale attivo per oggi.</p>';
  }

  // Item override picker (shown when study day)
  const overridePickerHtml = isActive ? `
    <div class="day-override-section">
      <div class="day-override-header">
        <span>🎯 Materie di oggi</span>
        <button class="btn-ghost" style="font-size:12px;padding:4px 10px" onclick="toggleOverridePicker('${dateStr}')">
          ${hasOverride ? '✏️ Modifica override' : '+ Override per oggi'}
        </button>
      </div>
      <div id="overridePickerWrap" class="hidden"></div>
    </div>` : '';

  panel.innerHTML = `
    <div class="day-panel-title">${label}</div>
    <div class="day-panel-subtitle">${isActive ? (isStudy ? '✅ Giorno di studio (piano + manuale)' : '📋 Coperto da piano di studio') : (isStudy ? '📌 Segnato manualmente (nessun piano)' : '⬜ Giorno libero')}</div>
    ${appellHtml}
    <div class="day-toggle">
      <label class="toggle-switch">
        <input type="checkbox" id="dayStudyToggle" ${isStudy?'checked':''}>
        <span class="toggle-slider"></span>
      </label>
      <span>Giorno di studio</span>
    </div>
    ${isActive ? planBadge : ''}
    ${isActive ? overridePickerHtml : ''}
    ${tasksHtml}
    ${isActive && tasks.length ? `<button class="btn-primary" style="margin-top:16px;width:100%" onclick="saveDayPanel('${dateStr}')">💾 Salva progresso</button>` : ''}
    ${!isActive ? `<p style="color:var(--ink-light);font-size:13px;margin-top:8px">Questo giorno non è coperto da nessun piano. Crea un <strong>Piano di Studio</strong> o attiva il toggle manualmente.</p>` : ''}
  `;

  document.getElementById('dayStudyToggle').addEventListener('change', function() {
    if (!state.calendar[dateStr]) state.calendar[dateStr]={};
    state.calendar[dateStr].isStudyDay = this.checked;
    // If turning ON manually with no plan, keep it as a free-form study day
    // If turning OFF, clear the manual flag (plan still covers it if applicable)
    save(); renderDayPanel(dateStr); renderCalendar(); renderDashboard();
  });
}

window.toggleOverridePicker = function(dateStr) {
  const wrap = document.getElementById('overridePickerWrap');
  if (!wrap.classList.contains('hidden')) { wrap.classList.add('hidden'); wrap.innerHTML=''; return; }

  const dayData = state.calendar[dateStr]||{};
  const currentActive = activeItemsForDate(dateStr);
  const currentKeys = new Set(currentActive.map(i=>itemKey(i.examId,i.bookIdx,i.type)));

  const allItems = allStudyItems();
  if (!allItems.length) { wrap.innerHTML='<p style="color:var(--ink-light);font-size:13px">Nessun materiale disponibile.</p>'; wrap.classList.remove('hidden'); return; }

  // Group by exam
  const byExam = {};
  allItems.forEach(i=>{ if(!byExam[i.examId]) byExam[i.examId]=[]; byExam[i.examId].push(i); });

  const html = Object.entries(byExam).map(([eid,items]) => {
    const exam = state.exams.find(e=>e.id===eid);
    if(!exam) return '';
    return `<div class="plan-exam-group" style="margin-bottom:8px">
      <div class="plan-exam-group-header" style="color:${exam.color};font-size:13px;font-weight:700;margin-bottom:4px">
        <span style="background:${exam.color};width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:5px"></span>
        ${exam.name}
      </div>
      ${items.map(i => {
        const key=itemKey(i.examId,i.bookIdx,i.type);
        const checked=currentKeys.has(key);
        const icon=i.type==='book'?'📖':i.type==='slides'?'🖥️':'🎬';
        return `<label class="plan-item-row ${checked?'checked':''}" style="padding:6px 10px;margin-bottom:3px">
          <input type="checkbox" class="override-cb" data-examid="${i.examId}" data-bookidx="${i.bookIdx}" data-type="${i.type}" ${checked?'checked':''}
            onchange="this.closest('label').classList.toggle('checked',this.checked)">
          <span class="plan-item-icon">${icon}</span>
          <span class="plan-item-label">${i.label}</span>
        </label>`;
      }).join('')}
    </div>`;
  }).join('');

  wrap.innerHTML = `
    <div style="background:var(--cream);border-radius:8px;padding:12px;margin-top:8px">
      ${html}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn-primary" style="flex:1" onclick="saveOverride('${dateStr}')">Applica override</button>
        <button class="btn-ghost" onclick="clearDayOverride('${dateStr}')">Ripristina piano</button>
      </div>
    </div>`;
  wrap.classList.remove('hidden');
};

window.saveOverride = function(dateStr) {
  const items = [...document.querySelectorAll('.override-cb:checked')].map(cb=>({
    examId: cb.dataset.examid, bookIdx: +cb.dataset.bookidx, type: cb.dataset.type,
  }));
  if (!state.calendar[dateStr]) state.calendar[dateStr]={};
  state.calendar[dateStr].overrideItems = items;
  save(); renderDayPanel(dateStr); renderCalendar();
  showSync('Override salvato ✓', 'success'); setTimeout(hideSync, 1500);
};

window.clearDayOverride = function(dateStr) {
  if (state.calendar[dateStr]) delete state.calendar[dateStr].overrideItems;
  save(); renderDayPanel(dateStr); renderCalendar();
};

window.saveDayPanel = function(dateStr) {
  if (!state.calendar[dateStr]) state.calendar[dateStr]={};
  const logs=[];
  document.querySelectorAll('.day-book-entry').forEach(entry=>{
    logs.push({ examId:entry.dataset.examid, bookIdx:+entry.dataset.bookidx,
                type:entry.dataset.type, pages:+entry.querySelector('.day-pages-input').value||0 });
  });
  state.calendar[dateStr].logs=logs;
  save(); renderCalendar(); renderDashboard();
  showSync('Progresso salvato 🎉','success'); setTimeout(hideSync,2000);
};

// ===== PROJECTS =====
document.getElementById('btnAddProject').addEventListener('click', () => openProjectModal(null));
window.openProjectModal = function(projectId) {
  state.editingProjectId = projectId;
  const p = projectId ? state.projects.find(x=>x.id===projectId) : null;
  document.getElementById('projectModalTitle').textContent = p ? 'Modifica Progetto' : 'Nuovo Progetto';
  document.getElementById('projectName').value = p?p.name:'';
  document.getElementById('projectType').value = p?p.type:'tesi';
  renderColorPicker('projectColorPicker', p?p.color:PRESET_COLORS[3], PRESET_COLORS);
  if(p) document.getElementById('projectCustomColor').value=p.color;
  ['readChapTotal','readChapDone','readPagesTotal','readPagesDone',
   'writeChapTotal','writeChapDone','writePagesTotal','writePagesDone'].forEach(id=>{
    document.getElementById(id).value=p?(p[id]||''):'';
  });
  const tc=document.getElementById('projectTasks');
  renderProjectTaskEntries(tc, p?(p.tasks||[]):[]);
  document.getElementById('addProjectTaskBtn').onclick=()=>
    renderProjectTaskEntries(tc,[...collectProjectTasks(),{label:'',done:false}]);
  openModal('projectModal');
};
function renderProjectTaskEntries(container, tasks) {
  container.innerHTML=tasks.map(t=>`
    <div class="project-task-entry">
      <input type="checkbox" ${t.done?'checked':''}>
      <input type="text" value="${t.label||''}" placeholder="Task da fare...">
      <button class="btn-icon" onclick="this.closest('.project-task-entry').remove()">✕</button>
    </div>`).join('');
}
function collectProjectTasks() {
  return [...document.getElementById('projectTasks').querySelectorAll('.project-task-entry')].map(e=>({
    done:e.querySelector('input[type=checkbox]').checked, label:e.querySelector('input[type=text]').value,
  }));
}
document.getElementById('saveProjectBtn').addEventListener('click', () => {
  const name=document.getElementById('projectName').value.trim();
  if(!name){alert('Inserisci il nome del progetto!');return;}
  const p={
    id:state.editingProjectId||uid(), name,
    type:document.getElementById('projectType').value,
    color:document.getElementById('projectColorPicker').dataset.selected||PRESET_COLORS[3],
    tasks:collectProjectTasks(),
  };
  ['readChapTotal','readChapDone','readPagesTotal','readPagesDone',
   'writeChapTotal','writeChapDone','writePagesTotal','writePagesDone'].forEach(id=>{
    p[id]=+document.getElementById(id).value||0;
  });
  if(state.editingProjectId){const i=state.projects.findIndex(x=>x.id===state.editingProjectId);if(i>=0)state.projects[i]=p;}
  else state.projects.push(p);
  save(); closeModal('projectModal'); renderProjects();
});
function renderProjects() {
  const el=document.getElementById('projectsGrid');
  if(!state.projects.length){el.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">📝</div><p>Nessun progetto ancora.</p></div>`;return;}
  const tl={tesi:'Tesi',elaborato:'Elaborato',ricerca:'Ricerca',altro:'Progetto'};
  el.innerHTML=state.projects.map(p=>{
    const doneTasks=(p.tasks||[]).filter(t=>t.done).length;
    const statSec=(title,cT,cD,pgT,pgD)=>`<div class="project-section">
      <div class="project-section-title">${title}</div>
      <div class="project-stats">
        ${cT?`<div class="stat-chip"><div class="stat-chip-label">Capitoli</div><div class="stat-chip-val">${cD}/${cT}</div></div>`:''}
        ${pgT?`<div class="stat-chip"><div class="stat-chip-label">Pagine</div><div class="stat-chip-val">${pgD}/${pgT}</div></div>`:''}
      </div>
      ${(cT||pgT)?`<div class="progress-bar-bg" style="margin-top:8px"><div class="progress-bar-fill" style="width:${Math.round(((cD+pgD)/((cT||0)+(pgT||0)))*100)||0}%;background:${p.color}"></div></div>`:''}
    </div>`;
    const tasksHtml=(p.tasks||[]).length?`<div class="project-section">
      <div class="project-section-title">🗂️ TASK (${doneTasks}/${p.tasks.length})</div>
      <div>${p.tasks.map((t,i)=>`<div class="task-item ${t.done?'done':''}">
        <input type="checkbox" ${t.done?'checked':''} onchange="toggleProjectTask('${p.id}',${i},this.checked)">
        <span>${t.label}</span></div>`).join('')}</div>
    </div>`:'';
    return `<div class="project-card">
      <div class="project-card-header">
        <span class="project-card-title">${p.name}</span>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="project-type-badge" style="background:${p.color}">${tl[p.type]||p.type}</span>
          <button class="btn-icon" onclick="openProjectModal('${p.id}')">✏️</button>
          <button class="btn-icon" onclick="deleteProject('${p.id}')">🗑️</button>
        </div>
      </div>
      <div class="project-card-body">
        ${(p.readChapTotal||p.readPagesTotal)?statSec('📖 DA LEGGERE',p.readChapTotal,p.readChapDone,p.readPagesTotal,p.readPagesDone):''}
        ${(p.writeChapTotal||p.writePagesTotal)?statSec('✍️ DA SCRIVERE',p.writeChapTotal,p.writeChapDone,p.writePagesTotal,p.writePagesDone):''}
        ${tasksHtml}
      </div>
    </div>`;
  }).join('');
}
window.toggleProjectTask=function(pid,i,done){const p=state.projects.find(x=>x.id===pid);if(p&&p.tasks&&p.tasks[i]){p.tasks[i].done=done;save();renderProjects();}};
window.deleteProject=function(id){if(!confirm('Eliminare?'))return;state.projects=state.projects.filter(x=>x.id!==id);save();renderProjects();};

// ===== MODAL HELPERS =====
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>closeModal(btn.dataset.close)));
document.querySelectorAll('.modal-overlay').forEach(ov=>ov.addEventListener('click',e=>{if(e.target===ov)ov.classList.remove('open');}));

// ===== INIT =====
document.getElementById('sidebar').style.display='none';
document.getElementById('main').style.display='none';