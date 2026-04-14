const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');

let win, tray, settingsWin, onboardingWin, reportWin;
let dismissEndTime = null;
let menuUpdateInterval = null;
let i18n = null; // loaded async

// --- Config ---
const configPath = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_CONFIG = { calibrated: false, strictness: 'moderate', breakIntervalMin: 60, breakRemindMin: 5 };

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
  } catch { return { ...DEFAULT_CONFIG }; }
}

function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

let currentConfig = loadConfig();

// --- Stats persistence ---
const statsDir = path.join(app.getPath('userData'), 'stats');

function ensureStatsDir() {
  if (!fs.existsSync(statsDir)) fs.mkdirSync(statsDir, { recursive: true });
}

function statsPath(dateStr) {
  return path.join(statsDir, `${dateStr}.json`);
}

function loadDayStats(dateStr) {
  try {
    return JSON.parse(fs.readFileSync(statsPath(dateStr), 'utf8'));
  } catch { return null; }
}

function saveDayStats(dateStr, data) {
  ensureStatsDir();
  fs.writeFileSync(statsPath(dateStr), JSON.stringify(data, null, 2));
}

function mergeDayStats(existing, incoming) {
  if (!existing) {
    return {
      date: incoming.date,
      version: 1,
      monitoredMs: incoming.monitoredMs || 0,
      goodPostureMs: incoming.goodPostureMs || 0,
      badPostureMs: incoming.badPostureMs || 0,
      alertCount: incoming.alertCount || 0,
      breakAlertCount: incoming.breakAlertCount || 0,
      sittingSessions: incoming.sittingSessions || [],
      hourlyBuckets: incoming.hourlyBuckets || {},
      lastFlushMs: Date.now(),
    };
  }
  existing.monitoredMs += incoming.monitoredMs || 0;
  existing.goodPostureMs += incoming.goodPostureMs || 0;
  existing.badPostureMs += incoming.badPostureMs || 0;
  existing.alertCount += incoming.alertCount || 0;
  existing.breakAlertCount += incoming.breakAlertCount || 0;
  if (incoming.sittingSessions?.length) {
    existing.sittingSessions = (existing.sittingSessions || []).concat(incoming.sittingSessions);
  }
  // Merge hourly buckets
  if (incoming.hourlyBuckets) {
    if (!existing.hourlyBuckets) existing.hourlyBuckets = {};
    for (const [h, b] of Object.entries(incoming.hourlyBuckets)) {
      if (!existing.hourlyBuckets[h]) {
        existing.hourlyBuckets[h] = { monitoredMs: 0, goodMs: 0, badMs: 0, alerts: 0 };
      }
      existing.hourlyBuckets[h].monitoredMs += b.monitoredMs || 0;
      existing.hourlyBuckets[h].goodMs += b.goodMs || 0;
      existing.hourlyBuckets[h].badMs += b.badMs || 0;
      existing.hourlyBuckets[h].alerts += b.alerts || 0;
    }
  }
  existing.lastFlushMs = Date.now();
  return existing;
}

function getStatsRange() {
  ensureStatsDir();
  const files = fs.readdirSync(statsDir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (files.length === 0) return null;
  return {
    firstDate: files[0].replace('.json', ''),
    lastDate: files[files.length - 1].replace('.json', ''),
  };
}

function computeWeeklyStats(weekStartStr) {
  const start = new Date(weekStartStr + 'T00:00:00');
  const days = [];
  const totals = { monitoredMs: 0, goodPostureMs: 0, badPostureMs: 0, alertCount: 0, breakAlertCount: 0, totalSittingMs: 0, longestSittingMs: 0 };
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dateStr = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    const stats = loadDayStats(dateStr);
    const daySitting = (stats?.sittingSessions || []).reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
    const dayLongest = (stats?.sittingSessions || []).reduce((max, s) => Math.max(max, s.endMs - s.startMs), 0);
    const dayObj = {
      date: dateStr,
      monitoredMs: stats?.monitoredMs || 0,
      goodPostureMs: stats?.goodPostureMs || 0,
      badPostureMs: stats?.badPostureMs || 0,
      alertCount: stats?.alertCount || 0,
      breakAlertCount: stats?.breakAlertCount || 0,
      totalSittingMs: daySitting,
      longestSittingMs: dayLongest,
      hourlyBuckets: stats?.hourlyBuckets || {},
    };
    days.push(dayObj);
    totals.monitoredMs += dayObj.monitoredMs;
    totals.goodPostureMs += dayObj.goodPostureMs;
    totals.badPostureMs += dayObj.badPostureMs;
    totals.alertCount += dayObj.alertCount;
    totals.breakAlertCount += dayObj.breakAlertCount;
    totals.totalSittingMs += dayObj.totalSittingMs;
    if (dayObj.longestSittingMs > totals.longestSittingMs) totals.longestSittingMs = dayObj.longestSittingMs;
  }
  return { days, totals };
}

