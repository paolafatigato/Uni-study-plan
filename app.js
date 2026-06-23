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
// Plan shape: { id, label, days:Set<string>→stored as array,
//   items:[{examId,bookIdx,type}],
//   studyMode:'parallel'|'sequential',
//   sequentialOrder:[{examId,bookIdx,type,weight}]  (weight = % of days)
// }
let state = {
  exams: [], projects: [], studyPlans: [], calendar: {},
  calMonth: new Date().getMonth(), calYear: new Date().getFullYear(),
  selectedDay: null, editingExamId: null, editingProjectId: null, editingPlanId: null,
  currentUser: null,
};
let saveDebounceTimer = null;

// ===== FIRESTORE =====
function userDocRef(uid) { return doc(db,'users',uid); }

async function loadFromFirestore(uid) {
  showSync('Caricamento...','loading');
  try {
    const snap = await getDoc(userDocRef(uid));
    if (snap.exists()) {
      const d = snap.data();
      state.exams      = d.exams      || [];
      state.projects   = d.projects   || [];
      state.studyPlans = (d.studyPlans||[]).map(normalizePlan);
      state.calendar   = d.calendar   || {};
    }
    hideSync();
  } catch(e) { showSync('Errore caricamento','error'); console.error(e); }
}

// Normalize old plan format (scheduleRules / from+to) → new days[] format
function normalizePlan(p) {
  if (p.days && Array.isArray(p.days)) return p; // already new format
  const days = new Set();
  const rules = p.scheduleRules || (p.from ? [{from:p.from,to:p.to,excludeWeekends:false,excludeDays:[]}] : []);
  rules.forEach(r => {
    if (!r.from||!r.to) return;
    let cur = new Date(r.from+'T00:00:00');
    const end = new Date(r.to+'T00:00:00');
    while (cur<=end) {
      const dow = cur.getDay();
      const isWE = dow===0||dow===6;
      if (!(r.excludeWeekends&&isWE) && !(r.excludeDays||[]).includes(dow))
        days.add(cur.toISOString().slice(0,10));
      cur.setDate(cur.getDate()+1);
    }
  });
  return { ...p, days:[...days].sort(), studyMode: p.studyMode||'parallel', sequentialOrder: p.sequentialOrder||[] };
}

