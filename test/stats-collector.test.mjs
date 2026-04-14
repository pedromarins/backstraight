import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StatsCollector, todayStr } from '../stats-collector.js';

// --- todayStr ---

describe('todayStr', () => {
  it('returns YYYY-MM-DD format', () => {
    const result = todayStr();
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('formats a specific timestamp correctly', () => {
    // 2026-04-13 at noon UTC
    const ts = new Date(2026, 3, 13, 12, 0, 0).getTime();
    assert.equal(todayStr(ts), '2026-04-13');
  });

  it('zero-pads single-digit months and days', () => {
    const ts = new Date(2026, 0, 5, 12, 0, 0).getTime(); // Jan 5
    assert.equal(todayStr(ts), '2026-01-05');
  });
});

// --- StatsCollector ---

describe('StatsCollector', () => {
  // Helper: create a wall-clock timestamp for a specific hour:minute today
  function wallAt(h, m, s) {
    const d = new Date();
    d.setHours(h, m || 0, s || 0, 0);
    return d.getTime();
  }

  it('starts with zeroed accumulators', () => {
    const sc = new StatsCollector();
    assert.equal(sc.monitoredMs, 0);
    assert.equal(sc.goodPostureMs, 0);
    assert.equal(sc.badPostureMs, 0);
    assert.equal(sc.alertCount, 0);
    assert.equal(sc.breakAlertCount, 0);
    assert.deepEqual(sc.sittingSessions, []);
    assert.deepEqual(sc.hourlyBuckets, {});
    assert.equal(sc.currentSittingStart, null);
  });

  it('does not accumulate time on first tick (no previous tick to compare)', () => {
    const sc = new StatsCollector();
    sc.tick(true, true, wallAt(10, 0));
    assert.equal(sc.monitoredMs, 0);
  });

  it('accumulates good posture time between ticks', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(10, 0);
    sc.tick(true, true, t0);
    sc.tick(true, true, t0 + 1000);
    assert.equal(sc.monitoredMs, 1000);
    assert.equal(sc.goodPostureMs, 1000);
    assert.equal(sc.badPostureMs, 0);
  });

  it('accumulates bad posture time between ticks', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(10, 0);
    sc.tick(true, false, t0);
    sc.tick(true, false, t0 + 2000);
    assert.equal(sc.monitoredMs, 2000);
    assert.equal(sc.goodPostureMs, 0);
    assert.equal(sc.badPostureMs, 2000);
  });

  it('does not accumulate time when face is not detected', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(10, 0);
    sc.tick(false, true, t0);
    sc.tick(false, true, t0 + 5000);
    assert.equal(sc.monitoredMs, 0);
    assert.equal(sc.goodPostureMs, 0);
  });

  it('caps delta at 5000ms to ignore gaps', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(10, 0);
    sc.tick(true, true, t0);
    sc.tick(true, true, t0 + 30000); // 30s gap
    assert.equal(sc.monitoredMs, 5000); // capped at 5s
  });

  it('tracks mixed good and bad posture correctly', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(10, 0);
    sc.tick(true, true, t0);         // face detected, good
    sc.tick(true, true, t0 + 1000);  // +1s good
    sc.tick(true, false, t0 + 2000); // +1s bad
    sc.tick(true, true, t0 + 3000);  // +1s good
    assert.equal(sc.monitoredMs, 3000);
    assert.equal(sc.goodPostureMs, 2000);
    assert.equal(sc.badPostureMs, 1000);
  });
});

// --- Hourly buckets ---

