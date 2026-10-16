/* 핏로그 - 웨이트/러닝 운동기록 앱 (Vanilla JS, 의존성 없음) */
'use strict';

/* =====================================================================
 * 1. 유틸리티
 * ===================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const S = () => Store.state;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => ymd(new Date());
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const dateLabel = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`; };
const fmtNum = (n, digits = 0) => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: digits });
const toNum = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : ''; };

function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
// 페이스: 1km당 걸린 시간 (예: 5'30")
function fmtPace(secPerKm) {
  if (!secPerKm || !Number.isFinite(secPerKm) || secPerKm > 3600) return `-'--"`;
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return s === 60 ? `${m + 1}'00"` : `${m}'${pad(s)}"`;
}

let toastTimer;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

/* =====================================================================
 * 2. 도메인 로직 (운동/칼로리/기록)
 * ===================================================================== */
const allExercises = () => [...DEFAULT_EXERCISES, ...S().customExercises];
const exById = (id) => allExercises().find((e) => e.id === id) || { id, name: '(삭제된 운동)', category: '기타' };
const getWorkout = (id) => S().workouts.find((w) => w.id === id);
const workoutsOn = (date) => S().workouts.filter((w) => w.date === date).sort((a, b) => a.createdAt - b.createdAt);
// 시간 순 정렬 키 (날짜 → 생성 시각)
const orderKey = (w) => `${w.date}|${String(w.createdAt).padStart(15, '0')}`;

// 추정 1RM (Epley 공식)
const e1rm = (w, r) => (!w || !r ? 0 : r === 1 ? w : w * (1 + r / 30));
const doneSets = (exEntry) => exEntry.sets.filter((s) => s.done && Number(s.r) > 0);
const setVolume = (s) => (Number(s.w) || 0) * (Number(s.r) || 0);

function weightSummary(w) {
  let sets = 0, volume = 0;
  for (const e of w.exercises) for (const s of doneSets(e)) { sets++; volume += setVolume(s); }
  return { exercises: w.exercises.length, sets, volume };
}

// 칼로리 추정 (체중 기반)
//  - 러닝: kcal ≈ 1.036 × 체중(kg) × 거리(km)  (널리 쓰이는 근사식)
//  - 웨이트: MET 5.0 × 체중(kg) × 시간(h)
const runCalories = (km, bw = S().settings.bodyWeight) => Math.round(1.036 * bw * (km || 0));
const weightCalories = (min, bw = S().settings.bodyWeight) => Math.round(5.0 * bw * ((min || 0) / 60));

// 같은 운동의 직전 기록 (현재 운동 제외, 현재 날짜 이전/같은 날 먼저 한 것 중 가장 최근)
function lastSetsFor(exId, current) {
  const key = current ? orderKey(current) : '9999';
  let best = null;
  for (const w of S().workouts) {
    if (w.type !== 'weight' || (current && w.id === current.id) || orderKey(w) > key) continue;
    const e = w.exercises.find((x) => x.exId === exId && doneSets(x).length);
    if (e && (!best || orderKey(w) > orderKey(best.w))) best = { w, e };
  }
  return best ? doneSets(best.e) : [];
}

// 특정 시점 이전까지의 최고 추정 1RM
function bestE1rmBefore(exId, current) {
  const key = orderKey(current);
  let best = 0;
  for (const w of S().workouts) {
    if (w.type !== 'weight' || w.id === current.id || orderKey(w) > key) continue;
    for (const e of w.exercises) if (e.exId === exId) for (const s of doneSets(e)) best = Math.max(best, e1rm(+s.w, +s.r));
  }
  return best;
}

// 이 운동에서 세운 신기록(PR) 종목 목록
function prsInWorkout(w) {
  if (w.type !== 'weight') return [];
  const out = [];
  for (const e of w.exercises) {
    const prev = bestE1rmBefore(e.exId, w);
    const cur = Math.max(0, ...doneSets(e).map((s) => e1rm(+s.w, +s.r)));
    if (prev > 0 && cur > prev) out.push(e.exId);
  }
  return out;
}

function streakDays() {
  const days = new Set(S().workouts.map((w) => w.date));
  let d = today();
  if (!days.has(d)) d = addDays(d, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

function weekStartOf(dateStr) {
  const d = parseYmd(dateStr);
  const diff = (d.getDay() - S().settings.weekStart + 7) % 7;
  d.setDate(d.getDate() - diff);
  return ymd(d);
}

/* =====================================================================
 * 3. UI 상태 + 렌더링 기반
 * ===================================================================== */
const ui = {
  tab: 'calendar',
  month: (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })(),
  selDate: today(),
  routineSeg: 'preset',
  routineType: 'all',
  statsSeg: 'weight',
  statsEx: 'bench',
};

const TITLES = { calendar: '기록', routines: '루틴', stats: '통계', settings: '설정' };

function renderView() {
  $('#view-title').textContent = TITLES[ui.tab];
  $('#topbar-actions').innerHTML = ui.tab === 'calendar'
    ? `<button class="btn sm" data-act="go-today">오늘</button>` : '';
  const views = { calendar: viewCalendar, routines: viewRoutines, stats: viewStats, settings: viewSettings };
  $('#view').innerHTML = views[ui.tab]();
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
}

/* ---------- 시트(모달) 스택 ---------- */
const sheets = [];
function openSheet(key, render, opts = {}) {
  closeSheet(key, true);
  const el = document.createElement('div');
  el.className = 'sheet-backdrop';
  el.dataset.key = key;
  const s = { key, render, el, ...opts };
  if (!opts.full) el.addEventListener('click', (e) => { if (e.target === el) closeSheet(key); });
  sheets.push(s);
  $('#sheets').appendChild(el);
  refreshSheet(key);
  document.body.style.overflow = 'hidden';
  return s;
}
function refreshSheet(key) {
  const s = sheets.find((x) => x.key === key);
  if (!s) return;
  const old = s.el.querySelector('.sheet');
  const scroll = old ? old.scrollTop : 0;
  // 처음 열 때만 슬라이드 애니메이션 (재렌더링 시 깜빡임 방지)
  s.el.innerHTML = `<div class="sheet ${s.full ? 'full' : ''} ${old ? '' : 'anim'}">${s.render()}</div>`;
  s.el.querySelector('.sheet').scrollTop = scroll;
  s.mount && s.mount(s.el);
}
function closeSheet(key, silent) {
  const i = key ? sheets.findIndex((x) => x.key === key) : sheets.length - 1;
  if (i < 0) return;
  const [s] = sheets.splice(i, 1);
  s.el.remove();
  if (!silent && s.onClose) s.onClose();
  if (!sheets.length) document.body.style.overflow = '';
}
const sheetHead = (title, left = `<button class="btn ghost" data-act="close-sheet">닫기</button>`, right = '<span style="width:56px"></span>') =>
  `<div class="sheet-head">${left}<h2>${title}</h2>${right}</div>`;

/* ---------- 이벤트 위임: data-act(클릭), data-input(입력) ---------- */
const ACT = {};
const INPUT = {};
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tabbar button');
  if (tab) { ui.tab = tab.dataset.tab; renderView(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) ACT[el.dataset.act](el, e);
});
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-input]');
  if (el && INPUT[el.dataset.input]) INPUT[el.dataset.input](el, e);
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && INPUT[el.dataset.change]) INPUT[el.dataset.change](el, e);
});

ACT['close-sheet'] = () => closeSheet();

/* =====================================================================
 * 4. 달력 화면
 * ===================================================================== */
function viewCalendar() {
  const { y, m } = ui.month;
  const ws = S().settings.weekStart;
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() - ws + 7) % 7));

  // 날짜별 기록 타입
  const marks = {};
  for (const w of S().workouts) (marks[w.date] ||= new Set()).add(w.type);

  let cells = '';
  for (let i = 0; i < 7; i++) cells += `<div class="cal-dow">${DOW[(i + ws) % 7]}</div>`;
  const d = new Date(start);
  for (let i = 0; i < 42; i++) {
    const key = ymd(d);
    const set = marks[key];
    const cls = ['cal-day', d.getMonth() !== m && 'other', key === today() && 'today', key === ui.selDate && 'sel'].filter(Boolean).join(' ');
    cells += `<button class="${cls}" data-act="pick-date" data-date="${key}">
      <span class="d">${d.getDate()}</span>
      <span class="dots">${set?.has('weight') ? '<i class="dot weight"></i>' : ''}${set?.has('run') ? '<i class="dot run"></i>' : ''}</span>
    </button>`;
    d.setDate(d.getDate() + 1);
    if (i >= 34 && d.getMonth() !== m) break; // 5주로 끝나는 달은 6번째 주 생략
  }

  // 이번 달 요약
  const prefix = `${y}-${pad(m + 1)}`;
  const monthW = S().workouts.filter((w) => w.date.startsWith(prefix));
  const days = new Set(monthW.map((w) => w.date)).size;
  const vol = monthW.filter((w) => w.type === 'weight').reduce((a, w) => a + weightSummary(w).volume, 0);
  const km = monthW.filter((w) => w.type === 'run').reduce((a, w) => a + (w.distanceKm || 0), 0);

  // 주간 목표
  const wk = weekStartOf(today());
  const weekDays = new Set(S().workouts.filter((w) => w.date >= wk && w.date <= addDays(wk, 6)).map((w) => w.date)).size;
  const goal = S().settings.weeklyGoal;
  const streak = streakDays();

  return `
    <div class="card">
      <div class="row between">
        <div><b>이번 주 ${weekDays}/${goal}일</b> <span class="muted small">주간 목표</span></div>
        ${streak ? `<span class="chip pr">🔥 ${streak}일 연속</span>` : ''}
      </div>
      <div style="height:8px;background:var(--surface-2);border-radius:4px;margin-top:8px;overflow:hidden">
        <div style="height:100%;width:${Math.min(100, (weekDays / goal) * 100)}%;background:var(--accent)"></div>
      </div>
    </div>

    <div class="card">
      <div class="cal-head">
        <button class="icon-btn" data-act="month" data-d="-1" aria-label="이전 달">◀</button>
        <strong>${y}년 ${m + 1}월</strong>
        <button class="icon-btn" data-act="month" data-d="1" aria-label="다음 달">▶</button>
      </div>
      <div class="cal-grid">${cells}</div>
      <div class="legend"><span><i style="background:var(--accent)"></i>웨이트</span><span><i style="background:var(--run)"></i>러닝</span></div>
    </div>

    <div class="stat-grid">
      <div class="stat"><b>${days}일</b><span>${m + 1}월 운동일</span></div>
      <div class="stat"><b>${fmtNum(vol / 1000, 1)}t</b><span>웨이트 볼륨</span></div>
      <div class="stat"><b>${fmtNum(km, 1)}km</b><span>러닝 거리</span></div>
    </div>

    <div class="section-title">${dateLabel(ui.selDate)}${ui.selDate === today() ? ' · 오늘' : ''}</div>
    ${workoutsOn(ui.selDate).map(workoutCard).join('') || `<div class="card empty">아직 기록이 없어요</div>`}
    <div class="add-row">
      <button class="btn primary block" data-act="add-weight">🏋️ 웨이트 기록</button>
      <button class="btn run block" data-act="add-run">🏃 러닝 기록</button>
    </div>`;
}

