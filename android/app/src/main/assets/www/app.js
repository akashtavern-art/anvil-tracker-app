const STORAGE_KEY = 'anvil_state_v1';
const DEFAULT_STATE = {
  profile: null,
  onboardingCompleted: false,
  weeklyAudit: {
    lastCompleted: null,
    audioPath: null
  },
  photos: [],
  workoutRoutines: [],
  workoutEntries: [],
  taskList: [],
  taskCompletions: {},
  nutrition: {},
  deadDays: [],
  streaks: {
    workout: 0,
    nutrition: 0,
    habit: 0
  },
  lastDeadCheck: null,
  filters: {
    usage: 7,
    wealth: 7,
    workout: 14,
    nutrition: 7,
    heatmap: 84
  }
};

const state = loadState();
let charts = {};
let currentAuditMode = false;
let reflectionRunning = false;
let reflectionTimer;
let boundEvents = false;

const bridge = {
  hasUsagePermission: () => !!(window.AnvilBridge && typeof window.AnvilBridge.hasUsagePermission === 'function' && window.AnvilBridge.hasUsagePermission()),
  requestUsageAccess: () => window.AnvilBridge && window.AnvilBridge.requestUsageAccess && window.AnvilBridge.requestUsageAccess(),
  getDailyUsage: (days) => {
    try {
      if (!window.AnvilBridge || typeof window.AnvilBridge.getDailyUsage !== 'function') return null;
      return JSON.parse(window.AnvilBridge.getDailyUsage(days));
    } catch (_e) {
      return null;
    }
  },
  scheduleNotification: (id, title, body, when, repeat) => {
    if (!window.AnvilBridge || typeof window.AnvilBridge.scheduleNotification !== 'function') return;
    window.AnvilBridge.scheduleNotification(id, title, body, when, repeat);
  },
  cancelNotification: (id) => {
    if (!window.AnvilBridge || typeof window.AnvilBridge.cancelNotification !== 'function') return;
    window.AnvilBridge.cancelNotification(id);
  },
  startAudioCapture: () => {
    if (!window.AnvilBridge || typeof window.AnvilBridge.startAudioCapture !== 'function') return '';
    return window.AnvilBridge.startAudioCapture('weekly_audit');
  },
  stopAudioCapture: () => {
    if (!window.AnvilBridge || typeof window.AnvilBridge.stopAudioCapture !== 'function') return '';
    return window.AnvilBridge.stopAudioCapture();
  },
  exportData: (jsonPayload, csvPayload) => {
    if (window.AnvilBridge && typeof window.AnvilBridge.exportData === 'function') {
      return window.AnvilBridge.exportData(jsonPayload, csvPayload);
    }
    return null;
  }
};

const CHART_EMPTY_TEXT = {
  usageChart: 'Usage data not available yet.',
  wealthTrendChart: 'No net worth history yet.',
  workoutChart: 'Log workouts to build this chart.',
  workoutProgressChart: 'Log workouts to build this chart.',
  nutritionChart: 'Add nutrition entries to build this chart.'
};

const CHART_KEY_TO_STORE = {
  usageChart: 'usage',
  wealthTrendChart: 'wealth',
  workoutChart: 'workout',
  workoutProgressChart: 'workout',
  nutritionChart: 'nutrition'
};
const APK_REPO_OWNER = 'akashtavern-art';
const APK_REPO_NAME = 'anvil-tracker-app';
const APK_RELEASES_URL = `https://github.com/${APK_REPO_OWNER}/${APK_REPO_NAME}/releases/latest`;
const APK_RELEASE_API_URL = `https://api.github.com/repos/${APK_REPO_OWNER}/${APK_REPO_NAME}/releases/latest`;

const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasChartLibrary() {
  return typeof Chart !== 'undefined';
}

function setChartEmptyState(chartId, hasData, message) {
  const canvas = qs(`#${chartId}`);
  if (!canvas) return;

  const host = canvas.parentElement;
  if (!host) return;

  let marker = host.querySelector(`.chart-empty[data-chart="${chartId}"]`);
  if (hasData) {
    if (marker) marker.remove();
    canvas.classList.remove('chart-muted');
    return;
  }

  if (!marker) {
    marker = document.createElement('div');
    marker.className = 'chart-empty';
    marker.dataset.chart = chartId;
    host.appendChild(marker);
  }

  marker.textContent = message;
  canvas.classList.add('chart-muted');
}

function destroyChart(chartIdOrStore) {
  const chart = charts[chartIdOrStore];
  if (!chart) return;
  chart.destroy();
  charts[chartIdOrStore] = null;
}

function applyChartState(chartId, hasData, message) {
  const storeKey = CHART_KEY_TO_STORE[chartId] || chartId;
  setChartEmptyState(chartId, hasData, message || CHART_EMPTY_TEXT[chartId] || 'No data available');

  if (!hasData) {
    destroyChart(storeKey);
    return null;
  }

  const existing = charts[storeKey];
  return existing;
}

function triggerDownload(url, filename) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  if (filename) {
    anchor.download = filename;
  }
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function handleApkDownload() {
  showToast('Looking for latest APK release...');
  try {
    const response = await fetch(APK_RELEASE_API_URL);
    if (!response.ok) {
      throw new Error('release-api');
    }

    const release = await response.json();
    const apk = (release.assets || []).find((asset) => /\.apk$/i.test(asset.name || ''));
    if (apk && apk.browser_download_url) {
      triggerDownload(apk.browser_download_url, apk.name || 'anvil-tracker-app.apk');
      showToast('Downloading latest APK...');
      return;
    }
  } catch (_e) {
    // fallback below
  }

  window.open(APK_RELEASES_URL, '_blank', 'noopener');
  showToast('Opening release page. Pick an APK file to download.');
}