function saveToFirestore() {
  if (!state.currentUser) return;
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    showSync('Salvataggio...','loading');
    try {
      await setDoc(userDocRef(state.currentUser.uid), {
        exams: state.exams, projects: state.projects,
        studyPlans: state.studyPlans.map(p => ({...p, days: p.days||[]})),
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
    state.currentUser=null; state.exams=[];state.projects=[];state.studyPlans=[];state.calendar={};
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

// ===== MATERIAL HELPERS =====
function itemKey(examId,bookIdx,type){ return `${examId}::${bookIdx}::${type}`; }
function examItems(exam) {
  const items=[];
  (exam.books||[]).forEach((b,i)=>items.push({examId:exam.id,bookIdx:i,type:'book',label:b.title||`Libro ${i+1}`,color:exam.color}));
  if(exam.hasSlides) items.push({examId:exam.id,bookIdx:-1,type:'slides',label:'Slides',color:exam.color});
  if(exam.hasVideo)  items.push({examId:exam.id,bookIdx:-2,type:'video', label:'Videolezioni',color:exam.color});
  if(!items.length)  items.push({examId:exam.id,bookIdx:-3,type:'exam',  label:'(nessun materiale)',color:exam.color});
  return items;
}
function allStudyItems(){ return state.exams.flatMap(e=>examItems(e)); }

// ===== PLAN HELPERS =====
function planDaysSet(plan){ return new Set(plan.days||[]); }

// Active items for a date
function activeItemsForDate(dateStr) {
  const dayData = state.calendar[dateStr]||{};
  if (dayData.overrideItems!==undefined&&dayData.overrideItems!==null) return dayData.overrideItems;
  const plan = coveringPlanForDate(dateStr);
  if (plan) return plan.items||[];
  if (dayData.isStudyDay) return allStudyItems().map(i=>({examId:i.examId,bookIdx:i.bookIdx,type:i.type}));
  return [];
}

function coveringPlanForDate(dateStr) {
  return [...state.studyPlans].reverse().find(p=>(p.days||[]).includes(dateStr))||null;
}

function isDayActive(dateStr) {
  if ((state.calendar[dateStr]||{}).isStudyDay) return true;
  return state.studyPlans.some(p=>(p.days||[]).includes(dateStr));
}

// ===== COMPUTE DAILY TASKS (respects sequential mode) =====
function computeDailyTasks(dateStr) {
  const plan = coveringPlanForDate(dateStr)||null;
  const activeItems = activeItemsForDate(dateStr);
  const tasks = [];

  if (!activeItems.length) return tasks;

  const bookItems = activeItems.filter(i=>i.type==='book');
  const nonBookItems = activeItems.filter(i=>i.type!=='book'&&i.type!=='exam');
  const mode = plan?.studyMode||'parallel';

  // --- SEQUENTIAL mode: only show the CURRENT book ---
  if (mode==='sequential'&&bookItems.length>1) {
    const order = plan.sequentialOrder||[];
    // Sort book items by sequential order
    const sorted = [...bookItems].sort((a,b)=>{
      const ia = order.findIndex(o=>o.examId===a.examId&&o.bookIdx===a.bookIdx);
      const ib = order.findIndex(o=>o.examId===b.examId&&o.bookIdx===b.bookIdx);
      return (ia<0?999:ia)-(ib<0?999:ib);
    });
    // Find the first book not yet finished
    for (const item of sorted) {
      const task = makeBookTask(item, dateStr, plan);
      if (task) { tasks.push(task); break; } // only one active book at a time
    }
  } else {
    // PARALLEL: all books active
    bookItems.forEach(item=>{
      const task = makeBookTask(item, dateStr, plan);
      if (task) tasks.push(task);
    });
  }

  // Slides and video are always in parallel
  nonBookItems.forEach(item=>{
    const exam = state.exams.find(e=>e.id===item.examId);
    if (!exam) return;
    let totalAmount=0, label='', alreadyDone=0;
    if (item.type==='slides') {
      if (!exam.slidesTotal) return;
      totalAmount=exam.slidesTotal; label='Slides'; alreadyDone=exam.slidesDone||0;
    } else if (item.type==='video') {
      if (!exam.videoTotal) return;
      totalAmount=exam.videoTotal; label='Videolezioni (min)'; alreadyDone=exam.videoDone||0;
    }
    const remaining=Math.max(0,totalAmount-alreadyDone);
    if (!remaining) return;
    const daysLeft=Math.max(1,getActiveDaysForItem(item,dateStr,null,plan).length);
    tasks.push({examId:item.examId,bookIdx:item.bookIdx,type:item.type,label,target:Math.ceil(remaining/daysLeft)});
  });

  return tasks;
}

function makeBookTask(item, dateStr, plan) {
  const exam = state.exams.find(e=>e.id===item.examId);
  if (!exam) return null;
  const book = (exam.books||[])[item.bookIdx];
  if (!book||!book.totalPages) return null;

  let alreadyDone=0;
  Object.entries(state.calendar).forEach(([d,day])=>{
    if (d<dateStr)(day.logs||[]).forEach(l=>{
      if(l.examId===item.examId&&l.bookIdx===item.bookIdx&&l.type==='book') alreadyDone+=(l.pages||0);
    });
  });

  const remaining=Math.max(0,book.totalPages-alreadyDone);
  if (!remaining) return null;

  const deadline=(exam.appells||[]).find(a=>a.chosen)?.date||null;
  const activeDays=getActiveDaysForItem(item,dateStr,deadline,plan);
  const daysLeft=Math.max(1,activeDays.length);
  return { examId:item.examId, bookIdx:item.bookIdx, type:'book',
    label:book.title||`Libro ${item.bookIdx+1}`, target:Math.ceil(remaining/daysLeft), remaining, daysLeft };
}

function getActiveDaysForItem(item, fromDate, deadline, plan) {
  const days=new Set();
  const plans = plan ? [plan] : state.studyPlans.filter(p=>(p.items||[]).some(i=>i.examId===item.examId&&i.bookIdx===item.bookIdx&&i.type===item.type));
  plans.forEach(p=>{
    (p.days||[]).forEach(ds=>{
      if (ds>=fromDate&&(!deadline||ds<=deadline)) days.add(ds);
    });
  });
  Object.entries(state.calendar).forEach(([ds,dayData])=>{
    if (ds<fromDate||(deadline&&ds>deadline)) return;
    if ((dayData.overrideItems||[]).some(i=>i.examId===item.examId&&i.bookIdx===item.bookIdx&&i.type===item.type))
      days.add(ds);
  });
  return [...days].sort();
}

function getStudyDays() {
  const days=new Set();
  Object.entries(state.calendar).forEach(([ds,d])=>{ if(d.isStudyDay) days.add(ds); });
  state.studyPlans.forEach(p=>(p.days||[]).forEach(ds=>days.add(ds)));
  return [...days].sort();
}

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
    if(v==='piani')     renderPlansView();
    if(v==='calendario'){renderCalendar();}
    if(v==='tesi')      renderProjects();
  });
});
document.getElementById('sidebarToggle').addEventListener('click',()=>document.getElementById('sidebar').classList.toggle('collapsed'));
(()=>{
  const d=new Date();
  const days=['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  const months=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  document.getElementById('headerDate').innerHTML=`<strong>${days[d.getDay()]}</strong><br>${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
})();

function renderAll(){ renderSidebarExams(); renderDashboard(); }

// ===== SIDEBAR =====
function renderSidebarExams(){
  const el=document.getElementById('examList');
  if(!state.exams.length){el.innerHTML='<p style="font-size:12px;color:rgba(255,255,255,.3);padding:4px 8px;">Nessun esame ancora</p>';return;}
  el.innerHTML=state.exams.map(e=>`<div class="exam-sidebar-item" onclick="goToExam('${e.id}')"><span class="exam-dot" style="background:${e.color}"></span><span>${e.name}</span></div>`).join('');
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
  if(!isDayActive(t)){el.innerHTML='<p style="color:var(--ink-light);font-size:13px;padding:8px 0;">Nessun piano attivo oggi.</p>';return;}
  const tasks=computeDailyTasks(t);
  if(!tasks.length){el.innerHTML='<p style="color:var(--ink-light);font-size:13px;">Nessun materiale programmato oggi.</p>';return;}
  el.innerHTML=tasks.map(task=>{
    const exam=state.exams.find(e=>e.id===task.examId);
    const logged=(dayData.logs||[]).find(l=>l.examId===task.examId&&l.bookIdx===task.bookIdx&&l.type===task.type);
    return `<div class="today-task">
      <div class="today-task-color" style="background:${exam.color}"></div>
      <div class="today-task-info"><div class="today-task-name">${exam.name}</div><div class="today-task-sub">${task.label}</div></div>
      <div class="today-task-pages">${logged?.pages||0}/${task.target} pp</div>
    </div>`;
  }).join('');
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
  el.innerHTML=state.exams.map(e=>renderExamCard(e)).join('');
}

function renderExamCard(e){
  const chosenAppell=(e.appells||[]).find(a=>a.chosen);
  const du=chosenAppell?daysUntil(chosenAppell.date):null;

  const notesHtml = e.notes ? `
    <div class="exam-notes-block">
      <div class="exam-notes-label">📝 Note & modalità</div>
      <div class="exam-notes-text">${e.notes.replace(/\n/g,'<br>')}</div>
    </div>` : '';

  const booksHtml=(e.books||[]).map((b,bi)=>{
    const tp=b.totalPages||0,r=v=>tp?Math.round((v||0)/tp*100):0,tc=b.totalChapters||0;
    return `<div class="book-row">
      <div class="book-title-row"><span class="book-title">${b.title||'Libro senza titolo'}</span><span class="book-pages">${tp} pp · ${tc} cap</span></div>
      <div class="book-progress-tracks">
        <div class="book-track"><span class="book-track-label">📖 Lette</span><div class="book-track-bar"><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${r(b.pagesRead)}%;background:${e.color}88"></div></div></div><span class="text-mono" style="font-size:11px">${b.pagesRead||0}</span></div>
        <div class="book-track"><span class="book-track-label">✏️ Sottolineate</span><div class="book-track-bar"><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${r(b.pagesUnderlined)}%;background:${e.color}bb"></div></div></div><span class="text-mono" style="font-size:11px">${b.pagesUnderlined||0}</span></div>
        <div class="book-track"><span class="book-track-label">🧠 Studiate</span><div class="book-track-bar"><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${r(b.pagesStudied)}%;background:${e.color}"></div></div></div><span class="text-mono" style="font-size:11px">${b.pagesStudied||0}</span></div>
      </div>
      ${tc?`<div class="chapter-tracks mt-8"><div class="chapter-badge">📚 Letti <span class="chapter-count">${b.chaptersRead||0}/${tc}</span></div><div class="chapter-badge">🃏 Anki <span class="chapter-count">${b.chaptersAnki||0}/${tc}</span></div><div class="chapter-badge">✅ Studiati <span class="chapter-count">${b.chaptersStudied||0}/${tc}</span></div></div>`:''}
      <button class="btn-ghost mt-8" style="font-size:12px;padding:5px 10px" onclick="openProgressModal('${e.id}',${bi})">Aggiorna progresso</button>
    </div>`;
  }).join('');

  const materialsHtml=(e.hasSlides||e.hasVideo)?`<div class="material-row">
    ${e.hasSlides?`<div class="material-chip">🖥️ Slides <span class="material-pct">${e.slidesTotal?Math.round((e.slidesDone||0)/e.slidesTotal*100):0}%</span></div>`:''}
    ${e.hasVideo?`<div class="material-chip">🎬 Video <span class="material-pct">${e.videoTotal?Math.round((e.videoDone||0)/e.videoTotal*100):0}%</span></div>`:''}
  </div>`:'';

  return `<div class="exam-card" id="exam-card-${e.id}">
    <div class="exam-card-header">
      <div class="exam-card-title-row"><div class="exam-card-stripe" style="background:${e.color}"></div><span class="exam-card-name">${e.name}</span></div>
      <div class="exam-card-actions">
        ${e.moodle?`<a class="exam-moodle" href="${e.moodle}" target="_blank">Moodle</a>`:''}
        <button class="btn-icon" onclick="openExamModal('${e.id}')">✏️</button>
        <button class="btn-icon" onclick="deleteExam('${e.id}')">🗑️</button>
      </div>
    </div>
    <div class="exam-card-body">
      ${notesHtml}
      ${chosenAppell?`<div class="exam-appell-chosen">📅 Appello: <strong>${fmt(chosenAppell.date)}</strong>${du!==null?`<span class="days-left">${du>0?du+' gg':du===0?'oggi':'passato'}</span>`:''}</div>`:''}
      ${booksHtml?`<div class="books-section-title">📚 LIBRI</div>${booksHtml}`:''}
      ${materialsHtml}
    </div>
  </div>`;
}

// ===== COLOR PICKER =====
function renderColorPicker(cid, selected, colors){
  const el=document.getElementById(cid);
  el.innerHTML=colors.map(c=>`<div class="color-swatch ${c===selected?'selected':''}" style="background:${c}" data-color="${c}" onclick="selectSwatch(this,'${cid}')"></div>`).join('');
  el.dataset.selected=selected||colors[0];
}
window.selectSwatch=function(swatch,cid){
  document.querySelectorAll(`#${cid} .color-swatch`).forEach(s=>s.classList.remove('selected'));
  swatch.classList.add('selected'); document.getElementById(cid).dataset.selected=swatch.dataset.color;
};
function addCustomSwatch(cid,hex){
  const el=document.getElementById(cid);
  let ex=el.querySelector(`[data-color="${hex}"]`);
  if(!ex){const d=document.createElement('div');d.className='color-swatch';d.style.background=hex;d.dataset.color=hex;d.onclick=()=>window.selectSwatch(d,cid);el.appendChild(d);}
  el.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected'));
  (ex||el.lastElementChild).classList.add('selected'); el.dataset.selected=hex;
}
document.getElementById('applyCustomColor').addEventListener('click',()=>addCustomSwatch('colorPicker',document.getElementById('examCustomColor').value));
document.getElementById('applyProjectCustomColor').addEventListener('click',()=>addCustomSwatch('projectColorPicker',document.getElementById('projectCustomColor').value));

// ===== EXAM MODAL =====
['btnAddExam','btnAddExam2'].forEach(id=>document.getElementById(id)?.addEventListener('click',()=>openExamModal(null)));
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
  renderBookEntries(bc,exam?(exam.books||[]):[]);
  document.getElementById('addBookBtn').onclick=()=>renderBookEntries(bc,[...collectBooks(),{title:'',totalPages:0,totalChapters:0}]);

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
function renderBookEntries(container,books){
  container.innerHTML=books.map((b,i)=>`<div class="book-entry">
    <div class="book-entry-header"><strong>Libro ${i+1}</strong><button class="btn-icon" onclick="this.closest('.book-entry').remove()">✕</button></div>
    <div class="form-row"><div class="form-group"><label>Titolo</label><input type="text" class="b-title" value="${b.title||''}"></div></div>
    <div class="form-row">
      <div class="form-group"><label>Pagine totali</label><input type="number" class="b-totalpages" value="${b.totalPages||''}"></div>
      <div class="form-group"><label>Pagine lette</label><input type="number" class="b-pagesread" value="${b.pagesRead||''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Pag. sottolineate</label><input type="number" class="b-pagesunderlined" value="${b.pagesUnderlined||''}"></div>
      <div class="form-group"><label>Pag. studiate</label><input type="number" class="b-pagesstudied" value="${b.pagesStudied||''}"></div>
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
  }));
}

document.getElementById('saveExamBtn').addEventListener('click',()=>{
  const name=document.getElementById('examName').value.trim();
  if(!name){alert('Inserisci il nome!');return;}
  const color=document.getElementById('colorPicker').dataset.selected||PRESET_COLORS[0];
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
  };
  if(state.editingExamId){const i=state.exams.findIndex(e=>e.id===state.editingExamId);if(i>=0)state.exams[i]=exam;}
  else state.exams.push(exam);
  save(); closeModal('examModal'); renderSidebarExams(); renderExamsGrid(); renderDashboard();
});
window.deleteExam=function(id){
  if(!confirm('Eliminare questo esame?'))return;
  state.exams=state.exams.filter(e=>e.id!==id);
  save(); renderSidebarExams(); renderExamsGrid(); renderDashboard();
};

// ===== PROGRESS MODAL =====
window.openProgressModal=function(examId,bookIdx){
  const exam=state.exams.find(e=>e.id===examId), book=exam.books[bookIdx];
  document.getElementById('progressModalTitle').textContent=`📖 ${book.title||'Libro'}`;
  document.getElementById('progressModalBody').innerHTML=`
    <div class="form-group"><label>Pagine lette</label><input type="number" id="pm-pagesread" value="${book.pagesRead||0}"></div>
    <div class="form-group"><label>Pagine sottolineate</label><input type="number" id="pm-pagesunderlined" value="${book.pagesUnderlined||0}"></div>
    <div class="form-group"><label>Pagine studiate</label><input type="number" id="pm-pagesstudied" value="${book.pagesStudied||0}"></div>
    ${book.totalChapters?`
    <div class="form-group"><label>Capitoli letti</label><input type="number" id="pm-chapread" value="${book.chaptersRead||0}"></div>
    <div class="form-group"><label>Capitoli Anki</label><input type="number" id="pm-chapanki" value="${book.chaptersAnki||0}"></div>
    <div class="form-group"><label>Capitoli studiati</label><input type="number" id="pm-chapstudied" value="${book.chaptersStudied||0}"></div>`:''}`;
  document.getElementById('saveProgressBtn').onclick=()=>{
    book.pagesRead=+document.getElementById('pm-pagesread').value||0;
    book.pagesUnderlined=+document.getElementById('pm-pagesunderlined').value||0;
    book.pagesStudied=+document.getElementById('pm-pagesstudied').value||0;
    if(book.totalChapters){
      book.chaptersRead=+document.getElementById('pm-chapread').value||0;
      book.chaptersAnki=+document.getElementById('pm-chapanki').value||0;
      book.chaptersStudied=+document.getElementById('pm-chapstudied').value||0;
    }
    save(); closeModal('progressModal'); renderExamsGrid(); renderDashboard();
  };
  openModal('progressModal');
};

// ===== PLAN MODAL — drag calendar + preview =====
let planModalState = { days: new Set(), month: new Date().getMonth(), year: new Date().getFullYear(), dragging: false, dragStart: null, dragMode: 'add' };

document.getElementById('btnAddPlan').addEventListener('click',()=>openPlanModal(null));
window.openPlanModal=function(planId){
  state.editingPlanId=planId;
  const plan=planId?state.studyPlans.find(p=>p.id===planId):null;

  document.getElementById('planModalTitle').textContent=plan?'Modifica Piano':'Nuovo Piano di Studio';
  document.getElementById('planLabel').value=plan?(plan.label||''):'';

  // Init drag-calendar state
  planModalState.days = new Set(plan?.days||[]);
  if (planModalState.days.size) {
    const sorted=[...planModalState.days].sort();
    const first=new Date(sorted[0]+'T00:00:00');
    planModalState.month=first.getMonth(); planModalState.year=first.getFullYear();
  } else {
    planModalState.month=new Date().getMonth(); planModalState.year=new Date().getFullYear();
  }

  // Study mode
  document.getElementById('modeParallel').checked=(plan?.studyMode||'parallel')==='parallel';
  document.getElementById('modeSequential').checked=plan?.studyMode==='sequential';
  document.getElementById('sequentialConfig').classList.toggle('hidden',plan?.studyMode!=='sequential');

  // Copy-from dropdown
  const copyFrom=document.getElementById('copyFromPlan');
  const otherPlans=state.studyPlans.filter(p=>p.id!==planId);
  document.getElementById('copyFromGroup').style.display=otherPlans.length?'':'none';
  copyFrom.innerHTML='<option value="">— seleziona piano —</option>'+
    otherPlans.map(p=>`<option value="${p.id}">${p.label||p.id}</option>`).join('');

  document.getElementById('btnCopyDays').onclick=()=>{
    const src=state.studyPlans.find(p=>p.id===copyFrom.value);
    if(!src){alert('Seleziona un piano da cui copiare.');return;}
    (src.days||[]).forEach(d=>planModalState.days.add(d));
    renderPlanMiniCal(); updatePlanPreview();
    showSync(`Copiati ${src.days?.length||0} giorni da "${src.label}" ✓`,'success'); setTimeout(hideSync,2000);
  };

  // Items picker
  renderPlanItemPicker(plan?(plan.items||[]):[]);

  // Mode toggle → show/hide sequential config + update preview
  document.querySelectorAll('input[name=studyMode]').forEach(r=>r.addEventListener('change',()=>{
    document.getElementById('sequentialConfig').classList.toggle('hidden',document.getElementById('modeParallel').checked);
    renderSequentialOrder(); updatePlanPreview();
  }));

  // Item checkboxes → trigger preview update + sequential reorder
  document.getElementById('planItemPicker').addEventListener('change',()=>{ renderSequentialOrder(); updatePlanPreview(); });

  renderPlanMiniCal();
  renderSequentialOrder();
  updatePlanPreview();

  // Quick chips
  document.getElementById('chipNoWeekend').onclick=()=>{
    planModalState.days.forEach(d=>{ const dow=new Date(d+'T00:00:00').getDay(); if(dow===0||dow===6) planModalState.days.delete(d); });
    renderPlanMiniCal(); updatePlanPreview();
  };
  document.getElementById('chipClearAll').onclick=()=>{ planModalState.days.clear(); renderPlanMiniCal(); updatePlanPreview(); };

  // Cal nav
  document.getElementById('planCalPrev').onclick=()=>{ planModalState.month--; if(planModalState.month<0){planModalState.month=11;planModalState.year--;} renderPlanMiniCal(); };
  document.getElementById('planCalNext').onclick=()=>{ planModalState.month++; if(planModalState.month>11){planModalState.month=0;planModalState.year++;} renderPlanMiniCal(); };

  openModal('planModal');
};

function renderPlanMiniCal(){
  const {month,year,days}=planModalState;
  const months=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  document.getElementById('planCalMonthLabel').textContent=`${months[month]} ${year}`;

  const firstDay=new Date(year,month,1).getDay();
  const startOffset=(firstDay+6)%7;
  const daysInMonth=new Date(year,month+1,0).getDate();
  const daysInPrev=new Date(year,month,0).getDate();
  const todayStr=today();

  let html='<div class="plan-mini-cal-weekdays">';
  ['L','M','M','G','V','S','D'].forEach(d=>html+=`<div class="pmcw">${d}</div>`);
  html+='</div><div class="plan-mini-cal-days">';

  for(let i=startOffset-1;i>=0;i--) html+=`<div class="pmc-day other-month"><span>${daysInPrev-i}</span></div>`;

  for(let d=1;d<=daysInMonth;d++){
    const ds=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isSelected=days.has(ds);
    const isToday=ds===todayStr;
    const dow=new Date(ds+'T00:00:00').getDay();
    const isWE=dow===0||dow===6;
    const cls=['pmc-day',isSelected?'selected':'',isToday?'today':'',isWE?'weekend':''].filter(Boolean).join(' ');
    html+=`<div class="${cls}" data-date="${ds}"><span>${d}</span></div>`;
  }

  const total=startOffset+daysInMonth;
  for(let i=1;i<=(7-(total%7))%7;i++) html+=`<div class="pmc-day other-month"><span>${i}</span></div>`;
  html+='</div>';

  const container=document.getElementById('planMiniCal');
  container.innerHTML=html;

  // DRAG selection
  let isMouseDown=false, dragMode='add', dragStart=null;

  container.addEventListener('mousedown',e=>{
    const day=e.target.closest('.pmc-day:not(.other-month)');
    if(!day)return;
    e.preventDefault();
    isMouseDown=true;
    const ds=day.dataset.date;
    // ctrl+click = remove single day
    if(e.ctrlKey||e.metaKey){ planModalState.days.delete(ds); renderPlanMiniCal(); updatePlanPreview(); return; }
    dragMode=planModalState.days.has(ds)?'remove':'add';
    dragStart=ds;
    planModalState.days[dragMode==='add'?'add':'delete'](ds);
    day.classList.toggle('selected',dragMode==='add');
  });

  container.addEventListener('mouseover',e=>{
    if(!isMouseDown)return;
    const day=e.target.closest('.pmc-day:not(.other-month)');
    if(!day)return;
    const ds=day.dataset.date;
    planModalState.days[dragMode==='add'?'add':'delete'](ds);
    day.classList.toggle('selected',dragMode==='add');
    updatePlanPreview();
  });

  document.addEventListener('mouseup',()=>{ if(isMouseDown){isMouseDown=false;updatePlanPreview();} },{once:true});

  // Touch support
  container.addEventListener('touchstart',e=>{
    const touch=e.touches[0];
    const el=document.elementFromPoint(touch.clientX,touch.clientY);
    const day=el?.closest?.('.pmc-day:not(.other-month)');
    if(!day)return;
    const ds=day.dataset.date;
    dragMode=planModalState.days.has(ds)?'remove':'add';
    planModalState.days[dragMode==='add'?'add':'delete'](ds);
    renderPlanMiniCal(); updatePlanPreview();
  },{passive:true});

  container.addEventListener('touchmove',e=>{
    e.preventDefault();
    const touch=e.touches[0];
    const el=document.elementFromPoint(touch.clientX,touch.clientY);
    const day=el?.closest?.('.pmc-day:not(.other-month)');
    if(!day)return;
    const ds=day.dataset.date;
    planModalState.days[dragMode==='add'?'add':'delete'](ds);
    day.classList.toggle('selected',dragMode==='add');
    updatePlanPreview();
  },{passive:false});
}

function collectPlanItems(){
  return [...document.querySelectorAll('.plan-item-cb:checked')].map(cb=>({
    examId:cb.dataset.examid, bookIdx:+cb.dataset.bookidx, type:cb.dataset.type,
  }));
}

function renderPlanItemPicker(selectedItems){
  const container=document.getElementById('planItemPicker');
  const selectedKeys=new Set(selectedItems.map(i=>itemKey(i.examId,i.bookIdx,i.type)));
  if(!state.exams.length){container.innerHTML='<p style="color:var(--ink-light);font-size:13px">Aggiungi prima degli esami.</p>';return;}
  container.innerHTML=state.exams.map(exam=>{
    const items=examItems(exam).filter(i=>i.type!=='exam');
    if(!items.length)return'';
    return `<div class="plan-exam-group">
      <div class="plan-exam-group-header" style="color:${exam.color}">
        <span style="background:${exam.color};width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px"></span>
        ${exam.name}
        <button class="btn-ghost" style="font-size:11px;padding:2px 8px;margin-left:8px" onclick="toggleAllExamItems('${exam.id}',this)">Seleziona tutto</button>
      </div>
      <div class="plan-exam-items">${items.map(i=>{
        const key=itemKey(i.examId,i.bookIdx,i.type);
        const checked=selectedKeys.has(key);
        const icon=i.type==='book'?'📖':i.type==='slides'?'🖥️':'🎬';
        return `<label class="plan-item-row ${checked?'checked':''}">
          <input type="checkbox" class="plan-item-cb" data-examid="${i.examId}" data-bookidx="${i.bookIdx}" data-type="${i.type}"
            ${checked?'checked':''} onchange="this.closest('label').classList.toggle('checked',this.checked)">
          <span class="plan-item-icon">${icon}</span>
          <span class="plan-item-label">${i.label}</span>
        </label>`;
      }).join('')}</div>
    </div>`;
  }).join('');
}

window.toggleAllExamItems=function(examId,btn){
  const group=btn.closest('.plan-exam-group');
  const cbs=group.querySelectorAll('.plan-item-cb');
  const allChecked=[...cbs].every(cb=>cb.checked);
  cbs.forEach(cb=>{cb.checked=!allChecked;cb.closest('label').classList.toggle('checked',!allChecked);});
  btn.textContent=allChecked?'Seleziona tutto':'Deseleziona tutto';
  renderSequentialOrder(); updatePlanPreview();
};

// Sequential order UI
function renderSequentialOrder(){
  const cfg=document.getElementById('sequentialConfig');
  if(cfg.classList.contains('hidden'))return;
  const items=collectPlanItems().filter(i=>i.type==='book');
  const existing=(document.getElementById('sequentialOrder')?.querySelectorAll('.seq-item')||[]);
  // preserve existing weights
  const weights={};
  existing.forEach(el=>{ weights[el.dataset.key]=+el.querySelector('.seq-weight').value||0; });

  const totalWeight=items.length?Math.round(100/items.length):100;
  document.getElementById('sequentialOrder').innerHTML=items.map((item,idx)=>{
    const exam=state.exams.find(e=>e.id===item.examId);
    const book=(exam?.books||[])[item.bookIdx];
    const key=itemKey(item.examId,item.bookIdx,item.type);
    const w=weights[key]||totalWeight;
    return `<div class="seq-item" data-key="${key}" data-examid="${item.examId}" data-bookidx="${item.bookIdx}" draggable="true">
      <span class="seq-handle">⠿</span>
      <span class="seq-dot" style="background:${exam?.color}"></span>
      <span class="seq-label">${book?.title||`Libro ${item.bookIdx+1}`}</span>
      <div class="seq-weight-group">
        <input type="number" class="seq-weight" min="1" max="100" value="${w}" onchange="updatePlanPreview()">
        <span>%</span>
      </div>
    </div>`;
  }).join('');

  // Drag-to-reorder
  initSeqDrag();
}

function initSeqDrag(){
  const container=document.getElementById('sequentialOrder');
  let dragged=null;
  container.querySelectorAll('.seq-item').forEach(item=>{
    item.addEventListener('dragstart',()=>{ dragged=item; item.style.opacity='0.4'; });
    item.addEventListener('dragend',()=>{ item.style.opacity='1'; dragged=null; updatePlanPreview(); });
    item.addEventListener('dragover',e=>{ e.preventDefault(); if(dragged&&item!==dragged){ container.insertBefore(dragged,item); }});
  });
}

// ===== LIVE PLAN PREVIEW =====
function updatePlanPreview(){
  const preview=document.getElementById('planPreview');
  const days=[...planModalState.days].sort();
  const items=collectPlanItems();
  const mode=document.getElementById('modeSequential').checked?'sequential':'parallel';

  if(!days.length||!items.length){
    preview.innerHTML='<p class="plan-preview-empty">Seleziona dei giorni e dei materiali per vedere il piano giornaliero</p>';
    return;
  }

  const nDays=days.length;
  let html=`<div class="preview-header"><strong>${nDays} giorni selezionati</strong> · modalità <em>${mode==='parallel'?'parallelo':'successione'}</em></div>`;

  const bookItems=items.filter(i=>i.type==='book');
  const nonBookItems=items.filter(i=>i.type!=='book');

  if(mode==='parallel'){
    html+='<div class="preview-rows">';
    bookItems.forEach(item=>{
      const exam=state.exams.find(e=>e.id===item.examId);
      const book=(exam?.books||[])[item.bookIdx];
      if(!book?.totalPages){
        html+=`<div class="preview-row warn">⚠️ ${exam?.name} — ${book?.title||'?'}: inserisci le pagine totali</div>`;
        return;
      }
      const done=book.pagesRead||0;
      const remaining=Math.max(0,book.totalPages-done);
      const perDay=Math.ceil(remaining/nDays);
      html+=`<div class="preview-row">
        <span class="pr-dot" style="background:${exam?.color}"></span>
        <span class="pr-name">${exam?.name} — ${book?.title}</span>
        <span class="pr-pages">${remaining} pp rimaste → <strong>${perDay} pp/giorno</strong></span>
      </div>`;
    });
  } else {
    // Sequential: distribute days by weight
    const seqItems=[...document.querySelectorAll('#sequentialOrder .seq-item')];
    const totalW=seqItems.reduce((s,el)=>s+(+el.querySelector('.seq-weight').value||0),0)||1;
    let cumDays=0;
    html+='<div class="preview-rows">';
    seqItems.forEach((el,i)=>{
      const examId=el.dataset.examid, bookIdx=+el.dataset.bookidx;
      const exam=state.exams.find(e=>e.id===examId);
      const book=(exam?.books||[])[bookIdx];
      const w=+el.querySelector('.seq-weight').value||0;
      const myDays=i===seqItems.length-1?nDays-cumDays:Math.round((w/totalW)*nDays);
      cumDays+=myDays;
      if(!book?.totalPages){
        html+=`<div class="preview-row warn">⚠️ ${exam?.name} — ${book?.title||'?'}: inserisci le pagine totali</div>`;
        return;
      }
      const remaining=Math.max(0,book.totalPages-(book.pagesRead||0));
      const perDay=myDays?Math.ceil(remaining/myDays):0;
      html+=`<div class="preview-row">
        <span class="pr-dot" style="background:${exam?.color}"></span>
        <span class="pr-name">${exam?.name} — ${book?.title}</span>
        <span class="pr-pages">${myDays} giorni · ${remaining} pp → <strong>${perDay} pp/giorno</strong></span>
      </div>`;
    });
    if(!seqItems.length) bookItems.forEach(item=>{
      const exam=state.exams.find(e=>e.id===item.examId);
      const book=(exam?.books||[])[item.bookIdx];
      html+=`<div class="preview-row warn">⚠️ ${exam?.name} — ${book?.title||'?'}: riordina nella sezione "successione"</div>`;
    });
  }

  // Non-book items
  nonBookItems.forEach(item=>{
    const exam=state.exams.find(e=>e.id===item.examId);
    const isSlides=item.type==='slides';
    const total=isSlides?(exam?.slidesTotal||0):(exam?.videoTotal||0);
    const done=isSlides?(exam?.slidesDone||0):(exam?.videoDone||0);
    const label=isSlides?'slides':'min video';
    if(!total) return;
    const rem=Math.max(0,total-done);
    html+=`<div class="preview-row">
      <span class="pr-dot" style="background:${exam?.color}"></span>
      <span class="pr-name">${exam?.name} — ${isSlides?'🖥️ Slides':'🎬 Video'}</span>
      <span class="pr-pages">${rem} ${label} → <strong>${Math.ceil(rem/nDays)} ${label}/giorno</strong></span>
    </div>`;
  });

  html+='</div>';
  preview.innerHTML=html;
}

document.getElementById('savePlanBtn').addEventListener('click',()=>{
  const label=document.getElementById('planLabel').value.trim();
  const days=[...planModalState.days].sort();
  if(!days.length){alert('Seleziona almeno un giorno sul calendario!');return;}
  const items=collectPlanItems();
  const mode=document.getElementById('modeSequential').checked?'sequential':'parallel';

  // Collect sequential order
  const seqOrder=[...document.querySelectorAll('#sequentialOrder .seq-item')].map(el=>({
    examId:el.dataset.examid, bookIdx:+el.dataset.bookidx, type:'book',
    weight:+el.querySelector('.seq-weight').value||0,
  }));

  const plan={
    id:state.editingPlanId||uid(),
    label:label||`Piano ${fmtShort(days[0])}–${fmtShort(days[days.length-1])}`,
    days, items, studyMode:mode, sequentialOrder:seqOrder,
  };

  if(state.editingPlanId){const i=state.studyPlans.findIndex(p=>p.id===state.editingPlanId);if(i>=0)state.studyPlans[i]=plan;}
  else state.studyPlans.push(plan);

  save(); closeModal('planModal'); renderPlansView();
  if(document.getElementById('view-calendario').classList.contains('active')) renderCalendar();
});

window.deletePlan=function(id){
  if(!confirm('Eliminare questo piano?'))return;
  state.studyPlans=state.studyPlans.filter(p=>p.id!==id);
  save(); renderPlansView();
};

// ===== PLANS VIEW =====
function renderPlansView(){
  const el=document.getElementById('plansGrid');
  if(!state.studyPlans.length){el.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">📋</div><p>Nessun piano ancora. Clicca "+ Nuovo piano".</p></div>`;return;}
  el.innerHTML=state.studyPlans.map(p=>{
    const days=p.days||[];
    const items=p.items||[];
    const byExam={};
    items.forEach(i=>{if(!byExam[i.examId])byExam[i.examId]=[];byExam[i.examId].push(i);});
    const chips=Object.entries(byExam).map(([eid,its])=>{
      const exam=state.exams.find(e=>e.id===eid);if(!exam)return'';
      const labels=its.filter(i=>i.type!=='exam').map(i=>i.type==='slides'?'🖥️ Slides':i.type==='video'?'🎬 Video':`📖 ${(exam.books||[])[i.bookIdx]?.title||'?'}`);
      if(!labels.length)return'';
      return `<div class="plan-exam-chip" style="border-left:3px solid ${exam.color}"><strong style="color:${exam.color}">${exam.name}</strong><div class="plan-chip-items">${labels.join(' · ')}</div></div>`;
    }).join('');
    const modeLabel=p.studyMode==='sequential'?'📚 Successione':'📖 Parallelo';
    return `<div class="plan-card">
      <div class="plan-card-header">
        <div>
          <div class="plan-card-title">${p.label||'Piano'}</div>
          <div class="plan-card-dates">📅 <strong>${days.length} giorni</strong> · ${days[0]?fmtShort(days[0]):'?'} → ${days[days.length-1]?fmtShort(days[days.length-1]):'?'} · ${modeLabel}</div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn-icon" onclick="openPlanModal('${p.id}')">✏️</button>
          <button class="btn-icon" onclick="deletePlan('${p.id}')">🗑️</button>
        </div>
      </div>
      <div class="plan-card-body">${chips||'<p style="color:var(--ink-light);font-size:13px">Nessun materiale selezionato</p>'}</div>
    </div>`;
  }).join('');
}

// ===== CALENDAR =====
function renderCalendar(){
  const months=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  document.getElementById('calMonthLabel').textContent=`${months[state.calMonth]} ${state.calYear}`;
  const firstDay=new Date(state.calYear,state.calMonth,1).getDay();
  const startOffset=(firstDay+6)%7;
  const daysInMonth=new Date(state.calYear,state.calMonth+1,0).getDate();
  const daysInPrev=new Date(state.calYear,state.calMonth,0).getDate();
  const todayStr=today();
  let html='<div class="cal-weekdays">';
  ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'].forEach(d=>html+=`<div class="cal-weekday">${d}</div>`);
  html+='</div><div class="cal-days">';
  for(let i=startOffset-1;i>=0;i--) html+=`<div class="cal-day other-month"><span class="cal-day-num">${daysInPrev-i}</span></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const ds=`${state.calYear}-${String(state.calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayData=state.calendar[ds]||{};
    const isActive=isDayActive(ds);
    const isToday=ds===todayStr;
    const hasOverride=dayData.overrideItems!==undefined&&dayData.overrideItems!==null;
    const appellExams=state.exams.filter(e=>(e.appells||[]).some(a=>a.date===ds));
    let pills='';
    if(isActive){
      const tasks=computeDailyTasks(ds);
      const activeItems=activeItemsForDate(ds);
      const seen=new Set();
      [...tasks.map(t=>t.examId),...activeItems.filter(i=>i.type!=='exam').map(i=>i.examId)].forEach(eid=>{
        if(seen.has(eid))return;seen.add(eid);
        const ex=state.exams.find(e=>e.id===eid);if(!ex)return;
        const total=tasks.filter(x=>x.examId===eid).reduce((s,x)=>s+x.target,0);
        const label=total>0?`${ex.name.split(' ')[0]} ${total}pp`:ex.name.split(' ')[0];
        pills+=`<span class="cal-pill" style="background:${ex.color};opacity:${total>0?1:0.65}">${label}</span>`;
      });
    }
    const cls=['cal-day',isToday?'today':'',isActive?'study-day':'',appellExams.length?'has-appell':'',hasOverride?'has-override':''].filter(Boolean).join(' ');
    html+=`<div class="${cls}" onclick="handleDayClick('${ds}')"><span class="cal-day-num">${d}</span>${hasOverride?'<span class="override-dot">✦</span>':''}<div class="cal-day-pills">${pills}</div></div>`;
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
  const isStudy=!!dayData.isStudyDay;
  const isActive=isDayActive(dateStr);
  const hasOverride=dayData.overrideItems!==undefined&&dayData.overrideItems!==null;
  const months=['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  const [y,m,d]=dateStr.split('-');
  const label=`${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;
  const coveringPlan=[...state.studyPlans].reverse().find(p=>(p.days||[]).includes(dateStr));
  const planBadge=hasOverride
    ?`<div class="plan-badge override">✦ Override materiali <button class="btn-link" onclick="clearDayOverride('${dateStr}')">← Ripristina</button></div>`
    :coveringPlan
      ?`<div class="plan-badge" style="justify-content:space-between"><span>📋 Piano: <strong>${coveringPlan.label}</strong></span><button class="btn-link" onclick="toggleDayExclude('${dateStr}')">❌ Escludi giorno</button></div>`
      :isStudy
        ?`<div class="plan-badge override">📌 Segnato manualmente <button class="btn-link" onclick="toggleDayExclude('${dateStr}')">Rimuovi</button></div>`
        :`<div class="plan-badge none">Giorno libero · <button class="btn-link" onclick="forceIncludeDay('${dateStr}')">+ Aggiungi manualmente</button></div>`;
  const appellExams=state.exams.filter(e=>(e.appells||[]).some(a=>a.date===dateStr));
  const appellHtml=appellExams.map(e=>`<div style="font-size:13px;padding:6px 0;border-bottom:1px solid var(--border)">📅 <strong style="color:${e.color}">${e.name}</strong> — appello</div>`).join('');
  const tasks=isActive?computeDailyTasks(dateStr):[];
  const activeItems=isActive?activeItemsForDate(dateStr):[];
  const tasksExamIds=new Set(tasks.map(t=>t.examId+':'+t.bookIdx+':'+t.type));
  const noPagesItems=activeItems.filter(i=>i.type!=='exam'&&!tasksExamIds.has(i.examId+':'+i.bookIdx+':'+i.type));
  let tasksHtml='';
  if(tasks.length||noPagesItems.length){
    const rows=tasks.map(t=>{
      const exam=state.exams.find(e=>e.id===t.examId);
      const logged=(dayData.logs||[]).find(l=>l.examId===t.examId&&l.bookIdx===t.bookIdx&&l.type===t.type);
      return `<div class="day-book-entry" data-examid="${t.examId}" data-bookidx="${t.bookIdx}" data-type="${t.type}">
        <div class="day-book-entry-name" style="color:${exam.color}">${exam.name}</div>
        <div style="font-size:13px">${t.label}</div>
        <div class="day-book-entry-target">Target: <span>${t.target} unità</span> <small style="color:var(--ink-light)">(${t.remaining} rimaste su ${t.daysLeft} giorni)</small></div>
        <div class="day-input-row"><label>Fatte oggi:</label><input type="number" class="day-pages-input" value="${logged?.pages||0}" min="0"></div>
      </div>`;
    }).join('');
    const noRows=noPagesItems.map(i=>{
      const exam=state.exams.find(e=>e.id===i.examId);
      const label=i.type==='slides'?'Slides':i.type==='video'?'Videolezioni':((exam?.books||[])[i.bookIdx]?.title||`Libro ${i.bookIdx+1}`);
      return `<div class="day-book-entry no-pages"><div style="color:${exam?.color};font-weight:600">${exam?.name}</div><div style="font-size:13px">${label}</div><div style="font-size:12px;color:var(--ink-light)">⚠️ Inserisci le pagine totali nell'esame per calcolare il target</div></div>`;
    }).join('');
    tasksHtml=`<div class="day-book-tasks">${rows}${noRows}</div>`;
  } else if(isActive){
    tasksHtml='<p style="color:var(--ink-light);font-size:13px;margin-top:8px">Nessun materiale attivo.</p>';
  }
  const overridePickerHtml=isActive?`<div class="day-override-section"><div class="day-override-header"><span>🎯 Materie di oggi</span><button class="btn-ghost" style="font-size:12px;padding:4px 10px" onclick="toggleOverridePicker('${dateStr}')">+ Override per oggi</button></div><div id="overridePickerWrap" class="hidden"></div></div>`:'';
  panel.innerHTML=`
    <div class="day-panel-title">${label}</div>
    <div class="day-panel-subtitle">${isActive?coveringPlan?`📋 ${coveringPlan.label}`:isStudy?'📌 Manuale':'📋 Attivo':'⬜ Libero'}</div>
    ${appellHtml}
    <div class="day-toggle"><label class="toggle-switch"><input type="checkbox" id="dayStudyToggle" ${isStudy?'checked':''}><span class="toggle-slider"></span></label><span>Segna manualmente</span></div>
    ${isActive?planBadge:''}
    ${isActive?overridePickerHtml:''}
    ${tasksHtml}
    ${isActive&&tasks.length?`<button class="btn-primary" style="margin-top:16px;width:100%" onclick="saveDayPanel('${dateStr}')">💾 Salva progresso</button>`:''}
    ${!isActive?`<p style="color:var(--ink-light);font-size:13px;margin-top:8px">Nessun piano attivo. Crea un Piano di Studio o attiva il toggle.</p>`:''}
  `;
  document.getElementById('dayStudyToggle').addEventListener('change',function(){
    if(!state.calendar[dateStr])state.calendar[dateStr]={};
    state.calendar[dateStr].isStudyDay=this.checked;
    save();renderDayPanel(dateStr);renderCalendar();renderDashboard();
  });
}

window.toggleOverridePicker=function(dateStr){
  const wrap=document.getElementById('overridePickerWrap');
  if(!wrap.classList.contains('hidden')){wrap.classList.add('hidden');wrap.innerHTML='';return;}
  const dayData=state.calendar[dateStr]||{};
  const current=activeItemsForDate(dateStr);
  const curKeys=new Set(current.map(i=>itemKey(i.examId,i.bookIdx,i.type)));
  const all=allStudyItems().filter(i=>i.type!=='exam');
  if(!all.length){wrap.innerHTML='<p style="font-size:13px;color:var(--ink-light)">Nessun materiale.</p>';wrap.classList.remove('hidden');return;}
  const byExam={};
  all.forEach(i=>{if(!byExam[i.examId])byExam[i.examId]=[];byExam[i.examId].push(i);});
  const html=Object.entries(byExam).map(([eid,items])=>{
    const exam=state.exams.find(e=>e.id===eid);if(!exam)return'';
    return `<div class="plan-exam-group" style="margin-bottom:8px">
      <div style="color:${exam.color};font-size:13px;font-weight:700;margin-bottom:4px">${exam.name}</div>
      ${items.map(i=>{const key=itemKey(i.examId,i.bookIdx,i.type);const icon=i.type==='book'?'📖':i.type==='slides'?'🖥️':'🎬';
        return `<label class="plan-item-row ${curKeys.has(key)?'checked':''}"><input type="checkbox" class="override-cb" data-examid="${i.examId}" data-bookidx="${i.bookIdx}" data-type="${i.type}" ${curKeys.has(key)?'checked':''} onchange="this.closest('label').classList.toggle('checked',this.checked)"><span class="plan-item-icon">${icon}</span><span>${i.label}</span></label>`;
      }).join('')}
    </div>`;
  }).join('');
  wrap.innerHTML=`<div style="background:var(--cream);border-radius:8px;padding:12px;margin-top:8px">${html}<div style="display:flex;gap:8px;margin-top:10px"><button class="btn-primary" style="flex:1" onclick="saveOverride('${dateStr}')">Applica</button><button class="btn-ghost" onclick="clearDayOverride('${dateStr}')">Ripristina piano</button></div></div>`;
  wrap.classList.remove('hidden');
};
window.saveOverride=function(dateStr){
  const items=[...document.querySelectorAll('.override-cb:checked')].map(cb=>({examId:cb.dataset.examid,bookIdx:+cb.dataset.bookidx,type:cb.dataset.type}));
  if(!state.calendar[dateStr])state.calendar[dateStr]={};
  state.calendar[dateStr].overrideItems=items;
  save();renderDayPanel(dateStr);renderCalendar();
};
window.clearDayOverride=function(dateStr){
  if(state.calendar[dateStr])delete state.calendar[dateStr].overrideItems;
  save();renderDayPanel(dateStr);renderCalendar();
};
window.toggleDayExclude=function(dateStr){
  if(!state.calendar[dateStr])state.calendar[dateStr]={};
  const plan=[...state.studyPlans].reverse().find(p=>(p.days||[]).includes(dateStr));
  if(plan){
    plan.days=plan.days.filter(d=>d!==dateStr);
    save();renderDayPanel(dateStr);renderCalendar();renderDashboard();
  } else {
    state.calendar[dateStr].isStudyDay=false;
    save();renderDayPanel(dateStr);renderCalendar();renderDashboard();
  }
};
window.forceIncludeDay=function(dateStr){
  if(!state.calendar[dateStr])state.calendar[dateStr]={};
  state.calendar[dateStr].isStudyDay=true;
  save();renderDayPanel(dateStr);renderCalendar();renderDashboard();
};
window.saveDayPanel=function(dateStr){
  if(!state.calendar[dateStr])state.calendar[dateStr]={};
  const logs=[...document.querySelectorAll('.day-book-entry')].map(el=>({examId:el.dataset.examid,bookIdx:+el.dataset.bookidx,type:el.dataset.type,pages:+el.querySelector('.day-pages-input')?.value||0})).filter(l=>l.examId);
  state.calendar[dateStr].logs=logs;
  save();renderCalendar();renderDashboard();
  showSync('Progresso salvato 🎉','success');setTimeout(hideSync,2000);
};

// ===== PROJECTS =====
document.getElementById('btnAddProject').addEventListener('click',()=>openProjectModal(null));
window.openProjectModal=function(projectId){
  state.editingProjectId=projectId;
  const p=projectId?state.projects.find(x=>x.id===projectId):null;
  document.getElementById('projectModalTitle').textContent=p?'Modifica Progetto':'Nuovo Progetto';
  document.getElementById('projectName').value=p?p.name:'';
  document.getElementById('projectType').value=p?p.type:'tesi';
  renderColorPicker('projectColorPicker',p?p.color:PRESET_COLORS[3],PRESET_COLORS);
  if(p)document.getElementById('projectCustomColor').value=p.color;
  ['readChapTotal','readChapDone','readPagesTotal','readPagesDone','writeChapTotal','writeChapDone','writePagesTotal','writePagesDone'].forEach(id=>document.getElementById(id).value=p?(p[id]||''):'');
  const tc=document.getElementById('projectTasks');
  renderProjectTaskEntries(tc,p?(p.tasks||[]):[]);
  document.getElementById('addProjectTaskBtn').onclick=()=>renderProjectTaskEntries(tc,[...collectProjectTasks(),{label:'',done:false}]);
  openModal('projectModal');
};
function renderProjectTaskEntries(container,tasks){container.innerHTML=tasks.map(t=>`<div class="project-task-entry"><input type="checkbox" ${t.done?'checked':''}><input type="text" value="${t.label||''}" placeholder="Task..."><button class="btn-icon" onclick="this.closest('.project-task-entry').remove()">✕</button></div>`).join('');}
function collectProjectTasks(){return[...document.getElementById('projectTasks').querySelectorAll('.project-task-entry')].map(e=>({done:e.querySelector('input[type=checkbox]').checked,label:e.querySelector('input[type=text]').value}));}
document.getElementById('saveProjectBtn').addEventListener('click',()=>{
  const name=document.getElementById('projectName').value.trim();
  if(!name){alert('Inserisci il nome!');return;}
  const p={id:state.editingProjectId||uid(),name,type:document.getElementById('projectType').value,color:document.getElementById('projectColorPicker').dataset.selected||PRESET_COLORS[3],tasks:collectProjectTasks()};
  ['readChapTotal','readChapDone','readPagesTotal','readPagesDone','writeChapTotal','writeChapDone','writePagesTotal','writePagesDone'].forEach(id=>p[id]=+document.getElementById(id).value||0);
  if(state.editingProjectId){const i=state.projects.findIndex(x=>x.id===state.editingProjectId);if(i>=0)state.projects[i]=p;}else state.projects.push(p);
  save();closeModal('projectModal');renderProjects();
});
function renderProjects(){
  const el=document.getElementById('projectsGrid');
  if(!state.projects.length){el.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">📝</div><p>Nessun progetto ancora.</p></div>`;return;}
  const tl={tesi:'Tesi',elaborato:'Elaborato',ricerca:'Ricerca',altro:'Progetto'};
  el.innerHTML=state.projects.map(p=>{
    const doneTasks=(p.tasks||[]).filter(t=>t.done).length;
    const statSec=(title,cT,cD,pgT,pgD)=>(!cT&&!pgT)?'':(`<div class="project-section"><div class="project-section-title">${title}</div><div class="project-stats">${cT?`<div class="stat-chip"><div class="stat-chip-label">Capitoli</div><div class="stat-chip-val">${cD}/${cT}</div></div>`:''} ${pgT?`<div class="stat-chip"><div class="stat-chip-label">Pagine</div><div class="stat-chip-val">${pgD}/${pgT}</div></div>`:''}</div>${(cT||pgT)?`<div class="progress-bar-bg" style="margin-top:8px"><div class="progress-bar-fill" style="width:${Math.round(((cD+pgD)/((cT||0)+(pgT||0)))*100)||0}%;background:${p.color}"></div></div>`:''}</div>`);
    const tasksHtml=(p.tasks||[]).length?`<div class="project-section"><div class="project-section-title">🗂️ TASK (${doneTasks}/${p.tasks.length})</div><div>${p.tasks.map((t,i)=>`<div class="task-item ${t.done?'done':''}"><input type="checkbox" ${t.done?'checked':''} onchange="toggleProjectTask('${p.id}',${i},this.checked)"><span>${t.label}</span></div>`).join('')}</div></div>`:'';
    return `<div class="project-card"><div class="project-card-header"><span class="project-card-title">${p.name}</span><div style="display:flex;gap:6px;align-items:center"><span class="project-type-badge" style="background:${p.color}">${tl[p.type]||p.type}</span><button class="btn-icon" onclick="openProjectModal('${p.id}')">✏️</button><button class="btn-icon" onclick="deleteProject('${p.id}')">🗑️</button></div></div><div class="project-card-body">${statSec('📖 DA LEGGERE',p.readChapTotal,p.readChapDone,p.readPagesTotal,p.readPagesDone)}${statSec('✍️ DA SCRIVERE',p.writeChapTotal,p.writeChapDone,p.writePagesTotal,p.writePagesDone)}${tasksHtml}</div></div>`;
  }).join('');
}
window.toggleProjectTask=function(pid,i,done){const p=state.projects.find(x=>x.id===pid);if(p?.tasks?.[i]){p.tasks[i].done=done;save();renderProjects();}};
window.deleteProject=function(id){if(!confirm('Eliminare?'))return;state.projects=state.projects.filter(x=>x.id!==id);save();renderProjects();};

// ===== MODALS =====
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>closeModal(btn.dataset.close)));
document.querySelectorAll('.modal-overlay').forEach(ov=>ov.addEventListener('click',e=>{if(e.target===ov)ov.classList.remove('open');}));

// ===== INIT =====
document.getElementById('sidebar').style.display='none';
document.getElementById('main').style.display='none';