function workoutCard(w) {
  if (w.type === 'run') {
    const pace = w.distanceKm ? w.durationSec / w.distanceKm : 0;
    return `<div class="card log-card" data-act="open-run" data-id="${w.id}">
      <div class="row between"><span class="title">${esc(w.title || '러닝')}</span><span class="chip run">러닝${w.source === 'gps' ? ' · GPS' : ''}</span></div>
      <div class="row wrap small" style="margin-top:6px;gap:14px">
        <span><b class="num">${fmtNum(w.distanceKm, 2)}</b> km</span>
        <span class="num">⏱ ${fmtDur(w.durationSec)}</span>
        <span class="num">⚡ ${fmtPace(pace)}/km</span>
        <span class="num">🔥 ${fmtNum(w.calories)} kcal</span>
      </div>
      ${w.memo ? `<div class="muted small" style="margin-top:4px">${esc(w.memo)}</div>` : ''}
    </div>`;
  }
  const sum = weightSummary(w);
  const prs = prsInWorkout(w);
  const lines = w.exercises.map((e) => {
    const ds = doneSets(e);
    const top = ds.reduce((a, s) => (e1rm(+s.w, +s.r) > e1rm(+a.w, +a.r) ? s : a), ds[0] || {});
    return `<li>${esc(exById(e.exId).name)} ${ds.length}세트${top.r ? ` · 최고 ${fmtNum(top.w, 1)}kg×${top.r}` : ''}${prs.includes(e.exId) ? ' 🏆' : ''}</li>`;
  }).join('');
  return `<div class="card log-card" data-act="open-weight" data-id="${w.id}">
    <div class="row between">
      <span class="title">${esc(w.title || '웨이트')}</span>
      <span class="row" style="gap:4px">${prs.length ? `<span class="chip pr">🏆 PR ${prs.length}</span>` : ''}${w.finished ? '' : '<span class="chip">진행 중</span>'}<span class="chip weight">웨이트</span></span>
    </div>
    <div class="muted small" style="margin-top:4px">${sum.exercises}종목 · ${sum.sets}세트 · 볼륨 ${fmtNum(sum.volume)}kg${w.durationMin ? ` · ${w.durationMin}분 · 🔥 ${fmtNum(weightCalories(w.durationMin))}kcal` : ''}</div>
    ${lines ? `<ul>${lines}</ul>` : ''}
  </div>`;
}

ACT['go-today'] = () => { const d = new Date(); ui.month = { y: d.getFullYear(), m: d.getMonth() }; ui.selDate = today(); renderView(); };
ACT['month'] = (el) => {
  const d = new Date(ui.month.y, ui.month.m + Number(el.dataset.d), 1);
  ui.month = { y: d.getFullYear(), m: d.getMonth() };
  renderView();
};
ACT['pick-date'] = (el) => {
  ui.selDate = el.dataset.date;
  const d = parseYmd(ui.selDate);
  ui.month = { y: d.getFullYear(), m: d.getMonth() };
  renderView();
};
ACT['open-weight'] = (el) => openWeightEditor(el.dataset.id);
ACT['open-run'] = (el) => { const w = getWorkout(el.dataset.id); openRunForm({ ...w }); };

// 웨이트 추가: 빈 운동 또는 루틴 선택
ACT['add-weight'] = () => {
  const mine = S().routines.filter((r) => r.type === 'weight');
  const presets = PRESET_ROUTINES.filter((r) => r.type === 'weight');
  const item = (r) => `<button class="card log-card" style="width:100%;text-align:left" data-act="start-routine" data-id="${r.id}">
      <div class="title">${esc(r.name)}</div><div class="muted small">${r.items.map((i) => esc(exById(i.exId).name)).join(' · ')}</div></button>`;
  openSheet('choose', () => `${sheetHead(`웨이트 · ${dateLabel(ui.selDate)}`)}
    <button class="btn primary block" data-act="start-empty">빈 운동으로 시작</button>
    ${mine.length ? `<div class="section-title">내 루틴</div>${mine.map(item).join('')}` : ''}
    <div class="section-title">추천 루틴</div>${presets.map(item).join('')}`);
};
ACT['add-run'] = () => {
  openSheet('choose', () => `${sheetHead(`러닝 · ${dateLabel(ui.selDate)}`)}
    <button class="btn run block" data-act="gps-open" ${ui.selDate !== today() ? 'disabled' : ''}>📍 GPS로 측정하며 달리기</button>
    ${ui.selDate !== today() ? '<p class="muted small">GPS 측정은 오늘 날짜에서만 가능해요.</p>' : ''}
    <div style="height:8px"></div>
    <button class="btn block" data-act="run-manual">✍️ 직접 입력 (워치/트레드밀 기록)</button>
    <div class="section-title">추천 러닝 루틴</div>
    ${[...S().routines, ...PRESET_ROUTINES].filter((r) => r.type === 'run').map((r) => `
      <button class="card log-card" style="width:100%;text-align:left" data-act="start-routine" data-id="${r.id}">
        <div class="title">${esc(r.name)} <span class="muted small">목표 ${r.run.targetKm}km · ${r.run.targetMin}분</span></div>
        <div class="muted small">${esc(r.desc || '')}</div></button>`).join('')}`);
};
ACT['start-empty'] = () => { closeSheet('choose'); openWeightEditor(createWeightWorkout(ui.selDate, '웨이트', []).id); };
ACT['run-manual'] = () => { closeSheet('choose'); openRunForm(newRunDraft(ui.selDate)); };
ACT['gps-open'] = () => { closeSheet('choose'); openGps(); };
ACT['start-routine'] = (el) => {
  const r = findRoutine(el.dataset.id);
  closeSheet('choose');
  startRoutine(r, ui.selDate);
};

/* =====================================================================
 * 5. 웨이트 기록 편집기
 * ===================================================================== */
let editId = null;      // 편집 중인 웨이트 운동 id
let liveTimer = null;

function createWeightWorkout(date, title, exIds, routine) {
  const w = {
    id: uid(), type: 'weight', date, title, memo: '', createdAt: Date.now(),
    startedAt: date === today() ? Date.now() : null, durationMin: '', finished: false,
    exercises: [],
  };
  S().workouts.push(w);
  for (const exId of exIds) addExerciseTo(w, exId, routine?.items.find((i) => i.exId === exId));
  Store.save();
  return w;
}

// 운동 추가: 직전 기록의 무게를 미리 채워 줌 (점진적 과부하 확인용)
function addExerciseTo(w, exId, plan) {
  const prev = lastSetsFor(exId, w);
  const n = plan?.sets || prev.length || 3;
  const sets = [];
  for (let i = 0; i < n; i++) {
    const p = prev[i] || prev[prev.length - 1];
    // 목표값은 힌트(placeholder)로만 보여주고, 실제 값은 사용자가 입력/체크할 때 기록
    sets.push({ w: '', r: '', tw: p ? p.w : '', tr: plan?.reps || (p ? p.r : ''), done: false, warm: false });
  }
  w.exercises.push({ exId, rest: null, sets });
}

function startRoutine(r, date) {
  if (r.type === 'run') {
    const draft = newRunDraft(date);
    draft.title = r.name;
    draft.target = r.run;
    draft.memo = '';
    if (date === today()) openGps(r);
    else openRunForm(draft);
    return;
  }
  const w = createWeightWorkout(date, r.name, r.items.map((i) => i.exId), r);
  renderView();
  openWeightEditor(w.id);
}

function openWeightEditor(id) {
  editId = id;
  openSheet('weight', renderWeightEditor, {
    full: true,
    onClose: () => { cleanupWorkout(); renderView(); },
  });
  clearInterval(liveTimer);
  liveTimer = setInterval(() => {
    const w = getWorkout(editId);
    const el = $('#live-timer');
    if (!w || !el) return clearInterval(liveTimer);
    if (w.startedAt && !w.finished) el.textContent = fmtDur((Date.now() - w.startedAt) / 1000);
  }, 1000);
}

// 운동이 하나도 없으면 기록 삭제
function cleanupWorkout() {
  clearInterval(liveTimer);
  const w = getWorkout(editId);
  if (w && !w.exercises.length && !w.memo) {
    S().workouts = S().workouts.filter((x) => x.id !== w.id);
    Store.save();
  }
}