function ensureNumericRange(value, min = 0, max = Number.POSITIVE_INFINITY) {
  const safe = safeNumber(value, min);
  return Math.max(min, Math.min(max, safe));
}

function nowString() {
  return new Date().toISOString().split('T')[0];
}

function safeId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
}

function dayIndex(d) {
  return d.toISOString().split('T')[0];
}

function addDays(date, days) {
  const t = new Date(date);
  t.setDate(t.getDate() + days);
  return t;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return JSON.parse(JSON.stringify(DEFAULT_STATE));
  try {
    const parsed = JSON.parse(raw);
    const merged = {
      ...JSON.parse(JSON.stringify(DEFAULT_STATE)),
      ...parsed,
      weeklyAudit: {
        ...DEFAULT_STATE.weeklyAudit,
        ...(parsed.weeklyAudit || {})
      },
      filters: { ...DEFAULT_STATE.filters, ...(parsed.filters || {}) }
    };

    const safe = {
      ...merged,
      photos: Array.isArray(merged.photos) ? merged.photos : [],
      workoutRoutines: Array.isArray(merged.workoutRoutines) ? merged.workoutRoutines : [],
      workoutEntries: Array.isArray(merged.workoutEntries) ? merged.workoutEntries : [],
      taskList: Array.isArray(merged.taskList) ? merged.taskList : [],
      taskCompletions: merged.taskCompletions && typeof merged.taskCompletions === 'object' && !Array.isArray(merged.taskCompletions)
        ? merged.taskCompletions
        : {},
      nutrition: merged.nutrition && typeof merged.nutrition === 'object' && !Array.isArray(merged.nutrition)
        ? merged.nutrition
        : {},
      deadDays: Array.isArray(merged.deadDays) ? merged.deadDays : [],
      streaks: {
        workout: safeNumber(merged.streaks?.workout, 0),
        nutrition: safeNumber(merged.streaks?.nutrition, 0),
        habit: safeNumber(merged.streaks?.habit, 0)
      }
    };

    if (safe.profile) {
      safe.profile = {
        ...safe.profile,
        name: safe.profile.name || '',
        birthYear: safeNumber(safe.profile.birthYear),
        height: safeNumber(safe.profile.height),
        weight: safeNumber(safe.profile.weight),
        netWorth: safeNumber(safe.profile.netWorth),
        skills: safe.profile.skills || '',
        photoCount: safeNumber(safe.profile.photoCount, 0),
        heightHistory: Array.isArray(safe.profile.heightHistory) ? safe.profile.heightHistory : [],
        weightHistory: Array.isArray(safe.profile.weightHistory) ? safe.profile.weightHistory : [],
        netWorthHistory: Array.isArray(safe.profile.netWorthHistory) ? safe.profile.netWorthHistory : []
      };
    }

    return safe;
  } catch (_e) {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function showToast(message) {
  const t = qs('#toast');
  t.textContent = message;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

function applyTab(view) {
  qsa('.screen').forEach((screen) => screen.classList.remove('active'));
  qsa('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
  if (view) {
    const activeScreen = qs(`#${view}`);
    if (activeScreen) activeScreen.classList.add('active');
  }
}

function updateVisibility() {
  const onboarding = qs('#onboardingView');
  if (!state.onboardingCompleted) {
    qsa('.screen').forEach((screen) => screen.classList.remove('active'));
    qsa('.tab-row .tab').forEach((tab) => tab.classList.remove('active'));
    onboarding.classList.remove('hidden');
    qs('#weeklyModal').classList.add('hidden');
  } else {
    onboarding.classList.add('hidden');
    applyTab('dashboard');
  }
}

function formatMoneyMills(value) {
  return `$${Number(value || 0).toFixed(2)}M`;
}

function initOdometer(inputId, displayId, parser, formatValue) {
  const input = qs(`#${inputId}`);
  const display = qs(`#${displayId}`);
  if (!input || !display) return;

  if (input.dataset.bound === '1') return;
  input.dataset.bound = '1';

  const update = () => {
    const raw = safeNumber(parser(input.value), 0);
    const next = formatValue(raw);
    animateOdometer(display, next);
  };

  input.addEventListener('input', update);
  update();
}

function animateOdometer(target, text) {
  target.innerHTML = '';
  const value = text.toString();
  for (const ch of value) {
    if (ch === '.' || ch === '$') {
      const staticCell = document.createElement('span');
      staticCell.textContent = ch;
      staticCell.className = 'od-digit-cell';
      target.appendChild(staticCell);
      continue;
    }

    const digit = Number(ch);
    const col = document.createElement('span');
    col.className = 'od-digit';

    const track = document.createElement('span');
    track.className = 'od-digit-track';
    for (let n = 0; n <= 9; n++) {
      const cell = document.createElement('span');
      cell.className = 'od-digit-cell';
      cell.textContent = String(n);
      track.appendChild(cell);
    }

    col.appendChild(track);
    target.appendChild(col);
    requestAnimationFrame(() => {
      const base = parseFloat(getComputedStyle(target).fontSize) * 1.35;
      track.style.transform = `translateY(-${digit * base}px)`;
    });
  }
}

function readPhotoFiles(fileInputId, statePhotosTarget) {
  const fileInput = qs(`#${fileInputId}`);
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) return;
  const files = Array.from(fileInput.files).slice(0, 10);
  files.forEach((file) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const src = evt.target.result;
      if (!statePhotosTarget.includes(src)) {
        statePhotosTarget.unshift(src);
      }
      refreshPhotoGrids();
      persist();
    };
    reader.readAsDataURL(file);
  });

  fileInput.value = '';
  if (statePhotosTarget.length > 10) {
    statePhotosTarget.splice(10);
  }
}

function refreshPhotoGrids() {
  const preview = qs('#photoPreview');
  const gallery = qs('#photoGallery');
  if (preview) {
    preview.innerHTML = '';
    state.photos.forEach((p) => {
      const img = document.createElement('img');
      img.src = p;
      preview.appendChild(img);
    });
  }
  if (gallery) {
    gallery.innerHTML = '';
    state.photos.forEach((p) => {
      const img = document.createElement('img');
      img.src = p;
      gallery.appendChild(img);
    });
  }
}

function setRingProgress(name, value, max) {
  const ring = document.querySelector(`[data-ring="${name}"]`);
  if (!ring) return;
  const circumference = Math.PI * 2 * 82;
  const safeMax = Math.max(1, max);
  const percent = Math.min(1, Math.max(0, value / safeMax));
  const offset = Math.round(circumference - percent * circumference);
  ring.style.strokeDasharray = circumference.toString();
  ring.style.strokeDashoffset = offset.toString();
}

function ensureNutrientsToday() {
  const today = nowString();
  if (!state.nutrition[today]) {
    state.nutrition[today] = { protein: 0, water: 0 };
  }
  return state.nutrition[today];
}

function updateNutritionUI() {
  const today = ensureNutrientsToday();
  const protein = Number(today.protein || 0);
  const water = Number(today.water || 0);
  qs('#proteinNow').textContent = `${protein.toFixed(0)}g`;
  qs('#waterNow').textContent = `${water.toFixed(1)}L`;
  setRingProgress('protein', protein, 180);
  setRingProgress('water', water, 3);
}

function setupWorkoutSelectors() {
  const select = qs('#workoutTarget');
  const chartSelect = qs('#workoutChartSelector');
  [select, chartSelect].forEach((el) => {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  });

  state.workoutRoutines.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = `${item.name} (${item.mode})`;
    if (select) select.appendChild(opt.cloneNode(true));
    if (chartSelect) chartSelect.appendChild(opt);
  });

  if (state.workoutRoutines.length > 0) {
    if (select) select.value = state.workoutRoutines[0].id;
    if (chartSelect) chartSelect.value = state.workoutRoutines[0].id;
  }
}

