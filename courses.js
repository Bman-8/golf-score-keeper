// Course search via GolfCourseAPI.com (free API key) + local cache.
const API_BASE = 'https://api.golfcourseapi.com/v1';

async function searchCourses(query, apiKey) {
  const res = await fetch(`${API_BASE}/search?search_query=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Key ${apiKey}` },
  });
  if (res.status === 429) throw new Error('Too many requests (429): the API\'s rate/daily limit was reached. Wait a while and try again, or use a saved course / manual entry.');
  if (res.status === 401 || res.status === 403) throw new Error(`API key rejected (${res.status}). Check your key.`);
  if (!res.ok) throw new Error(`Course search failed (${res.status}).`);
  const data = await res.json();
  // Search returns summaries only (tee counts); hole data comes from fetchCourse().
  return (data.courses || []).map(c => ({
    ...normalizeCourse({ ...c, tees: {} }),
    needsDetail: true,
  }));
}

async function fetchCourse(id, apiKey) {
  const res = await fetch(`${API_BASE}/courses/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Key ${apiKey}` },
  });
  if (res.status === 429) throw new Error('Too many requests (429): the API limit was reached. Try again later.');
  if (!res.ok) throw new Error(`Could not load course (${res.status}).`);
  const data = await res.json();
  const course = normalizeCourse(data.course || data);
  if (!course.tees.length) throw new Error('This course has no complete 18-hole data. Try another or enter it manually.');
  return course;
}

// Convert API course into {id, name, tees:[{name, holes:[{par, si, yards}]}]}
function normalizeCourse(c) {
  const tees = [];
  const t = c.tees || {};
  for (const gender of ['male', 'female']) {
    for (const tee of t[gender] || []) {
      if (!tee.holes || tee.holes.length < 18) continue;
      tees.push({
        name: `${tee.tee_name}${gender === 'female' ? ' (W)' : ''}`,
        holes: tee.holes.slice(0, 18).map(h => ({ par: h.par, si: h.handicap, yards: h.yardage })),
      });
    }
  }
  const name = c.club_name === c.course_name || !c.course_name ? c.club_name : `${c.club_name} - ${c.course_name}`;
  return { id: String(c.id), name, location: c.location ? `${c.location.city || ''}, ${c.location.state || ''}` : '', tees };
}

// Built-in courses (from published scorecards). Seeded once; removing one sticks.
const mk = (par, si) => par.map((p, i) => ({ par: p, si: si[i] }));
const BUILTIN_COURSES = [
  {
    id: 'builtin_msw_legends', name: 'Manila Southwoods G&CC - Legends', location: 'Carmona, Cavite',
    tees: [
      { name: "Men's", holes: mk([4,4,3,4,4,5,3,5,4, 4,4,3,4,5,4,3,5,4], [13,5,15,3,7,1,17,11,9, 8,16,12,18,4,10,14,2,6]) },
      { name: "Women's", holes: mk([4,4,3,4,4,5,3,5,4, 4,4,3,4,5,4,3,5,4], [11,1,15,5,7,3,17,9,13, 8,14,12,18,4,10,16,2,6]) },
    ],
  },
  {
    id: 'builtin_msw_masters', name: 'Manila Southwoods G&CC - Masters', location: 'Carmona, Cavite',
    tees: [
      { name: "Men's", holes: mk([4,4,3,5,3,4,4,5,4, 4,4,4,3,4,5,4,3,5], [11,1,15,9,17,5,7,13,3, 2,4,8,14,6,10,12,18,16]) },
      { name: "Women's", holes: mk([4,4,3,5,3,4,4,5,4, 4,4,4,3,4,5,4,3,5], [11,5,15,3,17,7,9,13,1, 2,4,6,16,10,8,12,18,14]) },
    ],
  },
];

function seedBuiltins() {
  try {
    const done = JSON.parse(localStorage.getItem('gsk_seeded') || '[]');
    const list = JSON.parse(localStorage.getItem('gsk_courses')) || [];
    for (const c of BUILTIN_COURSES) {
      if (!done.includes(c.id) && !list.some(x => x.id === c.id)) list.push(c);
      if (!done.includes(c.id)) done.push(c.id);
    }
    localStorage.setItem('gsk_courses', JSON.stringify(list));
    localStorage.setItem('gsk_seeded', JSON.stringify(done));
  } catch {}
}
seedBuiltins();

function loadSavedCourses() {
  try { return JSON.parse(localStorage.getItem('gsk_courses')) || []; } catch { return []; }
}
function isCourseSaved(id) { return loadSavedCourses().some(c => c.id === id); }
function removeSavedCourse(id) {
  localStorage.setItem('gsk_courses', JSON.stringify(loadSavedCourses().filter(c => c.id !== id)));
}
function saveCourse(course) {
  const list = loadSavedCourses().filter(c => c.id !== course.id);
  list.unshift(course);
  localStorage.setItem('gsk_courses', JSON.stringify(list.slice(0, 50)));
}