function renderWeightEditor() {
  const w = getWorkout(editId);
  if (!w) return sheetHead('기록 없음');
  const live = w.startedAt && !w.finished;
  const head = sheetHead(
    `${dateLabel(w.date)}${live ? ` · <span class="timer-pill" id="live-timer">${fmtDur((Date.now() - w.startedAt) / 1000)}</span>` : ''}`,
    `<button class="btn ghost" data-act="close-sheet">닫기</button>`,
    `<button class="btn primary sm" data-act="w-finish">완료</button>`,
  );

  const blocks = w.exercises.map((e, i) => {
    const prev = lastSetsFor(e.exId, w);
    const prevBest = bestE1rmBefore(e.exId, w);
    const curBest = Math.max(0, ...doneSets(e).map((s) => e1rm(+s.w, +s.r)));
    let workNo = 0;
    const rows = e.sets.map((s, j) => {
      const p = prev[j];
      const label = s.warm ? 'W' : ++workNo;
      const phW = s.tw !== undefined && s.tw !== '' ? s.tw : p ? p.w : 'kg';
      const phR = s.tr || (p ? p.r : '회');
      return `<tr class="${s.done ? 'done' : ''}">
        <td><button class="set-no ${s.warm ? 'warm' : ''}" data-act="set-warm" data-i="${i}" data-j="${j}" title="탭: 워밍업 세트 전환">${label}</button></td>
        <td class="prev" data-act="set-prev" data-i="${i}" data-j="${j}">${p ? `${fmtNum(p.w, 1)}×${p.r}` : '-'}</td>
        <td><input type="number" inputmode="decimal" step="any" min="0" value="${s.w}" placeholder="${phW}" data-input="set-w" data-i="${i}" data-j="${j}" aria-label="무게"></td>
        <td><input type="number" inputmode="numeric" step="1" min="0" value="${s.r}" placeholder="${phR}" data-input="set-r" data-i="${i}" data-j="${j}" aria-label="횟수"></td>
        <td><button class="check ${s.done ? 'on' : ''}" data-act="set-done" data-i="${i}" data-j="${j}" aria-label="세트 완료">✓</button></td>
      </tr>`;
    }).join('');
    return `<div class="ex-block">
      <div class="row between">
        <span class="ex-name grow">${esc(exById(e.exId).name)} ${prevBest && curBest > prevBest ? '<span class="chip pr">🏆 신기록</span>' : ''}</span>
        <button class="chip" data-act="ex-rest" data-i="${i}">⏱ ${e.rest ?? S().settings.restSeconds}s</button>
        <button class="icon-btn" data-act="ex-move" data-i="${i}" data-d="-1" aria-label="위로">↑</button>
        <button class="icon-btn" data-act="ex-move" data-i="${i}" data-d="1" aria-label="아래로">↓</button>
        <button class="icon-btn" data-act="ex-del" data-i="${i}" aria-label="삭제">✕</button>
      </div>
      <table class="set-table">
        <thead><tr><th style="width:36px">세트</th><th>이전</th><th>kg</th><th>회</th><th style="width:40px">✓</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="row" style="margin-top:8px">
        <button class="btn sm grow" data-act="set-add" data-i="${i}">+ 세트 추가</button>
        <button class="btn sm" data-act="set-remove" data-i="${i}" ${e.sets.length ? '' : 'disabled'}>− 세트</button>
      </div>
    </div>`;
  }).join('');

  return `${head}
    <input type="text" value="${esc(w.title)}" placeholder="운동 이름 (예: 가슴·삼두)" data-input="w-title" style="font-weight:700;margin-bottom:8px">
    <div class="muted small" id="w-summary" style="margin:0 2px 12px">${weightSummaryText(w)}</div>
    ${blocks || '<div class="card empty">아래 버튼으로 운동을 추가하세요</div>'}
    <button class="btn primary block" data-act="w-add-ex">+ 운동 추가</button>
    <div class="section-title">기록 정보</div>
    <div class="card">
      <label class="field"><span>날짜</span><input type="date" value="${w.date}" data-change="w-date"></label>
      <label class="field"><span>운동 시간 (분) ${live ? '· 완료 시 자동 계산' : ''}</span><input type="number" inputmode="numeric" min="0" value="${w.durationMin}" data-input="w-dur" placeholder="예: 60"></label>
      <label class="field" style="margin:0"><span>메모</span><textarea rows="2" data-input="w-memo" placeholder="컨디션, 자세 메모 등">${esc(w.memo)}</textarea></label>
    </div>
    <div class="row">
      <button class="btn grow" data-act="w-save-routine" ${w.exercises.length ? '' : 'disabled'}>📋 루틴으로 저장</button>
      <button class="btn danger" data-act="w-delete">기록 삭제</button>
    </div>`;
}

function weightSummaryText(w) {
  const s = weightSummary(w);
  return `${s.exercises}종목 · 완료 ${s.sets}세트 · 볼륨 ${fmtNum(s.volume)}kg`;
}
const curW = () => getWorkout(editId);
const setAt = (el) => curW().exercises[+el.dataset.i].sets[+el.dataset.j];
const saveW = (rerender) => { Store.save(); if (rerender) refreshSheet('weight'); else { const el = $('#w-summary'); if (el) el.textContent = weightSummaryText(curW()); } };

INPUT['w-title'] = (el) => { curW().title = el.value; saveW(); };
INPUT['w-memo'] = (el) => { curW().memo = el.value; saveW(); };
INPUT['w-dur'] = (el) => { curW().durationMin = toNum(el.value); saveW(); };
INPUT['w-date'] = (el) => { if (el.value) { curW().date = el.value; saveW(true); } };
INPUT['set-w'] = (el) => { setAt(el).w = toNum(el.value); saveW(); };
INPUT['set-r'] = (el) => { const v = toNum(el.value); setAt(el).r = v === '' ? '' : Math.round(v); saveW(); };

ACT['set-done'] = (el) => {
  const s = setAt(el);
  if (!s.done) {
    // 비어 있으면 이전 기록(placeholder)으로 채움
    const row = el.closest('tr');
    const [wIn, rIn] = row.querySelectorAll('input');
    if (s.w === '' && wIn.placeholder !== 'kg') s.w = toNum(wIn.placeholder);
    if (s.r === '' && rIn.placeholder !== '회') s.r = toNum(rIn.placeholder);
    if (!(Number(s.r) > 0)) { toast('횟수를 입력해 주세요'); rIn.focus(); return; }
    if (s.w === '') s.w = 0; // 맨몸 운동
    s.done = true;
    const ex = curW().exercises[+el.dataset.i];
    if (S().settings.autoRest && !s.warm) RestTimer.start(ex.rest ?? S().settings.restSeconds);
  } else {
    s.done = false;
  }
  saveW(true);
};
ACT['set-warm'] = (el) => { const s = setAt(el); s.warm = !s.warm; saveW(true); };
ACT['set-prev'] = (el) => {
  const ex = curW().exercises[+el.dataset.i];
  const p = lastSetsFor(ex.exId, curW())[+el.dataset.j];
  if (!p) return;
  Object.assign(setAt(el), { w: p.w, r: p.r });
  saveW(true);
};
ACT['set-add'] = (el) => {
  const sets = curW().exercises[+el.dataset.i].sets;
  const last = sets[sets.length - 1];
  sets.push({ w: last ? last.w : '', r: last ? last.r : '', tw: last?.tw, tr: last?.tr, done: false, warm: false });
  saveW(true);
};
ACT['set-remove'] = (el) => { curW().exercises[+el.dataset.i].sets.pop(); saveW(true); };
ACT['ex-del'] = (el) => {
  const w = curW(); const i = +el.dataset.i;
  if (!confirm(`'${exById(w.exercises[i].exId).name}'을(를) 삭제할까요?`)) return;
  w.exercises.splice(i, 1); saveW(true);
};
ACT['ex-move'] = (el) => {
  const arr = curW().exercises; const i = +el.dataset.i; const j = i + Number(el.dataset.d);
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]]; saveW(true);
};
ACT['ex-rest'] = (el) => {
  const ex = curW().exercises[+el.dataset.i];
  const v = prompt('이 운동의 휴식 시간 (초)', ex.rest ?? S().settings.restSeconds);
  if (v === null) return;
  const n = parseInt(v, 10);
  if (!(n >= 0 && n <= 900)) return toast('0~900초 사이로 입력해 주세요');
  ex.rest = n; saveW(true);
};
ACT['w-add-ex'] = () => openPicker((ids) => { const w = curW(); ids.forEach((id) => addExerciseTo(w, id)); saveW(true); });
ACT['w-delete'] = () => {
  if (!confirm('이 운동 기록을 삭제할까요?')) return;
  S().workouts = S().workouts.filter((x) => x.id !== editId);
  Store.save(); RestTimer.stop(); closeSheet('weight');
  toast('삭제했어요');
};
ACT['w-save-routine'] = () => {
  const w = curW();
  const name = prompt('루틴 이름', w.title || '나의 루틴');
  if (!name) return;
  S().routines.push({
    id: uid(), type: 'weight', name, desc: '',
    items: w.exercises.map((e) => ({ exId: e.exId, sets: e.sets.filter((s) => !s.warm).length || 3, reps: Number(e.sets.find((s) => !s.warm)?.r) || 10 })),
  });
  Store.save(); toast('내 루틴에 저장했어요');
};
ACT['w-finish'] = () => {
  const w = curW();
  if (!w.exercises.length) { closeSheet('weight'); return; }
  const pending = w.exercises.flatMap((e) => e.sets.filter((s) => !s.done));
  // 무게나 횟수를 직접 입력한 세트만 대상 (빈 칸은 목표값 힌트로 채움)
  const filled = pending.filter((s) => (s.w !== '' || s.r !== '') && Number(s.r !== '' ? s.r : s.tr) > 0);
  if (filled.length) {
    if (confirm(`완료 체크하지 않은 세트 ${filled.length}개가 있어요.\n\n확인: 완료로 기록\n취소: 해당 세트 삭제`)) {
      filled.forEach((s) => { if (s.r === '') s.r = Number(s.tr); if (s.w === '') s.w = s.tw !== undefined && s.tw !== '' ? s.tw : 0; s.done = true; });
    }
  }
  // 값이 없거나 미완료인 세트 정리
  w.exercises.forEach((e) => { e.sets = e.sets.filter((s) => s.done); });
  w.exercises = w.exercises.filter((e) => e.sets.length);
  if (w.startedAt && !w.finished && !w.durationMin) w.durationMin = Math.max(1, Math.round((Date.now() - w.startedAt) / 60000));
  w.finished = true;
  Store.save(); RestTimer.stop();
  const sum = weightSummary(w); const prs = prsInWorkout(w).length;
  closeSheet('weight');
  toast(`수고했어요! ${sum.sets}세트 · ${fmtNum(sum.volume)}kg${prs ? ` · 🏆 신기록 ${prs}개` : ''}`, 3500);
};