function workoutValueForRoutine(entry) {
  return Number(entry.set1 || 0);
}

function routineStagnationTag(routine) {
  const entries = state.workoutEntries
    .filter((entry) => entry.routineId === routine.id)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (entries.length < 2) return '';
  const latestDay = addDays(new Date(), -14);
  const windowEntries = entries.filter((entry) => new Date(entry.date) >= latestDay);
  if (windowEntries.length < 2) return '';

  const sorted = windowEntries.map((e) => workoutValueForRoutine(e)).sort((a, b) => a - b);
  const earliest = sorted[0];
  const latest = sorted[sorted.length - 1];
  if (latest <= earliest) {
    return '<span class="chip" style="color:#fecdd3">Stagnant 14 days</span>';
  }
  return '';
}

function getRoutineEntries(routineId, days = 365) {
  const from = addDays(new Date(), -days);
  return state.workoutEntries
    .filter((entry) => entry.routineId === routineId && new Date(entry.date) >= from)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function updateWorkoutCards() {
  const list = qs('#routineList');
  list.innerHTML = '';
  if (state.workoutRoutines.length === 0) {
    list.innerHTML = '<p>Build routines mapped to days and start logging.</p>';
    return;
  }

  state.workoutRoutines.forEach((routine) => {
    const card = document.createElement('article');
    const recent = state.workoutEntries.filter((e) => e.routineId === routine.id).slice(-4);
    const tag = routineStagnationTag(routine);
    card.innerHTML = `
      <div class="card-head">
        <h4>${routine.name}</h4>
        <small>${routine.mode}</small>
      </div>
      <p>Mapped: ${routine.days.join(', ') || 'No days'}</p>
      ${tag ? `<div>${tag}</div>` : ''}
      <div>${recent.map((entry) => `${entry.date}: ${entry.set1} / ${entry.set2} (${entry.reps || 0} reps)` ).join('<br>')}</div>
    `;
    list.appendChild(card);
  });

  const selector = qs('#workoutChartSelector');
  if (selector && selector.children.length) {
    const selected = selector.value || selector.children[0].value;
    drawWorkoutChart(selected);
  }
}

function refreshWorkoutForm() {
  setupWorkoutSelectors();
  updateWorkoutCards();
}

function getCoreTaskIds() {
  return state.taskList.filter((task) => task.isCore).map((task) => task.id);
}

function getTaskCompletionsForDate(key) {
  const entry = state.taskCompletions[key] || {};
  return entry;
}

function hasAnyCompletedTask(entry) {
  return entry && Object.values(entry).some((value) => !!value);
}

function isHabitDayComplete(entry, key, coreIds) {
  if (!entry || !coreIds || coreIds.length === 0) {
    return hasAnyCompletedTask(entry);
  }
  return coreIds.every((id) => !!entry[id]);
}

function getTaskNotificationId(task) {
  const digits = String(task.id || '').replace(/\D/g, '').slice(0, 9);
  if (digits.length) return Number(digits);

  let hash = 0;
  const source = `${task.name || ''}${task.time || ''}`;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) % 900000;
  }
  return hash;
}

