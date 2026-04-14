// --- Per-aspect strictness values ---
export const ASPECT_VALUES = {
  eyes:      { light: 25, moderate: 18, severe: 10 },
  head:      { light: 0.55, moderate: 0.45, severe: 0.35 },
  shoulders: { light: 25, moderate: 18, severe: 10 },
  distance:  { light: { close: 1.35, far: 0.65 }, moderate: { close: 1.20, far: 0.75 }, severe: { close: 1.10, far: 0.85 } },
  turn:      { light: 0.22, moderate: 0.15, severe: 0.10 },
  hand:      { light: 0.20, moderate: 0.15, severe: 0.10 },
};

// --- Legacy presets (for uncalibrated fallback) ---
export const PRESETS = {
  light:    { EYE_ANGLE_THRESHOLD: 25, SHOULDER_ANGLE_THRESHOLD: 25, HEAD_FORWARD_THRESHOLD: 0.55, DIST_CLOSE: 0.10, DIST_FAR: 0.04, TURN_THRESHOLD: 0.22, HEAD_ON_HAND_THRESHOLD: 0.20 },
  moderate: { EYE_ANGLE_THRESHOLD: 18, SHOULDER_ANGLE_THRESHOLD: 18, HEAD_FORWARD_THRESHOLD: 0.45, DIST_CLOSE: 0.08, DIST_FAR: 0.055, TURN_THRESHOLD: 0.15, HEAD_ON_HAND_THRESHOLD: 0.15 },
  severe:   { EYE_ANGLE_THRESHOLD: 10, SHOULDER_ANGLE_THRESHOLD: 10, HEAD_FORWARD_THRESHOLD: 0.35, DIST_CLOSE: 0.075, DIST_FAR: 0.065, TURN_THRESHOLD: 0.10, HEAD_ON_HAND_THRESHOLD: 0.10 },
};

// --- Active config (mutable) ---
export const config = {
  ...PRESETS.moderate,
  breakIntervalMin: 60,
  breakRemindMin: 5,
  windDownEnabled: true,
  windDownHour: 20,
  windDownMinute: 0,
  windDownRemindMin: 15,
};

// --- Calibration ---
const MARGINS = {
  light:    { angle: 25, headFwdMargin: 0.20, distCloseMul: 1.35, distFarMul: 0.65, turn: 0.22, hand: 0.20 },
  moderate: { angle: 15, headFwdMargin: 0.12, distCloseMul: 1.20, distFarMul: 0.75, turn: 0.15, hand: 0.15 },
  severe:   { angle: 8,  headFwdMargin: 0.05, distCloseMul: 1.10, distFarMul: 0.85, turn: 0.10, hand: 0.10 },
};

export function calibrateFromBaseline(baseline, strictness = 'moderate') {
  const m = MARGINS[strictness] || MARGINS.moderate;
  return {
    EYE_ANGLE_THRESHOLD: m.angle,
    SHOULDER_ANGLE_THRESHOLD: m.angle,
    HEAD_FORWARD_THRESHOLD: Math.abs(baseline.headForwardDelta) + m.headFwdMargin,
    DIST_CLOSE: baseline.eyeDist * m.distCloseMul,
    DIST_FAR: baseline.eyeDist * m.distFarMul,
    TURN_THRESHOLD: m.turn,
    HEAD_ON_HAND_THRESHOLD: m.hand,
  };
}

function applyPerAspect(levels, baseline) {
  // levels = { eyes: 'moderate', head: 'severe', ... }
  const av = ASPECT_VALUES;
  const result = {};
  result.EYE_ANGLE_THRESHOLD = av.eyes[levels.eyes || 'moderate'];
  result.SHOULDER_ANGLE_THRESHOLD = av.shoulders[levels.shoulders || 'moderate'];
  result.HEAD_FORWARD_THRESHOLD = av.head[levels.head || 'moderate'];
  result.TURN_THRESHOLD = av.turn[levels.turn || 'moderate'];
  result.HEAD_ON_HAND_THRESHOLD = av.hand[levels.hand || 'moderate'];

  // Distance depends on baseline if calibrated
  const dl = av.distance[levels.distance || 'moderate'];
  if (baseline?.eyeDist) {
    result.DIST_CLOSE = baseline.eyeDist * dl.close;
    result.DIST_FAR = baseline.eyeDist * dl.far;
  } else {
    result.DIST_CLOSE = PRESETS[levels.distance || 'moderate'].DIST_CLOSE;
    result.DIST_FAR = PRESETS[levels.distance || 'moderate'].DIST_FAR;
  }

  // Head forward also depends on baseline
  if (baseline?.headForwardDelta) {
    const margins = { light: 0.20, moderate: 0.12, severe: 0.05 };
    result.HEAD_FORWARD_THRESHOLD = Math.abs(baseline.headForwardDelta) + margins[levels.head || 'moderate'];
  }

  return result;
}