/* ---------- 운동 선택기 ---------- */
const picker = { q: '', cat: '전체', sel: [], onPick: null };
function openPicker(onPick) {
  Object.assign(picker, { q: '', cat: '전체', sel: [], onPick });
  openSheet('picker', renderPicker, { full: true });
}
function pickerList() {
  const q = picker.q.trim().toLowerCase();
  const list = allExercises().filter((e) => (picker.cat === '전체' || e.category === picker.cat) && (!q || e.name.toLowerCase().includes(q)));
  return list.map((e) => `<div class="ex-pick ${picker.sel.includes(e.id) ? 'sel' : ''}" data-act="pick-ex" data-id="${e.id}">
      <span>${esc(e.name)} ${e.custom ? '<span class="chip">내 운동</span>' : ''}</span><span class="muted small">${e.category}</span></div>`).join('')
    || '<div class="empty">검색 결과가 없어요. 아래에서 새 운동을 만들어 보세요.</div>';
}
function renderPicker() {
  return `${sheetHead('운동 선택', undefined, `<button class="btn primary sm" data-act="pick-done" ${picker.sel.length ? '' : 'disabled'}>추가${picker.sel.length ? ` (${picker.sel.length})` : ''}</button>`)}
    <input type="search" placeholder="운동 검색" value="${esc(picker.q)}" data-input="pick-q">
    <div class="chips-scroll">${['전체', ...CATEGORIES].map((c) => `<button class="chip ${picker.cat === c ? 'on' : ''}" data-act="pick-cat" data-c="${c}">${c}</button>`).join('')}</div>
    <div id="pick-list">${pickerList()}</div>
    <div class="section-title">새 운동 만들기</div>
    <div class="card row">
      <input type="text" id="new-ex-name" placeholder="운동 이름" class="grow">
      <select id="new-ex-cat" style="width:96px">${CATEGORIES.map((c) => `<option ${c === (picker.cat === '전체' ? '가슴' : picker.cat) ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <button class="btn sm" data-act="new-ex">만들기</button>
    </div>`;
}
INPUT['pick-q'] = (el) => { picker.q = el.value; $('#pick-list').innerHTML = pickerList(); };
ACT['pick-cat'] = (el) => { picker.cat = el.dataset.c; refreshSheet('picker'); };
ACT['pick-ex'] = (el) => {
  const id = el.dataset.id;
  picker.sel = picker.sel.includes(id) ? picker.sel.filter((x) => x !== id) : [...picker.sel, id];
  el.classList.toggle('sel');
  const btn = $('[data-act="pick-done"]');
  btn.disabled = !picker.sel.length;
  btn.textContent = picker.sel.length ? `추가 (${picker.sel.length})` : '추가';
};
ACT['pick-done'] = () => { const ids = picker.sel; closeSheet('picker'); picker.onPick?.(ids); };
ACT['new-ex'] = () => {
  const name = $('#new-ex-name').value.trim();
  if (!name) return toast('운동 이름을 입력해 주세요');
  if (allExercises().some((e) => e.name === name)) return toast('이미 있는 운동이에요');
  const e = { id: 'c-' + uid(), name, category: $('#new-ex-cat').value, custom: true };
  S().customExercises.push(e); Store.save();
  picker.sel.push(e.id); picker.q = ''; picker.cat = e.category;
  refreshSheet('picker'); toast(`'${name}' 추가됨`);
};

/* ---------- 휴식 타이머 ---------- */
const RestTimer = {
  end: 0, iv: null,
  start(sec) {
    if (!sec) return;
    this.end = Date.now() + sec * 1000;
    $('#rest-timer').classList.remove('hidden');
    clearInterval(this.iv);
    this.iv = setInterval(() => this.tick(), 250);
    this.tick();
  },
  adjust(d) { this.end += d * 1000; this.tick(); },
  tick() {
    const left = Math.round((this.end - Date.now()) / 1000);
    if (left <= 0) { this.stop(); this.alert(); return; }
    $('#rest-time').textContent = fmtDur(left);
  },
  stop() { clearInterval(this.iv); $('#rest-timer').classList.add('hidden'); },
  alert() {
    toast('휴식 끝! 다음 세트 가볼까요 💪');
    navigator.vibrate?.([200, 100, 200]);
    try { // 짧은 비프음
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.2, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      o.start(); o.stop(ctx.currentTime + 0.6);
    } catch (e) { /* 오디오 미지원 시 무시 */ }
  },
};
$('#rest-timer').addEventListener('click', (e) => {
  const v = e.target.dataset.rest;
  if (!v) return;
  if (v === 'skip') RestTimer.stop(); else RestTimer.adjust(Number(v));
});

/* =====================================================================
 * 6. 러닝 기록 (직접 입력 / GPS 결과 검토)
 * ===================================================================== */
let runDraft = null;
const newRunDraft = (date) => ({ id: null, type: 'run', date, title: '러닝', distanceKm: '', durationSec: 0, calories: '', calManual: false, memo: '', source: 'manual', route: null, splits: null });

function openRunForm(draft) {
  runDraft = draft;
  openSheet('run', renderRunForm, { onClose: renderView });
}
function runDerived() {
  const d = runDraft;
  const km = Number(d.distanceKm) || 0;
  if (!d.calManual) d.calories = km ? runCalories(km) : '';
  return { pace: km ? d.durationSec / km : 0, speed: d.durationSec ? km / (d.durationSec / 3600) : 0 };
}
function renderRunForm() {
  const d = runDraft;
  const { pace, speed } = runDerived();
  const h = Math.floor(d.durationSec / 3600), m = Math.floor((d.durationSec % 3600) / 60), s = Math.round(d.durationSec % 60);
  return `${sheetHead(d.id ? '러닝 기록' : '러닝 추가', undefined, `<button class="btn run sm" data-act="run-save">저장</button>`)}
    ${d.target ? `<div class="card small">🎯 목표: <b>${d.target.targetKm}km · ${d.target.targetMin}분</b></div>` : ''}
    <div class="card">
      <div class="run-stats" style="margin:0">
        <div><b id="run-pace">${fmtPace(pace)}</b><span>평균 페이스 /km</span></div>
        <div><b id="run-speed">${fmtNum(speed, 1)}</b><span>평균 속도 km/h</span></div>
        <div><b id="run-cal">${fmtNum(d.calories)}</b><span>칼로리 kcal</span></div>
      </div>
    </div>
    <label class="field"><span>제목</span><input type="text" value="${esc(d.title)}" data-input="run-title"></label>
    <label class="field"><span>날짜</span><input type="date" value="${d.date}" data-change="run-date"></label>
    <label class="field"><span>거리 (km)</span><input type="number" inputmode="decimal" step="0.01" min="0" value="${d.distanceKm}" placeholder="예: 5.2" data-input="run-km"></label>
    <div class="field"><span class="muted small" style="display:block;margin-bottom:4px">시간 (시 : 분 : 초)</span>
      <div class="time-inputs">
        <input type="number" inputmode="numeric" min="0" value="${h || ''}" placeholder="시" data-input="run-t" data-u="h">
        <input type="number" inputmode="numeric" min="0" max="59" value="${m || ''}" placeholder="분" data-input="run-t" data-u="m">
        <input type="number" inputmode="numeric" min="0" max="59" value="${s || ''}" placeholder="초" data-input="run-t" data-u="s">
      </div></div>
    <label class="field"><span>칼로리 (kcal) · 비워두면 체중 ${S().settings.bodyWeight}kg 기준 자동 계산</span>
      <input type="number" inputmode="numeric" min="0" value="${d.calManual ? d.calories : ''}" placeholder="${d.calories || '자동'}" data-input="run-calin"></label>
    <label class="field"><span>메모</span><textarea rows="2" data-input="run-memo" placeholder="코스, 컨디션, 신발 등">${esc(d.memo)}</textarea></label>
    ${d.route && d.route.length > 1 ? `<div class="section-title">경로</div>${routeSvg(d.route)}` : ''}
    ${d.splits && d.splits.length ? splitsTable(d.splits) : ''}
    ${d.id ? `<button class="btn danger block" data-act="run-delete" style="margin-top:12px">기록 삭제</button>` : ''}`;
}
function updateRunDerived() {
  const { pace, speed } = runDerived();
  $('#run-pace').textContent = fmtPace(pace);
  $('#run-speed').textContent = fmtNum(speed, 1);
  $('#run-cal').textContent = fmtNum(runDraft.calories);
  const ci = $('[data-input="run-calin"]'); if (ci && !runDraft.calManual) ci.placeholder = runDraft.calories || '자동';
}
INPUT['run-title'] = (el) => { runDraft.title = el.value; };
INPUT['run-memo'] = (el) => { runDraft.memo = el.value; };
INPUT['run-date'] = (el) => { if (el.value) runDraft.date = el.value; };
INPUT['run-km'] = (el) => { runDraft.distanceKm = toNum(el.value); updateRunDerived(); };
INPUT['run-t'] = () => {
  const v = (u) => Number($(`[data-input="run-t"][data-u="${u}"]`).value) || 0;
  runDraft.durationSec = v('h') * 3600 + v('m') * 60 + v('s');
  updateRunDerived();
};
INPUT['run-calin'] = (el) => {
  const v = toNum(el.value);
  runDraft.calManual = v !== '';
  runDraft.calories = v === '' ? '' : Math.round(v);
  updateRunDerived();
};
ACT['run-save'] = () => {
  const d = runDraft;
  if (!(Number(d.distanceKm) > 0)) return toast('거리를 입력해 주세요');
  if (!(d.durationSec > 0)) return toast('시간을 입력해 주세요');
  runDerived();
  const rec = {
    id: d.id || uid(), type: 'run', date: d.date, title: d.title || '러닝', memo: d.memo,
    distanceKm: Number(d.distanceKm), durationSec: d.durationSec, calories: Number(d.calories) || 0,
    calManual: d.calManual, source: d.source, route: d.route, splits: d.splits,
    createdAt: d.createdAt || Date.now(), finished: true,
  };
  const i = S().workouts.findIndex((w) => w.id === rec.id);
  if (i >= 0) S().workouts[i] = rec; else S().workouts.push(rec);
  Store.save();
  ui.selDate = rec.date;
  closeSheet('run');
  toast(`🏃 ${fmtNum(rec.distanceKm, 2)}km 저장! 페이스 ${fmtPace(rec.durationSec / rec.distanceKm)}`);
};
ACT['run-delete'] = () => {
  if (!confirm('이 러닝 기록을 삭제할까요?')) return;
  S().workouts = S().workouts.filter((w) => w.id !== runDraft.id);
  Store.save(); closeSheet('run'); toast('삭제했어요');
};

function splitsTable(splits) {
  const max = Math.max(...splits);
  return `<div class="section-title">구간 기록 (1km)</div><div class="card"><table class="splits" style="width:100%">
    <tr class="muted small"><th>km</th><th>페이스</th><th style="width:50%"></th></tr>
    ${splits.map((s, i) => `<tr><td>${i + 1}</td><td>${fmtPace(s)}</td><td><div class="bar-mini" style="width:${(s / max) * 100}%"></div></td></tr>`).join('')}
  </table></div>`;
}

// 위경도 경로를 SVG로 단순 표시 (지도 타일 없이 오프라인 동작)
function routeSvg(route) {
  const lat0 = route[0][0] * Math.PI / 180;
  const pts = route.map(([la, lo]) => [lo * Math.cos(lat0), -la]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const W = 340, H = 180, padding = 12;
  const k = Math.min((W - padding * 2) / (maxX - minX || 1e-9), (H - padding * 2) / (maxY - minY || 1e-9));
  const ox = (W - (maxX - minX) * k) / 2, oy = (H - (maxY - minY) * k) / 2;
  const xy = pts.map(([x, y]) => [(x - minX) * k + ox, (y - minY) * k + oy]);
  const path = xy.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
  const [s, e] = [xy[0], xy[xy.length - 1]];
  return `<svg class="route-svg" viewBox="0 0 ${W} ${H}"><polyline points="${path}" fill="none" stroke="var(--run)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${s[0]}" cy="${s[1]}" r="5" fill="var(--run)"/><circle cx="${e[0]}" cy="${e[1]}" r="5" fill="var(--danger)"/></svg>`;
}

/* =====================================================================
 * 7. GPS 러닝 측정
 * ===================================================================== */
const gps = { status: 'ready', activeMs: 0, resumedAt: 0, distM: 0, last: null, route: [], splits: [], lastSplitMs: 0, watchId: null, iv: null, wake: null, target: null, routine: null, err: '' };

function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLa = (b[0] - a[0]) * toR, dLo = (b[1] - a[1]) * toR;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const gpsElapsed = () => gps.activeMs + (gps.status === 'running' ? Date.now() - gps.resumedAt : 0);

function openGps(routine) {
  if (!('geolocation' in navigator)) return toast('이 기기/브라우저는 위치 측정을 지원하지 않아요');
  Object.assign(gps, { status: 'ready', activeMs: 0, distM: 0, last: null, route: [], splits: [], lastSplitMs: 0, routine: routine || null, err: '' });
  openSheet('gps', renderGps, { full: true });
}
function renderGps() {
  const t = gpsElapsed() / 1000, km = gps.distM / 1000;
  const btns = {
    ready: `<button class="btn run block" data-act="gps-start" style="padding:18px;font-size:18px">▶ 시작</button>
      <button class="btn ghost block" data-act="gps-to-manual" style="margin-top:8px">워치·트레드밀 기록은 직접 입력하기</button>`,
    running: `<button class="btn block" data-act="gps-pause" style="padding:18px;font-size:18px">⏸ 일시정지</button>`,
    paused: `<div class="row"><button class="btn run grow" data-act="gps-resume" style="padding:18px">▶ 재개</button><button class="btn primary grow" data-act="gps-finish" style="padding:18px">■ 종료</button></div>`,
  }[gps.status];
  return `${sheetHead('러닝 측정', `<button class="btn ghost" data-act="gps-close">닫기</button>`)}
    ${gps.routine ? `<div class="card small">🎯 ${esc(gps.routine.name)} · 목표 ${gps.routine.run.targetKm}km<br><span class="muted">${esc(gps.routine.desc)}</span></div>` : ''}
    <div class="run-big"><div class="km" id="g-km">${km.toFixed(2)}</div><div class="unit">킬로미터</div></div>
    <div class="run-stats">
      <div><b id="g-time">${fmtDur(t)}</b><span>시간</span></div>
      <div><b id="g-pace">${fmtPace(km > 0.05 ? t / km : 0)}</b><span>평균 페이스</span></div>
      <div><b id="g-cal">${fmtNum(runCalories(km))}</b><span>kcal</span></div>
    </div>
    ${btns}
    <p class="muted small" id="g-msg" style="text-align:center;margin-top:14px">${esc(gps.err) || (gps.status === 'ready' ? '야외에서 GPS 신호를 잡은 뒤 시작하세요. 측정 중에는 화면을 켜 두는 것이 가장 정확해요.' : '')}</p>`;
}
function gpsUpdateUI() {
  const t = gpsElapsed() / 1000, km = gps.distM / 1000;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('#g-km', km.toFixed(2)); set('#g-time', fmtDur(t));
  set('#g-pace', fmtPace(km > 0.05 ? t / km : 0)); set('#g-cal', fmtNum(runCalories(km)));
}
function onGpsPos(pos) {
  if (gps.status !== 'running') return;
  const { latitude, longitude, accuracy } = pos.coords;
  if (accuracy > 35) { gps.err = `GPS 신호 약함 (±${Math.round(accuracy)}m)`; $('#g-msg') && ($('#g-msg').textContent = gps.err); return; }
  gps.err = ''; $('#g-msg') && ($('#g-msg').textContent = '');
  const p = [latitude, longitude];
  if (gps.last) {
    const d = haversine(gps.last.p, p);
    const dt = (pos.timestamp - gps.last.t) / 1000;
    if (d < 3) return;                     // 정지 상태의 GPS 떨림 무시
    if (dt > 0 && d / dt > 12) return;     // 비정상 점프 (43km/h 초과) 무시
    gps.distM += d;
    // 1km 구간 기록
    const kmDone = Math.floor(gps.distM / 1000);
    while (gps.splits.length < kmDone) {
      const now = gpsElapsed();
      gps.splits.push((now - gps.lastSplitMs) / 1000);
      gps.lastSplitMs = now;
      navigator.vibrate?.(300);
      toast(`${gps.splits.length}km 통과 · ${fmtPace(gps.splits[gps.splits.length - 1])}/km`);
    }
  }
  gps.last = { p, t: pos.timestamp };
  gps.route.push(p);
  gpsUpdateUI();
}
async function gpsWake(on) {
  try {
    if (on && 'wakeLock' in navigator) gps.wake = await navigator.wakeLock.request('screen');
    else if (!on && gps.wake) { await gps.wake.release(); gps.wake = null; }
  } catch (e) { /* 화면 켜짐 유지 미지원 */ }
}
function gpsWatch(on) {
  if (on) {
    gps.watchId = navigator.geolocation.watchPosition(onGpsPos, (err) => {
      gps.err = err.code === 1 ? '위치 권한이 거부됐어요. 브라우저 설정에서 위치를 허용해 주세요.' : 'GPS 신호를 찾는 중…';
      const el = $('#g-msg'); if (el) el.textContent = gps.err;
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    clearInterval(gps.iv); gps.iv = setInterval(gpsUpdateUI, 1000);
  } else {
    if (gps.watchId !== null) navigator.geolocation.clearWatch(gps.watchId);
    gps.watchId = null; clearInterval(gps.iv);
  }
}
ACT['gps-start'] = () => { gps.status = 'running'; gps.resumedAt = Date.now(); gpsWatch(true); gpsWake(true); refreshSheet('gps'); };
ACT['gps-pause'] = () => { gps.activeMs += Date.now() - gps.resumedAt; gps.status = 'paused'; gps.last = null; gpsWatch(false); refreshSheet('gps'); };
ACT['gps-resume'] = () => { gps.status = 'running'; gps.resumedAt = Date.now(); gpsWatch(true); refreshSheet('gps'); };
ACT['gps-finish'] = () => {
  gpsWatch(false); gpsWake(false);
  const draft = newRunDraft(today());
  Object.assign(draft, {
    title: gps.routine ? gps.routine.name : '러닝', source: 'gps', target: gps.routine?.run,
    distanceKm: Math.round(gps.distM / 10) / 100, durationSec: Math.round(gps.activeMs / 1000),
    route: simplifyRoute(gps.route), splits: gps.splits.slice(),
  });
  gps.status = 'ready';
  closeSheet('gps');
  openRunForm(draft);
};
ACT['gps-to-manual'] = () => {
  const draft = newRunDraft(today());
  if (gps.routine) Object.assign(draft, { title: gps.routine.name, target: gps.routine.run });
  closeSheet('gps');
  openRunForm(draft);
};
ACT['gps-close'] = () => {
  if (gps.status !== 'ready' && !confirm('측정 중인 러닝을 버리고 닫을까요?')) return;
  gpsWatch(false); gpsWake(false); gps.status = 'ready';
  closeSheet('gps');
};
// 저장 용량 절약: 경로 포인트를 최대 ~400개로 간추림
function simplifyRoute(r) {
  if (r.length <= 400) return r.map((p) => p.map((v) => +v.toFixed(6)));
  const step = r.length / 400;
  const out = [];
  for (let i = 0; i < r.length; i += step) out.push(r[Math.floor(i)].map((v) => +v.toFixed(6)));
  out.push(r[r.length - 1]);
  return out;
}

/* =====================================================================
 * 8. 루틴 화면 (내 루틴 / 추천 루틴)
 * ===================================================================== */
const findRoutine = (id) => S().routines.find((r) => r.id === id) || PRESET_ROUTINES.find((r) => r.id === id);

function routineSummary(r) {
  if (r.type === 'run') return `목표 ${r.run.targetKm}km · ${r.run.targetMin}분`;
  return r.items.map((i) => `${esc(exById(i.exId).name)} ${i.sets}×${i.reps}`).join(' · ');
}
function routineCard(r, preset) {
  return `<div class="card">
    <div class="row between"><b>${esc(r.name)}</b><span class="chip ${r.type}">${r.type === 'run' ? '러닝' : '웨이트'}</span></div>
    ${r.desc ? `<div class="muted small" style="margin-top:4px">${esc(r.desc)}</div>` : ''}
    <div class="small" style="margin-top:6px">${routineSummary(r)}</div>
    <div class="row" style="margin-top:10px">
      <button class="btn ${r.type === 'run' ? 'run' : 'primary'} sm grow" data-act="routine-start" data-id="${r.id}">▶ ${dateLabel(ui.selDate)}에 시작</button>
      ${preset ? `<button class="btn sm" data-act="routine-copy" data-id="${r.id}">내 루틴으로 복사</button>`
               : `<button class="btn sm" data-act="routine-edit" data-id="${r.id}">편집</button>`}
    </div>
  </div>`;
}

function viewRoutines() {
  const filt = (r) => ui.routineType === 'all' || r.type === ui.routineType;
  let body;
  if (ui.routineSeg === 'mine') {
    const mine = S().routines.filter(filt);
    body = (mine.map((r) => routineCard(r, false)).join('') || `<div class="card empty">아직 만든 루틴이 없어요.<br>새로 만들거나 추천 루틴을 복사해 보세요.</div>`)
      + `<div class="add-row"><button class="btn primary block" data-act="routine-new" data-type="weight">+ 웨이트 루틴</button><button class="btn run block" data-act="routine-new" data-type="run">+ 러닝 루틴</button></div>`;
  } else {
    const groups = {};
    PRESET_ROUTINES.filter(filt).forEach((r) => (groups[r.group] ||= []).push(r));
    body = Object.entries(groups).map(([g, rs]) => `<div class="section-title">${esc(g)}</div>${rs.map((r) => routineCard(r, true)).join('')}`).join('');
  }
  return `
    <div class="row between" style="margin-bottom:8px">
      <div class="seg">
        <button class="${ui.routineSeg === 'preset' ? 'on' : ''}" data-act="routine-seg" data-v="preset">추천 루틴</button>
        <button class="${ui.routineSeg === 'mine' ? 'on' : ''}" data-act="routine-seg" data-v="mine">내 루틴 ${S().routines.length}</button>
      </div>
      <div class="seg">
        ${[['all', '전체'], ['weight', '웨이트'], ['run', '러닝']].map(([v, l]) => `<button class="${ui.routineType === v ? 'on' : ''}" data-act="routine-type" data-v="${v}">${l}</button>`).join('')}
      </div>
    </div>
    ${body}`;
}
ACT['routine-seg'] = (el) => { ui.routineSeg = el.dataset.v; renderView(); };
ACT['routine-type'] = (el) => { ui.routineType = el.dataset.v; renderView(); };
ACT['routine-start'] = (el) => startRoutine(findRoutine(el.dataset.id), ui.selDate);
ACT['routine-copy'] = (el) => {
  const r = JSON.parse(JSON.stringify(findRoutine(el.dataset.id)));
  delete r.group;
  r.id = uid();
  S().routines.push(r); Store.save();
  ui.routineSeg = 'mine'; renderView();
  openRoutineEditor(r.id);
};
ACT['routine-new'] = (el) => {
  const type = el.dataset.type;
  const r = type === 'run'
    ? { id: uid(), type, name: '새 러닝 루틴', desc: '', run: { targetKm: 5, targetMin: 30 } }
    : { id: uid(), type, name: '새 웨이트 루틴', desc: '', items: [] };
  routineDraft = r; routineIsNew = true;
  openSheet('routine', renderRoutineEditor, { full: true });
};
ACT['routine-edit'] = (el) => openRoutineEditor(el.dataset.id);

/* ---------- 루틴 편집기 ---------- */
let routineDraft = null, routineIsNew = false;
function openRoutineEditor(id) {
  routineDraft = JSON.parse(JSON.stringify(S().routines.find((r) => r.id === id)));
  routineIsNew = false;
  openSheet('routine', renderRoutineEditor, { full: true });
}
function renderRoutineEditor() {
  const r = routineDraft;
  const items = r.type === 'weight' ? r.items.map((it, i) => `
    <div class="ex-block">
      <div class="row between"><span class="ex-name grow">${esc(exById(it.exId).name)}</span>
        <button class="icon-btn" data-act="ri-move" data-i="${i}" data-d="-1">↑</button>
        <button class="icon-btn" data-act="ri-move" data-i="${i}" data-d="1">↓</button>
        <button class="icon-btn" data-act="ri-del" data-i="${i}">✕</button></div>
      <div class="row" style="margin-top:8px">
        <label class="grow small muted">세트<input type="number" inputmode="numeric" min="1" value="${it.sets}" data-input="ri-sets" data-i="${i}"></label>
        <label class="grow small muted">횟수<input type="number" inputmode="numeric" min="1" value="${it.reps}" data-input="ri-reps" data-i="${i}"></label>
      </div>
    </div>`).join('') + `<button class="btn primary block" data-act="ri-add">+ 운동 추가</button>`
    : `<div class="row">
        <label class="field grow"><span>목표 거리 (km)</span><input type="number" inputmode="decimal" step="0.1" min="0" value="${r.run.targetKm}" data-input="rr-km"></label>
        <label class="field grow"><span>목표 시간 (분)</span><input type="number" inputmode="numeric" min="0" value="${r.run.targetMin}" data-input="rr-min"></label>
      </div>`;
  return `${sheetHead(routineIsNew ? '새 루틴' : '루틴 편집', undefined, `<button class="btn primary sm" data-act="routine-save">저장</button>`)}
    <label class="field"><span>루틴 이름</span><input type="text" value="${esc(r.name)}" data-input="rt-name"></label>
    <label class="field"><span>설명 (선택)</span><textarea rows="2" data-input="rt-desc" placeholder="${r.type === 'run' ? '예: 1분 달리기 + 2분 걷기 × 8' : '예: 월/목 진행, 마지막 세트는 실패 지점까지'}">${esc(r.desc || '')}</textarea></label>
    ${items}
    ${routineIsNew ? '' : `<button class="btn danger block" data-act="routine-delete" style="margin-top:16px">루틴 삭제</button>`}`;
}
INPUT['rt-name'] = (el) => { routineDraft.name = el.value; };
INPUT['rt-desc'] = (el) => { routineDraft.desc = el.value; };
INPUT['ri-sets'] = (el) => { routineDraft.items[+el.dataset.i].sets = Math.max(1, parseInt(el.value, 10) || 1); };
INPUT['ri-reps'] = (el) => { routineDraft.items[+el.dataset.i].reps = Math.max(1, parseInt(el.value, 10) || 1); };
INPUT['rr-km'] = (el) => { routineDraft.run.targetKm = toNum(el.value) || 0; };
INPUT['rr-min'] = (el) => { routineDraft.run.targetMin = parseInt(el.value, 10) || 0; };
ACT['ri-add'] = () => openPicker((ids) => { ids.forEach((exId) => routineDraft.items.push({ exId, sets: 3, reps: 10 })); refreshSheet('routine'); });
ACT['ri-del'] = (el) => { routineDraft.items.splice(+el.dataset.i, 1); refreshSheet('routine'); };
ACT['ri-move'] = (el) => {
  const a = routineDraft.items; const i = +el.dataset.i; const j = i + Number(el.dataset.d);
  if (j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]]; refreshSheet('routine');
};
ACT['routine-save'] = () => {
  const r = routineDraft;
  if (!r.name.trim()) return toast('루틴 이름을 입력해 주세요');
  if (r.type === 'weight' && !r.items.length) return toast('운동을 하나 이상 추가해 주세요');
  const i = S().routines.findIndex((x) => x.id === r.id);
  if (i >= 0) S().routines[i] = r; else S().routines.push(r);
  Store.save(); closeSheet('routine');
  ui.routineSeg = 'mine'; renderView(); toast('루틴을 저장했어요');
};
ACT['routine-delete'] = () => {
  if (!confirm(`'${routineDraft.name}' 루틴을 삭제할까요?`)) return;
  S().routines = S().routines.filter((r) => r.id !== routineDraft.id);
  Store.save(); closeSheet('routine'); renderView();
};

/* =====================================================================
 * 9. 통계 화면
 * ===================================================================== */
// 간단한 SVG 막대 차트
function barChart(data, color, fmt = (v) => fmtNum(v)) {
  const W = 340, H = 180, L = 6, B = 22, T = 16;
  const max = Math.max(1, ...data.map((d) => d.v));
  const bw = (W - L * 2) / data.length;
  const bars = data.map((d, i) => {
    const h = (d.v / max) * (H - B - T);
    const x = L + i * bw + bw * 0.18;
    return `<rect x="${x}" y="${H - B - h}" width="${bw * 0.64}" height="${h}" rx="3" fill="${color}" opacity="${i === data.length - 1 ? 1 : 0.55}"><title>${d.l}: ${fmt(d.v)}</title></rect>
      ${i % 2 === data.length % 2 || data.length < 8 ? `<text x="${x + bw * 0.32}" y="${H - 6}" text-anchor="middle">${d.l}</text>` : ''}`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}"><line class="grid" x1="0" x2="${W}" y1="${H - B}" y2="${H - B}"/>
    <text x="${W - 4}" y="11" text-anchor="end">최대 ${fmt(max)}</text>${bars}</svg>`;
}
// 간단한 SVG 꺾은선 차트
function lineChart(data, color, fmt = (v) => fmtNum(v, 1), invert = false) {
  if (data.length < 2) return '<div class="empty small">기록이 2개 이상 쌓이면 그래프가 보여요</div>';
  const W = 340, H = 180, L = 34, R = 10, T = 14, B = 22;
  const vs = data.map((d) => d.v);
  let min = Math.min(...vs), max = Math.max(...vs);
  if (min === max) { min -= 1; max += 1; }
  const x = (i) => L + (i / (data.length - 1)) * (W - L - R);
  const y = (v) => { const r = (v - min) / (max - min); return T + (invert ? r : 1 - r) * (H - T - B); };
  const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.v).toFixed(1)}`).join(' ');
  const yl = [min, (min + max) / 2, max];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">
    ${yl.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${fmt(v)}</text>`).join('')}
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>
    ${data.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.v)}" r="3" fill="${color}"><title>${d.l}: ${fmt(d.v)}</title></circle>`).join('')}
    <text x="${L}" y="${H - 6}">${data[0].l}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${data[data.length - 1].l}</text>
  </svg>`;
}
// 최근 12주 주차별 합계
function weekly(filter, valueOf) {
  const start = weekStartOf(today());
  const out = [];
  for (let k = 11; k >= 0; k--) {
    const ws = addDays(start, -7 * k), we = addDays(ws, 6);
    const v = S().workouts.filter((w) => filter(w) && w.date >= ws && w.date <= we).reduce((a, w) => a + valueOf(w), 0);
    const d = parseYmd(ws);
    out.push({ l: `${d.getMonth() + 1}/${d.getDate()}`, v });
  }
  return out;
}
const shortDate = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}`; };