function ensureDeadDays() {
  const today = new Date(nowString());
  const last = state.lastDeadCheck ? new Date(state.lastDeadCheck) : addDays(today, -20);
  const cursor = Number.isFinite(last.getTime()) ? last : addDays(today, -20);
  const coreIds = getCoreTaskIds();

  const start = cursor > today ? today : cursor;

  let current = new Date(start);
  while (current <= today) {
    const key = dayIndex(current);
    const completions = getTaskCompletionsForDate(key);
    const done = isHabitDayComplete(completions, key, coreIds);
    if (!done) {
      if (!state.deadDays.includes(key)) {
        state.deadDays.unshift(key);
      }
    }
    current = addDays(current, 1);
  }

  state.deadDays = [...new Set(state.deadDays.filter(Boolean))]
    .sort((a, b) => new Date(b) - new Date(a));
  state.lastDeadCheck = nowString();
}

function updateHeatmap() {
  const heatmap = qs('#calendarHeatmap');
  if (!heatmap) return;
  heatmap.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'heatmap';
  const base = new Date();
  base.setDate(base.getDate() - 83);
  for (let i = 0; i < 84; i++) {
    const date = addDays(base, i);
    const key = dayIndex(date);
    const cell = document.createElement('div');
    cell.className = 'heat-cell';
    cell.title = key;

    const core = getCoreTaskIds();
    const c = getTaskCompletionsForDate(key);
    const done = core.length === 0
      ? (hasAnyCompletedTask(c) ? 1 : 0)
      : (core.filter((id) => !!c[id]).length / core.length);

    if (state.deadDays.includes(key)) {
      cell.classList.add('dead');
    } else if (done >= 1) {
      cell.classList.add('good');
    } else if (done > 0.5) {
      cell.classList.add('hit');
    }
    wrapper.appendChild(cell);
  }
  const summary = qs('#deadDaySummary');
  if (summary) {
    summary.textContent = state.deadDays.length
      ? `Dead days: ${state.deadDays.slice(0, 5).join(', ')}`
      : 'No missed core habits yet';
  }
  heatmap.appendChild(wrapper);
}

function renderDeadList() {
  const target = qs('#deadDays');
  if (!target) return;
  target.innerHTML = '';
  if (!state.deadDays.length) {
    target.innerHTML = '<p>Consistency is clean.</p>';
    return;
  }
  state.deadDays.slice(0, 40).forEach((date) => {
    const row = document.createElement('div');
    row.className = 'task-row';
    row.innerHTML = `<span style="color:#fecaca">${date}</span> <span>Missed core routines</span>`;
    target.appendChild(row);
  });
}

function updateTaskList() {
  const list = qs('#taskList');
  list.innerHTML = '';
  if (state.taskList.length === 0) {
    list.innerHTML = '<p>Add core tasks and daily tasks.</p>';
    return;
  }

  state.taskList.forEach((task) => {
    const row = document.createElement('label');
    row.className = 'task-row';
    row.innerHTML = `<input type="checkbox" data-task="${task.id}"/> <span>${task.time}</span><span>${task.name}</span><button class="tiny-btn" data-task-notify="${task.id}">Notify</button>`;
    const todayKey = nowString();
    const completed = !!((state.taskCompletions[todayKey] || {})[task.id]);
    const cb = row.querySelector('input');
    cb.checked = completed;
    cb.addEventListener('change', () => {
      state.taskCompletions[todayKey] = state.taskCompletions[todayKey] || {};
      state.taskCompletions[todayKey][task.id] = cb.checked;
      persist();
      ensureDeadDays();
      updateHeatmap();
      updateStreaks();
      renderDeadList();
    });
    row.querySelector('[data-task-notify]').addEventListener('click', () => {
      const [h, m] = (task.time || '').split(':').map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) {
        showToast('Set a valid task time before scheduling notification.');
        return;
      }
      const now = new Date();
      const trigger = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
      const id = Number(String(task.id).replace(/\D/g, '').slice(0, 8)) || Math.abs((String(task.name || '').length || 1) * 11);
      bridge.scheduleNotification(id, 'Anvil Habit', `${task.name} due now`, trigger, true);
      showToast('Notification scheduled daily');
    });
    list.appendChild(row);
  });
}

function updateStreaks() {
  const workout = getConsecutiveDatesHasValue(state.workoutEntries, (entries) => entries.length > 0);
  const nutrition = getConsecutiveDatesHasValue(state.nutrition, (n) => !!n.protein || !!n.water);
  const habit = getConsecutiveDatesHasValue(state.taskCompletions, (entry, date) => {
    const coreIds = getCoreTaskIds();
    const completed = isHabitDayComplete(entry, date, coreIds);
    const done = completed;
    return done;
  });
  state.streaks = { workout, nutrition, habit };

  const target = qs('#streakList');
  if (!target) return;
  target.innerHTML = `
    <p>Workouts: ${workout}d</p>
    <p>Nutrition: ${nutrition}d</p>
    <p>Routines: ${habit}d</p>
  `;
}

