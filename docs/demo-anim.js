(function () {
  const C = document.getElementById('demo-canvas');
  if (!C) return;
  const X = C.getContext('2d');
  const W = 480, H = 360;

  // ---- EASING ----
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOutBack(t) { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpPt(a, b, t) { return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }; }

  // ---- POSES (normalized 0-1) ----
  const good = {
    head: { x: 0.50, y: 0.22 }, neck: { x: 0.50, y: 0.38 },
    leftEye: { x: 0.44, y: 0.20 }, rightEye: { x: 0.56, y: 0.20 },
    leftShoulder: { x: 0.33, y: 0.44 }, rightShoulder: { x: 0.67, y: 0.44 },
    spine: { x: 0.50, y: 0.58 },
  };
  const bad = {
    head: { x: 0.47, y: 0.25 }, neck: { x: 0.48, y: 0.39 },
    leftEye: { x: 0.41, y: 0.235 }, rightEye: { x: 0.535, y: 0.26 },
    leftShoulder: { x: 0.31, y: 0.45 }, rightShoulder: { x: 0.65, y: 0.48 },
    spine: { x: 0.48, y: 0.59 },
  };
  const keys = Object.keys(good);

  // ---- TIMELINE (20s cycle) ----
  // Cascaded slouch: head moves first, shoulders follow with delay
  const CYCLE = 20000;
  //  0-6s     good (breathing)
  //  6-9.5s   cascaded slouch (head first 6-8s, shoulders 7-9.5s)
  //  9.5-15s  bad (alert builds, pulsing)
  //  15-16s   snap correction (easeOutBack)
  //  16-20s   good (celebration breathing)

  function getSlouchProgress(t) {
    // Returns per-part progress: head leads, shoulders follow
    if (t < 6000) return { head: 0, shoulders: 0, eyes: 0 };
    if (t >= 9500) return { head: 1, shoulders: 1, eyes: 1 };
    // Head: 6000-8000 (2s)
    const headP = Math.min(1, Math.max(0, (t - 6000) / 2000));
    // Eyes follow head closely: 6200-8200
    const eyesP = Math.min(1, Math.max(0, (t - 6200) / 2000));
    // Shoulders: 7000-9500 (2.5s, delayed)
    const shldP = Math.min(1, Math.max(0, (t - 7000) / 2500));
    return { head: easeInOut(headP), shoulders: easeInOut(shldP), eyes: easeInOut(eyesP) };
  }

  function getCorrectionProgress(t) {
    if (t < 15000 || t >= 16000) return t >= 16000 ? 1 : 0;
    const p = (t - 15000) / 1000;
    return easeOutBack(p); // snap with overshoot
  }

  function getPose(t) {
    const ct = t % CYCLE;
    const result = {};
    let badness = 0; // 0 = good, 1 = fully bad

    if (ct < 6000) {
      // Good pose
      for (const k of keys) result[k] = { ...good[k] };
      badness = 0;
    } else if (ct < 9500) {
      // Cascaded slouch
      const sp = getSlouchProgress(ct);
      for (const k of keys) {
        let p = sp.shoulders; // default: shoulder timing
        if (k === 'head' || k === 'neck' || k === 'spine') p = sp.head;
        if (k === 'leftEye' || k === 'rightEye') p = sp.eyes;
        result[k] = lerpPt(good[k], bad[k], p);
      }
      badness = sp.eyes; // for status bar cascading
    } else if (ct < 15000) {
      // Fully bad
      for (const k of keys) result[k] = { ...bad[k] };
      badness = 1;
    } else if (ct < 16000) {
      // Snap correction
      const cp = getCorrectionProgress(ct);
      for (const k of keys) result[k] = lerpPt(bad[k], good[k], cp);
      badness = 1 - cp;
    } else {
      // Good again
      for (const k of keys) result[k] = { ...good[k] };
      badness = 0;
    }

    return { pose: result, badness, ct };
  }

  // ---- BREATHING (idle micro-movement) ----
  function breathe(pose, t) {
    const b = Math.sin(t / 1200) * 0.003; // subtle vertical sway
    const s = Math.sin(t / 1800) * 0.001; // even subtler horizontal
    const result = {};
    for (const k of keys) {
      result[k] = { x: pose[k].x + s, y: pose[k].y + b };
    }
    // Head bobs a bit more
    result.head.y += Math.sin(t / 1000) * 0.002;
    return result;
  }

  // ---- COORDINATE TRANSFORM ----
  function toC(pt) { return { x: (1 - pt.x) * W, y: pt.y * H }; }

  // ---- ENVIRONMENT ----
  function drawEnvironment() {
    // Desk surface — subtle line at bottom
    X.strokeStyle = 'rgba(255,255,255,0.06)';
    X.lineWidth = 2;
    X.beginPath();
    X.moveTo(40, H - 60);
    X.lineTo(W - 40, H - 60);
    X.stroke();

    // Monitor outline — faint rectangle behind the person
    X.strokeStyle = 'rgba(255,255,255,0.04)';
    X.lineWidth = 1.5;
    const mx = W / 2, my = 30, mw = 160, mh = 110;
    X.beginPath();
    X.roundRect(mx - mw / 2, my, mw, mh, 6);
    X.stroke();
    // Monitor stand
    X.beginPath();
    X.moveTo(mx, my + mh);
    X.lineTo(mx, my + mh + 20);
    X.moveTo(mx - 20, my + mh + 20);
    X.lineTo(mx + 20, my + mh + 20);
    X.stroke();

    // Chair back — subtle curve behind shoulders
    X.strokeStyle = 'rgba(255,255,255,0.03)';
    X.lineWidth = 3;
    X.beginPath();
    X.moveTo(W * 0.25, H - 60);
    X.quadraticCurveTo(W * 0.22, H * 0.35, W * 0.28, H * 0.28);
    X.moveTo(W * 0.75, H - 60);
    X.quadraticCurveTo(W * 0.78, H * 0.35, W * 0.72, H * 0.28);
    X.stroke();
  }

  // ---- SILHOUETTE ----
  function drawBody(pose) {
    const head = toC(pose.head), neck = toC(pose.neck);
    const ls = toC(pose.leftShoulder), rs = toC(pose.rightShoulder);
    const spine = toC(pose.spine);

    // Torso — curved body shape
    X.fillStyle = 'rgba(255,255,255,0.04)';
    X.strokeStyle = 'rgba(255,255,255,0.08)';
    X.lineWidth = 1.5;
    X.beginPath();
    X.moveTo(ls.x, ls.y);
    X.quadraticCurveTo(ls.x + 10, (ls.y + H - 60) / 2, ls.x + 5, H - 62);
    X.lineTo(rs.x - 5, H - 62);
    X.quadraticCurveTo(rs.x - 10, (rs.y + H - 60) / 2, rs.x, rs.y);
    X.lineTo(neck.x, neck.y);
    X.lineTo(ls.x, ls.y);
    X.closePath();
    X.fill();
    X.stroke();

    // Neck
    X.strokeStyle = 'rgba(255,255,255,0.1)';
    X.lineWidth = 10;
    X.lineCap = 'round';
    X.beginPath();
    X.moveTo(neck.x, neck.y);
    X.lineTo(head.x, head.y + 24);
    X.stroke();

    // Head — filled oval
    X.fillStyle = 'rgba(255,255,255,0.05)';
    X.strokeStyle = 'rgba(255,255,255,0.12)';
    X.lineWidth = 1.5;
    X.beginPath();
    X.ellipse(head.x, head.y, 22, 26, 0, 0, Math.PI * 2);
    X.fill();
    X.stroke();

    // Shoulder curves
    X.strokeStyle = 'rgba(255,255,255,0.1)';
    X.lineWidth = 2;
    X.beginPath();
    X.moveTo(ls.x - 15, ls.y + 8);
    X.quadraticCurveTo(ls.x, ls.y - 4, neck.x, neck.y);
    X.quadraticCurveTo(rs.x, rs.y - 4, rs.x + 15, rs.y + 8);
    X.stroke();

    // Arms — subtle curves hanging from shoulders
    X.strokeStyle = 'rgba(255,255,255,0.04)';
    X.lineWidth = 6;
    X.beginPath();
    X.moveTo(ls.x - 8, ls.y + 4);
    X.quadraticCurveTo(ls.x - 20, ls.y + 50, ls.x - 5, H - 80);
    X.stroke();
    X.beginPath();
    X.moveTo(rs.x + 8, rs.y + 4);
    X.quadraticCurveTo(rs.x + 20, rs.y + 50, rs.x + 5, H - 80);
    X.stroke();
  }

  // ---- DETECTION LINES ----
  function drawDetectionLine(a, b, ok) {
    const p1 = toC(a), p2 = toC(b);
    const color = ok ? '#00ff44' : '#ff3333';

    // Glow
    X.shadowColor = color;
    X.shadowBlur = ok ? 6 : 10;

    X.beginPath();
    X.strokeStyle = color;
    X.lineWidth = 2;
    X.lineCap = 'round';
    X.moveTo(p1.x, p1.y);
    X.lineTo(p2.x, p2.y);
    X.stroke();

    for (const p of [p1, p2]) {
      X.beginPath();
      X.fillStyle = color;
      X.arc(p.x, p.y, 3, 0, Math.PI * 2);
      X.fill();
    }

    X.shadowBlur = 0;

    if (!ok) {
      const hi = p1.y < p2.y ? p1 : p2;
      const lo = p1.y < p2.y ? p2 : p1;
      X.fillStyle = color;
      X.beginPath();
      X.moveTo(hi.x, hi.y - 16);
      X.lineTo(hi.x - 5, hi.y - 8);
      X.lineTo(hi.x + 5, hi.y - 8);
      X.fill();
      X.beginPath();
      X.moveTo(lo.x, lo.y + 16);
      X.lineTo(lo.x - 5, lo.y + 8);
      X.lineTo(lo.x + 5, lo.y + 8);
      X.fill();
    }
  }

  // ---- LEAN BACK WARNING ----
  function drawLeanWarning(now, alpha) {
    if (alpha <= 0) return;
    const color = '#ff3333';
    const cx = W / 2, cy = 30, sz = 16;
    const pulse = 0.6 + 0.4 * Math.sin(now / 250);

    X.globalAlpha = alpha * pulse;
    X.shadowColor = color;
    X.shadowBlur = 12;

    X.strokeStyle = color;
    X.lineWidth = 2.5;
    X.lineCap = 'round';
    X.beginPath();
    X.moveTo(cx, cy + sz);
    X.lineTo(cx, cy - sz);
    X.stroke();
    X.beginPath();
    X.moveTo(cx, cy - sz);
    X.lineTo(cx - 8, cy - sz + 12);
    X.moveTo(cx, cy - sz);
    X.lineTo(cx + 8, cy - sz + 12);
    X.stroke();

    X.font = 'bold 11px system-ui';
    X.fillStyle = color;
    X.textAlign = 'center';
    X.textBaseline = 'top';
    X.fillText('ENDIREITE-SE', cx, cy + sz + 6);

    X.shadowBlur = 0;
    X.globalAlpha = 1;
  }

  // ---- STATUS BAR (cascading flip) ----
  function drawStatusBar(badness, now) {
    const barH = 26;
    const y = H - barH;

    X.fillStyle = 'rgba(0, 0, 0, 0.65)';
    X.fillRect(0, y, W, barH);

    const items = [
      { label: 'Olhos', failAt: 0.3 },
      { label: 'Cabeça', failAt: 0.4 },
      { label: 'Ombr', failAt: 0.6 },
      { label: 'Dist', failAt: 1.1 },   // never fails in this demo
      { label: 'Giro', failAt: 1.1 },
      { label: 'Mao', failAt: 1.1 },
    ];

    const sw = W / items.length;
    X.font = '9px system-ui';
    X.textAlign = 'center';
    X.textBaseline = 'middle';

    items.forEach((item, i) => {
      const cx = sw * i + sw / 2;
      const cy = y + barH / 2;
      const ok = badness < item.failAt;
      const color = ok ? '#00ff44' : '#ff3333';

      X.shadowColor = color;
      X.shadowBlur = 4;
      X.beginPath();
      X.fillStyle = color;
      X.arc(cx - 14, cy, 3.5, 0, Math.PI * 2);
      X.fill();
      X.shadowBlur = 0;

      X.fillStyle = 'rgba(255,255,255,0.8)';
      X.fillText(item.label, cx + 8, cy);
    });
  }

  // ---- STATS OVERLAY ----
  function drawStats(now) {
    X.fillStyle = 'rgba(0,0,0,0.5)';
    X.fillRect(0, 0, 108, 16);
    X.font = '9px monospace';
    X.textAlign = 'left';
    X.textBaseline = 'top';
    X.fillStyle = '#888';
    const d = 11 + Math.floor(Math.sin(now / 1500) * 2);
    const fps = 5 + Math.floor(Math.sin(now / 2500));
    X.fillText(`${d}ms \u00b7 ${fps}d/s \u00b7 5fps`, 4, 3);
  }

  // ---- ALERT OPACITY (fade in/out) ----
  function getAlertAlpha(ct) {
    // Fade in from 9.5s (when fully bad), fade out at 15s (correction)
    if (ct < 9500) return 0;
    if (ct < 10200) return easeInOut((ct - 9500) / 700); // 0.7s fade in
    if (ct < 15000) return 1;
    if (ct < 15500) return 1 - (ct - 15000) / 500; // 0.5s fade out
    return 0;
  }

  // ---- MAIN FRAME ----
  function frame(now) {
    X.clearRect(0, 0, W, H);

    // Background
    X.fillStyle = '#131320';
    X.fillRect(0, 0, W, H);
    const g = X.createRadialGradient(W * 0.45, H * 0.4, 0, W * 0.45, H * 0.4, W * 0.7);
    g.addColorStop(0, 'rgba(102,126,234,0.03)');
    g.addColorStop(1, 'transparent');
    X.fillStyle = g;
    X.fillRect(0, 0, W, H);

    const { pose, badness, ct } = getPose(now);
    const breathed = breathe(pose, now);

    // Environment (desk, monitor, chair)
    drawEnvironment();

    // Body silhouette
    drawBody(breathed);

    // Detection lines
    const eyeOk = badness < 0.3;
    const shldOk = badness < 0.6;
    drawDetectionLine(breathed.leftEye, breathed.rightEye, eyeOk);
    drawDetectionLine(breathed.leftShoulder, breathed.rightShoulder, shldOk);

    // Lean warning
    const alertAlpha = getAlertAlpha(ct);
    drawLeanWarning(now, alertAlpha);

    // Status bar with cascading check flips
    drawStatusBar(badness, now);

    // Stats overlay
    drawStats(now);

    requestAnimationFrame(frame);
  }

  // Start only when visible
  const obs = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      requestAnimationFrame(frame);
      obs.disconnect();
    }
  }, { threshold: 0.1 });
  obs.observe(C);
})();