function computeMonthlyStats(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = [];
  const totals = { monitoredMs: 0, goodPostureMs: 0, badPostureMs: 0, alertCount: 0, breakAlertCount: 0, totalSittingMs: 0, longestSittingMs: 0 };

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const stats = loadDayStats(dateStr);
    const daySitting = (stats?.sittingSessions || []).reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
    const dayLongest = (stats?.sittingSessions || []).reduce((max, s) => Math.max(max, s.endMs - s.startMs), 0);
    const dayObj = {
      date: dateStr,
      monitoredMs: stats?.monitoredMs || 0,
      goodPostureMs: stats?.goodPostureMs || 0,
      badPostureMs: stats?.badPostureMs || 0,
      alertCount: stats?.alertCount || 0,
      breakAlertCount: stats?.breakAlertCount || 0,
      totalSittingMs: daySitting,
      longestSittingMs: dayLongest,
    };
    days.push(dayObj);
    totals.monitoredMs += dayObj.monitoredMs;
    totals.goodPostureMs += dayObj.goodPostureMs;
    totals.badPostureMs += dayObj.badPostureMs;
    totals.alertCount += dayObj.alertCount;
    totals.breakAlertCount += dayObj.breakAlertCount;
    totals.totalSittingMs += dayObj.totalSittingMs;
    if (dayObj.longestSittingMs > totals.longestSittingMs) totals.longestSittingMs = dayObj.longestSittingMs;
  }

  // Compute weekly sub-aggregates for PDF breakdown
  const weeks = [];
  let weekStart = 0;
  for (let i = 0; i < days.length; i++) {
    const dow = new Date(year, month - 1, i + 1).getDay();
    // Start new week on Monday or first day of month
    if (i === 0 || dow === 1) {
      if (i > 0) {
        weeks.push(aggregateWeek(days, weekStart, i - 1));
      }
      weekStart = i;
    }
  }
  weeks.push(aggregateWeek(days, weekStart, days.length - 1));

  return { yearMonth, days, totals, weeks };
}

function aggregateWeek(days, startIdx, endIdx) {
  const w = { startDate: days[startIdx].date, endDate: days[endIdx].date, monitoredMs: 0, goodPostureMs: 0, badPostureMs: 0, alertCount: 0, breakAlertCount: 0, totalSittingMs: 0 };
  for (let i = startIdx; i <= endIdx; i++) {
    w.monitoredMs += days[i].monitoredMs;
    w.goodPostureMs += days[i].goodPostureMs;
    w.badPostureMs += days[i].badPostureMs;
    w.alertCount += days[i].alertCount;
    w.breakAlertCount += days[i].breakAlertCount;
    w.totalSittingMs += days[i].totalSittingMs;
  }
  return w;
}

// --- Tray menu ---