function getConsecutiveDatesHasValue(source, predicate) {
  const today = new Date(nowString());
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const key = dayIndex(addDays(today, -i));
    const entry = Array.isArray(source)
      ? source.filter((entry) => entry.date === key)
      : source[key];
    const valid = entry ? predicate(entry, key) : false;
    if (valid) streak++;
    else break;
  }
  return streak;
}

function drawUsageChart(days) {
  if (!hasChartLibrary()) {
    applyChartState('usageChart', false, 'Chart engine is not loaded yet.');
    return;
  }

  const canvas = qs('#usageChart');
  if (!canvas || !canvas.getContext) {
    return;
  }

  const data = bridge.getDailyUsage(days) || [];
  const safeData = Array.isArray(data)
    ? data
        .map((item) => ({
          label: item?.app || item?.package || 'Unknown',
          value: Number((Number(item?.ms || 0) / 60000).toFixed(1))
        }))
        .filter((row) => row.label && Number.isFinite(row.value))
    : [];
  const labels = safeData.length ? safeData.map((row) => row.label) : ['No data'];
  const points = safeData.length ? safeData.map((row) => row.value) : [0];
  const hasData = safeData.length > 0;
  const existing = applyChartState('usageChart', hasData, CHART_EMPTY_TEXT.usageChart);
  if (!existing) return;

  if (existing) {
    existing.data.labels = labels;
    existing.data.datasets[0].data = points;
    existing.update();
    return;
  }

  charts.usage = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Minutes',
          data: points,
          borderRadius: 8,
          backgroundColor: 'rgba(56,189,248,0.75)'
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        tooltip: {
          backgroundColor: '#0f172a',
          bodyColor: '#e2e8f0',
          titleColor: '#bae6fd',
          callbacks: {
            label: (ctx) => `${ctx.formattedValue} min`
          }
        },
        legend: { display: false }
      },
      scales: {
        x: { ticks: { color: '#cbd5e1' }, grid: { color: '#33415555' } },
        y: { ticks: { color: '#cbd5e1' }, grid: { color: '#33415555' } }
      }
    }
  });
}

function drawTrendChart(lines, target, label, color) {
  if (!hasChartLibrary()) {
    applyChartState(target, false, 'Chart engine is not loaded yet.');
    return;
  }

  const canvas = qs(`#${target}`);
  if (!canvas || !canvas.getContext) {
    return;
  }

  const normalized = Array.isArray(lines)
    ? lines
        .map((item) => ({
          date: item?.date,
          value: Number(item?.value || 0)
        }))
        .filter((row) => row.date)
    : [];
  const hasData = normalized.length > 0;

  const existing = applyChartState(target, hasData, CHART_EMPTY_TEXT[target] || 'No data to display');
  if (!hasData) return;

  const labels = normalized.map((item) => item.date);
  const values = normalized.map((item) => item.value);

  const chartTarget = CHART_KEY_TO_STORE[target] || target;
  if (existing) {
    existing.data.labels = labels;
    existing.data.datasets[0].data = values;
    existing.update();
    return;
  }

  charts[chartTarget] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label,
          data: values,
          fill: true,
          tension: 0.36,
          borderColor: color,
          backgroundColor: `${color}33`,
          pointBackgroundColor: '#f0f9ff',
          borderWidth: 2
        }
      ]
    },
    options: {
      plugins: { legend: { labels: { color: '#e2e8f0' }, } },
      scales: {
        x: { ticks: { color: '#cbd5e1' }, grid: { color: '#33415555' } },
        y: { ticks: { color: '#cbd5e1' }, grid: { color: '#33415555' } }
      },
      interaction: { intersect: false, mode: 'index' }
    }
  });
}

function drawWorkoutChart(routineId) {
  if (!hasChartLibrary()) {
    applyChartState('workoutProgressChart', false, 'Chart engine is not loaded yet.');
    return;
  }

  if (!routineId) {
    applyChartState('workoutProgressChart', false, CHART_EMPTY_TEXT.workoutProgressChart);
    return;
  }
  const days = Number(state.filters.workout);
  const entries = getRoutineEntries(routineId, days);
  const data = Array.isArray(entries)
    ? entries
        .map((entry) => ({
          date: entry?.date,
          value: safeNumber(entry?.set1 || entry?.weight || 0)
        }))
        .filter((row) => row.date)
    : [];
  const canvas = qs('#workoutProgressChart');
  if (!canvas || !canvas.getContext) return;

  const hasData = data.length > 0;
  const existing = applyChartState('workoutProgressChart', hasData, CHART_EMPTY_TEXT.workoutProgressChart);
  if (!hasData) return;

  if (charts.workout) {
    charts.workout.data.labels = data.map((x) => x.date);
    charts.workout.data.datasets[0].data = data.map((x) => x.value);
    charts.workout.update();
    return;
  }

  charts.workout = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: data.map((row) => row.date),
      datasets: [
        {
          label: 'Progress',
          data: data.map((row) => row.value),
          tension: 0.38,
          fill: true,
          borderColor: '#0ea5e9',
          backgroundColor: 'rgba(14,165,233,0.2)'
        }
      ]
    },
    options: {
      scales: {
        x: { ticks: { color: '#cbd5e1' }, grid: { color: '#33415555' } },
        y: { ticks: { color: '#cbd5e1' }, grid: { color: '#33415555' } }
      },
      plugins: { legend: { labels: { color: '#e2e8f0' } } }
    }
  });
}

