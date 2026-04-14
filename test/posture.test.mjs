import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { t, setLocale, getLocale, translations } from '../i18n.mjs';
import {
  angleDeg, mid,
  checkEyeLevel, checkDistance, checkFacing,
  checkShoulders, checkHeadForward, checkHeadOnHand, isAllOk,
  PillStateMachine, SitTimer, WindDownTimer, DismissTimer, getTargetFps, getDetectEvery,
  setConfig, config, PRESETS,
  BAD_DURATION_MS, GOOD_DELAY_MS,
  IDLE_FPS, ACTIVE_FPS, DETECT_EVERY_IDLE, DETECT_EVERY_ACTIVE,
} from '../posture.js';

// Ensure tests use moderate defaults
setConfig({ strictness: 'moderate', breakIntervalMin: 0.5, breakRemindMin: 1/60*2.5 });
// Alias for readability
const { EYE_ANGLE_THRESHOLD, SHOULDER_ANGLE_THRESHOLD, DIST_CLOSE, DIST_FAR, TURN_THRESHOLD,
  HEAD_FORWARD_THRESHOLD, HEAD_ON_HAND_THRESHOLD } = config;

// --- angleDeg ---

describe('angleDeg', () => {
  it('returns 0 for horizontally aligned points', () => {
    assert.equal(angleDeg({ x: 0, y: 0 }, { x: 1, y: 0 }), 0);
  });

  it('returns positive angle when b is below a', () => {
    const deg = angleDeg({ x: 0, y: 0 }, { x: 1, y: 1 });
    assert.ok(Math.abs(deg - 45) < 0.01);
  });

  it('returns negative angle when b is above a', () => {
    const deg = angleDeg({ x: 0, y: 0 }, { x: 1, y: -1 });
    assert.ok(Math.abs(deg - (-45)) < 0.01);
  });

  it('wraps 180 to 0 (points going right-to-left)', () => {
    const deg = angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 });
    assert.ok(Math.abs(deg) < 0.01);
  });

  it('wraps angles < -90 into [-90, 90]', () => {
    const deg = angleDeg({ x: 1, y: 0.01 }, { x: 0, y: 0 });
    assert.ok(deg >= -90 && deg <= 90);
  });

  it('handles identical points without throwing', () => {
    const deg = angleDeg({ x: 5, y: 5 }, { x: 5, y: 5 });
    assert.equal(deg, 0);
  });

  it('handles near-vertical alignment', () => {
    const deg = angleDeg({ x: 0, y: 0 }, { x: 0.001, y: 1 });
    assert.ok(deg > 80 && deg <= 90);
  });
});

// --- mid ---

describe('mid', () => {
  it('computes midpoint of two 2D points', () => {
    assert.deepEqual(mid({ x: 0, y: 0 }, { x: 10, y: 10 }), { x: 5, y: 5, z: 0 });
  });

  it('averages z coordinates when present', () => {
    assert.deepEqual(mid({ x: 0, y: 0, z: 2 }, { x: 10, y: 10, z: 4 }), { x: 5, y: 5, z: 3 });
  });

  it('falls back to 0 when z is missing on one point', () => {
    assert.deepEqual(mid({ x: 0, y: 0, z: 6 }, { x: 10, y: 10 }), { x: 5, y: 5, z: 3 });
  });

  it('falls back to 0 when z is missing on both', () => {
    assert.deepEqual(mid({ x: 2, y: 4 }, { x: 6, y: 8 }), { x: 4, y: 6, z: 0 });
  });
});

// --- checkEyeLevel ---

describe('checkEyeLevel', () => {
  it('returns eyeOk=true when eyes are level', () => {
    const r = checkEyeLevel({ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 });
    assert.equal(r.eyeOk, true);
    assert.ok(Math.abs(r.eyeAngle) < 1);
  });

  it('returns eyeOk=false when tilted beyond threshold', () => {
    // ~26.5 degrees
    const r = checkEyeLevel({ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.5 });
    assert.equal(r.eyeOk, false);
  });

  it('returns eyeOk=true just inside threshold', () => {
    // Small angle within 18 degrees
    const r = checkEyeLevel({ x: 0, y: 0 }, { x: 1, y: 0.1 });
    assert.equal(r.eyeOk, true);
  });

  it('returns eyeOk=false just outside threshold', () => {
    // ~21.8 degrees
    const r = checkEyeLevel({ x: 0, y: 0 }, { x: 1, y: 0.4 });
    assert.equal(r.eyeOk, false);
  });
});

