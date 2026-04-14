import {
  FaceLandmarker,
  PoseLandmarker,
  HandLandmarker,
  FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs';

import {
  mid, checkEyeLevel, checkDistance, checkFacing,
  checkShoulders, checkHeadForward, checkHeadOnHand, isAllOk,
  PillStateMachine, SitTimer, WindDownTimer, getTargetFps, getDetectEvery,
  setConfig, config,
} from './posture.js';
import { t, setLocale } from './i18n.mjs';
import { StatsCollector } from './stats-collector.js';

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const loading = document.getElementById('loading');

let faceLandmarker, poseLandmarker, handLandmarker;
let posture = null;
let frame = 0;
let stats = { detectMs: 0, detectsPerSec: 0 };
let detectCount = 0;
let lastStatTime = performance.now();
const pill = new PillStateMachine();
const sit = new SitTimer();
const windDown = new WindDownTimer();
const statsCollector = new StatsCollector();
let breakAlert = false;
let windDownAlert = false;
const dismissBtn = document.getElementById('dismiss-btn');

dismissBtn.addEventListener('click', () => {
  const now = performance.now();
  if (breakAlert) {
    sit.dismiss(now);
    breakAlert = false;
  }
  if (windDownAlert) {
    windDown.snooze(Date.now());
    windDownAlert = false;
  }
  dismissBtn.style.display = 'none';
  window.pill.hide();
  pill.pillVisible = false;
});

// Load config and listen for changes
window.config.get().then(cfg => { setConfig(cfg); if (cfg.locale) setLocale(cfg.locale); });
window.config.onChange(cfg => { setConfig(cfg); if (cfg.locale) setLocale(cfg.locale); });

let modelsReady = false;
let running = false;
let loopTimeout = null;

// --- Stats flush ---

function flushStats() {
  const snap = statsCollector.consumeSnapshot();
  if (snap.monitoredMs > 0 || snap.alertCount > 0 || snap.sittingSessions.length > 0) {
    window.stats.flush(snap);
  }
}

const FLUSH_INTERVAL = 30000;
let flushTimer = setInterval(flushStats, FLUSH_INTERVAL);

window.addEventListener('beforeunload', flushStats);

// --- Pause / Resume ---

window.monitoring.onPause(() => { flushStats(); stopCamera(); });
window.monitoring.onResume(() => startCamera());

function stopCamera() {
  running = false;
  if (loopTimeout) { clearTimeout(loopTimeout); loopTimeout = null; }
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
  });
  video.srcObject = stream;
  await video.play();
  running = true;
  scheduleNext();
}

// --- Init ---

async function init() {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
  );

  loading.textContent = t('pill.loading');

  [faceLandmarker, poseLandmarker, handLandmarker] = await Promise.all([
    FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
    }),
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    }),
    HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
    }),
  ]);

  modelsReady = true;
  loading.style.display = 'none';
  await startCamera();
}

function scheduleNext() {
  if (!running) return;
  const fps = getTargetFps(pill.pillVisible);
  loopTimeout = setTimeout(() => { loop(); scheduleNext(); }, 1000 / fps);
}

// --- Detection ---

function detect() {
  const t0 = performance.now();
  const ts = t0;
  const result = {};

  const faces = faceLandmarker.detectForVideo(video, ts);
  if (faces.faceLandmarks?.length) {
    const lm = faces.faceLandmarks[0];
    result.leftEye = mid(lm[33], lm[133]);
    result.rightEye = mid(lm[362], lm[263]);

    Object.assign(result, checkEyeLevel(result.leftEye, result.rightEye));
    Object.assign(result, checkDistance(result.leftEye, result.rightEye));
    Object.assign(result, checkFacing(lm[1], lm[234], lm[454]));
  }

  const poses = poseLandmarker.detectForVideo(video, ts + 1);
  if (poses.landmarks?.length) {
    const lm = poses.landmarks[0];

    if (lm[11].visibility > 0.3 && lm[12].visibility > 0.3) {
      result.leftShoulder = lm[11];
      result.rightShoulder = lm[12];
      Object.assign(result, checkShoulders(lm[11], lm[12]));
    }

    Object.assign(result, checkHeadForward(lm[7], lm[8], lm[11], lm[12]));

    // Hand near face detection via HandLandmarker
    const hands = handLandmarker.detectForVideo(video, ts + 2);
    if (hands.landmarks?.length) {
      Object.assign(result, checkHeadOnHand(hands.landmarks, lm[0], lm[7], lm[8]));
    }
  }

  stats.detectMs = performance.now() - t0;
  detectCount++;
  const now = performance.now();
  if (now - lastStatTime >= 1000) {
    stats.detectsPerSec = detectCount;
    detectCount = 0;
    lastStatTime = now;
  }

  return result;
}