function drawNutritionChart(days) {
  if (!hasChartLibrary()) {
    applyChartState('nutritionChart', false, 'Chart engine is not loaded yet.');
    return;
  }

  const canvas = qs('#nutritionChart');
  if (!canvas || !canvas.getContext) return;

  const from = addDays(new Date(), -days);
  const points = Object.entries(state.nutrition || {})
    .filter(([date]) => date && new Date(date) >= from)
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .map(([date, value]) => ({
      date,
      protein: Number(value?.protein || 0),
      water: Number(value?.water || 0) * 100
    }));

  const labels = points.map((item) => item.date);
  const protein = points.map((item) => item.protein);
  const water = points.map((item) => item.water);

  const hasData = labels.length > 0;
  const existing = applyChartState('nutritionChart', hasData, CHART_EMPTY_TEXT.nutritionChart);
  if (!hasData) return;

  if (charts.nutrition) {
    charts.nutrition.data.labels = labels;
    charts.nutrition.data.datasets[0].data = protein;
    charts.nutrition.data.datasets[1].data = water;
    charts.nutrition.update();
    return;
  }

  charts.nutrition = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Protein g',
          data: protein,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56,189,248,0.2)',
          tension: 0.4
        },
        {
          label: 'Water ml',
          data: water,
          borderColor: '#22d3ee',
          backgroundColor: 'rgba(34,211,238,0.2)',
          tension: 0.4
        }
      ]
    },
    options: {
      plugins: { legend: { labels: { color: '#e2e8f0' } } },
      scales: {
        x: { ticks: { color: '#cbd5e1' }, grid: { color: '#33415555' } },
        y: { ticks: { color: '#cbd5e1' }, grid: { color: '#33415555' } }
      }
    }
  });
}

function updateDashboardCharts() {
  drawUsageChart(state.filters.usage);

  if (state.profile) {
    const worth = state.profile.netWorthHistory || [{
      date: nowString(),
      value: Number(state.profile.netWorth || 0)
    }];
    drawTrendChart(worth.slice(-Math.max(1, state.filters.wealth)), 'wealthTrendChart', 'Net worth', '#38bdf8');
  }

  const nutritionDays = state.filters.nutrition;
  drawNutritionChart(nutritionDays);
  updateHeatmap();
  renderDeadList();
}

function buildCSV() {
  const rows = [];
  rows.push(['Type', 'Date', 'Field', 'Value']);

  rows.push(['Profile', nowString(), 'Name', state.profile?.name || '']);
  rows.push(['Profile', nowString(), 'Height', state.profile?.height || 0]);
  rows.push(['Profile', nowString(), 'Weight', state.profile?.weight || 0]);
  rows.push(['Profile', nowString(), 'NetWorth', state.profile?.netWorth || 0]);

  state.workoutEntries.forEach((entry) => {
    rows.push(['Workout', entry.date, entry.routineId, `${entry.set1}/${entry.set2}`]);
  });

  Object.entries(state.nutrition).forEach(([date, value]) => {
    rows.push(['Nutrition', date, 'Protein', value.protein || 0]);
    rows.push(['Nutrition', date, 'Water', value.water || 0]);
  });

  return rows.map((row) => row.join(',')).join('\n');
}

