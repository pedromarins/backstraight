import { t, setLocale, getLocale, applyTranslations } from './i18n.mjs';

const aspects = ['eyes', 'head', 'shoulders', 'distance', 'turn', 'hand'];
const langSelect = document.getElementById('lang-select');

// --- Tab switching ---
document.querySelectorAll('.tab-bar button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// --- Load config ---
window.config.get().then((cfg) => {
  // Language
  const locale = cfg.locale || 'en';
  setLocale(locale);
  langSelect.value = locale;
  applyTranslations();

  // Posture tab
  const levels = cfg.levels || {};
  for (const a of aspects) {
    const val = levels[a] || cfg.strictness || 'moderate';
    const radio = document.querySelector(`input[name="${a}"][value="${val}"]`);
    if (radio) radio.checked = true;
  }

  // Breaks tab
  document.getElementById('breakInterval').value = cfg.breakIntervalMin || 60;
  document.getElementById('breakRemind').value = cfg.breakRemindMin || 5;

  // Wind Down tab
  document.getElementById('windDownEnabled').checked = cfg.windDownEnabled !== false;
  document.getElementById('windDownHour').value = cfg.windDownHour ?? 20;
  document.getElementById('windDownMinute').value = String(cfg.windDownMinute ?? 0).padStart(2, '0');
  document.getElementById('windDownRemind').value = cfg.windDownRemindMin || 15;

  // Calibration tab
  renderCalibInfo(cfg);
});

function renderCalibInfo(cfg) {
  const info = document.getElementById('calib-info');
  if (cfg.calibrated && cfg.baseline) {
    const b = cfg.baseline;
    info.innerHTML = `
      <div class="row"><span>${t('settings.calib.status')}</span><span class="val">${t('settings.calib.calibrated')}</span></div>
      <div class="row"><span>${t('settings.calib.eyeDist')}</span><span class="val">${b.eyeDist?.toFixed(4) || '—'}</span></div>
      <div class="row"><span>${t('settings.calib.headDelta')}</span><span class="val">${b.headForwardDelta?.toFixed(3) || '—'}</span></div>
      <div class="row"><span>${t('settings.calib.eyeAngle')}</span><span class="val">${b.eyeAngle?.toFixed(1) || '—'}°</span></div>
      <div class="row"><span>${t('settings.calib.shoulderAngle')}</span><span class="val">${b.shoulderAngle?.toFixed(1) || '—'}°</span></div>
      <div class="row"><span>${t('settings.calib.noseOffset')}</span><span class="val">${b.noseOffset?.toFixed(3) || '—'}</span></div>
    `;
  } else if (cfg.calibrated) {
    info.innerHTML = `
      <div class="row"><span>${t('settings.calib.status')}</span><span class="val">${t('settings.calib.default')}</span></div>
      <div class="row"><span></span><span class="val" style="color:#86868b;font-weight:400;">${t('settings.calib.defaultHint')}</span></div>
    `;
  } else {
    info.innerHTML = `<div class="row"><span>${t('settings.calib.status')}</span><span class="val">${t('settings.calib.notCalibrated')}</span></div>`;
  }
}

// --- Language change ---
langSelect.addEventListener('change', async () => {
  const locale = langSelect.value;
  setLocale(locale);
  applyTranslations();
  // Re-render calibration (uses t() dynamically)
  const cfg = await window.config.get();
  renderCalibInfo(cfg);
});

// --- Save ---
document.getElementById('save').addEventListener('click', async () => {
  const levels = {};
  for (const a of aspects) {
    levels[a] = document.querySelector(`input[name="${a}"]:checked`)?.value || 'moderate';
  }

  const locale = langSelect.value;

  await window.config.save({
    levels,
    locale,
    breakIntervalMin: Math.max(1, parseInt(document.getElementById('breakInterval').value) || 60),
    breakRemindMin: Math.max(1, parseInt(document.getElementById('breakRemind').value) || 5),
    windDownEnabled: document.getElementById('windDownEnabled').checked,
    windDownHour: Math.min(23, Math.max(0, parseInt(document.getElementById('windDownHour').value) || 20)),
    windDownMinute: Math.min(59, Math.max(0, parseInt(document.getElementById('windDownMinute').value) || 0)),
    windDownRemindMin: Math.max(1, parseInt(document.getElementById('windDownRemind').value) || 15),
  });

  const msg = document.getElementById('saved-msg');
  msg.classList.add('show');
  setTimeout(() => msg.classList.remove('show'), 1500);
});

// --- Recalibrate ---
document.getElementById('recalibrate').addEventListener('click', async () => {
  await window.config.save({ calibrated: false });
  window.close();
});
