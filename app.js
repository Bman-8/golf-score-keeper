const $ = s => document.querySelector(s);
const app = $('#app');
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

let settings = store.get('gsk_settings', { apiKey: '', goal: 89 });
let round = store.get('gsk_round', null); // {courseName, teeName, holes:[{par,si}], goal, scores:[], hole, date}
let view = round ? 'hole' : 'setup';
let setupState = { results: [], picked: null, manual: false, error: '', loading: false };

const save = () => { store.set('gsk_settings', settings); store.set('gsk_round', round); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtVs = n => (n > 0 ? '+' + n : n === 0 ? 'E' : String(n));

function go(v) { view = v; render(); }
document.querySelectorAll('nav button').forEach(b => b.onclick = () => go(b.dataset.view));

function render() {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  if (view !== 'setup' && !round && view !== 'history') view = 'setup';
  ({ setup: renderSetup, hole: renderHole, card: renderCard, history: renderHistory })[view]();
}

// ---------- Setup ----------
function renderSetup() {
  const s = setupState;
  const saved = loadSavedCourses();
  app.innerHTML = `
    <div class="card">
      <label>Goal score for the round</label>
      <input id="goal" type="number" inputmode="numeric" value="${settings.goal}">
      <p class="hint">Extra strokes beyond par are placed on the hardest holes first (by stroke index).</p>
    </div>
    <div class="card">
      <label>Find a course (GolfCourseAPI.com)</label>
      <div class="row"><input id="q" placeholder="Course name"><button class="sec" id="search" style="flex:0 0 90px">Search</button></div>
      <label>API key (free at golfcourseapi.com, saved on this phone)</label>
      <input id="key" type="password" value="${esc(settings.apiKey)}" placeholder="API key">
      ${s.loading ? '<p>Searching…</p>' : ''}${s.error ? `<p class="err">${esc(s.error)}</p>` : ''}
      <div class="list" id="results"></div>
    </div>
    ${saved.length ? `<div class="card"><b>Saved courses</b><div class="list" id="saved"></div></div>` : ''}
    <div class="card"><button class="sec" id="manual" style="width:100%">Enter a course manually</button></div>
    <div id="picker"></div>`;
  const list = (el, courses, removable) => courses.forEach(c => {
    const wrap = document.createElement('div');
    wrap.className = 'row';
    const b = document.createElement('button');
    b.textContent = c.name + (c.location ? ` — ${c.location}` : '');
    b.onclick = async () => {
      s.manual = false; s.prefill = null;
      if (c.needsDetail) {
        s.loading = true; s.error = ''; renderSetup();
        try { c = await fetchCourse(c.id, settings.apiKey); } catch (e) { s.loading = false; s.error = e.message; return renderSetup(); }
        s.loading = false;
      }
      s.picked = c; renderSetup(); // picking does NOT save; use "Save to My Courses"
    };
    wrap.appendChild(b);
    if (removable) {
      const x = document.createElement('button');
      x.textContent = '✕'; x.title = 'Remove saved course'; x.className = 'rm';
      x.style.flex = '0 0 48px';
      x.onclick = () => {
        if (!confirm(`Remove "${c.name}" from saved courses?`)) return;
        removeSavedCourse(c.id);
        if (s.picked && s.picked.id === c.id) s.picked = null;
        renderSetup();
      };
      wrap.appendChild(x);
    }
    el.appendChild(wrap);
  });
  list($('#results'), s.results);
  if (saved.length) list($('#saved'), saved, true);
  $('#goal').onchange = e => { settings.goal = +e.target.value || 90; save(); };
  $('#key').onchange = e => { settings.apiKey = e.target.value.trim(); save(); };
  $('#search').onclick = doSearch;
  $('#manual').onclick = () => { s.manual = true; s.picked = null; s.prefill = null; renderPicker(); };
  renderPicker();
}

async function doSearch() {
  const q = $('#q').value.trim(); settings.apiKey = $('#key').value.trim(); save();
  if (!q) return;
  if (!settings.apiKey) { setupState.error = 'Enter your API key first (or use manual entry).'; return renderSetup(); }
  setupState.loading = true; setupState.error = ''; renderSetup();
  try { setupState.results = await searchCourses(q, settings.apiKey); if (!setupState.results.length) setupState.error = 'No courses with full hole data found.'; }
  catch (e) { setupState.error = e.message; }
  setupState.loading = false; renderSetup();
}

function renderPicker() {
  const s = setupState, el = $('#picker');
  if (s.picked) {
    el.innerHTML = `<div class="card"><b>${esc(s.picked.name)}</b>
      <label>Tee</label><select id="tee">${s.picked.tees.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join('')}</select>
      <button class="primary" id="start">Start round</button>
      ${isCourseSaved(s.picked.id) ? '<p class="hint">✓ In My Courses</p>' : '<button class="sec" id="savec" style="width:100%;margin-top:10px">Save to My Courses</button>'}</div>`;
    if ($('#savec')) $('#savec').onclick = () => { saveCourse(s.picked); renderSetup(); };
    $('#start').onclick = () => {
      const tee = s.picked.tees[+$('#tee').value];
      const si = tee.holes.map(h => h.si);
      if (si.some(x => !Number.isInteger(x) || x < 1 || x > 18) || new Set(si).size !== 18) {
        // Course database has no (valid) stroke index for this tee: let the user fill it in.
        s.prefill = { course: s.picked, teeName: tee.name, name: s.picked.name, pars: tee.holes.map(h => h.par) };
        s.manual = true; s.picked = null; return renderPicker();
      }
      startRound(s.picked.name, tee);
    };
  } else if (s.manual) {
    const pf = s.prefill;
    let rows = '';
    for (let i = 0; i < 18; i++) rows += `<tr><td>${i + 1}</td><td><input class="mp" type="number" inputmode="numeric" value="${pf ? pf.pars[i] : 4}"></td><td><input class="ms" type="number" inputmode="numeric" value="${pf ? '' : i + 1}" placeholder="1-18"></td></tr>`;
    el.innerHTML = `<div class="card">${pf ? '<p class="err">This course has no stroke index data online. Par was filled in; please enter each hole\'s index (1–18, from the scorecard) once — it will be saved.</p>' : ''}
      <label>Course name</label><input id="mname" placeholder="My course" value="${pf ? esc(pf.name) : ''}">
      <table><tr><th>Hole</th><th>Par</th><th>Index</th></tr>${rows}</table>
      <button class="primary" id="mstart">Save &amp; start round</button></div>`;
    $('#mstart').onclick = () => {
      const par = [...document.querySelectorAll('.mp')].map(i => +i.value || 4);
      const si = [...document.querySelectorAll('.ms')].map(i => +i.value);
      if (new Set(si).size !== 18 || si.some(x => x < 1 || x > 18)) return alert('Stroke index must use each number 1–18 once.');
      const name = $('#mname').value.trim() || 'My course';
      const holes = par.map((p, i) => ({ par: p, si: si[i] }));
      if (pf) {
        // Register the typed index on the existing course/tee so it's remembered next time.
        const course = JSON.parse(JSON.stringify(pf.course));
        const tee = course.tees.find(t => t.name === pf.teeName);
        tee.holes = tee.holes.map((h, i) => ({ ...h, par: holes[i].par, si: holes[i].si }));
        saveCourse(course);
        s.prefill = null; s.manual = false;
        return startRound(course.name, tee);
      }
      saveCourse({ id: 'm_' + Date.now(), name, location: '', tees: [{ name: 'Default', holes }] });
      startRound(name, { name: 'Default', holes });
    };
  } else el.innerHTML = '';
}

function startRound(courseName, tee) {
  settings.goal = +$('#goal').value || settings.goal;
  round = { courseName, teeName: tee.name, holes: tee.holes.map(h => ({ par: h.par, si: h.si })), goal: settings.goal, scores: Array(18).fill(null), hole: 0, date: new Date().toISOString() };
  save(); go('hole');
}

// ---------- Hole ----------
const targets = () => computeTargets(round.holes, round.goal);

function renderHole() {
  const t = targets(), i = round.hole, h = t[i], sc = round.scores[i];
  const played = round.scores.map((s, k) => s == null ? null : k).filter(k => k != null);
  const vsPar = played.reduce((a, k) => a + round.scores[k] - t[k].par, 0);
  const vsTgt = played.reduce((a, k) => a + round.scores[k] - t[k].target, 0);
  app.innerHTML = `
    <div class="card big">
      <div class="status">${esc(round.courseName)} · ${esc(round.teeName)} · Goal ${round.goal}</div>
      <div class="hole-no">Hole ${i + 1}</div>
      <div class="status">Stroke index ${h.si}</div>
      <div class="pair">
        <div class="par"><small>PAR</small><b>${h.par}</b></div>
        <div class="tgt"><small>YOUR TARGET</small><b>${h.target}</b></div>
      </div>
      <div class="stepper"><button id="minus">−</button><div class="sc">${sc ?? '–'}</div><button id="plus">+</button></div>
      <div class="row"><button class="sec" id="prev" ${i === 0 ? 'disabled' : ''}>◀ Prev</button>
        <button class="sec" id="next">${i === 17 ? 'Finish' : 'Next ▶'}</button></div>
    </div>
    <p class="status">Through ${played.length}: ${fmtVs(vsPar)} vs par · ${fmtVs(vsTgt)} vs target</p>`;
  const set = v => { round.scores[i] = Math.max(1, v); save(); renderHole(); };
  $('#plus').onclick = () => set((sc ?? h.target - 1) + 1);
  $('#minus').onclick = () => set((sc ?? h.target + 1) - 1);
  $('#prev').onclick = () => { round.hole--; save(); renderHole(); };
  $('#next').onclick = () => { if (i === 17) return go('card'); if (sc == null) round.scores[i] = h.target; round.hole++; save(); renderHole(); };
}

// ---------- Card ----------
function cardRows(r) {
  const t = computeTargets(r.holes, r.goal);
  let tp = 0, tt = 0, ts = 0, rows = '';
  t.forEach((h, i) => {
    const s = r.scores[i];
    tp += h.par; tt += h.target; if (s != null) ts += s;
    const cls = s == null ? '' : s <= h.target ? 'good' : 'bad';
    rows += `<tr><td>${i + 1}</td><td>${h.si}</td><td>${h.par}</td><td>${h.target}</td><td class="${cls}">${s ?? ''}</td></tr>`;
  });
  return { rows, tp, tt, ts, done: r.scores.filter(s => s != null).length };
}

function renderCard() {
  const c = cardRows(round);
  app.innerHTML = `<div class="card"><b>${esc(round.courseName)}</b> · Goal ${round.goal}
    <table><tr><th>Hole</th><th>Idx</th><th>Par</th><th>Target</th><th>Score</th></tr>${c.rows}
    <tr><th>Total</th><th></th><th>${c.tp}</th><th>${c.tt}</th><th>${c.done ? c.ts : ''}</th></tr></table>
    <p class="status">${c.done === 18 ? `Final ${c.ts} (${fmtVs(c.ts - c.tp)}) — ${c.ts <= round.goal ? 'goal met! 🎉' : (c.ts - round.goal) + ' over goal'}` : `${c.done}/18 holes scored`}</p>
    <button class="primary" id="finish">Save to history &amp; new round</button></div>`;
  $('#finish').onclick = () => {
    if (!confirm('Save this round and start a new one?')) return;
    const hist = store.get('gsk_history', []); hist.unshift(round); store.set('gsk_history', hist);
    round = null; save(); go('setup');
  };
}

// ---------- History ----------
function renderHistory() {
  const hist = store.get('gsk_history', []);
  app.innerHTML = hist.length ? hist.map((r, i) => {
    const c = cardRows(r);
    return `<div class="card"><b>${esc(r.courseName)}</b><div class="hint">${new Date(r.date).toLocaleDateString()} · Goal ${r.goal}</div>
      <div class="row"><div style="font-size:26px">${c.ts} <small>(${fmtVs(c.ts - c.tp)})</small></div>
      <button class="sec del" data-i="${i}" style="flex:0 0 auto;color:var(--red)">Delete</button></div></div>`;
  }).join('') + '<button class="sec" id="clearall" style="width:100%;color:var(--red);margin-top:6px">Delete all history</button>'
  : '<p class="status">No saved rounds yet.</p>';
  document.querySelectorAll('.del').forEach(b => b.onclick = () => {
    if (!confirm('Delete this round? This cannot be undone.')) return;
    const h = store.get('gsk_history', []); h.splice(+b.dataset.i, 1); store.set('gsk_history', h); renderHistory();
  });
  const ca = $('#clearall');
  if (ca) ca.onclick = () => {
    if (!confirm('Delete ALL saved rounds? This cannot be undone.')) return;
    store.set('gsk_history', []); renderHistory();
  };
}

render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