export function setConfig(newConfig) {
  // Per-aspect strictness levels
  if (newConfig.levels) {
    Object.assign(config, applyPerAspect(newConfig.levels, newConfig.baseline));
  } else if (newConfig.baseline && newConfig.strictness) {
    Object.assign(config, calibrateFromBaseline(newConfig.baseline, newConfig.strictness));
  } else if (newConfig.strictness && PRESETS[newConfig.strictness]) {
    Object.assign(config, PRESETS[newConfig.strictness]);
  }
  if (newConfig.breakIntervalMin != null) config.breakIntervalMin = newConfig.breakIntervalMin;
  if (newConfig.breakRemindMin != null) config.breakRemindMin = newConfig.breakRemindMin;
  if (newConfig.windDownEnabled != null) config.windDownEnabled = newConfig.windDownEnabled;
  if (newConfig.windDownHour != null) config.windDownHour = newConfig.windDownHour;
  if (newConfig.windDownMinute != null) config.windDownMinute = newConfig.windDownMinute;
  if (newConfig.windDownRemindMin != null) config.windDownRemindMin = newConfig.windDownRemindMin;
}

// --- Visibility ---
export const BAD_DURATION_MS = 5000;
export const GOOD_DELAY_MS = 4000;

// --- Performance ---
export const IDLE_FPS = 5;
export const ACTIVE_FPS = 24;
export const DETECT_EVERY_IDLE = 2;
export const DETECT_EVERY_ACTIVE = 2;

// --- Pure math ---

export function angleDeg(a, b) {
  let deg = Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;
  return deg;
}

export function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 };
}

// --- Posture checks ---

export function checkEyeLevel(leftEye, rightEye) {
  const eyeAngle = angleDeg(leftEye, rightEye);
  return { eyeAngle, eyeOk: Math.abs(eyeAngle) < config.EYE_ANGLE_THRESHOLD };
}

export function checkDistance(leftEye, rightEye) {
  const eyeDist = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
  return {
    eyeDist,
    distOk: eyeDist >= config.DIST_FAR && eyeDist <= config.DIST_CLOSE,
    tooClose: eyeDist > config.DIST_CLOSE,
  };
}

export function checkFacing(nose, leftCheek, rightCheek) {
  const faceCenter = mid(leftCheek, rightCheek);
  const faceWidth = Math.abs(rightCheek.x - leftCheek.x);
  const noseOffset = faceWidth > 0 ? (nose.x - faceCenter.x) / faceWidth : 0;
  return { noseOffset, facingOk: Math.abs(noseOffset) < config.TURN_THRESHOLD };
}

export function checkShoulders(leftShoulder, rightShoulder) {
  const shoulderAngle = angleDeg(leftShoulder, rightShoulder);
  return { shoulderAngle, shoulderOk: Math.abs(shoulderAngle) < config.SHOULDER_ANGLE_THRESHOLD };
}

export function checkHeadForward(leftEar, rightEar, leftShoulder, rightShoulder) {
  const earMidZ = (leftEar.z + rightEar.z) / 2;
  const shoulderMidZ = (leftShoulder.z + rightShoulder.z) / 2;
  const headForwardDelta = earMidZ - shoulderMidZ;
  return { headForwardDelta, headOk: headForwardDelta > -config.HEAD_FORWARD_THRESHOLD };
}

export function checkHeadOnHand(hands, nose, leftEar, rightEar) {
  if (!hands || hands.length === 0) {
    return { handNearHead: false, handDist: Infinity };
  }
  let minDist = Infinity;
  let closestSide = 'left';
  for (const hand of hands) {
    const wrist = hand[0];
    const palm = hand[9];
    const pt = palm || wrist;
    const dNose = Math.hypot(pt.x - nose.x, pt.y - nose.y);
    const dLeft = Math.hypot(pt.x - leftEar.x, pt.y - leftEar.y);
    const dRight = Math.hypot(pt.x - rightEar.x, pt.y - rightEar.y);
    const best = Math.min(dNose, dLeft, dRight);
    if (best < minDist) {
      minDist = best;
      closestSide = dLeft < dRight ? 'left' : 'right';
    }
  }
  return {
    handNearHead: minDist < config.HEAD_ON_HAND_THRESHOLD,
    handDist: minDist,
    handSide: closestSide,
  };
}

export function isAllOk(posture) {
  return (posture.eyeOk !== false)
    && (posture.headOk !== false)
    && (posture.shoulderOk !== false)
    && (posture.distOk !== false)
    && (posture.facingOk !== false)
    && (posture.handNearHead !== true);
}

// --- Pill visibility state machine ---

export class PillStateMachine {
  constructor() {
    this.pillVisible = false;
    this.badSince = null;
    this.goodSince = null;
  }

