import {
  FaceLandmarker,
  PoseLandmarker,
  FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs';

import { mid, angleDeg, calibrateFromBaseline } from './posture.js';
import { t, setLocale, applyTranslations } from './i18n.mjs';

// Load locale from config
window.config.get().then(cfg => {
  if (cfg.locale) setLocale(cfg.locale);
  applyTranslations();
});

let faceLandmarker, poseLandmarker;
let video, stream;
let currentStep = 0;
let baseline = null;
let capturedSamples = [];

// --- Step navigation ---

window.goToStep = function (step) {
  currentStep = step;
  document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
  document.querySelector(`.step[data-step="${step}"]`).classList.add('active');

  // Show dots only from step 1 onward
  const indicator = document.getElementById('steps-indicator');
  if (step === 0) {
    indicator.classList.remove('visible');
  } else {
    indicator.classList.add('visible');
    document.querySelectorAll('.step-dot').forEach((dot, i) => {
      const dotStep = i + 1; // dots represent steps 1-4
      dot.classList.remove('active', 'done');
      if (dotStep < step) dot.classList.add('done');
      if (dotStep === step) dot.classList.add('active');
    });
  }

  if (step === 1) initCamera();
  if (step === 2) startCapture();
  if (step === 3) startVerify();
  if (step === 7) finishOnboarding();
};

// --- MediaPipe + Camera init ---

async function initModels() {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
  );
  [faceLandmarker, poseLandmarker] = await Promise.all([
    FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
    }),
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    }),
  ]);
}

async function initCamera() {
  if (stream) return; // already initialized
  await initModels();
  video = document.getElementById('video');
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
  });
  video.srcObject = stream;
  await video.play();
  drawPreview('canvas');
}

// --- Live preview ---