describe('StatsCollector hourly buckets', () => {
  function wallAt(h, m) {
    const d = new Date();
    d.setHours(h, m || 0, 0, 0);
    return d.getTime();
  }

  it('creates hourly buckets for the correct hours', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(9, 0);
    sc.tick(true, true, t0);
    sc.tick(true, true, t0 + 1000);     // +1s good in hour 9
    sc.tick(true, true, t0 + 2000);     // +1s good in hour 9
    sc.tick(true, false, t0 + 3000);    // +1s bad in hour 9

    assert.ok(sc.hourlyBuckets[9]);
    assert.equal(sc.hourlyBuckets[9].goodMs, 2000);
    assert.equal(sc.hourlyBuckets[9].badMs, 1000);
    assert.equal(sc.hourlyBuckets[9].monitoredMs, 3000);
  });

  it('tracks alerts per hour', () => {
    const sc = new StatsCollector();
    sc.onPillShown(wallAt(9, 15));
    sc.onPillShown(wallAt(9, 45));
    sc.onPillShown(wallAt(14, 0));

    assert.equal(sc.hourlyBuckets[9].alerts, 2);
    assert.equal(sc.hourlyBuckets[14].alerts, 1);
  });
});

// --- Sitting sessions ---

describe('StatsCollector sitting sessions', () => {
  function wallAt(h, m) {
    const d = new Date();
    d.setHours(h, m || 0, 0, 0);
    return d.getTime();
  }

  it('starts a sitting session when face is detected', () => {
    const sc = new StatsCollector();
    sc.tick(true, true, wallAt(9, 0));
    assert.equal(sc.currentSittingStart, wallAt(9, 0));
  });

  it('closes a sitting session when face disappears', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(9, 0);
    sc.tick(true, true, t0);
    sc.tick(false, true, t0 + 60000); // face gone after 1 min
    assert.equal(sc.currentSittingStart, null);
    assert.equal(sc.sittingSessions.length, 1);
    assert.equal(sc.sittingSessions[0].startMs, t0);
    assert.equal(sc.sittingSessions[0].endMs, t0 + 60000);
  });

  it('tracks multiple sitting sessions', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(9, 0);
    sc.tick(true, true, t0);            // sit down
    sc.tick(false, true, t0 + 30000);   // stand up after 30s
    sc.tick(true, true, t0 + 60000);    // sit down again
    sc.tick(false, true, t0 + 120000);  // stand up after 1m
    assert.equal(sc.sittingSessions.length, 2);
  });

  it('does not create a session when face is never detected', () => {
    const sc = new StatsCollector();
    sc.tick(false, true, wallAt(9, 0));
    sc.tick(false, true, wallAt(9, 1));
    assert.equal(sc.sittingSessions.length, 0);
    assert.equal(sc.currentSittingStart, null);
  });
});

// --- Alert counting ---

describe('StatsCollector alerts', () => {
  it('counts posture alerts via onPillShown', () => {
    const sc = new StatsCollector();
    sc.onPillShown(Date.now());
    sc.onPillShown(Date.now());
    sc.onPillShown(Date.now());
    assert.equal(sc.alertCount, 3);
  });

  it('counts break alerts via onBreakAlert', () => {
    const sc = new StatsCollector();
    sc.onBreakAlert();
    sc.onBreakAlert();
    assert.equal(sc.breakAlertCount, 2);
  });
});

// --- Snapshot ---

describe('StatsCollector snapshot', () => {
  function wallAt(h, m) {
    const d = new Date();
    d.setHours(h, m || 0, 0, 0);
    return d.getTime();
  }

  it('returns current accumulated stats', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(10, 0);
    sc.tick(true, true, t0);
    sc.tick(true, true, t0 + 2000);
    sc.onPillShown(t0 + 1000);
    sc.onBreakAlert();

    const snap = sc.snapshot();
    assert.equal(snap.monitoredMs, 2000);
    assert.equal(snap.goodPostureMs, 2000);
    assert.equal(snap.alertCount, 1);
    assert.equal(snap.breakAlertCount, 1);
    assert.equal(snap.date, todayStr());
  });

  it('does not reset accumulators (read-only)', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(10, 0);
    sc.tick(true, true, t0);
    sc.tick(true, true, t0 + 1000);

    sc.snapshot(); // should not reset
    assert.equal(sc.monitoredMs, 1000);
  });

  it('includes open sitting session in snapshot', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(10, 0);
    sc.tick(true, true, t0); // starts sitting, no closed session yet

    const snap = sc.snapshot();
    assert.equal(snap.sittingSessions.length, 1); // open session included
    assert.equal(snap.sittingSessions[0].startMs, t0);
  });

  it('deep copies hourly buckets (no shared references)', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(10, 0);
    sc.tick(true, true, t0);
    sc.tick(true, true, t0 + 1000);

    const snap = sc.snapshot();
    // Mutating the snapshot should not affect the collector
    snap.hourlyBuckets[10].goodMs = 999999;
    assert.equal(sc.hourlyBuckets[10].goodMs, 1000);
  });
});