function viewStats() {
  const seg = `<div class="seg" style="margin-bottom:12px">
    ${[['weight', '웨이트'], ['run', '러닝'], ['body', '체중']].map(([v, l]) => `<button class="${ui.statsSeg === v ? 'on' : ''}" data-act="stats-seg" data-v="${v}">${l}</button>`).join('')}
  </div>`;
  return seg + ({ weight: statsWeight, run: statsRun, body: statsBody }[ui.statsSeg])();
}
ACT['stats-seg'] = (el) => { ui.statsSeg = el.dataset.v; renderView(); };

function statsWeight() {
  const ws = S().workouts.filter((w) => w.type === 'weight').sort((a, b) => orderKey(a).localeCompare(orderKey(b)));
  if (!ws.length) return '<div class="card empty">웨이트 기록이 쌓이면 볼륨, 1RM 추이, 부위별 비율을 보여드려요</div>';
  const totalVol = ws.reduce((a, w) => a + weightSummary(w).volume, 0);
  const totalSets = ws.reduce((a, w) => a + weightSummary(w).sets, 0);

  // 최근 30일 부위별 세트 수
  const since = addDays(today(), -29);
  const cat = {};
  ws.filter((w) => w.date >= since).forEach((w) => w.exercises.forEach((e) => {
    const c = exById(e.exId).category; cat[c] = (cat[c] || 0) + doneSets(e).length;
  }));
  const catMax = Math.max(1, ...Object.values(cat));
  const catRows = CATEGORIES.filter((c) => cat[c]).map((c) => `
    <div class="row small" style="margin:6px 0"><span style="width:44px">${c}</span>
      <div class="grow" style="background:var(--surface-2);border-radius:4px;height:10px"><div style="width:${(cat[c] / catMax) * 100}%;height:100%;background:var(--accent);border-radius:4px"></div></div>
      <span class="num" style="width:44px;text-align:right">${cat[c]}세트</span></div>`).join('') || '<div class="muted small">최근 30일 기록 없음</div>';

  // 운동별 추이
  const usedIds = [...new Set(ws.flatMap((w) => w.exercises.filter((e) => doneSets(e).length).map((e) => e.exId)))];
  if (!usedIds.includes(ui.statsEx)) ui.statsEx = usedIds[0];
  const hist = ws.map((w) => {
    const e = w.exercises.find((x) => x.exId === ui.statsEx);
    const ds = e ? doneSets(e) : [];
    if (!ds.length) return null;
    return { date: w.date, best: Math.max(...ds.map((s) => e1rm(+s.w, +s.r))), maxW: Math.max(...ds.map((s) => +s.w)), vol: ds.reduce((a, s) => a + setVolume(s), 0), sets: ds };
  }).filter(Boolean);
  const pr = hist.reduce((a, h) => ({ best: Math.max(a.best, h.best), maxW: Math.max(a.maxW, h.maxW), vol: Math.max(a.vol, h.vol) }), { best: 0, maxW: 0, vol: 0 });

  return `
    <div class="stat-grid">
      <div class="stat"><b>${ws.length}회</b><span>총 웨이트</span></div>
      <div class="stat"><b>${fmtNum(totalSets)}</b><span>총 세트</span></div>
      <div class="stat"><b>${fmtNum(totalVol / 1000, 1)}t</b><span>총 볼륨</span></div>
    </div>
    <div class="section-title">주간 볼륨 (최근 12주, kg)</div>
    <div class="card">${barChart(weekly((w) => w.type === 'weight', (w) => weightSummary(w).volume), 'var(--accent)')}</div>
    <div class="section-title">부위별 세트 (최근 30일)</div>
    <div class="card">${catRows}</div>
    <div class="section-title">운동별 기록</div>
    <div class="card">
      <select data-change="stats-ex">${usedIds.map((id) => `<option value="${id}" ${id === ui.statsEx ? 'selected' : ''}>${esc(exById(id).name)}</option>`).join('')}</select>
      <div class="stat-grid" style="margin:10px 0">
        <div class="stat"><b>${fmtNum(pr.best, 1)}</b><span>추정 1RM kg</span></div>
        <div class="stat"><b>${fmtNum(pr.maxW, 1)}</b><span>최고 무게 kg</span></div>
        <div class="stat"><b>${fmtNum(pr.vol)}</b><span>최고 볼륨 kg</span></div>
      </div>
      <div class="muted small">추정 1RM 추이 (Epley 공식)</div>
      ${lineChart(hist.slice(-20).map((h) => ({ l: shortDate(h.date), v: h.best })), 'var(--accent)')}
      <div class="muted small" style="margin-top:8px">최근 기록</div>
      ${hist.slice(-5).reverse().map((h) => `<div class="row between small" style="padding:6px 0;border-bottom:1px solid var(--border)">
        <span>${shortDate(h.date)}</span><span class="muted">${h.sets.map((s) => `${fmtNum(s.w, 1)}×${s.r}`).join(', ')}</span></div>`).join('')}
    </div>`;
}
INPUT['stats-ex'] = (el) => { ui.statsEx = el.value; renderView(); };