function drawPreview(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function frame() {
    if (!video || video.paused) return;
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-canvas.width, 0);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Draw silhouette + landmarks if face detected
    const ts = performance.now();
    const faces = faceLandmarker.detectForVideo(video, ts);
    let poseLm = null;
    if (poseLandmarker) {
      const poses = poseLandmarker.detectForVideo(video, ts + 1);
      if (poses.landmarks?.length) poseLm = poses.landmarks[0];
    }
    if (faces.faceLandmarks?.length) {
      const lm = faces.faceLandmarks[0];
      drawSilhouetteGuide(ctx, canvas, lm, poseLm, null);
      const leftEye = mid(lm[33], lm[133]);
      const rightEye = mid(lm[362], lm[263]);
      drawDot(ctx, canvas, leftEye, '#34c759');
      drawDot(ctx, canvas, rightEye, '#34c759');
      drawLandmarkLine(ctx, canvas, leftEye, rightEye, '#34c759');
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function drawDot(ctx, canvas, pt, color) {
  const x = (1 - pt.x) * canvas.width;
  const y = pt.y * canvas.height;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawLandmarkLine(ctx, canvas, a, b, color) {
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.moveTo((1 - a.x) * canvas.width, a.y * canvas.height);
  ctx.lineTo((1 - b.x) * canvas.width, b.y * canvas.height);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawSilhouetteGuide(ctx, canvas, faceLm, poseLm, pulse) {
  const alpha = pulse != null ? 0.3 + 0.15 * Math.sin(pulse / 600) : 0.4;

  // Head oval — from face bounding landmarks
  const leftCheek = faceLm[234];
  const rightCheek = faceLm[454];
  const forehead = faceLm[10];
  const chin = faceLm[152];

  const cx = (1 - (leftCheek.x + rightCheek.x) / 2) * canvas.width;
  const cy = ((forehead.y + chin.y) / 2) * canvas.height;
  const rx = Math.abs(rightCheek.x - leftCheek.x) * canvas.width * 0.7;
  const ry = Math.abs(chin.y - forehead.y) * canvas.height * 0.65;

  ctx.shadowColor = '#34c759';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = `rgba(52, 199, 89, ${alpha})`;
  ctx.fillStyle = `rgba(52, 199, 89, 0.04)`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Neck line
  const neckX = cx;
  const neckTopY = cy + ry;
  const neckBottomY = neckTopY + 20;
  ctx.beginPath();
  ctx.moveTo(neckX - 10, neckTopY);
  ctx.quadraticCurveTo(neckX, neckBottomY + 5, neckX + 10, neckTopY);
  ctx.stroke();

  // Shoulder curve
  if (poseLm && poseLm[11].visibility > 0.3 && poseLm[12].visibility > 0.3) {
    const ls = { x: (1 - poseLm[11].x) * canvas.width, y: poseLm[11].y * canvas.height };
    const rs = { x: (1 - poseLm[12].x) * canvas.width, y: poseLm[12].y * canvas.height };
    const midY = (ls.y + rs.y) / 2 - 8;

    ctx.beginPath();
    ctx.moveTo(ls.x - 20, ls.y + 8);
    ctx.quadraticCurveTo(ls.x, ls.y - 8, (ls.x + rs.x) / 2, midY);
    ctx.quadraticCurveTo(rs.x, rs.y - 8, rs.x + 20, rs.y + 8);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
}

// --- Capture baseline ---

function startCapture() {
  capturedSamples = [];
  const canvas = document.getElementById('canvas-capture');
  const ctx = canvas.getContext('2d');
  const countdownEl = document.getElementById('countdown');
  const ringEl = document.getElementById('progress-ring');
  const DURATION = 5;
  let startTime = null;

  function frame(now) {
    if (!startTime) startTime = now;
    const elapsed = (now - startTime) / 1000;
    const remaining = Math.max(0, DURATION - elapsed);

    // Draw camera
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-canvas.width, 0);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Countdown
    countdownEl.textContent = Math.ceil(remaining);

    // Progress ring
    const progress = Math.min(elapsed / DURATION, 1);
    const circumference = 97.4;
    ringEl.setAttribute('stroke-dashoffset', circumference * (1 - progress));

    // Capture sample
    const sample = detectPosture();
    if (sample) capturedSamples.push(sample);

    // Draw silhouette + landmarks
    if (sample) {
      const facesAgain = faceLandmarker.detectForVideo(video, performance.now() + 0.1);
      let poseLmCapture = null;
      if (poseLandmarker) {
        const posesAgain = poseLandmarker.detectForVideo(video, performance.now() + 0.2);
        if (posesAgain.landmarks?.length) poseLmCapture = posesAgain.landmarks[0];
      }
      if (facesAgain.faceLandmarks?.length) {
        drawSilhouetteGuide(ctx, canvas, facesAgain.faceLandmarks[0], poseLmCapture, now);
      }
      if (sample.leftEye && sample.rightEye) {
        drawDot(ctx, canvas, sample.leftEye, '#34c759');
        drawDot(ctx, canvas, sample.rightEye, '#34c759');
        drawLandmarkLine(ctx, canvas, sample.leftEye, sample.rightEye, '#34c759');
      }
    }

    if (elapsed < DURATION) {
      requestAnimationFrame(frame);
    } else {
      computeBaseline();
      goToStep(3);
    }
  }

  requestAnimationFrame(frame);
}

function detectPosture() {
  const ts = performance.now();
  const result = {};

  const faces = faceLandmarker.detectForVideo(video, ts);
  if (faces.faceLandmarks?.length) {
    const lm = faces.faceLandmarks[0];
    result.leftEye = mid(lm[33], lm[133]);
    result.rightEye = mid(lm[362], lm[263]);
    result.eyeAngle = angleDeg(result.leftEye, result.rightEye);
    result.eyeDist = Math.hypot(result.rightEye.x - result.leftEye.x, result.rightEye.y - result.leftEye.y);

    const nose = lm[1];
    const faceCenter = mid(lm[234], lm[454]);
    const faceWidth = Math.abs(lm[454].x - lm[234].x);
    result.noseOffset = faceWidth > 0 ? (nose.x - faceCenter.x) / faceWidth : 0;
  }

  const poses = poseLandmarker.detectForVideo(video, ts + 1);
  if (poses.landmarks?.length) {
    const lm = poses.landmarks[0];
    if (lm[11].visibility > 0.3 && lm[12].visibility > 0.3) {
      result.shoulderAngle = angleDeg(lm[11], lm[12]);
    }
    const earMidZ = (lm[7].z + lm[8].z) / 2;
    const shoulderMidZ = (lm[11].z + lm[12].z) / 2;
    result.headForwardDelta = earMidZ - shoulderMidZ;
  }

  return result.eyeDist ? result : null;
}

function computeBaseline() {
  if (capturedSamples.length === 0) return;
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

  baseline = {
    eyeDist: avg(capturedSamples.map(s => s.eyeDist)),
    eyeAngle: avg(capturedSamples.map(s => s.eyeAngle || 0)),
    shoulderAngle: avg(capturedSamples.filter(s => s.shoulderAngle != null).map(s => s.shoulderAngle)),
    headForwardDelta: avg(capturedSamples.filter(s => s.headForwardDelta != null).map(s => s.headForwardDelta)),
    noseOffset: avg(capturedSamples.map(s => s.noseOffset || 0)),
  };
}

// --- Verify ---

function startVerify() {
  const canvas = document.getElementById('canvas-verify');
  const ctx = canvas.getContext('2d');
  const msg = document.getElementById('verify-msg');
  const skipBtn = document.getElementById('skip-verify');
  let detected = false;
  let detectedTime = null;

  // Compute thresholds from baseline
  const thresholds = calibrateFromBaseline(baseline, 'moderate');

  function frame() {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-canvas.width, 0);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    const sample = detectPosture();

    if (sample && !detected) {
      const eyeBad = Math.abs(sample.eyeAngle) >= thresholds.EYE_ANGLE_THRESHOLD;
      const headBad = sample.headForwardDelta != null && sample.headForwardDelta <= -thresholds.HEAD_FORWARD_THRESHOLD;
      const shoulderBad = sample.shoulderAngle != null && Math.abs(sample.shoulderAngle) >= thresholds.SHOULDER_ANGLE_THRESHOLD;

      if (eyeBad || headBad || shoulderBad) {
        detected = true;
        detectedTime = performance.now();
        msg.className = 'verify-status detected';
        msg.innerHTML = t('onboarding.verify.detected');
      }

      // Draw visual feedback
      if (sample.leftEye && sample.rightEye) {
        const color = eyeBad ? '#ff3333' : '#34c759';
        drawLandmarkLine(ctx, canvas, sample.leftEye, sample.rightEye, color);
        drawDot(ctx, canvas, sample.leftEye, color);
        drawDot(ctx, canvas, sample.rightEye, color);
      }
    }

    if (detected && sample) {
      const eyeOk = Math.abs(sample.eyeAngle) < thresholds.EYE_ANGLE_THRESHOLD;
      const headOk = sample.headForwardDelta == null || sample.headForwardDelta > -thresholds.HEAD_FORWARD_THRESHOLD;
      const elapsed = performance.now() - detectedTime;

      if (eyeOk && headOk && elapsed > 1500) {
        msg.innerHTML = t('onboarding.verify.verified');
        skipBtn.style.display = 'inline-block';
        skipBtn.textContent = 'Continue';
        return; // stop loop
      }

      if (sample.leftEye && sample.rightEye) {
        const color = eyeOk ? '#34c759' : '#ff3333';
        drawLandmarkLine(ctx, canvas, sample.leftEye, sample.rightEye, color);
        drawDot(ctx, canvas, sample.leftEye, color);
        drawDot(ctx, canvas, sample.rightEye, color);
      }
    }

    // Auto-skip after 15s if detection not triggered
    if (!detected && performance.now() - verifyStart > 15000) {
      msg.innerHTML = t('onboarding.verify.skipped');
      skipBtn.style.display = 'inline-block';
      return;
    }

    requestAnimationFrame(frame);
  }

  const verifyStart = performance.now();
  requestAnimationFrame(frame);
}

// --- Finish ---

document.getElementById('finish-btn').addEventListener('click', async () => {
  const strictness = document.querySelector('input[name="strictness"]:checked')?.value || 'moderate';
  const breakIntervalMin = Math.max(1, parseInt(document.getElementById('breakInterval').value) || 60);
  const breakRemindMin = Math.max(1, parseInt(document.getElementById('breakRemind').value) || 5);
  const windDownEnabled = document.getElementById('windDownEnabled').checked;
  const windDownHour = Math.min(23, Math.max(0, parseInt(document.getElementById('windDownHour').value) || 20));
  const windDownMinute = Math.min(59, Math.max(0, parseInt(document.getElementById('windDownMinute').value) || 0));
  const windDownRemindMin = Math.max(1, parseInt(document.getElementById('windDownRemind').value) || 15);

  const levels = { eyes: strictness, head: strictness, shoulders: strictness, distance: strictness, turn: strictness, hand: strictness };

  await window.config.save({
    calibrated: true,
    strictness,
    levels,
    breakIntervalMin,
    breakRemindMin,
    windDownEnabled,
    windDownHour,
    windDownMinute,
    windDownRemindMin,
    baseline,
  });

  goToStep(7);
  setTimeout(() => window.onboarding.complete(), 2500);
});

document.getElementById('start-calibration').addEventListener('click', () => goToStep(2));

function finishOnboarding() {
  // Stop camera
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
}