// --- consumeSnapshot ---

describe('StatsCollector consumeSnapshot', () => {
  function wallAt(h, m) {
    const d = new Date();
    d.setHours(h, m || 0, 0, 0);
    return d.getTime();
  }

  it('returns snapshot and resets accumulators', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(10, 0);
    sc.tick(true, true, t0);
    sc.tick(true, false, t0 + 1000);
    sc.onPillShown(t0 + 500);
    sc.onBreakAlert();

    const snap = sc.consumeSnapshot();
    assert.equal(snap.monitoredMs, 1000);
    assert.equal(snap.badPostureMs, 1000);
    assert.equal(snap.alertCount, 1);
    assert.equal(snap.breakAlertCount, 1);

    // After consume, accumulators are zero
    assert.equal(sc.monitoredMs, 0);
    assert.equal(sc.goodPostureMs, 0);
    assert.equal(sc.badPostureMs, 0);
    assert.equal(sc.alertCount, 0);
    assert.equal(sc.breakAlertCount, 0);
    assert.deepEqual(sc.sittingSessions, []);
    assert.deepEqual(sc.hourlyBuckets, {});
  });

  it('preserves an open sitting session after consume but does not include it in snapshot', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(10, 0);
    sc.tick(true, true, t0); // start sitting

    const snap = sc.consumeSnapshot();
    // Still sitting — currentSittingStart should persist
    assert.equal(sc.currentSittingStart, t0);
    // consumeSnapshot should NOT include the open session (only closed ones)
    assert.equal(snap.sittingSessions.length, 0);
  });

  it('repeated consumes do not duplicate open sitting sessions', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(10, 0);
    sc.tick(true, true, t0);       // start sitting
    sc.tick(true, true, t0 + 1000);

    const snap1 = sc.consumeSnapshot();
    assert.equal(snap1.sittingSessions.length, 0); // no closed sessions

    sc.tick(true, true, t0 + 2000);
    const snap2 = sc.consumeSnapshot();
    assert.equal(snap2.sittingSessions.length, 0); // still no closed sessions

    // Now face disappears — session closes
    sc.tick(false, true, t0 + 3000);
    const snap3 = sc.consumeSnapshot();
    assert.equal(snap3.sittingSessions.length, 1); // one closed session
    assert.equal(snap3.sittingSessions[0].startMs, t0);
    assert.equal(snap3.sittingSessions[0].endMs, t0 + 3000);
  });

  it('accumulates new data after consume', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(10, 0);
    sc.tick(true, true, t0);
    sc.tick(true, true, t0 + 1000);

    sc.consumeSnapshot(); // resets

    sc.tick(true, false, t0 + 2000);
    assert.equal(sc.monitoredMs, 1000);
    assert.equal(sc.badPostureMs, 1000);
    assert.equal(sc.goodPostureMs, 0);
  });
});

// --- Midnight rollover ---