// --- Drawing ---

function toCanvas(pt) {
  return { x: (1 - pt.x) * canvas.width, y: pt.y * canvas.height };
}

function drawArrow(p, dirY, color) {
  const sz = 6;
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.moveTo(p.x, p.y + sz * dirY);
  ctx.lineTo(p.x - sz * 0.6, p.y - sz * 0.4 * dirY);
  ctx.lineTo(p.x + sz * 0.6, p.y - sz * 0.4 * dirY);
  ctx.closePath();
  ctx.fill();
}

function drawLine(a, b, ok) {
  const p1 = toCanvas(a);
  const p2 = toCanvas(b);
  const color = ok ? '#00ff44' : '#ff3333';

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  for (const p of [p1, p2]) {
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  if (!ok) {
    const higher = p1.y < p2.y ? p1 : p2;
    const lower = p1.y < p2.y ? p2 : p1;
    drawArrow({ x: higher.x, y: higher.y - 10 }, 1, color);
    drawArrow({ x: lower.x, y: lower.y + 10 }, -1, color);
  }
}

function drawHeadForward() {
  if (posture?.headOk !== false) return;
  const color = '#ff3333';
  const cx = canvas.width / 2;
  const cy = 30;
  const sz = 14;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy + sz);
  ctx.lineTo(cx, cy - sz);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - sz);
  ctx.lineTo(cx - 7, cy - sz + 10);
  ctx.moveTo(cx, cy - sz);
  ctx.lineTo(cx + 7, cy - sz + 10);
  ctx.stroke();
  ctx.font = '10px system-ui';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(t('pill.leanBack'), cx, cy + sz + 4);
}

function drawDistanceWarning() {
  if (posture?.distOk !== false) return;
  const color = '#ff3333';
  const w = canvas.width;
  const h = canvas.height;
  const sz = 20;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(sz, 4); ctx.lineTo(4, 4); ctx.lineTo(4, sz); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w - sz, 4); ctx.lineTo(w - 4, 4); ctx.lineTo(w - 4, sz); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sz, h - 4); ctx.lineTo(4, h - 4); ctx.lineTo(4, h - sz); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w - sz, h - 4); ctx.lineTo(w - 4, h - 4); ctx.lineTo(w - 4, h - sz); ctx.stroke();
  ctx.font = '10px system-ui';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const label = posture.tooClose ? t('pill.tooClose') : t('pill.tooFar');
  ctx.fillText(label, w / 2, h - 28);
}

function drawTurnWarning() {
  if (posture?.facingOk !== false || !posture?.noseOffset) return;
  const color = '#ff3333';
  const dir = posture.noseOffset > 0 ? 1 : -1;
  const cy = canvas.height / 2;
  const cx = dir > 0 ? canvas.width - 30 : 30;
  const sz = 16;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - sz * dir, cy);
  ctx.lineTo(cx + sz * dir, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + sz * dir, cy);
  ctx.lineTo(cx + sz * dir - 8 * dir, cy - 6);
  ctx.moveTo(cx + sz * dir, cy);
  ctx.lineTo(cx + sz * dir - 8 * dir, cy + 6);
  ctx.stroke();
}

function drawHandWarning() {
  if (!posture?.handNearHead) return;
  const color = '#ff3333';
  // Show on the side where the hand is detected
  const side = posture.handSide === 'left' ? 1 : -1; // mirrored
  const cx = side > 0 ? canvas.width - 40 : 40;
  const cy = canvas.height * 0.35;
  // Hand icon: small palm shape
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  // Circle for palm
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.stroke();
  // X through it (not allowed)
  ctx.beginPath();
  ctx.moveTo(cx - 7, cy - 7);
  ctx.lineTo(cx + 7, cy + 7);
  ctx.moveTo(cx + 7, cy - 7);
  ctx.lineTo(cx - 7, cy + 7);
  ctx.stroke();
  // Label
  ctx.font = '9px system-ui';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(t('pill.hand'), cx, cy + 14);
}

function drawBreakAlert() {
  if (!breakAlert) return;
  const w = canvas.width;
  const h = canvas.height;
  // Pulsing overlay
  const alpha = 0.3 + 0.15 * Math.sin(performance.now() / 400);
  ctx.fillStyle = `rgba(255, 180, 0, ${alpha})`;
  ctx.fillRect(0, 0, w, h);
  // Message
  ctx.font = 'bold 16px system-ui';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t('pill.standUp'), w / 2, h / 2 - 10);
  ctx.font = '11px system-ui';
  ctx.fillText(t('pill.timeForBreak'), w / 2, h / 2 + 12);
}

