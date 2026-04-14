import { t, setLocale, applyTranslations } from './i18n.mjs';

// Load locale
window.config.get().then(cfg => {
  if (cfg.locale) setLocale(cfg.locale);
  applyTranslations();
});

// --- State ---
let currentView = 'day'; // 'day', 'week', or 'month'
let currentDate = todayStr();
let currentWeekStart = mondayOf(todayStr());
let currentMonth = currentYearMonth();
let statsRange = null;

// --- Helpers ---

function todayStr() {
  const d = new Date();
  return fmt(d);
}

function fmt(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

function mondayOf(dateStr) {
  const d = parseDate(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return fmt(d);
}

function currentYearMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function addMonths(yearMonth, n) {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function formatDate(dateStr, locale) {
  const d = parseDate(dateStr);
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const loc = locale === 'pt-BR' ? 'pt-BR' : 'en-US';
  return d.toLocaleDateString(loc, opts);
}

function formatWeekRange(weekStartStr, locale) {
  const start = parseDate(weekStartStr);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const loc = locale === 'pt-BR' ? 'pt-BR' : 'en-US';
  const opts = { month: 'short', day: 'numeric' };
  const startFmt = start.toLocaleDateString(loc, opts);
  const endFmt = end.toLocaleDateString(loc, { ...opts, year: 'numeric' });
  return `${startFmt} – ${endFmt}`;
}

function formatMonthLabel(yearMonth, locale) {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const loc = locale === 'pt-BR' ? 'pt-BR' : 'en-US';
  return d.toLocaleDateString(loc, { month: 'long', year: 'numeric' });
}

function formatMs(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}<span class="unit">h</span> ${m}<span class="unit">m</span>`;
  return `${m}<span class="unit">m</span>`;
}

// --- DOM ---
const tabBtns = document.querySelectorAll('.tab-bar button');
const navPrev = document.getElementById('nav-prev');
const navNext = document.getElementById('nav-next');
const dateLabel = document.getElementById('date-label');
const emptyState = document.getElementById('empty-state');
const emptyText = document.getElementById('empty-text');
const dataView = document.getElementById('data-view');
const valScore = document.getElementById('val-score');
const valAlerts = document.getElementById('val-alerts');
const valSitting = document.getElementById('val-sitting');
const subSitting = document.getElementById('sub-sitting');
const valBreaks = document.getElementById('val-breaks');
const cardScore = document.getElementById('card-score');
const ringCanvas = document.getElementById('ring-canvas');
const chartCanvas = document.getElementById('chart-canvas');
const chartTitle = document.getElementById('chart-title');
const exportBtn = document.getElementById('export-pdf-btn');

// --- Tab switching ---
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.tab;
    render();
  });
});

// --- Navigation ---
navPrev.addEventListener('click', () => {
  if (currentView === 'day') {
    currentDate = addDays(currentDate, -1);
  } else if (currentView === 'week') {
    currentWeekStart = addDays(currentWeekStart, -7);
  } else {
    currentMonth = addMonths(currentMonth, -1);
  }
  render();
});

navNext.addEventListener('click', () => {
  if (currentView === 'day') {
    currentDate = addDays(currentDate, 1);
  } else if (currentView === 'week') {
    currentWeekStart = addDays(currentWeekStart, 7);
  } else {
    currentMonth = addMonths(currentMonth, 1);
  }
  render();
});

// --- Export PDF ---
exportBtn.addEventListener('click', async () => {
  exportBtn.disabled = true;
  exportBtn.textContent = t('report.exporting');

  try {
    const locale = (await window.config.get()).locale || 'en';
    let payload;

    if (currentView === 'week') {
      const data = await window.stats.getWeekly(currentWeekStart);
      payload = {
        type: 'weekly',
        locale,
        period: { label: dateLabel.textContent, start: currentWeekStart, end: addDays(currentWeekStart, 6) },
        totals: data.totals,
        days: data.days,
      };
    } else if (currentView === 'month') {
      const data = await window.stats.getMonthly(currentMonth);
      payload = {
        type: 'monthly',
        locale,
        period: { label: dateLabel.textContent, start: currentMonth + '-01', end: currentMonth + '-' + String(data.days.length).padStart(2, '0') },
        totals: data.totals,
        days: data.days,
        weeks: data.weeks,
      };
    }

    if (payload) {
      await window.report.exportPDF(payload);
    }
  } catch (err) {
    console.error('PDF export failed:', err);
  }

  exportBtn.disabled = false;
  exportBtn.textContent = t('report.exportPDF');
});

// --- Score color class ---
function scoreClass(pct) {
  if (pct >= 75) return 'good';
  if (pct >= 50) return 'warn';
  return 'bad';
}

// --- Draw score ring ---
function drawRing(pct) {
  const ctx = ringCanvas.getContext('2d');
  const size = 56;
  const cx = size / 2;
  const cy = size / 2;
  const r = 22;
  const lw = 5;

  ctx.clearRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#e0e0e5';
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.stroke();

  if (pct > 0) {
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + (pct / 100) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    const color = pct >= 75 ? '#34c759' : pct >= 50 ? '#ff9500' : '#ff3b30';
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

// --- Draw hourly bar chart ---
function drawHourlyChart(hourlyBuckets) {
  const container = chartCanvas.parentElement;
  chartCanvas.width = container.clientWidth;
  chartCanvas.height = container.clientHeight;
  const ctx = chartCanvas.getContext('2d');
  const W = chartCanvas.width;
  const H = chartCanvas.height;

  ctx.clearRect(0, 0, W, H);

  const hours = Object.keys(hourlyBuckets).map(Number).sort((a, b) => a - b);
  if (hours.length === 0) return;

  const minH = Math.min(...hours);
  const maxH = Math.max(...hours);
  const range = maxH - minH + 1;

  const padding = { left: 30, right: 16, top: 16, bottom: 28 };
  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;
  const barW = Math.min(Math.floor(chartW / range) - 4, 32);
  const gap = (chartW - barW * range) / (range + 1);

  let maxVal = 0;
  for (const h of hours) {
    const b = hourlyBuckets[h];
    maxVal = Math.max(maxVal, (b.goodMs || 0) + (b.badMs || 0));
  }
  if (maxVal === 0) maxVal = 3600000;

  drawGrid(ctx, W, H, padding, chartH, (i) => `${Math.round((maxVal / 60000) * (1 - i / 4))}m`);

  for (let i = 0; i < range; i++) {
    const hour = minH + i;
    const b = hourlyBuckets[String(hour)];
    const x = padding.left + gap + i * (barW + gap);

    if (b) {
      const goodH = ((b.goodMs || 0) / maxVal) * chartH;
      const badH = ((b.badMs || 0) / maxVal) * chartH;
      const totalH = goodH + badH;

      if (goodH > 0) {
        ctx.fillStyle = '#34c759';
        roundRect(ctx, x, padding.top + chartH - totalH, barW, goodH, badH > 0 ? 0 : Math.min(4, barW / 2));
        ctx.fill();
      }
      if (badH > 0) {
        ctx.fillStyle = '#ff3b30';
        roundRect(ctx, x, padding.top + chartH - totalH, barW, badH, Math.min(4, barW / 2));
        ctx.fill();
      }
    }

    ctx.fillStyle = '#b0b0b5';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${hour}`, x + barW / 2, padding.top + chartH + 8);
  }
}