// --- checkDistance ---

describe('checkDistance', () => {
  it('returns distOk=true when in range', () => {
    const r = checkDistance({ x: 0.4, y: 0.5 }, { x: 0.47, y: 0.5 });
    assert.equal(r.distOk, true);
    assert.equal(r.tooClose, false);
  });

  it('returns tooClose=true when too close', () => {
    const r = checkDistance({ x: 0.3, y: 0.5 }, { x: 0.5, y: 0.5 });
    assert.equal(r.distOk, false);
    assert.equal(r.tooClose, true);
  });

  it('returns tooClose=false when too far', () => {
    const r = checkDistance({ x: 0.49, y: 0.5 }, { x: 0.5, y: 0.5 });
    assert.equal(r.distOk, false);
    assert.equal(r.tooClose, false);
  });

  it('returns distOk=true at exact DIST_FAR boundary', () => {
    const r = checkDistance({ x: 0.5, y: 0.5 }, { x: 0.5 + DIST_FAR, y: 0.5 });
    assert.equal(r.distOk, true);
  });

  it('returns distOk=true at exact DIST_CLOSE boundary', () => {
    const r = checkDistance({ x: 0.5, y: 0.5 }, { x: 0.5 + DIST_CLOSE, y: 0.5 });
    assert.equal(r.distOk, true);
  });
});

// --- checkFacing ---

describe('checkFacing', () => {
  it('returns facingOk=true when facing straight', () => {
    const nose = { x: 0.5, y: 0.4 };
    const left = { x: 0.3, y: 0.5 };
    const right = { x: 0.7, y: 0.5 };
    assert.equal(checkFacing(nose, left, right).facingOk, true);
  });

  it('returns facingOk=false when turned far right', () => {
    const nose = { x: 0.65, y: 0.4 };
    const left = { x: 0.3, y: 0.5 };
    const right = { x: 0.7, y: 0.5 };
    assert.equal(checkFacing(nose, left, right).facingOk, false);
  });

  it('returns facingOk=false when turned far left', () => {
    const nose = { x: 0.35, y: 0.4 };
    const left = { x: 0.3, y: 0.5 };
    const right = { x: 0.7, y: 0.5 };
    assert.equal(checkFacing(nose, left, right).facingOk, false);
  });

  it('returns facingOk=true when face width is 0 (degenerate)', () => {
    const r = checkFacing({ x: 0.5, y: 0.4 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 });
    assert.equal(r.noseOffset, 0);
    assert.equal(r.facingOk, true);
  });
});

// --- checkShoulders ---

describe('checkShoulders', () => {
  it('returns shoulderOk=true when level', () => {
    const r = checkShoulders({ x: 0.3, y: 0.7 }, { x: 0.7, y: 0.7 });
    assert.equal(r.shoulderOk, true);
  });

  it('returns shoulderOk=false when uneven', () => {
    const r = checkShoulders({ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.8 });
    assert.equal(r.shoulderOk, false);
  });

  it('computes shoulder angle correctly', () => {
    const r = checkShoulders({ x: 0, y: 0 }, { x: 1, y: 0 });
    assert.ok(Math.abs(r.shoulderAngle) < 0.01);
  });
});

// --- checkHeadForward ---

describe('checkHeadForward', () => {
  it('returns headOk=true when head is not forward', () => {
    const r = checkHeadForward(
      { z: -0.1 }, { z: -0.1 }, { z: -0.05 }, { z: -0.05 }
    );
    assert.equal(r.headOk, true);
  });

  it('returns headOk=false when head is too far forward', () => {
    const r = checkHeadForward(
      { z: -0.6 }, { z: -0.6 }, { z: -0.1 }, { z: -0.1 }
    );
    assert.equal(r.headOk, false);
  });

  it('returns headOk=false at exact boundary (> not >=)', () => {
    // delta = -0.45, threshold = -0.45, condition is > so this is false
    const r = checkHeadForward(
      { z: -0.45 }, { z: -0.45 }, { z: 0 }, { z: 0 }
    );
    assert.equal(r.headOk, false);
  });
});

// --- checkHeadOnHand ---