function drawWindDownAlert() {
  if (!windDownAlert) return;
  const w = canvas.width;
  const h = canvas.height;
  // Stronger pulsing overlay — deep red/purple
  const alpha = 0.5 + 0.2 * Math.sin(performance.now() / 300);
  ctx.fillStyle = `rgba(120, 30, 60, ${alpha})`;
  ctx.fillRect(0, 0, w, h);
  // Message
  ctx.font = 'bold 20px system-ui';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t('pill.timeToStop'), w / 2, h / 2 - 16);
  ctx.font = '12px system-ui';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const hh = String(config.windDownHour).padStart(2, '0');
  const mm = String(config.windDownMinute).padStart(2, '0');
  ctx.fillText(t('pill.windDownMsg', { time: `${hh}:${mm}` }), w / 2, h / 2 + 10);
}

function drawStatusBar() {
  const barH = 22;
  const y = canvas.height - barH;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, y, canvas.width, barH);

  const items = [
    { label: t('pill.eyes'), ok: posture?.eyeOk },
    { label: t('pill.head'), ok: posture?.headOk },
    { label: t('pill.shld'), ok: posture?.shoulderOk },
    { label: t('pill.dist'), ok: posture?.distOk },
    { label: t('pill.turn'), ok: posture?.facingOk },
    { label: t('pill.handLabel'), ok: posture?.handNearHead === undefined ? undefined : !posture.handNearHead },
  ];

  const sw = canvas.width / items.length;
  ctx.font = '8px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  items.forEach((item, i) => {
    const cx = sw * i + sw / 2;
    const cy = y + barH / 2;

    const color = item.ok === undefined ? '#666' : item.ok ? '#00ff44' : '#ff3333';
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(cx - 12, cy, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.fillText(item.label, cx + 8, cy);
  });

  // Stats overlay (top-left)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, 90, 14);
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#aaa';
  const fps = getTargetFps(pill.pillVisible);
  ctx.fillText(`${stats.detectMs.toFixed(0)}ms · ${stats.detectsPerSec}d/s · ${fps}fps`, 4, 3);
}

// --- Main loop ---

function loop() {
  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-canvas.width, 0);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  frame++;
  const detectEvery = getDetectEvery(pill.pillVisible);
  if (frame % detectEvery === 0) {
    posture = detect();
  }

  if (posture) {
    if (posture.leftEye && posture.rightEye) {
      drawLine(posture.leftEye, posture.rightEye, posture.eyeOk);
    }
    if (posture.leftShoulder && posture.rightShoulder) {
      drawLine(posture.leftShoulder, posture.rightShoulder, posture.shoulderOk);
    }
    drawHeadForward();
    drawDistanceWarning();
    drawTurnWarning();
    drawHandWarning();
  }

  drawBreakAlert();
  drawWindDownAlert();
  drawStatusBar();

  const now = performance.now();

  // Sit timer: face detected = sitting
  const faceDetected = !!(posture?.leftEye);
  const sitResult = sit.update(faceDetected, now);
  if (sitResult.needsBreak && !breakAlert && !windDownAlert) {
    breakAlert = true;
    statsCollector.onBreakAlert();
    dismissBtn.style.display = 'block';
    window.pill.show();
    pill.pillVisible = true;
  }
  if (!faceDetected && breakAlert) {
    breakAlert = false;
    dismissBtn.style.display = 'none';
  }

  // Wind Down timer: wall-clock based
  const windResult = windDown.update(Date.now());
  if (windResult.shouldWarn && !windDownAlert && !breakAlert) {
    windDownAlert = true;
    dismissBtn.style.display = 'block';
    window.pill.show();
    pill.pillVisible = true;
  }

  // Posture show/hide (only when no alert active)
  if (posture && !breakAlert && !windDownAlert) {
    const allOk = isAllOk(posture);
    const { action } = pill.update(allOk, now);
    if (action === 'show') {
      window.pill.show();
      statsCollector.onPillShown();
    }
    if (action === 'hide') window.pill.hide();
  }

  // Stats collection
  const wallNow = Date.now();
  const allOkForStats = posture ? isAllOk(posture) : true;
  const rollover = statsCollector.tick(faceDetected, allOkForStats, wallNow);
  if (rollover) {
    // Midnight rollover — flush old day's data
    window.stats.flush(rollover);
  }
}

init().catch((err) => {
  loading.textContent = 'Error: ' + err.message;
  console.error(err);
});
