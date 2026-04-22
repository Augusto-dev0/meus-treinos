/* ═══════════════════════════════════════════════════════════════════════════
   MEUS TREINOS — script.js  (v3)
   Features: biblioteca do usuário, treinos por dia, modo treino ativo,
             histórico, busca, drag & drop, confetti, PWA offline
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── PWA: Service Worker ─────────────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

/* ── Constants ───────────────────────────────────────────────────────────── */
const DAYS_SHORT = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
const DAYS_FULL  = ['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
const WEEKDAY    = (new Date().getDay() + 6) % 7;
const MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

/* ── Storage keys ────────────────────────────────────────────────────────── */
const K_LIB      = 'mt-library-v1';
const K_WORKOUTS = 'mt-workouts-v1';
const K_HISTORY  = 'mt-history-v1';
const K_CHECKLIST_DISMISSED = 'mt-checklist-dismissed';

function load(key) { try { return JSON.parse(localStorage.getItem(key)) || (key===K_WORKOUTS?{}:[]); } catch { return key===K_WORKOUTS?{}:[]; } }
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

/* ── App State ───────────────────────────────────────────────────────────── */
let library  = load(K_LIB);     // [{id,name,muscle,icon,color,sets,tip}]
let workouts = load(K_WORKOUTS); // {0:[{name,exIds:[]}], ...}
let history  = load(K_HISTORY);  // [{id,date,wkName,exIds,duration,dayIndex}]
let selDay   = WEEKDAY;
let libFilter = 'Todos';

/* Workout builder */
let wkDay=null, wkEditIdx=null, wkSel=[], wkFilter='Todos';
/* Exercise editor */
let exEditId = null;
/* Drag & drop */
let dragSrcIdx = null;

/* Timer */
let tTotal=60, tRemain=60, tRunning=false, tInterval=null;
const PRESETS=[30,60,90,120];

/* Active workout */
let activeWk   = null;   // {name, exIds, dayIndex}
let activeCur  = 0;      // current exercise index
let activeStart= null;   // Date.now()
let restInterval=null;
let restRemain  =0;

/* ═══════════════════════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════════════════════ */
(function init() {
  const dn = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
  document.getElementById('today-label').textContent = dn[new Date().getDay()];

  document.querySelectorAll('.tab, .bnav-btn').forEach(b =>
    b.addEventListener('click', () => switchTab(b.dataset.tab))
  );

  renderStats();
  renderChecklist();
  renderDayStrip();
  renderDayContent();
  renderHistory();
  renderLibrary();
  renderTimerPresets();
  updateTimerUI();
})();

/* ═══════════════════════════════════════════════════════════════════════════
   CHECKLIST DE PRIMEIROS PASSOS
   ═══════════════════════════════════════════════════════════════════════════ */
function renderChecklist() {
  const el = document.getElementById('checklist-card');
  if (!el) return;

  // Hide forever if dismissed
  if (localStorage.getItem(K_CHECKLIST_DISMISSED)) { el.innerHTML = ''; return; }

  const s1 = library.length > 0;                                          // exercício adicionado
  const s2 = Object.values(workouts).some(w => w && w.length);            // treino criado
  const s3 = history.length > 0;                                          // treino concluído
  const done = [s1, s2, s3].filter(Boolean).length;

  // All done → auto-dismiss after brief celebration
  if (done === 3) {
    el.innerHTML = `
      <div class="checklist-card" style="border-color:rgba(200,240,96,.5);text-align:center;padding:18px">
        <div style="font-size:28px;margin-bottom:6px">🎉</div>
        <div class="checklist-title">Configuração concluída!</div>
        <div class="checklist-sub" style="margin-top:4px">Você já sabe usar o app. Bons treinos!</div>
      </div>`;
    setTimeout(() => {
      localStorage.setItem(K_CHECKLIST_DISMISSED, '1');
      el.style.transition = 'opacity .5s, max-height .5s';
      el.style.opacity = '0';
      el.style.maxHeight = '0';
      el.style.overflow = 'hidden';
      setTimeout(() => { el.innerHTML = ''; el.style = ''; }, 520);
    }, 2800);
    return;
  }

  const steps = [
    {
      done: s1,
      label: 'Adicionar um exercício',
      hint:  'Vá em Biblioteca → + Exercício',
      action: `onclick="dismissAndGo('biblioteca')"`,
    },
    {
      done: s2,
      label: 'Criar um treino para algum dia',
      hint:  'Selecione um dia e clique em "Criar treino"',
      action: s1 ? `onclick="checklistFocusDay()"` : `onclick="dismissAndGo('biblioteca')"`,
    },
    {
      done: s3,
      label: 'Iniciar seu primeiro treino',
      hint:  'Clique no botão ▶ no card do treino',
      action: s2 ? `` : `onclick="checklistFocusDay()"`,
    },
  ];

  const pct = Math.round((done / 3) * 100);

  el.innerHTML = `
    <div class="checklist-card">
      <div class="checklist-header">
        <div>
          <div class="checklist-title">Primeiros passos</div>
          <div class="checklist-sub">${done} de 3 concluídos — siga a ordem abaixo</div>
        </div>
        <button class="checklist-dismiss" onclick="dismissChecklist()">Dispensar</button>
      </div>
      <div class="checklist-progress">
        <div class="checklist-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="checklist-steps">
        ${steps.map((s, i) => `
          <div class="checklist-step ${s.done ? 'done' : ''}" ${!s.done ? s.action : ''}>
            <div class="step-check">${s.done ? '✓' : (i + 1)}</div>
            <div class="step-body">
              <div class="step-label">${s.label}</div>
              <div class="step-hint">${s.hint}</div>
            </div>
            ${!s.done ? '<span class="step-arrow">→</span>' : ''}
          </div>`).join('')}
      </div>
    </div>`;
}

function dismissChecklist() {
  localStorage.setItem(K_CHECKLIST_DISMISSED, '1');
  const el = document.getElementById('checklist-card');
  el.style.transition = 'opacity .3s, max-height .4s, margin .4s';
  el.style.opacity = '0';
  el.style.maxHeight = '0';
  el.style.overflow = 'hidden';
  el.style.marginBottom = '0';
  setTimeout(() => { el.innerHTML = ''; el.style = ''; }, 420);
}

function dismissAndGo(tab) {
  switchTab(tab);
}

function checklistFocusDay() {
  // Scroll to day strip and briefly highlight the selected day
  document.getElementById('day-strip').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ═══════════════════════════════════════════════════════════════════════════
   TABS
   ═══════════════════════════════════════════════════════════════════════════ */
function switchTab(tab) {
  ['treinos','historico','biblioteca','timer'].forEach(t => {
    document.getElementById('sec-'+t).classList.toggle('active', t===tab);
  });
  document.querySelectorAll('.tab, .bnav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab===tab)
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STATS
   ═══════════════════════════════════════════════════════════════════════════ */
function renderStats() {
  const days = Object.values(workouts).filter(w=>w&&w.length).length;
  document.getElementById('header-stats').innerHTML = `
    <div class="stat-pill"><span class="stat-num">${library.length}</span><span class="stat-lbl">Exerc.</span></div>
    <div class="stat-pill"><span class="stat-num">${days}</span><span class="stat-lbl">Dias</span></div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   DAY STRIP
   ═══════════════════════════════════════════════════════════════════════════ */
function renderDayStrip() {
  document.getElementById('day-strip').innerHTML = DAYS_SHORT.map((d,i) => `
    <div class="day-cell ${workouts[i]&&workouts[i].length?'has-workout':''} ${i===selDay?'selected':''}" onclick="selectDay(${i})">
      <span class="day-letter">${d}</span>
      <div class="day-dot"></div>
      ${i===WEEKDAY?'<span class="day-today-dot">●</span>':'<span style="height:10px;display:block"></span>'}
    </div>`).join('');
}

function selectDay(i) { selDay=i; renderDayStrip(); renderDayContent(); }

/* ═══════════════════════════════════════════════════════════════════════════
   DAY CONTENT
   ═══════════════════════════════════════════════════════════════════════════ */
function renderDayContent() {
  const c  = document.getElementById('day-content');
  const ws = workouts[selDay] || [];

  const hdr = `<div class="day-header">
    <div class="day-header-name">${DAYS_FULL[selDay]}${selDay===WEEKDAY?' <span>(hoje)</span>':''}</div>
  </div>`;

  if (!ws.length) {
    c.innerHTML = hdr + `
      <div class="day-empty">Nenhum treino em <strong>${DAYS_FULL[selDay]}</strong>.<br>
        <span style="font-size:12px">Dia de descanso, ou crie um treino abaixo.</span></div>
      <div class="day-actions">
        <button class="btn-ghost" onclick="openWorkoutModal(${selDay},null)">✏️ Criar treino</button>
      </div>`;
    return;
  }

  const cards = ws.map((w,wi) => {
    const valid = w.exIds.filter(id=>library.find(e=>e.id===id));
    const rows  = w.exIds.map(id=>{
      const ex=library.find(e=>e.id===id); if(!ex) return '';
      return `<div class="ex-row">
        <div class="ex-ico" style="background:${ex.color}22">${ex.icon||'💪'}</div>
        <div class="ex-meta">
          <div class="ex-title">${ex.name}</div>
          ${ex.tip?`<div class="ex-sub">${ex.tip}</div>`:''}
        </div>
        <span class="ex-muscle-tag" style="color:${ex.color};border:1px solid ${ex.color}33">${ex.muscle}</span>
        ${ex.sets?`<span class="ex-sets-tag" style="color:var(--muted)">${ex.sets}</span>`:''}
      </div>`;
    }).join('');

    return `<div class="workout-card">
      <div class="wcard-header">
        <div class="wcard-left">
          <span class="wcard-name">${w.name}</span>
          <span class="wcard-badge">${valid.length} exercício${valid.length!==1?'s':''}</span>
        </div>
        <div class="wcard-actions">
          <button class="icon-btn play" onclick="startActiveWorkout(${selDay},${wi})" title="Iniciar treino">▶</button>
          <button class="icon-btn edit" onclick="openWorkoutModal(${selDay},${wi})" title="Editar">✏️</button>
          <button class="icon-btn del"  onclick="confirmDeleteWorkout(${selDay},${wi})" title="Remover">✕</button>
        </div>
      </div>
      ${rows||`<div style="padding:12px 14px;font-size:12px;color:var(--muted)">Exercícios removidos da biblioteca.</div>`}
    </div>`;
  }).join('');

  c.innerHTML = hdr + cards + `
    <div class="day-actions">
      <button class="btn-ghost" onclick="openWorkoutModal(${selDay},null)">+ Novo treino</button>
    </div>`;
}

function confirmDeleteWorkout(day,wi) {
  showConfirm('Remover treino', `Remover o treino "<strong>${workouts[day][wi].name}</strong>"?`, () => {
    workouts[day].splice(wi,1);
    if(!workouts[day].length) delete workouts[day];
    save(K_WORKOUTS,workouts);
    renderDayStrip(); renderDayContent(); renderStats();
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   WORKOUT MODAL  (com drag & drop)
   ═══════════════════════════════════════════════════════════════════════════ */
function openWorkoutModal(day, wi) {
  wkDay=day; wkEditIdx=wi; wkFilter='Todos';
  if(wi!==null && workouts[day]?.[wi]) {
    const w=workouts[day][wi];
    document.getElementById('wk-name').value=w.name;
    wkSel=[...w.exIds];
  } else {
    document.getElementById('wk-name').value='';
    wkSel=[];
  }
  document.getElementById('wk-modal-title').textContent = wi!==null ? 'Editar Treino' : `Treino de ${DAYS_FULL[day]}`;
  renderWkFilters(); renderWkPicker(); renderWkSelected();
  document.getElementById('overlay-workout').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeWorkoutModal() {
  document.getElementById('overlay-workout').classList.remove('open');
  document.body.style.overflow='';
}

function renderWkFilters() {
  const muscles=['Todos',...new Set(library.map(e=>e.muscle))];
  document.getElementById('wk-filter-row').innerHTML=muscles.map(m=>
    `<button class="filter-btn ${m===wkFilter?'active':''}" onclick="setWkFilter('${m}')">${m}</button>`
  ).join('');
}
function setWkFilter(m){wkFilter=m;renderWkFilters();renderWkPicker();}

function renderWkPicker() {
  const list=document.getElementById('wk-ex-list');
  const empty=document.getElementById('wk-lib-empty');
  if(!library.length){list.style.display='none';empty.style.display='block';return;}
  list.style.display='flex';empty.style.display='none';
  const filtered=wkFilter==='Todos'?library:library.filter(e=>e.muscle===wkFilter);
  list.innerHTML=filtered.map(ex=>{
    const chk=wkSel.includes(ex.id);
    return `<div class="pick-item ${chk?'checked':''}" onclick="toggleWkEx('${ex.id}')">
      <span class="pick-ico">${ex.icon||'💪'}</span>
      <div class="pick-info"><div class="pick-name">${ex.name}</div><div class="pick-sub">${ex.muscle}${ex.sets?' · '+ex.sets:''}</div></div>
      <div class="pick-check">${chk?'✓':'+'}</div>
    </div>`;
  }).join('');
}

function toggleWkEx(id){
  const p=wkSel.indexOf(id);
  p===-1?wkSel.push(id):wkSel.splice(p,1);
  renderWkPicker(); renderWkSelected();
}

function renderWkSelected() {
  const wrap=document.getElementById('wk-selected-list');
  document.getElementById('wk-count').textContent=wkSel.length;
  if(!wkSel.length){wrap.innerHTML='<div class="wk-empty-sel">Nenhum exercício selecionado.</div>';return;}
  wrap.innerHTML=wkSel.map((id,pos)=>{
    const ex=library.find(e=>e.id===id); if(!ex) return '';
    return `<div class="sel-item" draggable="true"
        ondragstart="dragStart(${pos})" ondragover="dragOver(event,${pos})"
        ondrop="dragDrop(event,${pos})" ondragend="dragEnd()"
        data-pos="${pos}">
      <span class="drag-handle">⠿</span>
      <span>${ex.icon||'💪'}</span>
      <span class="sel-name">${ex.name}</span>
      ${ex.sets?`<span class="sel-sets">${ex.sets}</span>`:''}
      <button class="sel-remove" onclick="removeWkSel(${pos})">✕</button>
    </div>`;
  }).join('');
}

function removeWkSel(pos){wkSel.splice(pos,1);renderWkPicker();renderWkSelected();}

/* Drag & drop — workout builder */
function dragStart(i){dragSrcIdx=i;}
function dragOver(e,i){
  e.preventDefault();
  document.querySelectorAll('.sel-item').forEach((el,idx)=>el.classList.toggle('drag-over',idx===i));
}
function dragDrop(e,i){
  e.preventDefault();
  if(dragSrcIdx===null||dragSrcIdx===i) return;
  const [moved]=wkSel.splice(dragSrcIdx,1);
  wkSel.splice(i,0,moved);
  renderWkSelected(); renderWkPicker();
}
function dragEnd(){
  dragSrcIdx=null;
  document.querySelectorAll('.sel-item').forEach(el=>el.classList.remove('drag-over','dragging'));
}

function saveWorkout() {
  const name=document.getElementById('wk-name').value.trim();
  if(!name){
    const inp=document.getElementById('wk-name');
    inp.style.borderColor='var(--red)'; inp.focus();
    setTimeout(()=>inp.style.borderColor='',1500); return;
  }
  if(!wkSel.length){alert('Selecione pelo menos um exercício.');return;}
  const obj={name,exIds:[...wkSel]};
  if(!workouts[wkDay]) workouts[wkDay]=[];
  wkEditIdx!==null?workouts[wkDay][wkEditIdx]=obj:workouts[wkDay].push(obj);
  save(K_WORKOUTS,workouts);
  closeWorkoutModal();
  renderDayStrip(); renderDayContent(); renderStats(); renderChecklist();
}

/* ═══════════════════════════════════════════════════════════════════════════
   ACTIVE WORKOUT MODE
   ═══════════════════════════════════════════════════════════════════════════ */
function startActiveWorkout(day, wi) {
  const w = workouts[day][wi];
  const validIds = w.exIds.filter(id=>library.find(e=>e.id===id));
  if(!validIds.length){alert('Nenhum exercício válido neste treino.');return;}
  activeWk    = {name:w.name, exIds:validIds, dayIndex:day, workoutName:w.name};
  activeCur   = 0;
  activeStart = Date.now();
  stopRestTimer();

  document.getElementById('active-screen').classList.add('open');
  document.getElementById('active-finish').style.display='none';
  document.getElementById('active-ex-view').style.display='flex';
  document.body.style.overflow='hidden';
  renderActiveExercise();
}

function renderActiveExercise() {
  const ids  = activeWk.exIds;
  const ex   = library.find(e=>e.id===ids[activeCur]);
  if(!ex) return;

  document.getElementById('active-wk-name').textContent      = activeWk.name;
  document.getElementById('active-progress-label').textContent= `${activeCur+1} / ${ids.length}`;
  document.getElementById('active-progress-fill').style.width = `${((activeCur+1)/ids.length)*100}%`;

  // animate card
  const card=document.getElementById('active-ex-card');
  card.style.animation='none'; card.offsetHeight; card.style.animation='';

  document.getElementById('active-ex-icon').textContent   = ex.icon||'💪';
  document.getElementById('active-ex-name').textContent   = ex.name;
  document.getElementById('active-ex-sets').textContent   = ex.sets||'';
  document.getElementById('active-ex-tip').textContent    = ex.tip||'';
  document.getElementById('active-ex-muscle').textContent = ex.muscle;
  document.getElementById('active-ex-muscle').style.color = ex.color;

  document.getElementById('active-prev').disabled = activeCur===0;
  document.getElementById('active-next').textContent =
    activeCur===ids.length-1 ? '🏁 Concluir' : 'Próximo →';
}

function activeNav(dir) {
  stopRestTimer();
  if(dir===1 && activeCur===activeWk.exIds.length-1) {
    finishWorkout(); return;
  }
  activeCur = Math.max(0, Math.min(activeWk.exIds.length-1, activeCur+dir));
  renderActiveExercise();
}

function finishWorkout() {
  stopRestTimer();
  const duration = Math.round((Date.now()-activeStart)/60000);

  // Save to history
  const entry = {
    id:       Date.now().toString(36),
    date:     new Date().toISOString(),
    wkName:   activeWk.name,
    exIds:    [...activeWk.exIds],
    duration,
    dayIndex: activeWk.dayIndex,
  };
  history.unshift(entry);
  if(history.length>100) history.pop();
  save(K_HISTORY, history);

  // Show finish screen
  document.getElementById('active-ex-view').style.display='none';
  document.getElementById('active-finish').style.display='flex';
  document.getElementById('active-progress-fill').style.width='100%';

  const subs=['Mandou muito bem!','Continue assim!','Cada treino conta!','Você é incrível!'];
  document.getElementById('finish-sub').textContent = subs[Math.floor(Math.random()*subs.length)];
  document.getElementById('finish-stats').innerHTML = `
    <div class="finish-stat"><span class="finish-stat-num">${activeWk.exIds.length}</span><span class="finish-stat-lbl">Exercícios</span></div>
    <div class="finish-stat"><span class="finish-stat-num">${duration||1}</span><span class="finish-stat-lbl">Minutos</span></div>`;

  spawnConfetti();
  renderHistory();
}

function closeActiveWorkout() {
  stopRestTimer();
  document.getElementById('active-screen').classList.remove('open');
  document.body.style.overflow='';
  renderChecklist();
}

function confirmStopWorkout() {
  showConfirm('Sair do treino','Deseja sair? O progresso não será salvo no histórico.',()=>{
    stopRestTimer();
    document.getElementById('active-screen').classList.remove('open');
    document.body.style.overflow='';
  });
}

/* Rest timer inside active workout */
function startRestTimer(secs) {
  stopRestTimer();
  restRemain = secs;
  document.getElementById('active-timer-mini').style.display='flex';
  updateRestUI();
  restInterval = setInterval(()=>{
    restRemain--;
    updateRestUI();
    if(restRemain<=0) stopRestTimer();
  },1000);
}
function stopRestTimer() {
  clearInterval(restInterval);
  document.getElementById('active-timer-mini').style.display='none';
}
function updateRestUI() {
  const m=Math.floor(restRemain/60), s=restRemain%60;
  document.getElementById('active-timer-val').textContent =
    String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}

/* Drag & drop inside active workout — touch friendly list reorder not needed
   because active mode doesn't reorder; reorder is in the builder. */

/* ═══════════════════════════════════════════════════════════════════════════
   CONFETTI
   ═══════════════════════════════════════════════════════════════════════════ */
function spawnConfetti() {
  const wrap=document.getElementById('confetti-wrap');
  wrap.innerHTML='';
  const colors=['#c8f060','#3ecfb0','#ff5f5f','#facc15','#60a5fa','#f472b6'];
  for(let i=0;i<60;i++){
    const el=document.createElement('div');
    el.className='confetti-piece';
    el.style.cssText=`
      left:${Math.random()*100}%;
      background:${colors[i%colors.length]};
      animation-delay:${Math.random()*1.2}s;
      animation-duration:${1.8+Math.random()*1.5}s;
      transform:rotate(${Math.random()*360}deg);
      border-radius:${Math.random()>0.5?'50%':'2px'};
    `;
    wrap.appendChild(el);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   HISTORY
   ═══════════════════════════════════════════════════════════════════════════ */
function renderHistory() {
  const list  = document.getElementById('hist-list');
  const empty = document.getElementById('hist-empty');

  // Streak: consecutive days with at least one workout
  const streak = calcStreak();
  document.getElementById('streak-badge').innerHTML =
    `<span class="streak-num">${streak}</span><span class="streak-lbl">🔥 sequência</span>`;

  if(!history.length){ list.innerHTML=''; empty.style.display='flex'; return; }
  empty.style.display='none';

  list.innerHTML = history.slice(0,50).map(h=>{
    const d = new Date(h.date);
    const exNames = h.exIds
      .map(id=>library.find(e=>e.id===id)?.name)
      .filter(Boolean).slice(0,4);
    const more = h.exIds.length - exNames.length;
    return `<div class="hist-entry">
      <div class="hist-date-col">
        <span class="hist-day-num">${d.getDate()}</span>
        <span class="hist-month">${MONTHS_SHORT[d.getMonth()]}</span>
      </div>
      <div class="hist-divider"></div>
      <div class="hist-info">
        <div class="hist-wk-name">${h.wkName}</div>
        <div class="hist-day-name">${DAYS_FULL[h.dayIndex]}</div>
        <div class="hist-ex-pills">
          ${exNames.map(n=>`<span class="hist-pill">${n}</span>`).join('')}
          ${more>0?`<span class="hist-pill">+${more}</span>`:''}
        </div>
        ${h.duration?`<div class="hist-duration">⏱ ${h.duration} min</div>`:''}
      </div>
      <button class="hist-delete-btn" onclick="confirmDeleteHistory('${h.id}')" title="Apagar este registro">✕</button>
    </div>`;
  }).join('');
}

function confirmDeleteHistory(id) {
  const h = history.find(e => e.id === id);
  if (!h) return;
  const d = new Date(h.date);
  const label = `${h.wkName} — ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  showConfirm('Apagar registro', `Apagar "<strong>${label}</strong>" do histórico?<br><span style="font-size:11px;color:var(--muted)">Isso pode afetar a contagem da sequência.</span>`, () => {
    history = history.filter(e => e.id !== id);
    save(K_HISTORY, history);
    renderHistory();
  });
}

function calcStreak() {
  if(!history.length) return 0;
  const today = new Date(); today.setHours(0,0,0,0);
  const days  = [...new Set(history.map(h=>{
    const d=new Date(h.date); d.setHours(0,0,0,0); return d.getTime();
  }))].sort((a,b)=>b-a);
  let streak=0, cur=today.getTime();
  for(const d of days){
    if(d===cur){ streak++; cur-=86400000; }
    else if(d===cur+86400000){ streak++; cur=d-86400000; } // yesterday start
    else break;
  }
  return streak;
}

/* ═══════════════════════════════════════════════════════════════════════════
   LIBRARY
   ═══════════════════════════════════════════════════════════════════════════ */
function renderLibrary() {
  const query    = (document.getElementById('lib-search')?.value||'').toLowerCase().trim();
  const muscles  = ['Todos',...new Set(library.map(e=>e.muscle))];
  const filterEl = document.getElementById('lib-filter-row');
  filterEl.innerHTML = library.length
    ? muscles.map(m=>`<button class="filter-btn ${m===libFilter?'active':''}" onclick="setLibFilter('${m}')">${m}</button>`).join('')
    : '';

  let filtered = libFilter==='Todos' ? library : library.filter(e=>e.muscle===libFilter);
  if(query) filtered = filtered.filter(e=>e.name.toLowerCase().includes(query)||e.muscle.toLowerCase().includes(query));

  const grid  = document.getElementById('lib-grid');
  const empty = document.getElementById('lib-empty');

  if(!library.length){ grid.style.display='none'; empty.style.display='flex'; return; }
  grid.style.display='grid'; empty.style.display='none';

  grid.innerHTML = filtered.length ? filtered.map(ex=>`
    <div class="lib-card">
      <div class="lib-card-top">
        <span class="lib-card-icon">${ex.icon||'💪'}</span>
        <div class="lib-card-actions">
          <button class="icon-btn edit" onclick="openExModal('${ex.id}')" title="Editar">✏️</button>
          <button class="icon-btn del"  onclick="confirmDeleteEx('${ex.id}')" title="Remover">✕</button>
        </div>
      </div>
      <div class="lib-card-name">${ex.name}</div>
      <div class="lib-card-muscle"><span class="muscle-dot" style="background:${ex.color}"></span>${ex.muscle}</div>
      ${ex.sets?`<div class="lib-card-sets">${ex.sets}</div>`:''}
      ${ex.tip?`<div class="lib-card-tip">${ex.tip}</div>`:''}
    </div>`).join('')
  : `<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--muted);font-size:13px">Nenhum exercício encontrado.</div>`;
}

function setLibFilter(m){libFilter=m;renderLibrary();}

function confirmDeleteEx(id) {
  const ex=library.find(e=>e.id===id);
  showConfirm('Remover exercício',`Remover "<strong>${ex?.name}</strong>" da biblioteca?`,()=>{
    library=library.filter(e=>e.id!==id);
    save(K_LIB,library);
    // clean from workouts
    Object.keys(workouts).forEach(day=>{
      workouts[day]=workouts[day].map(w=>({...w,exIds:w.exIds.filter(eid=>eid!==id)}));
    });
    save(K_WORKOUTS,workouts);
    renderLibrary(); renderStats();
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXERCISE MODAL
   ═══════════════════════════════════════════════════════════════════════════ */
function openExModal(id) {
  exEditId=id;
  document.getElementById('ex-modal-title').textContent=id?'Editar Exercício':'Novo Exercício';
  const muscles=[...new Set(library.map(e=>e.muscle))];
  document.getElementById('muscle-list').innerHTML=muscles.map(m=>`<option value="${m}">`).join('');
  if(id){
    const ex=library.find(e=>e.id===id);
    if(ex){
      document.getElementById('ex-name').value  =ex.name;
      document.getElementById('ex-muscle').value=ex.muscle;
      document.getElementById('ex-icon').value  =ex.icon||'';
      document.getElementById('ex-sets').value  =ex.sets||'';
      document.getElementById('ex-color').value =ex.color||'#c8f060';
      document.getElementById('ex-tip').value   =ex.tip||'';
    }
  } else {
    ['ex-name','ex-muscle','ex-icon','ex-sets','ex-tip'].forEach(i=>document.getElementById(i).value='');
    document.getElementById('ex-color').value='#c8f060';
  }
  document.getElementById('overlay-ex').classList.add('open');
  document.body.style.overflow='hidden';
  setTimeout(()=>document.getElementById('ex-name').focus(),80);
}
function closeExModal(){
  document.getElementById('overlay-ex').classList.remove('open');
  document.body.style.overflow='';
}
function saveExercise(){
  const name  =document.getElementById('ex-name').value.trim();
  const muscle=document.getElementById('ex-muscle').value.trim();
  if(!name||!muscle){
    ['ex-name','ex-muscle'].forEach(id=>{
      const el=document.getElementById(id);
      if(!el.value.trim()){el.style.borderColor='var(--red)';el.focus();}
      setTimeout(()=>el.style.borderColor='',1500);
    });
    return;
  }
  const ex={
    id:    exEditId||Date.now().toString(36)+Math.random().toString(36).slice(2,5),
    name, muscle,
    icon:  document.getElementById('ex-icon').value.trim()||'💪',
    sets:  document.getElementById('ex-sets').value.trim()||'',
    color: document.getElementById('ex-color').value||'#c8f060',
    tip:   document.getElementById('ex-tip').value.trim()||'',
  };
  if(exEditId){const i=library.findIndex(e=>e.id===exEditId);if(i!==-1)library[i]=ex;}
  else library.push(ex);
  save(K_LIB,library);
  closeExModal();
  renderLibrary(); renderStats(); renderDayContent(); renderChecklist();
}

/* ═══════════════════════════════════════════════════════════════════════════
   TIMER
   ═══════════════════════════════════════════════════════════════════════════ */
function renderTimerPresets(){
  document.getElementById('preset-row').innerHTML=PRESETS.map(s=>`
    <div class="preset-btn ${tTotal===s&&tRemain===s?'active':''}" onclick="setPreset(${s})">
      ${s<60?s+'s':s===60?'1min':s===90?'1m30':'2min'}
    </div>`).join('');
}
function setPreset(s){
  clearInterval(tInterval);tTotal=s;tRemain=s;tRunning=false;
  document.getElementById('start-btn').textContent='Iniciar';
  document.getElementById('timer-status').textContent='PRONTO';
  updateTimerUI();renderTimerPresets();
}
function toggleTimer(){
  if(tRunning){
    clearInterval(tInterval);tRunning=false;
    document.getElementById('start-btn').textContent='Retomar';
    document.getElementById('timer-status').textContent='PAUSADO';
  } else {
    if(tRemain<=0) tRemain=tTotal;
    tRunning=true;
    document.getElementById('start-btn').textContent='Pausar';
    document.getElementById('timer-status').textContent='CONTANDO';
    tInterval=setInterval(()=>{
      tRemain--;updateTimerUI();
      if(tRemain<=0){
        clearInterval(tInterval);tRunning=false;
        document.getElementById('start-btn').textContent='Iniciar';
        document.getElementById('timer-status').textContent='PRONTO!';
        document.getElementById('ring').style.stroke='var(--red)';
        setTimeout(()=>document.getElementById('ring').style.stroke='var(--accent)',1400);
      }
    },1000);
  }
}
function resetTimer(){
  clearInterval(tInterval);tRunning=false;tRemain=tTotal;
  document.getElementById('start-btn').textContent='Iniciar';
  document.getElementById('timer-status').textContent='PRONTO';
  updateTimerUI();
}
function addTimerMinute(){tTotal+=60;tRemain+=60;updateTimerUI();}
function updateTimerUI(){
  const m=Math.floor(tRemain/60),s=tRemain%60;
  document.getElementById('timer-display').textContent=
    String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  const pct=tTotal>0?tRemain/tTotal:1;
  document.getElementById('ring').setAttribute('stroke-dashoffset',534*(1-pct));
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIRM DIALOG
   ═══════════════════════════════════════════════════════════════════════════ */
let confirmCallback=null;
function showConfirm(title,msg,cb){
  confirmCallback=cb;
  document.getElementById('confirm-title').textContent=title;
  document.getElementById('confirm-msg').innerHTML=msg;
  document.getElementById('confirm-ok').onclick=()=>{cb();closeConfirm();};
  document.getElementById('overlay-confirm').classList.add('open');
}
function closeConfirm(){
  document.getElementById('overlay-confirm').classList.remove('open');
  confirmCallback=null;
}