  update(allOk, now) {
    if (allOk) {
      this.badSince = null;
      if (this.pillVisible) {
        if (this.goodSince === null) this.goodSince = now;
        if (now - this.goodSince >= GOOD_DELAY_MS) {
          this.pillVisible = false;
          this.goodSince = null;
          return { action: 'hide', pillVisible: false };
        }
      }
    } else {
      this.goodSince = null;
      if (this.badSince === null) this.badSince = now;
      if (!this.pillVisible && now - this.badSince >= BAD_DURATION_MS) {
        this.pillVisible = true;
        return { action: 'show', pillVisible: true };
      }
    }
    return { action: null, pillVisible: this.pillVisible };
  }
}

// --- Break timer ---

export class SitTimer {
  constructor() {
    this.sittingSince = null;
    this.dismissedAt = null;
    this.alertActive = false;
  }

  update(faceDetected, now) {
    if (faceDetected) {
      if (this.sittingSince === null) this.sittingSince = now;
      const elapsed = now - this.sittingSince;
      const breakMs = config.breakIntervalMin * 60 * 1000;
      const remindMs = config.breakRemindMin * 60 * 1000;

      if (elapsed >= breakMs && !this.alertActive && this.dismissedAt === null) {
        this.alertActive = true;
        return { needsBreak: true, sittingMs: elapsed };
      }

      if (this.dismissedAt !== null && !this.alertActive) {
        if (now - this.dismissedAt >= remindMs) {
          this.alertActive = true;
          return { needsBreak: true, sittingMs: elapsed };
        }
      }

      return { needsBreak: false, sittingMs: elapsed };
    } else {
      this.sittingSince = null;
      this.dismissedAt = null;
      this.alertActive = false;
      return { needsBreak: false, sittingMs: 0 };
    }
  }

  dismiss(now) {
    this.alertActive = false;
    this.dismissedAt = now;
  }
}

// --- Wind Down timer ---

export class WindDownTimer {
  constructor() {
    this.alertActive = false;
    this.snoozedAt = null;
    this.triggeredToday = false;
    this.lastCheckedDay = null;
  }

  update(nowMs) {
    if (!config.windDownEnabled) return { shouldWarn: false };

    const d = new Date(nowMs);
    const day = d.getDate();
    const currentMin = d.getHours() * 60 + d.getMinutes();
    const targetMin = config.windDownHour * 60 + config.windDownMinute;

    // Reset at midnight (new day)
    if (this.lastCheckedDay !== null && this.lastCheckedDay !== day) {
      this.triggeredToday = false;
      this.alertActive = false;
      this.snoozedAt = null;
    }
    this.lastCheckedDay = day;

    // Before target time — nothing
    if (currentMin < targetMin) return { shouldWarn: false };

    // Already showing — don't re-trigger
    if (this.alertActive) return { shouldWarn: false };

    // First trigger of the day
    if (!this.triggeredToday && this.snoozedAt === null) {
      this.alertActive = true;
      this.triggeredToday = true;
      return { shouldWarn: true };
    }

    // Re-warn after snooze
    if (this.snoozedAt !== null) {
      const remindMs = config.windDownRemindMin * 60 * 1000;
      if (nowMs - this.snoozedAt >= remindMs) {
        this.alertActive = true;
        return { shouldWarn: true };
      }
    }

    return { shouldWarn: false };
  }

  snooze(nowMs) {
    this.alertActive = false;
    this.snoozedAt = nowMs;
  }
}

// --- Dismiss timer ---

export class DismissTimer {
  constructor() {
    this.dismissedAt = null;
    this.durationMs = 0;
  }

  get dismissed() {
    return this.dismissedAt !== null;
  }

  dismiss(durationMs, now) {
    this.dismissedAt = now;
    this.durationMs = durationMs;
  }

  resume() {
    this.dismissedAt = null;
    this.durationMs = 0;
  }

  update(now) {
    if (this.dismissedAt === null) return { dismissed: false, remainingMs: 0 };
    const elapsed = now - this.dismissedAt;
    const remaining = this.durationMs - elapsed;
    if (remaining <= 0) {
      this.dismissedAt = null;
      this.durationMs = 0;
      return { dismissed: false, remainingMs: 0 };
    }
    return { dismissed: true, remainingMs: remaining };
  }

  formatRemaining(now) {
    const { remainingMs } = this.update(now);
    if (remainingMs <= 0) return '';
    const totalSec = Math.ceil(remainingMs / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }
}

// --- FPS helpers ---

export function getTargetFps(pillVisible) {
  return pillVisible ? ACTIVE_FPS : IDLE_FPS;
}

export function getDetectEvery(pillVisible) {
  return pillVisible ? DETECT_EVERY_ACTIVE : DETECT_EVERY_IDLE;
}