describe('StatsCollector midnight rollover', () => {
  it('returns old day snapshot when date changes', () => {
    const sc = new StatsCollector();
    // Use explicit dates to control the rollover
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 50, 0);
    const yesterdayMs = yesterday.getTime();

    const today = new Date();
    today.setHours(0, 0, 10, 0);
    const todayMs = today.getTime();

    // Force the collector to think it's yesterday
    sc.date = todayStr(yesterdayMs);
    sc.tick(true, true, yesterdayMs);
    sc.tick(true, true, yesterdayMs + 5000);

    // Cross midnight
    const rollover = sc.tick(true, true, todayMs);
    assert.ok(rollover !== null, 'Expected a rollover snapshot');
    assert.equal(rollover.date, todayStr(yesterdayMs));
    assert.ok(rollover.monitoredMs > 0);

    // After rollover, collector is on the new date
    assert.equal(sc.date, todayStr(todayMs));
    assert.equal(sc.monitoredMs, 0);
  });

  it('returns null when date does not change', () => {
    const sc = new StatsCollector();
    const t0 = Date.now();
    const result = sc.tick(true, true, t0);
    assert.equal(result, null);
  });

  it('splits sitting session at midnight boundary', () => {
    const sc = new StatsCollector();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 50, 0, 0);
    const yesterdayMs = yesterday.getTime();

    const today = new Date();
    today.setHours(0, 5, 0, 0);
    const todayMs = today.getTime();

    sc.date = todayStr(yesterdayMs);
    sc.tick(true, true, yesterdayMs); // start sitting yesterday

    const rollover = sc.tick(true, true, todayMs); // cross midnight
    assert.ok(rollover !== null);

    // The old day's snapshot should have a sitting session ending at midnight
    assert.equal(rollover.sittingSessions.length, 1);
    const midnightToday = new Date(todayMs);
    midnightToday.setHours(0, 0, 0, 0);
    assert.equal(rollover.sittingSessions[0].endMs, midnightToday.getTime());

    // The new day should have a sitting session starting at midnight
    assert.equal(sc.currentSittingStart, midnightToday.getTime());
  });
});

// --- Reset ---

describe('StatsCollector reset', () => {
  it('clears all accumulators', () => {
    const sc = new StatsCollector();
    const t0 = Date.now();
    sc.tick(true, true, t0);
    sc.tick(true, true, t0 + 1000);
    sc.onPillShown(t0);
    sc.onBreakAlert();

    sc.reset();
    assert.equal(sc.monitoredMs, 0);
    assert.equal(sc.goodPostureMs, 0);
    assert.equal(sc.badPostureMs, 0);
    assert.equal(sc.alertCount, 0);
    assert.equal(sc.breakAlertCount, 0);
    assert.deepEqual(sc.sittingSessions, []);
    assert.deepEqual(sc.hourlyBuckets, {});
    assert.equal(sc.currentSittingStart, null);
    assert.equal(sc.lastTickWall, null);
  });
});

// --- Edge cases ---

describe('StatsCollector edge cases', () => {
  function wallAt(h, m) {
    const d = new Date();
    d.setHours(h, m || 0, 0, 0);
    return d.getTime();
  }

  it('handles face appearing and disappearing rapidly', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(10, 0);
    sc.tick(true, true, t0);
    sc.tick(false, true, t0 + 100);
    sc.tick(true, true, t0 + 200);
    sc.tick(false, true, t0 + 300);

    assert.equal(sc.sittingSessions.length, 2);
    assert.equal(sc.sittingSessions[0].endMs - sc.sittingSessions[0].startMs, 100);
    assert.equal(sc.sittingSessions[1].endMs - sc.sittingSessions[1].startMs, 100);
  });

  it('handles good/bad posture sum equaling monitored time', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(10, 0);
    sc.tick(true, true, t0);
    sc.tick(true, true, t0 + 500);
    sc.tick(true, false, t0 + 1500);
    sc.tick(true, true, t0 + 2000);

    assert.equal(sc.monitoredMs, sc.goodPostureMs + sc.badPostureMs);
  });

  it('does not accumulate negative deltas', () => {
    const sc = new StatsCollector();
    const t0 = wallAt(10, 0);
    sc.tick(true, true, t0);
    // Same time — zero delta, should not crash or go negative
    sc.tick(true, true, t0);
    assert.equal(sc.monitoredMs, 0);
  });
});