function exportDataVault() {
  const json = JSON.stringify(state, null, 2);
  const csv = buildCSV();
  const response = bridge.exportData(json, csv);
  if (response) {
    try {
      const parsed = JSON.parse(response);
      showToast(`Saved: ${parsed.json}`);
      return;
    } catch (_e) {
      // keep fallback
    }
  }

  const blob = new Blob([`${json}\n\n${csv}`], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `anvil-export-${Date.now()}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast('Export fallback downloaded.');
}

function setupWeeklyAuditReminder() {
  const last = state.weeklyAudit.lastCompleted;
  const today = new Date(nowString());
  let due = true;
  if (last) {
    const lastDate = new Date(last);
    if (Number.isFinite(lastDate.getTime())) {
      const diff = (today - lastDate) / (1000 * 60 * 60 * 24);
      due = diff >= 7;
    }
  }
  const modal = qs('#weeklyModal');
  const dueLabel = qs('#auditStatus');
  if (dueLabel) {
    dueLabel.textContent = due ? 'Audit required for momentum and growth safety checks.' : 'Last audit complete. Good discipline.';
  }
  if (due && state.onboardingCompleted) {
    modal.classList.remove('hidden');
    currentAuditMode = true;
  }
}

function maybeRequestUsagePermission() {
  const usageAccessBtn = qs('#usageAccessBtn');
  if (!usageAccessBtn) return;

  if (!bridge.hasUsagePermission()) {
    usageAccessBtn.classList.remove('hidden');
    if (!usageAccessBtn.dataset.bound) {
      usageAccessBtn.addEventListener('click', () => {
        bridge.requestUsageAccess();
        showToast('Open usage-access settings and grant permission.');
      });
      usageAccessBtn.dataset.bound = '1';
    }
  } else {
    usageAccessBtn.classList.add('hidden');
  }
}

function renderMetrics() {
  if (!state.profile) return;
  const p = state.profile;
  const metricHeight = qs('#metricHeight');
  const metricWeight = qs('#metricWeight');
  const metricWorth = qs('#metricWorth');
  if (metricHeight) metricHeight.textContent = `Height: ${p.height} cm`;
  if (metricWeight) metricWeight.textContent = `Weight: ${p.weight} kg`;
  if (metricWorth) metricWorth.textContent = `Net Worth: ${formatMoneyMills(p.netWorth)}`;
}

function drawInitialCharts() {
  updateDashboardCharts();
  if (state.workoutRoutines.length) {
    const first = state.workoutRoutines[0].id;
    drawWorkoutChart(first);
  }
  if (state.profile) {
    drawTrendChart(
      (state.profile.netWorthHistory || [{ date: nowString(), value: state.profile.netWorth || 0 }]).slice(-7),
      'wealthTrendChart',
      'Net worth',
      '#38bdf8'
    );
  }
}

function wireForms() {
  if (boundEvents) return;
  boundEvents = true;

  qs('#onboardingForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = qs('#nameInput').value.trim();
    const birthYear = Number(qs('#birthInput').value);
    const height = Number(qs('#heightInput').value);
    const weight = Number(qs('#weightInput').value);
    const netWorth = Number(qs('#networthInput').value);
    const skills = qs('#skillsInput').value.trim();

    state.profile = {
      name,
      birthYear,
      height,
      weight,
      netWorth,
      skills,
      heightHistory: [{ date: nowString(), value: height }],
      weightHistory: [{ date: nowString(), value: weight }],
      netWorthHistory: [{ date: nowString(), value: netWorth }]
    };
    if (state.photos.length) state.profile.photoCount = state.photos.length;
    state.onboardingCompleted = true;
    persist();
    setupWeeklyAuditReminder();
    qs('#onboardingView').classList.add('hidden');
    updateVisibility();
    initAll();
  });

  qsa('.od-btn').forEach((button) => {
    button.type = 'button';
    button.addEventListener('click', () => {
      const target = qs(`#${button.dataset.target}`);
      const delta = Number(button.dataset.delta);
      if (!target || Number.isNaN(delta)) return;
      const min = Number.isFinite(Number(target.min)) ? Number(target.min) : 0;
      const max = Number.isFinite(Number(target.max)) ? Number(target.max) : Number.POSITIVE_INFINITY;
      const step = Number(target.step) || 1;
      const next = Number(target.value || 0) + delta;
      const clamped = Math.max(min, Math.min(max, next));
      target.value = (step % 1 === 0 ? Math.round(clamped) : clamped.toFixed(2));
      target.dispatchEvent(new Event('input'));
    });
  });

  qs('#photoInput').addEventListener('change', () => readPhotoFiles('photoInput', state.photos));

  qs('#workoutForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const routineName = qs('#exerciseName').value.trim();
    const days = Array.from(qs('#exerciseDays').selectedOptions).map((item) => item.value);
    const mode = qs('#exerciseMode').value;
    if (!routineName || days.length === 0 || !mode) return;

    const item = {
      id: safeId('routine'),
      name: routineName,
      days,
      mode
    };
    state.workoutRoutines.push(item);
    persist();
    refreshWorkoutForm();
    updateDashboardCharts();
  });

  qs('#workoutLogForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const routineId = qs('#workoutTarget').value;
    const set1 = Number(qs('#set1').value);
    const set2 = Number(qs('#set2').value);
    const reps = Number(qs('#reps').value);
    if (!routineId || !Number.isFinite(set1) || !Number.isFinite(set2) || !Number.isFinite(reps) || set1 < 0 || set2 < 0 || reps <= 0) {
      showToast('Enter valid workout values.');
      return;
    }
    const row = {
      id: safeId('entry'),
      routineId,
      date: nowString(),
      set1,
      set2,
      reps
    };
    state.workoutEntries.push(row);
    persist();
    updateWorkoutCards();
    updateStreaks();
    updateDashboardCharts();
    qs('#set1').value = '';
    qs('#set2').value = '';
    qs('#reps').value = '';
  });

  qs('#taskForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = qs('#taskName').value.trim();
    const time = qs('#taskTime').value;
    const isCore = !!qs('#taskCore').checked;
    if (!name || !time) return;
    const task = {
      id: safeId('task'),
      name,
      time,
      isCore
    };
    state.taskList.push(task);
    persist();
    updateTaskList();
    ensureDeadDays();
    updateHeatmap();
    renderDeadList();
    qs('#taskName').value = '';
    qs('#taskTime').value = '';
    qs('#taskCore').checked = false;
  });

  qs('[data-action="addProtein"]').addEventListener('click', () => {
    const amt = Number(qs('#proteinInput').value);
    if (!amt || amt <= 0) return;
    const today = ensureNutrientsToday();
    today.protein += amt;
    persist();
    updateNutritionUI();
    updateDashboardCharts();
    qs('#proteinInput').value = '';
  });

  qs('[data-action="addWater"]').addEventListener('click', () => {
    const amt = Number(qs('#waterInput').value);
    if (!amt || amt <= 0) return;
    const today = ensureNutrientsToday();
    today.water += amt;
    persist();
    updateNutritionUI();
    updateDashboardCharts();
    qs('#waterInput').value = '';
  });

  qsa('[data-days]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const parent = chip.parentElement;
      const chart = parent?.dataset?.chart;
      if (!chart) return;
      const days = Number(chip.dataset.days || 7);
      parent.querySelectorAll('.chip').forEach((item) => item.classList.remove('active'));
      chip.classList.add('active');

      if (chart === 'usageChart') {
        state.filters.usage = days;
        drawUsageChart(days);
      }
      if (chart === 'wealthTrendChart') {
        state.filters.wealth = days;
        if (state.profile?.netWorthHistory) {
          const start = new Date();
          start.setDate(start.getDate() - Math.min(days, 365));
          const filtered = state.profile.netWorthHistory.filter(
            (item) => new Date(item.date) >= start
          );
          drawTrendChart(filtered, 'wealthTrendChart', 'Net worth', '#38bdf8');
        }
      }
      if (chart === 'workoutProgressChart') {
        state.filters.workout = days;
        const id = qs('#workoutChartSelector').value;
        drawWorkoutChart(id);
      }
      if (chart === 'nutritionChart') {
        state.filters.nutrition = days;
        drawNutritionChart(days);
      }
      persist();
    });
  });

  qs('#workoutChartSelector').addEventListener('change', () => {
    const id = qs('#workoutChartSelector').value;
    drawWorkoutChart(id);
  });

  qsa('.tab').forEach((tab) => {
    tab.addEventListener('click', () => applyTab(tab.dataset.view));
  });

  qs('#downloadApkBtn').addEventListener('click', handleApkDownload);

  qs('#startAuditBtn').addEventListener('click', () => {
    currentAuditMode = true;
    qs('#weeklyModal').classList.remove('hidden');
    qs('#weeklyHeight').value = state.profile?.height || '';
    qs('#weeklyWeight').value = state.profile?.weight || '';
    qs('#weeklyWorth').value = state.profile?.netWorth || '';
    qs('#weeklySkills').value = state.profile?.skills || '';
  });

  qs('#closeAudit').addEventListener('click', () => {
    qs('#weeklyModal').classList.add('hidden');
    currentAuditMode = false;
  });

  qs('#weeklyForm').addEventListener('submit', (event) => {
    event.preventDefault();
    state.profile.height = Number(qs('#weeklyHeight').value);
    state.profile.weight = Number(qs('#weeklyWeight').value);
    state.profile.netWorth = Number(qs('#weeklyWorth').value);
    state.profile.skills = qs('#weeklySkills').value.trim();
    state.profile.heightHistory = (state.profile.heightHistory || []).concat({ date: nowString(), value: state.profile.height });
    state.profile.weightHistory = (state.profile.weightHistory || []).concat({ date: nowString(), value: state.profile.weight });
    state.profile.netWorthHistory = (state.profile.netWorthHistory || []).concat({ date: nowString(), value: state.profile.netWorth });
    readPhotoFiles('weeklyPhoto', state.photos);
    state.weeklyAudit.lastCompleted = nowString();
    persist();
    qs('#weeklyModal').classList.add('hidden');
    currentAuditMode = false;
    showToast('Weekly audit locked for this cycle.');
    refreshPhotoGrids();
    renderMetrics();
    updateDashboardCharts();
  });

  qs('#weeklyPhoto').addEventListener('change', () => readPhotoFiles('weeklyPhoto', state.photos));

  qs('#exportBtn').addEventListener('click', exportDataVault);

  qs('#shareBtn').addEventListener('click', () => {
    const json = JSON.stringify(state, null, 2);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    link.download = `anvil-share-${Date.now()}.json`;
    link.click();
  });

  qs('#startAudio').addEventListener('click', () => {
    if (reflectionRunning) return;
    const path = bridge.startAudioCapture();
    if (!path || path === 'already-running') {
      reflectionRunning = false;
      qs('#startAudio').disabled = false;
      qs('#stopAudio').disabled = true;
      qs('#audioStatus').textContent = path === 'already-running' ? 'Already running' : 'Ready to start';
      if (!path) showToast('Audio recording failed. Check microphone permission.');
      return;
    }
    reflectionRunning = true;
    qs('#startAudio').disabled = true;
    qs('#stopAudio').disabled = false;
    qs('#audioStatus').textContent = 'Recording...';
    let remaining = 30;
    reflectionTimer = setInterval(() => {
      remaining -= 1;
      qs('#audioStatus').textContent = `Recording ${remaining}s`;
      if (remaining <= 0) {
        stopAudioCapture(path);
      }
    }, 1000);
  });

  qs('#stopAudio').addEventListener('click', () => {
    stopAudioCapture();
  });
}