describe('checkHeadOnHand', () => {
  const nose = { x: 0.5, y: 0.4 };
  const leftEar = { x: 0.3, y: 0.3 };
  const rightEar = { x: 0.7, y: 0.3 };
  // Helper: make a fake hand with wrist at [0] and palm center at [9]
  const hand = (wx, wy, px, py) => {
    const h = Array(21).fill({ x: 0, y: 0 });
    h[0] = { x: wx, y: wy }; // wrist
    h[9] = { x: px ?? wx, y: py ?? wy }; // palm center
    return h;
  };

  it('returns handNearHead=false when no hands detected', () => {
    const r = checkHeadOnHand([], nose, leftEar, rightEar);
    assert.equal(r.handNearHead, false);
  });

  it('returns handNearHead=false when hands are far from face', () => {
    const r = checkHeadOnHand(
      [hand(0.2, 0.8, 0.2, 0.75)],
      nose, leftEar, rightEar
    );
    assert.equal(r.handNearHead, false);
  });

  it('returns handNearHead=true when hand is near left ear', () => {
    const r = checkHeadOnHand(
      [hand(0.25, 0.25, 0.31, 0.31)],
      nose, leftEar, rightEar
    );
    assert.equal(r.handNearHead, true);
    assert.equal(r.handSide, 'left');
  });

  it('returns handNearHead=true when hand is near chin (nose area)', () => {
    const r = checkHeadOnHand(
      [hand(0.5, 0.5, 0.5, 0.42)],
      nose, leftEar, rightEar
    );
    assert.equal(r.handNearHead, true);
  });

  it('detects closest hand when multiple hands present', () => {
    const r = checkHeadOnHand(
      [hand(0.1, 0.9, 0.1, 0.85), hand(0.5, 0.42, 0.5, 0.42)],
      nose, leftEar, rightEar
    );
    assert.equal(r.handNearHead, true);
    assert.ok(r.handDist < 0.05);
  });
});

// --- isAllOk ---

describe('isAllOk', () => {
  it('returns true when all checks pass', () => {
    assert.equal(isAllOk({
      eyeOk: true, headOk: true, shoulderOk: true, distOk: true, facingOk: true,
    }), true);
  });

  it('returns true when checks are undefined (no detection)', () => {
    assert.equal(isAllOk({}), true);
  });

  it('returns false when any single check fails', () => {
    assert.equal(isAllOk({ eyeOk: false }), false);
    assert.equal(isAllOk({ headOk: false }), false);
    assert.equal(isAllOk({ shoulderOk: false }), false);
    assert.equal(isAllOk({ distOk: false }), false);
    assert.equal(isAllOk({ facingOk: false }), false);
  });

  it('returns false when hand is near head', () => {
    assert.equal(isAllOk({ handNearHead: true }), false);
  });

  it('returns false when multiple checks fail', () => {
    assert.equal(isAllOk({ eyeOk: false, headOk: false }), false);
  });

  it('returns true for mixed undefined and true', () => {
    assert.equal(isAllOk({ eyeOk: true, headOk: undefined, shoulderOk: true }), true);
  });
});

// --- PillStateMachine ---

