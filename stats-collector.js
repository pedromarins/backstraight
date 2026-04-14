// --- Stats collector: accumulates posture metrics in memory for periodic flush ---

function todayStr(now) {
  const d = now ? new Date(now) : new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function hourKey(now) {
  return new Date(now).getHours();
}

export class StatsCollector {
  constructor() {
    this.reset();
  }

  reset() {
    this.date = todayStr();
    this.monitoredMs = 0;
    this.goodPostureMs = 0;
    this.badPostureMs = 0;
    this.alertCount = 0;
    this.breakAlertCount = 0;
    this.currentSittingStart = null;
    this.sittingSessions = [];
    this.hourlyBuckets = {};
    this.lastTickWall = null;
  }

  tick(faceDetected, allOk, wallNow) {
    if (!wallNow) wallNow = Date.now();
    const today = todayStr(wallNow);

    // Midnight rollover: flush old day data, reset for new day
    if (today !== this.date) {
      // Close sitting session at midnight boundary
      let newDaySittingStart = null;
      if (this.currentSittingStart !== null) {
        const midnight = new Date(wallNow);
        midnight.setHours(0, 0, 0, 0);
        this.sittingSessions.push({ startMs: this.currentSittingStart, endMs: midnight.getTime() });
        this.currentSittingStart = null; // clear before snapshot so it only includes the closed session
        newDaySittingStart = midnight.getTime();
      }
      const oldSnapshot = this._buildSnapshot();
      this.reset();
      this.date = today;
      // Re-open sitting session in new day if still sitting
      if (faceDetected && newDaySittingStart) {
        this.currentSittingStart = newDaySittingStart;
      }
      this.lastTickWall = wallNow;
      return oldSnapshot; // caller should flush this for the old date
    }

    if (this.lastTickWall !== null && faceDetected) {
      const delta = Math.min(wallNow - this.lastTickWall, 5000); // cap at 5s to ignore gaps
      if (delta > 0) {
        this.monitoredMs += delta;
        const h = hourKey(wallNow);
        if (!this.hourlyBuckets[h]) {
          this.hourlyBuckets[h] = { monitoredMs: 0, goodMs: 0, badMs: 0, alerts: 0 };
        }
        this.hourlyBuckets[h].monitoredMs += delta;

        if (allOk) {
          this.goodPostureMs += delta;
          this.hourlyBuckets[h].goodMs += delta;
        } else {
          this.badPostureMs += delta;
          this.hourlyBuckets[h].badMs += delta;
        }
      }
    }

    // Track sitting sessions
    if (faceDetected) {
      if (this.currentSittingStart === null) this.currentSittingStart = wallNow;
    } else {
      if (this.currentSittingStart !== null) {
        this.sittingSessions.push({ startMs: this.currentSittingStart, endMs: wallNow });
        this.currentSittingStart = null;
      }
    }

    this.lastTickWall = wallNow;
    return null; // no midnight rollover
  }

  onPillShown(wallNow) {
    if (!wallNow) wallNow = Date.now();
    this.alertCount++;
    const h = hourKey(wallNow);
    if (!this.hourlyBuckets[h]) {
      this.hourlyBuckets[h] = { monitoredMs: 0, goodMs: 0, badMs: 0, alerts: 0 };
    }
    this.hourlyBuckets[h].alerts++;
  }

  onBreakAlert() {
    this.breakAlertCount++;
  }

  _buildSnapshot() {
    // Close any open sitting session temporarily for snapshot
    const sessions = [...this.sittingSessions];
    if (this.currentSittingStart !== null) {
      sessions.push({ startMs: this.currentSittingStart, endMs: Date.now() });
    }
    // Deep copy hourly buckets
    const buckets = {};
    for (const [h, b] of Object.entries(this.hourlyBuckets)) {
      buckets[h] = { ...b };
    }
    return {
      date: this.date,
      monitoredMs: this.monitoredMs,
      goodPostureMs: this.goodPostureMs,
      badPostureMs: this.badPostureMs,
      alertCount: this.alertCount,
      breakAlertCount: this.breakAlertCount,
      sittingSessions: sessions,
      hourlyBuckets: buckets,
    };
  }

  snapshot() {
    return this._buildSnapshot();
  }

  consumeSnapshot() {
    // Only include CLOSED sitting sessions in flush — the open session
    // stays with the collector until it actually closes (face disappears).
    // _buildSnapshot() includes the open session for live display (snapshot()),
    // but consumeSnapshot() must not, otherwise every 30s flush duplicates it.
    const closedSessions = [...this.sittingSessions];
    const buckets = {};
    for (const [h, b] of Object.entries(this.hourlyBuckets)) {
      buckets[h] = { ...b };
    }
    const snap = {
      date: this.date,
      monitoredMs: this.monitoredMs,
      goodPostureMs: this.goodPostureMs,
      badPostureMs: this.badPostureMs,
      alertCount: this.alertCount,
      breakAlertCount: this.breakAlertCount,
      sittingSessions: closedSessions,
      hourlyBuckets: buckets,
    };
    // Reset accumulators but keep current sitting session open
    this.monitoredMs = 0;
    this.goodPostureMs = 0;
    this.badPostureMs = 0;
    this.alertCount = 0;
    this.breakAlertCount = 0;
    this.sittingSessions = [];
    this.hourlyBuckets = {};
    // currentSittingStart stays — session is still in progress
    return snap;
  }
}

export { todayStr };