function stopAudioCapture(fallbackPath = '') {
  if (!reflectionRunning) return;
  clearInterval(reflectionTimer);
  const path = bridge.stopAudioCapture() || fallbackPath || '';
  reflectionRunning = false;
  qs('#startAudio').disabled = false;
  qs('#stopAudio').disabled = true;
  qs('#audioStatus').textContent = path ? `Saved ${path}` : 'Saved';
  state.weeklyAudit.audioPath = path;
  persist();
}

function refreshAll() {
  renderMetrics();
  refreshPhotoGrids();
  refreshWorkoutForm();
  updateTaskList();
  ensureNutrientsToday();
  updateNutritionUI();
  ensureDeadDays();
  updateHeatmap();
  renderDeadList();
  updateStreaks();
  drawInitialCharts();
  maybeRequestUsagePermission();
}

function initAll() {
  initOdometer('heightInput', 'heightOdo', (x) => Number(x), (n) => `${n}`);
  initOdometer('weightInput', 'weightOdo', (x) => Number(x), (n) => `${n}`);
  initOdometer('networthInput', 'netOdo', (x) => Number(x), (n) => `${formatMoneyMills(n)}`);

  updateVisibility();
  if (!state.onboardingCompleted) {
    qs('#photoPreview').innerHTML = '';
    return;
  }

  wireForms();
  refreshAll();
  setupWeeklyAuditReminder();
}

document.addEventListener('DOMContentLoaded', initAll);