describe('PillStateMachine', () => {
  it('starts with pill hidden', () => {
    const sm = new PillStateMachine();
    assert.equal(sm.pillVisible, false);
  });

  it('does not show pill on first bad frame', () => {
    const sm = new PillStateMachine();
    const r = sm.update(false, 0);
    assert.equal(r.action, null);
    assert.equal(r.pillVisible, false);
  });

  it('does not show pill before BAD_DURATION_MS', () => {
    const sm = new PillStateMachine();
    sm.update(false, 0);
    const r = sm.update(false, BAD_DURATION_MS - 1);
    assert.equal(r.action, null);
    assert.equal(r.pillVisible, false);
  });

  it('shows pill after BAD_DURATION_MS of sustained bad posture', () => {
    const sm = new PillStateMachine();
    sm.update(false, 0);
    const r = sm.update(false, BAD_DURATION_MS);
    assert.equal(r.action, 'show');
    assert.equal(r.pillVisible, true);
  });

  it('resets bad timer when posture corrects before threshold', () => {
    const sm = new PillStateMachine();
    sm.update(false, 0);
    sm.update(true, 3000);     // corrected — resets
    sm.update(false, 3000);    // bad again — timer restarts from 3000
    const r = sm.update(false, 3000 + BAD_DURATION_MS - 1);
    assert.equal(r.action, null);
    assert.equal(r.pillVisible, false);
  });

  it('does not hide pill immediately when posture corrects', () => {
    const sm = new PillStateMachine();
    sm.update(false, 0);
    sm.update(false, BAD_DURATION_MS); // shows
    const r = sm.update(true, BAD_DURATION_MS + 1);
    assert.equal(r.action, null);
    assert.equal(r.pillVisible, true);
  });

  it('hides pill after GOOD_DELAY_MS of sustained good posture', () => {
    const sm = new PillStateMachine();
    sm.update(false, 0);
    sm.update(false, BAD_DURATION_MS); // shows
    sm.update(true, BAD_DURATION_MS + 1); // good starts
    const r = sm.update(true, BAD_DURATION_MS + 1 + GOOD_DELAY_MS);
    assert.equal(r.action, 'hide');
    assert.equal(r.pillVisible, false);
  });

  it('resets good timer if posture goes bad again', () => {
    const sm = new PillStateMachine();
    sm.update(false, 0);
    sm.update(false, BAD_DURATION_MS); // shows
    sm.update(true, 6000);  // good starts
    sm.update(false, 7000); // bad again — resets goodSince
    sm.update(true, 7001);  // good restarts from 7001
    const r = sm.update(true, 7001 + GOOD_DELAY_MS - 1);
    assert.equal(r.action, null); // not yet
    const r2 = sm.update(true, 7001 + GOOD_DELAY_MS);
    assert.equal(r2.action, 'hide');
  });

  it('can show pill again after a full hide cycle', () => {
    const sm = new PillStateMachine();
    sm.update(false, 0);
    sm.update(false, BAD_DURATION_MS); // show
    sm.update(true, 6000);
    sm.update(true, 6000 + GOOD_DELAY_MS); // hide
    // Bad again
    sm.update(false, 20000);
    const r = sm.update(false, 20000 + BAD_DURATION_MS);
    assert.equal(r.action, 'show');
    assert.equal(r.pillVisible, true);
  });
});

// --- FPS helpers ---

describe('getTargetFps', () => {
  it('returns IDLE_FPS when pill is hidden', () => {
    assert.equal(getTargetFps(false), IDLE_FPS);
  });
  it('returns ACTIVE_FPS when pill is visible', () => {
    assert.equal(getTargetFps(true), ACTIVE_FPS);
  });
});

describe('getDetectEvery', () => {
  it('returns DETECT_EVERY_IDLE when pill is hidden', () => {
    assert.equal(getDetectEvery(false), DETECT_EVERY_IDLE);
  });
  it('returns DETECT_EVERY_ACTIVE when pill is visible', () => {
    assert.equal(getDetectEvery(true), DETECT_EVERY_ACTIVE);
  });
});

// --- SitTimer ---

describe('SitTimer', () => {
  // Break interval and remind are read from config at runtime
  const breakMs = () => config.breakIntervalMin * 60 * 1000;
  const remindMs = () => config.breakRemindMin * 60 * 1000;

  it('starts with no sitting time', () => {
    const st = new SitTimer();
    const r = st.update(false, 0);
    assert.equal(r.needsBreak, false);
    assert.equal(r.sittingMs, 0);
  });

  it('tracks sitting time when face is detected', () => {
    const st = new SitTimer();
    st.update(true, 0);
    const r = st.update(true, 10000);
    assert.equal(r.needsBreak, false);
    assert.equal(r.sittingMs, 10000);
  });

  it('triggers break after breakIntervalMin', () => {
    const st = new SitTimer();
    st.update(true, 0);
    const r = st.update(true, breakMs());
    assert.equal(r.needsBreak, true);
    assert.equal(r.sittingMs, breakMs());
  });

  it('does not re-trigger while alert is active', () => {
    const st = new SitTimer();
    st.update(true, 0);
    st.update(true, breakMs());
    const r = st.update(true, breakMs() + 5000);
    assert.equal(r.needsBreak, false);
  });

  it('re-nags after breakRemindMin when dismissed', () => {
    const st = new SitTimer();
    st.update(true, 0);
    st.update(true, breakMs());
    st.dismiss(breakMs() + 1000);
    const r1 = st.update(true, breakMs() + 1000 + remindMs() - 1);
    assert.equal(r1.needsBreak, false);
    const r2 = st.update(true, breakMs() + 1000 + remindMs());
    assert.equal(r2.needsBreak, true);
  });

  it('can dismiss and re-nag multiple times', () => {
    const st = new SitTimer();
    st.update(true, 0);
    st.update(true, breakMs());
    st.dismiss(breakMs() + 100);
    st.update(true, breakMs() + 100 + remindMs());
    st.dismiss(breakMs() + 200 + remindMs());
    const r = st.update(true, breakMs() + 200 + remindMs() * 2);
    assert.equal(r.needsBreak, true);
  });

  it('resets when face disappears (user left chair)', () => {
    const st = new SitTimer();
    st.update(true, 0);
    st.update(true, breakMs());
    st.update(false, breakMs() + 1000);
    const r = st.update(true, breakMs() + 2000);
    assert.equal(r.needsBreak, false);
    assert.equal(r.sittingMs, 0);
  });

  it('triggers again after returning from break', () => {
    const st = new SitTimer();
    st.update(true, 0);
    st.update(true, breakMs());
    st.update(false, breakMs() + 1000);
    st.update(true, 50000);
    const r = st.update(true, 50000 + breakMs());
    assert.equal(r.needsBreak, true);
  });
});