function statsRun() {
  const rs = S().workouts.filter((w) => w.type === 'run' && w.distanceKm > 0).sort((a, b) => orderKey(a).localeCompare(orderKey(b)));
  if (!rs.length) return '<div class="card empty">러닝 기록이 쌓이면 주간 거리, 페이스 추이, 최고 기록을 보여드려요</div>';
  const km = rs.reduce((a, r) => a + r.distanceKm, 0);
  const sec = rs.reduce((a, r) => a + r.durationSec, 0);
  const kcal = rs.reduce((a, r) => a + (r.calories || 0), 0);
  const bestPace = (minKm) => {
    const c = rs.filter((r) => r.distanceKm >= minKm);
    if (!c.length) return null;
    return c.reduce((a, r) => (r.durationSec / r.distanceKm < a.durationSec / a.distanceKm ? r : a));
  };
  const longest = rs.reduce((a, r) => (r.distanceKm > a.distanceKm ? r : a));
  const bests = [['1km+', 1], ['5km+', 5], ['10km+', 10], ['하프 21.1km+', 21.0975]].map(([l, k]) => {
    const r = bestPace(k);
    return `<div class="row between small" style="padding:6px 0;border-bottom:1px solid var(--border)">
      <span>${l}</span><span>${r ? `<b>${fmtPace(r.durationSec / r.distanceKm)}</b>/km <span class="muted">(${shortDate(r.date)}, ${fmtNum(r.distanceKm, 2)}km)</span>` : '<span class="muted">-</span>'}</span></div>`;
  }).join('');
  const monthPrefix = today().slice(0, 7);
  const monthKm = rs.filter((r) => r.date.startsWith(monthPrefix)).reduce((a, r) => a + r.distanceKm, 0);
  return `
    <div class="stat-grid">
      <div class="stat"><b>${fmtNum(km, 1)}</b><span>누적 km</span></div>
      <div class="stat"><b>${fmtNum(monthKm, 1)}</b><span>이번 달 km</span></div>
      <div class="stat"><b>${rs.length}회</b><span>총 러닝</span></div>
      <div class="stat"><b>${fmtPace(sec / km)}</b><span>평균 페이스</span></div>
      <div class="stat"><b>${fmtNum(longest.distanceKm, 1)}</b><span>최장 거리 km</span></div>
      <div class="stat"><b>${fmtNum(kcal)}</b><span>누적 kcal</span></div>
    </div>
    <div class="section-title">주간 거리 (최근 12주, km)</div>
    <div class="card">${barChart(weekly((w) => w.type === 'run', (w) => w.distanceKm || 0), 'var(--run)', (v) => fmtNum(v, 1))}</div>
    <div class="section-title">페이스 추이 (최근 20회, 위로 갈수록 빠름)</div>
    <div class="card">${lineChart(rs.slice(-20).map((r) => ({ l: shortDate(r.date), v: r.durationSec / r.distanceKm })), 'var(--run)', fmtPace, true)}</div>
    <div class="section-title">거리별 최고 페이스</div>
    <div class="card">${bests}</div>`;
}