function formatCountdown() {
  if (!dismissEndTime) return '';
  const remaining = Math.max(0, dismissEndTime - Date.now());
  if (remaining <= 0) return '';
  const totalSec = Math.ceil(remaining / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function tt(key, vars) {
  return i18n ? i18n.t(key, vars) : key;
}

function buildMenu() {
  const template = [];
  const paused = dismissEndTime && dismissEndTime > Date.now();

  if (paused) {
    template.push({ label: tt('tray.paused', { time: formatCountdown() }), enabled: false });
    template.push({ label: tt('tray.resume'), click: resumeMonitoring });
  }

  template.push({
    label: tt('tray.dismiss'),
    submenu: [
      { label: tt('tray.5min'), click: () => dismissFor(5 * 60 * 1000) },
      { label: tt('tray.10min'), click: () => dismissFor(10 * 60 * 1000) },
      { label: tt('tray.30min'), click: () => dismissFor(30 * 60 * 1000) },
      { label: tt('tray.1hour'), click: () => dismissFor(60 * 60 * 1000) },
    ]
  });

  template.push({ type: 'separator' });
  template.push({ label: tt('tray.report'), click: openReport });
  template.push({ label: tt('tray.settings'), click: openSettings });
  template.push({ label: tt('tray.recalibrate'), click: openOnboarding });
  template.push({ label: tt('tray.faq'), click: openFaq });
  template.push({ type: 'separator' });
  template.push({ label: tt('tray.quit'), click: () => app.quit() });

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function dismissFor(durationMs) {
  dismissEndTime = Date.now() + durationMs;

  // Tell renderer to stop camera
  if (win && !win.isDestroyed()) {
    win.webContents.send('monitoring-pause');
    if (win.isVisible()) win.hide();
  }

  buildMenu();
  startMenuUpdater();
}

function resumeMonitoring() {
  dismissEndTime = null;
  stopMenuUpdater();

  // Tell renderer to restart camera
  if (win && !win.isDestroyed()) {
    win.webContents.send('monitoring-resume');
  }

  buildMenu();
}

function startMenuUpdater() {
  stopMenuUpdater();
  menuUpdateInterval = setInterval(() => {
    if (!dismissEndTime || dismissEndTime <= Date.now()) {
      // Timer expired — auto resume
      resumeMonitoring();
      return;
    }
    buildMenu();
  }, 1000);
}

function stopMenuUpdater() {
  if (menuUpdateInterval) {
    clearInterval(menuUpdateInterval);
    menuUpdateInterval = null;
  }
}

// --- App ---
app.whenReady().then(async () => {
  // Hide from dock and Cmd+Tab — this is a tray-only app
  if (app.dock) app.dock.hide();

  // Load i18n (file URL needed for ESM from CJS)
  i18n = await import(`file://${path.join(__dirname, 'i18n.mjs')}`);
  if (currentConfig.locale) i18n.setLocale(currentConfig.locale);

  const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
  trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  buildMenu();

  // Auto-grant camera permission so resume after dismiss doesn't re-prompt
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media';
  });

  // Floating pill window — starts hidden
  win = new BrowserWindow({
    width: 480,
    height: 360,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      sandbox: false,
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile('index.html');

  // IPC: pill show/hide
  ipcMain.on('pill-show', () => {
    if (dismissEndTime && dismissEndTime > Date.now()) return; // paused, ignore
    if (win && !win.isDestroyed() && !win.isVisible()) win.showInactive();
  });
  ipcMain.on('pill-hide', () => { if (win && !win.isDestroyed() && win.isVisible()) win.hide(); });

  // IPC: config
  ipcMain.handle('get-config', () => currentConfig);
  ipcMain.handle('save-config', (_e, cfg) => {
    currentConfig = { ...currentConfig, ...cfg };
    saveConfig(currentConfig);
    // Update locale in main process + rebuild tray
    if (cfg.locale && i18n) { i18n.setLocale(cfg.locale); buildMenu(); }
    if (win && !win.isDestroyed()) {
      win.webContents.send('config-changed', currentConfig);
    }
    return currentConfig;
  });

  // IPC: dismiss state query (for test mode)
  ipcMain.handle('get-dismiss-state', () => ({
    dismissed: !!(dismissEndTime && dismissEndTime > Date.now()),
    remainingMs: dismissEndTime ? Math.max(0, dismissEndTime - Date.now()) : 0,
  }));

  // IPC: onboarding complete
  ipcMain.on('onboarding-complete', () => {
    if (onboardingWin && !onboardingWin.isDestroyed()) onboardingWin.close();
  });

  // IPC: stats
  ensureStatsDir();
  ipcMain.on('stats-flush', (_e, snapshot) => {
    if (!snapshot?.date) return;
    const existing = loadDayStats(snapshot.date);
    const merged = mergeDayStats(existing, snapshot);
    saveDayStats(snapshot.date, merged);
  });
  ipcMain.handle('get-daily-stats', (_e, dateStr) => {
    const stats = loadDayStats(dateStr);
    if (!stats) return null;
    const sittingMs = (stats.sittingSessions || []).reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
    const longestMs = (stats.sittingSessions || []).reduce((max, s) => Math.max(max, s.endMs - s.startMs), 0);
    return { ...stats, totalSittingMs: sittingMs, longestSittingMs: longestMs };
  });
  ipcMain.handle('get-weekly-stats', (_e, weekStartStr) => computeWeeklyStats(weekStartStr));
  ipcMain.handle('get-monthly-stats', (_e, yearMonth) => computeMonthlyStats(yearMonth));
  ipcMain.handle('get-stats-range', () => getStatsRange());

  // IPC: PDF export
  ipcMain.handle('export-pdf', async (_e, payload) => {
    const pdfWin = new BrowserWindow({
      width: 794,
      height: 1123,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload-pdf.js'),
        sandbox: false,
      }
    });

    pdfWin.loadFile('report-pdf.html');

    // Wait for page to load, then send data
    await new Promise(resolve => {
      pdfWin.webContents.once('did-finish-load', () => {
        pdfWin.webContents.send('pdf-data', payload);
        resolve();
      });
    });

    // Wait for template to signal ready
    await new Promise(resolve => {
      ipcMain.once('pdf-ready', resolve);
    });

    const pdfBuffer = await pdfWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    const typeLabel = payload.type === 'weekly' ? 'Weekly' : 'Monthly';
    const dateLabel = payload.type === 'weekly' ? payload.period.start : payload.period.start.slice(0, 7);
    const defaultName = `BackStraight-${typeLabel}-${dateLabel}.pdf`;

    const { filePath, canceled } = await dialog.showSaveDialog(reportWin || undefined, {
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });

    pdfWin.close();

    if (canceled || !filePath) {
      return { success: false, reason: 'canceled' };
    }

    fs.writeFileSync(filePath, pdfBuffer);
    return { success: true, filePath };
  });

  // First launch check
  if (!currentConfig.calibrated) {
    openOnboarding();
  }

  // Test mode
  if (process.argv.includes('--test-mode')) {
    const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
    emit({
      ready: true,
      visible: win.isVisible(),
      alwaysOnTop: win.isAlwaysOnTop(),
      focusable: win.isFocusable(),
      size: win.getSize(),
    });
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (data) => {
      const cmd = data.trim();
      if (cmd === 'show') {
        if (!(dismissEndTime && dismissEndTime > Date.now())) win.showInactive();
      }
      if (cmd === 'hide') { win.hide(); }
      if (cmd === 'state') { emit({ visible: win.isVisible() }); }
      if (cmd.startsWith('dismiss:')) {
        const ms = parseInt(cmd.split(':')[1]);
        dismissFor(ms);
        emit({ dismissed: true, durationMs: ms });
      }
      if (cmd === 'resume') {
        resumeMonitoring();
        emit({ dismissed: false });
      }
      if (cmd === 'dismiss-state') {
        emit({
          dismissed: !!(dismissEndTime && dismissEndTime > Date.now()),
          remainingMs: dismissEndTime ? Math.max(0, dismissEndTime - Date.now()) : 0,
        });
      }
      if (cmd === 'quit') { app.quit(); }
    });
  }
});

function openOnboarding() {
  if (onboardingWin && !onboardingWin.isDestroyed()) {
    onboardingWin.focus();
    return;
  }
  onboardingWin = new BrowserWindow({
    width: 1050,
    height: 810,
    resizable: false,
    minimizable: false,
    maximizable: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    }
  });
  onboardingWin.loadFile('onboarding.html');
  onboardingWin.on('closed', () => { onboardingWin = null; });

}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 1050,
    height: 810,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    }
  });
  settingsWin.loadFile('settings.html');
  settingsWin.on('closed', () => { settingsWin = null; });

}

function openReport() {
  if (reportWin && !reportWin.isDestroyed()) {
    reportWin.focus();
    return;
  }
  reportWin = new BrowserWindow({
    width: 1050,
    height: 810,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    }
  });
  reportWin.loadFile('report.html');
  reportWin.on('closed', () => { reportWin = null; });

}

let faqWin;

function openFaq() {
  if (faqWin && !faqWin.isDestroyed()) {
    faqWin.focus();
    return;
  }
  faqWin = new BrowserWindow({
    width: 1050,
    height: 810,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    }
  });
  faqWin.loadFile('faq.html');
  faqWin.on('closed', () => { faqWin = null; });

}

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