// --- WindDownTimer ---

describe('WindDownTimer', () => {
  // Helper: create a Date.now()-style timestamp for a given hour:minute today
  const timeAt = (h, m) => {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };

  it('does not warn before configured time', () => {
    setConfig({ windDownEnabled: true, windDownHour: 20, windDownMinute: 0, windDownRemindMin: 15 });
    const wd = new WindDownTimer();
    assert.equal(wd.update(timeAt(19, 59)).shouldWarn, false);
  });

  it('warns when past configured time', () => {
    setConfig({ windDownEnabled: true, windDownHour: 20, windDownMinute: 0, windDownRemindMin: 15 });
    const wd = new WindDownTimer();
    assert.equal(wd.update(timeAt(20, 1)).shouldWarn, true);
  });

  it('does not re-warn while alert is active', () => {
    setConfig({ windDownEnabled: true, windDownHour: 20, windDownMinute: 0, windDownRemindMin: 15 });
    const wd = new WindDownTimer();
    wd.update(timeAt(20, 1)); // triggers
    assert.equal(wd.update(timeAt(20, 2)).shouldWarn, false);
  });

  it('re-warns after snooze + remind interval', () => {
    setConfig({ windDownEnabled: true, windDownHour: 20, windDownMinute: 0, windDownRemindMin: 15 });
    const wd = new WindDownTimer();
    wd.update(timeAt(20, 1)); // triggers
    const snoozeTime = timeAt(20, 2);
    wd.snooze(snoozeTime);
    assert.equal(wd.update(snoozeTime + 14 * 60 * 1000).shouldWarn, false); // 14min later — not yet
    assert.equal(wd.update(snoozeTime + 15 * 60 * 1000).shouldWarn, true);  // 15min — re-warn
  });

  it('does not warn when disabled', () => {
    setConfig({ windDownEnabled: false, windDownHour: 20, windDownMinute: 0, windDownRemindMin: 15 });
    const wd = new WindDownTimer();
    assert.equal(wd.update(timeAt(22, 0)).shouldWarn, false);
  });

  it('resets on new day', () => {
    setConfig({ windDownEnabled: true, windDownHour: 20, windDownMinute: 0, windDownRemindMin: 15 });
    const wd = new WindDownTimer();
    wd.update(timeAt(20, 1)); // triggers today
    wd.snooze(timeAt(20, 2));
    // Simulate next day by creating a timestamp with a different date
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(19, 0, 0, 0);
    assert.equal(wd.update(tomorrow.getTime()).shouldWarn, false); // before target on new day
    tomorrow.setHours(20, 1, 0, 0);
    assert.equal(wd.update(tomorrow.getTime()).shouldWarn, true); // triggers again on new day
  });

  it('does not warn at 1am for a 22:00 target', () => {
    setConfig({ windDownEnabled: true, windDownHour: 22, windDownMinute: 0, windDownRemindMin: 15 });
    const wd = new WindDownTimer();
    assert.equal(wd.update(timeAt(1, 0)).shouldWarn, false);
  });

  it('can snooze multiple times', () => {
    setConfig({ windDownEnabled: true, windDownHour: 20, windDownMinute: 0, windDownRemindMin: 15 });
    const wd = new WindDownTimer();
    wd.update(timeAt(20, 1)); // first trigger
    wd.snooze(timeAt(20, 2));
    const t2 = timeAt(20, 2) + 15 * 60 * 1000;
    wd.update(t2); // second trigger
    wd.snooze(t2 + 1000);
    const t3 = t2 + 1000 + 15 * 60 * 1000;
    assert.equal(wd.update(t3).shouldWarn, true); // third trigger
  });
});