function statsBody() {
  const bws = S().bodyWeights.slice().sort((a, b) => a.date.localeCompare(b.date));
  const last = bws[bws.length - 1];
  return `
    <div class="card">
      <div class="row">
        <input type="date" id="bw-date" value="${today()}" style="width:150px">
        <input type="number" id="bw-kg" inputmode="decimal" step="0.1" min="20" max="300" placeholder="체중 kg" value="${last ? last.kg : ''}" class="grow">
        <button class="btn primary" data-act="bw-add">기록</button>
      </div>
      <p class="muted small" style="margin:8px 0 0">최근 체중은 칼로리 계산에 자동 반영돼요.</p>
    </div>
    <div class="section-title">체중 변화</div>
    <div class="card">${lineChart(bws.slice(-30).map((b) => ({ l: shortDate(b.date), v: b.kg })), 'var(--accent)')}</div>
    ${bws.slice(-10).reverse().map((b) => `<div class="card row between small" style="padding:10px 14px">
      <span>${dateLabel(b.date)}</span><span><b>${fmtNum(b.kg, 1)}kg</b> <button class="icon-btn" data-act="bw-del" data-date="${b.date}" aria-label="삭제">✕</button></span></div>`).join('')}`;
}
ACT['bw-add'] = () => {
  const date = $('#bw-date').value; const kg = toNum($('#bw-kg').value);
  if (!date || !(kg >= 20 && kg <= 300)) return toast('날짜와 체중(20~300kg)을 확인해 주세요');
  S().bodyWeights = S().bodyWeights.filter((b) => b.date !== date).concat({ date, kg });
  syncBodyWeight(); Store.save(); renderView(); toast('체중을 기록했어요');
};
ACT['bw-del'] = (el) => { S().bodyWeights = S().bodyWeights.filter((b) => b.date !== el.dataset.date); syncBodyWeight(); Store.save(); renderView(); };
function syncBodyWeight() {
  const latest = S().bodyWeights.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  if (latest) S().settings.bodyWeight = latest.kg;
}