// --- Draw weekly bar chart ---
function drawWeeklyChart(days) {
  const dayLabels = [
    t('report.mon'), t('report.tue'), t('report.wed'),
    t('report.thu'), t('report.fri'), t('report.sat'), t('report.sun')
  ];
  drawScoreBarChart(days, dayLabels);
}

// --- Draw monthly bar chart ---
function drawMonthlyChart(days) {
  const labels = days.map((_, i) => String(i + 1));
  drawScoreBarChart(days, labels);
}

// --- Generic score bar chart (shared by week/month) ---
function drawScoreBarChart(days, labels) {
  const container = chartCanvas.parentElement;
  chartCanvas.width = container.clientWidth;
  chartCanvas.height = container.clientHeight;
  const ctx = chartCanvas.getContext('2d');
  const W = chartCanvas.width;
  const H = chartCanvas.height;

  ctx.clearRect(0, 0, W, H);

  const count = days.length;
  const padding = { left: 30, right: 16, top: 16, bottom: 28 };
  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;
  const maxBarW = count <= 7 ? 48 : count <= 14 ? 24 : 14;
  const barW = Math.min(Math.floor(chartW / count) - 2, maxBarW);
  const gap = (chartW - barW * count) / (count + 1);

  drawGrid(ctx, W, H, padding, chartH, (i) => `${100 - i * 25}%`);

  for (let i = 0; i < count; i++) {
    const day = days[i];
    const x = padding.left + gap + i * (barW + gap);

    if (day && day.monitoredMs > 0) {
      const pct = day.goodPostureMs / day.monitoredMs;
      const barH = pct * chartH;
      const color = pct >= 0.75 ? '#34c759' : pct >= 0.5 ? '#ff9500' : '#ff3b30';
      ctx.fillStyle = color;
      roundRect(ctx, x, padding.top + chartH - barH, barW, barH, Math.min(4, barW / 2));
      ctx.fill();

      if (barH > 20 && barW > 16) {
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${barW > 24 ? 10 : 8}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${Math.round(pct * 100)}%`, x + barW / 2, padding.top + chartH - barH + 16);
      }
    } else {
      ctx.fillStyle = '#e8e8ed';
      roundRect(ctx, x, padding.top + chartH - 4, barW, 4, 2);
      ctx.fill();
    }

    // Label — skip some for readability on monthly charts
    const showLabel = count <= 7 || (count <= 14) || ((i + 1) % 5 === 0 || i === 0);
    if (showLabel) {
      ctx.fillStyle = '#b0b0b5';
      ctx.font = `${count > 14 ? 8 : 10}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(labels[i], x + barW / 2, padding.top + chartH + 8);
    }
  }
}

// --- Shared grid drawing ---
function drawGrid(ctx, W, H, padding, chartH, labelFn) {
  ctx.strokeStyle = '#e8e8ed';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(W - padding.right, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#b0b0b5';
  ctx.font = '9px system-ui';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartH / 4) * i;
    ctx.fillText(labelFn(i), padding.left - 6, y);
  }
}