// --- DismissTimer ---

describe('DismissTimer', () => {
  it('starts not dismissed', () => {
    const dt = new DismissTimer();
    assert.equal(dt.dismissed, false);
    assert.deepEqual(dt.update(0), { dismissed: false, remainingMs: 0 });
  });

  it('dismisses for the given duration', () => {
    const dt = new DismissTimer();
    dt.dismiss(60000, 1000); // 60s starting at t=1000
    const r = dt.update(1000);
    assert.equal(r.dismissed, true);
    assert.equal(r.remainingMs, 60000);
  });

  it('counts down remaining time', () => {
    const dt = new DismissTimer();
    dt.dismiss(60000, 0);
    const r = dt.update(10000); // 10s later
    assert.equal(r.dismissed, true);
    assert.equal(r.remainingMs, 50000);
  });

  it('auto-expires when duration elapses', () => {
    const dt = new DismissTimer();
    dt.dismiss(60000, 0);
    const r = dt.update(60000); // exactly at expiry
    assert.equal(r.dismissed, false);
    assert.equal(r.remainingMs, 0);
  });

  it('auto-expires when past duration', () => {
    const dt = new DismissTimer();
    dt.dismiss(60000, 0);
    const r = dt.update(70000);
    assert.equal(r.dismissed, false);
  });

  it('can be resumed early', () => {
    const dt = new DismissTimer();
    dt.dismiss(60000, 0);
    dt.resume();
    assert.equal(dt.dismissed, false);
    assert.deepEqual(dt.update(5000), { dismissed: false, remainingMs: 0 });
  });

  it('can be replaced with a new dismiss duration', () => {
    const dt = new DismissTimer();
    dt.dismiss(60000, 0);  // 60s
    dt.dismiss(10000, 30000); // replace with 10s at t=30s
    const r = dt.update(35000); // 5s into the new dismiss
    assert.equal(r.dismissed, true);
    assert.equal(r.remainingMs, 5000);
  });

  it('formats remaining time as M:SS', () => {
    const dt = new DismissTimer();
    dt.dismiss(90000, 0); // 90s
    assert.equal(dt.formatRemaining(0), '1:30');
    assert.equal(dt.formatRemaining(60000), '0:30');
    assert.equal(dt.formatRemaining(89000), '0:01');
    assert.equal(dt.formatRemaining(90000), '');
  });

  it('returns empty string when not dismissed', () => {
    const dt = new DismissTimer();
    assert.equal(dt.formatRemaining(0), '');
  });
});

// --- i18n ---

describe('i18n', () => {
  it('returns English string by default', () => {
    setLocale('en');
    assert.equal(t('pill.standUp'), 'STAND UP!');
  });

  it('returns pt-BR string when locale is set', () => {
    setLocale('pt-BR');
    assert.equal(t('pill.standUp'), 'LEVANTE-SE!');
    setLocale('en'); // reset
  });

  it('falls back to English for unknown locale', () => {
    setLocale('xx');
    // Should still return something (falls back to en since xx doesn't exist)
    assert.equal(t('pill.standUp'), 'STAND UP!');
    setLocale('en');
  });

  it('returns key when key is missing', () => {
    setLocale('en');
    assert.equal(t('nonexistent.key'), 'nonexistent.key');
  });

  it('replaces template variables', () => {
    setLocale('en');
    assert.equal(t('pill.windDownMsg', { time: '20:00' }), "It's past 20:00 — close your laptop");
  });

  it('replaces template variables in pt-BR', () => {
    setLocale('pt-BR');
    assert.equal(t('pill.windDownMsg', { time: '20:00' }), 'Já passou das 20:00 — feche o notebook');
    setLocale('en');
  });

  it('has all keys in pt-BR that exist in en', () => {
    const enKeys = Object.keys(translations.en);
    const ptKeys = Object.keys(translations['pt-BR']);
    const missing = enKeys.filter(k => !ptKeys.includes(k));
    assert.deepEqual(missing, [], `Missing pt-BR keys: ${missing.join(', ')}`);
  });

  it('getLocale returns current locale', () => {
    setLocale('pt-BR');
    assert.equal(getLocale(), 'pt-BR');
    setLocale('en');
    assert.equal(getLocale(), 'en');
  });
});