/* =====================================================================
 * 10. 설정 화면
 * ===================================================================== */
function viewSettings() {
  const st = S().settings;
  const custom = S().customExercises;
  return `
    <div class="section-title">내 정보 · 운동</div>
    <div class="card">
      <label class="field"><span>체중 (kg) · 칼로리 계산에 사용</span><input type="number" inputmode="decimal" step="0.1" value="${st.bodyWeight}" data-change="set-bw"></label>
      <label class="field"><span>기본 휴식 시간 (초)</span><input type="number" inputmode="numeric" min="0" max="900" value="${st.restSeconds}" data-change="set-rest"></label>
      <label class="field"><span>주간 목표 운동일</span><input type="number" inputmode="numeric" min="1" max="7" value="${st.weeklyGoal}" data-change="set-goal"></label>
      <label class="row between" style="margin:4px 0 12px"><span>세트 완료 시 휴식 타이머 자동 시작</span><input type="checkbox" ${st.autoRest ? 'checked' : ''} data-change="set-autorest" style="width:22px;height:22px"></label>
      <label class="field"><span>한 주의 시작</span><select data-change="set-ws"><option value="0" ${st.weekStart === 0 ? 'selected' : ''}>일요일</option><option value="1" ${st.weekStart === 1 ? 'selected' : ''}>월요일</option></select></label>
      <label class="field" style="margin:0"><span>화면 테마</span><select data-change="set-theme">
        ${[['auto', '시스템 설정 따름'], ['light', '라이트'], ['dark', '다크']].map(([v, l]) => `<option value="${v}" ${st.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>

    <div class="section-title">내가 만든 운동 (${custom.length})</div>
    <div class="card">${custom.map((e) => `<div class="row between small" style="padding:6px 0"><span>${esc(e.name)} <span class="muted">${e.category}</span></span><button class="icon-btn" data-act="del-custom" data-id="${e.id}">✕</button></div>`).join('') || '<div class="muted small">운동 선택 화면에서 새 운동을 만들 수 있어요</div>'}</div>

    <div class="section-title">데이터 (이 기기에만 저장됨)</div>
    <div class="card">
      <p class="small muted" style="margin-top:0">기록 ${S().workouts.length}개 · 루틴 ${S().routines.length}개. 폰을 바꾸거나 브라우저 데이터를 지우기 전에 백업해 두세요.</p>
      <div class="row wrap">
        <button class="btn grow" data-act="export">⬇️ 백업 내보내기</button>
        <button class="btn grow" data-act="import">⬆️ 백업 불러오기</button>
      </div>
      <button class="btn grow block" data-act="export-csv" style="margin-top:8px">📄 엑셀용 CSV 내보내기</button>
      <input type="file" id="import-file" accept="application/json,.json" class="hidden" data-change="import-file">
      <button class="btn danger block" data-act="reset" style="margin-top:8px">모든 데이터 초기화</button>
    </div>
    <p class="muted small" style="text-align:center">핏로그 v1.0 · 홈 화면에 추가하면 앱처럼 쓸 수 있어요</p>`;
}
INPUT['set-bw'] = (el) => { const v = toNum(el.value); if (v >= 20 && v <= 300) { S().settings.bodyWeight = v; Store.save(); toast('저장됨'); } else toast('20~300kg 사이로 입력해 주세요'); };
INPUT['set-rest'] = (el) => { const v = parseInt(el.value, 10); if (v >= 0 && v <= 900) { S().settings.restSeconds = v; Store.save(); toast('저장됨'); } };
INPUT['set-goal'] = (el) => { const v = parseInt(el.value, 10); if (v >= 1 && v <= 7) { S().settings.weeklyGoal = v; Store.save(); toast('저장됨'); } };
INPUT['set-autorest'] = (el) => { S().settings.autoRest = el.checked; Store.save(); };
INPUT['set-ws'] = (el) => { S().settings.weekStart = Number(el.value); Store.save(); };
INPUT['set-theme'] = (el) => { S().settings.theme = el.value; Store.save(); applyTheme(); };
ACT['del-custom'] = (el) => {
  if (!confirm('이 운동을 목록에서 삭제할까요? (기존 기록은 남지만 이름이 표시되지 않을 수 있어요)')) return;
  S().customExercises = S().customExercises.filter((e) => e.id !== el.dataset.id); Store.save(); renderView();
};

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
ACT['export'] = () => download(`fitlog-backup-${today()}.json`, Store.exportJSON(), 'application/json');
ACT['export-csv'] = () => {
  const rows = [['날짜', '종류', '제목', '운동', '세트', '무게(kg)', '횟수', '거리(km)', '시간', '페이스(/km)', '칼로리']];
  S().workouts.slice().sort((a, b) => orderKey(a).localeCompare(orderKey(b))).forEach((w) => {
    if (w.type === 'run') rows.push([w.date, '러닝', w.title, '', '', '', '', w.distanceKm, fmtDur(w.durationSec), fmtPace(w.durationSec / w.distanceKm), w.calories]);
    else w.exercises.forEach((e) => doneSets(e).forEach((s, i) => rows.push([w.date, '웨이트', w.title, exById(e.exId).name, s.warm ? 'W' : i + 1, s.w, s.r, '', '', '', ''])));
  });
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  download(`fitlog-${today()}.csv`, '﻿' + csv, 'text/csv'); // BOM: 엑셀 한글 깨짐 방지
};
ACT['import'] = () => $('#import-file').click();
INPUT['import-file'] = async (el) => {
  const f = el.files[0];
  if (!f) return;
  try {
    const text = await f.text();
    if (!confirm('현재 데이터를 백업 파일 내용으로 교체할까요?')) return;
    Store.importJSON(text); applyTheme(); renderView(); toast('불러오기 완료');
  } catch (err) {
    alert('불러오기 실패: ' + err.message);
  } finally { el.value = ''; }
};
ACT['reset'] = () => {
  if (!confirm('모든 기록과 루틴을 삭제합니다. 되돌릴 수 없어요. 계속할까요?')) return;
  Store.reset(); applyTheme(); renderView(); toast('초기화했어요');
};

function applyTheme() {
  const t = S().settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

/* =====================================================================
 * 11. 시작
 * ===================================================================== */
Store.load();
applyTheme();
renderView();

// 진행 중인 오늘 운동이 있으면 이어하기 안내
(() => {
  const open = S().workouts.find((w) => w.type === 'weight' && !w.finished && w.date === today());
  if (open) toast('진행 중인 운동이 있어요. 달력에서 이어서 기록하세요');
})();

// 오프라인 지원 (https 또는 localhost에서만 동작)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 등록 실패', e));
}