// --- Rounded rect helper ---
function roundRect(ctx, x, y, w, h, r) {
  if (h <= 0) return;
  if (typeof r === 'number') r = { tl: r, tr: r, bl: 0, br: 0 };
  ctx.beginPath();
  ctx.moveTo(x + r.tl, y);
  ctx.lineTo(x + w - r.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r.tr);
  ctx.lineTo(x + w, y + h - r.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
  ctx.lineTo(x + r.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r.bl);
  ctx.lineTo(x, y + r.tl);
  ctx.quadraticCurveTo(x, y, x + r.tl, y);
  ctx.closePath();
}

// --- Render ---

async function render() {
  const locale = (await window.config.get()).locale || 'en';
  statsRange = await window.stats.getRange();

  // Show/hide export button (only on week and month)
  if (currentView === 'day') {
    exportBtn.classList.add('hidden');
  } else {
    exportBtn.classList.remove('hidden');
  }

  if (currentView === 'day') {
    await renderDay(locale);
  } else if (currentView === 'week') {
    await renderWeek(locale);
  } else {
    await renderMonth(locale);
  }
  updateNavButtons();
}

function fillMetrics(totals) {
  const pct = totals.monitoredMs > 0 ? Math.round((totals.goodPostureMs / totals.monitoredMs) * 100) : 0;
  valScore.innerHTML = `${pct}<span class="unit">%</span>`;
  cardScore.className = 'metric-card score ' + scoreClass(pct);
  drawRing(pct);
  valAlerts.textContent = totals.alertCount || 0;
  valSitting.innerHTML = formatMs(totals.totalSittingMs || 0);
  const longestMs = totals.longestSittingMs || 0;
  subSitting.textContent = longestMs > 0 ? `${t('report.maxSitting')}: ${Math.round(longestMs / 60000)}m` : '';
  valBreaks.textContent = totals.breakAlertCount || 0;
}

async function renderDay(locale) {
  dateLabel.textContent = formatDate(currentDate, locale);
  chartTitle.textContent = t('report.hourlyBreakdown');

  const data = await window.stats.getDaily(currentDate);

  if (!data || data.monitoredMs === 0) {
    emptyState.classList.add('visible');
    emptyText.textContent = t('report.noData');
    dataView.classList.add('hidden');
    return;
  }

  emptyState.classList.remove('visible');
  dataView.classList.remove('hidden');
  fillMetrics(data);
  drawHourlyChart(data.hourlyBuckets || {});
}

async function renderWeek(locale) {
  dateLabel.textContent = formatWeekRange(currentWeekStart, locale);
  chartTitle.textContent = t('report.dailyBreakdown');

  const data = await window.stats.getWeekly(currentWeekStart);

  if (!data || data.totals.monitoredMs === 0) {
    emptyState.classList.add('visible');
    emptyText.textContent = t('report.noDataWeek');
    dataView.classList.add('hidden');
    return;
  }

  emptyState.classList.remove('visible');
  dataView.classList.remove('hidden');
  fillMetrics(data.totals);
  drawWeeklyChart(data.days);
}

async function renderMonth(locale) {
  dateLabel.textContent = formatMonthLabel(currentMonth, locale);
  chartTitle.textContent = t('report.dailyScoreBreakdown');

  const data = await window.stats.getMonthly(currentMonth);

  if (!data || data.totals.monitoredMs === 0) {
    emptyState.classList.add('visible');
    emptyText.textContent = t('report.noDataMonth');
    dataView.classList.add('hidden');
    return;
  }

  emptyState.classList.remove('visible');
  dataView.classList.remove('hidden');
  fillMetrics(data.totals);
  drawMonthlyChart(data.days);
}

function updateNavButtons() {
  const today = todayStr();
  const todayMonday = mondayOf(today);
  const todayMonth = currentYearMonth();

  if (currentView === 'day') {
    navNext.disabled = currentDate >= today;
    navPrev.disabled = statsRange ? currentDate <= statsRange.firstDate : true;
  } else if (currentView === 'week') {
    navNext.disabled = currentWeekStart >= todayMonday;
    navPrev.disabled = statsRange ? currentWeekStart <= mondayOf(statsRange.firstDate) : true;
  } else {
    navNext.disabled = currentMonth >= todayMonth;
    navPrev.disabled = statsRange ? currentMonth <= statsRange.firstDate.slice(0, 7) : true;
  }
}

// --- Init ---
render();
