/*
  Ваза = поверхность вращения. Профиль (радиус по высоте) задан опорными точками,
  сглажен кривой Катмулла-Рома и размечен сеткой NU x NV.
  Осколки — это ячейки сетки, разбитые по «рваной» диаграмме Вороного:
  у каждой ячейки находим ближайшее зерно (с шумовым искажением), так получаются неровные края.
  Роспись рисуется на 2D-canvas и натягивается как текстура (u — вокруг вазы, v — по высоте).
*/
(function (g) {
  'use strict';

  const TAU = Math.PI * 2;
  const H = 3.0;                                   // высота вазы

  // (радиус, высота): дно, ножка, брюшко, плечо, горло, венчик
  const CONTROLS = [
    [0.50, 0.00], [0.53, 0.05], [0.43, 0.13], [0.40, 0.22], [0.60, 0.52],
    [0.86, 0.95], [0.97, 1.35], [0.90, 1.85], [0.64, 2.30], [0.44, 2.55],
    [0.39, 2.70], [0.47, 2.88], [0.62, 3.00]
  ];

  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    const f = i => 0.5 * (
      (2 * p1[i]) +
      (-p0[i] + p2[i]) * t +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3
    );
    return [f(0), f(1)];
  }

  // Профиль, равномерно разбитый по длине дуги (n отрезков)
  function buildProfile(n) {
    const c = CONTROLS, m = c.length;
    const dense = [[0, 0]];                        // центр донышка
    for (let i = 0; i < m - 1; i++) {
      const p0 = c[Math.max(i - 1, 0)], p1 = c[i], p2 = c[i + 1], p3 = c[Math.min(i + 2, m - 1)];
      for (let k = 0; k < 12; k++) dense.push(catmull(p0, p1, p2, p3, k / 12));
    }
    dense.push(c[m - 1].slice());

    const cum = [0];
    for (let i = 1; i < dense.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    }
    const L = cum[cum.length - 1];

    const r = [], y = [];
    let seg = 1;
    for (let j = 0; j <= n; j++) {
      const d = j / n * L;
      while (seg < dense.length - 1 && cum[seg] < d) seg++;
      const span = (cum[seg] - cum[seg - 1]) || 1;
      const t = (d - cum[seg - 1]) / span;
      r.push(dense[seg - 1][0] + (dense[seg][0] - dense[seg - 1][0]) * t);
      y.push(dense[seg - 1][1] + (dense[seg][1] - dense[seg - 1][1]) * t);
    }

    // Нормали профиля (наружу)
    const nr = [], ny = [];
    for (let j = 0; j <= n; j++) {
      const a = Math.max(j - 1, 0), b = Math.min(j + 1, n);
      const tr = r[b] - r[a], ty = y[b] - y[a];
      const len = Math.hypot(tr, ty) || 1;
      nr.push(ty / len);
      ny.push(-tr / len);
    }
    return { r, y, nr, ny, L };
  }

  /*
    Возвращает { parts: [{ center, nrm, radius, verts, count }] }
    verts — Float32Array, 9 чисел на вершину: pos(3, относительно центра), normal(3), uv(2), crack(1)
  */
  function buildShards(cols, rows) {
    const NU = 160, NV = 120;
    const P = buildProfile(NV);
    const L = P.L;
    const CX = TAU * 0.8;                          // «физическая» ширина развёртки
    const gw = NU + 1;

    // Сетка вершин
    const GP = new Float32Array(gw * (NV + 1) * 3);
    const GN = new Float32Array(gw * (NV + 1) * 3);
    for (let j = 0; j <= NV; j++) {
      for (let i = 0; i <= NU; i++) {
        const a = TAU * i / NU, sa = Math.sin(a), ca = Math.cos(a);
        const k = (j * gw + i) * 3;
        GP[k] = P.r[j] * sa;  GP[k + 1] = P.y[j];  GP[k + 2] = P.r[j] * ca;
        GN[k] = P.nr[j] * sa; GN[k + 1] = P.ny[j]; GN[k + 2] = P.nr[j] * ca;
      }
    }

    // Зёрна
    const seeds = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const su = (c + 0.5 + (Math.random() - 0.5) * 0.75) / cols;
        const ss = Math.min(1, Math.max(0, (r + 0.5 + (Math.random() - 0.5) * 0.75) / rows));
        seeds.push([su * CX, ss * L]);
      }
    }
    const K = seeds.length;

    // Какому осколку принадлежит каждая ячейка
    const assign = new Int16Array(NU * NV);
    for (let j = 0; j < NV; j++) {
      const s = (j + 0.5) / NV;
      for (let i = 0; i < NU; i++) {
        const u = (i + 0.5) / NU;
        let wx = u * CX + 0.09 * Math.sin(s * L * 8 + u * TAU * 2) + 0.05 * Math.sin(s * L * 21);
        const wy = s * L + 0.09 * Math.sin(u * TAU * 6 + s * L * 4) + 0.05 * Math.sin(u * TAU * 17);
        wx = ((wx % CX) + CX) % CX;
        let best = 0, bd = 1e9;
        for (let k = 0; k < K; k++) {
          let dx = Math.abs(wx - seeds[k][0]);
          dx = Math.min(dx, CX - dx);
          const dy = wy - seeds[k][1];
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = k; }
        }
        assign[j * NU + i] = best;
      }
    }

    // Центры осколков
    const cnt = new Int32Array(K);
    const acc = new Float64Array(K * 6);
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NU; i++) {
        const k = assign[j * NU + i];
        const a = j * gw + i, b = a + 1, c = a + gw, d = c + 1;
        cnt[k]++;
        for (let q = 0; q < 3; q++) {
          acc[k * 6 + q]     += (GP[a * 3 + q] + GP[b * 3 + q] + GP[c * 3 + q] + GP[d * 3 + q]) / 4;
          acc[k * 6 + 3 + q] += (GN[a * 3 + q] + GN[b * 3 + q] + GN[c * 3 + q] + GN[d * 3 + q]) / 4;
        }
      }
    }

    const parts = [];
    const remap = new Int32Array(K).fill(-1);
    for (let k = 0; k < K; k++) {
      if (cnt[k] < 12) continue;                   // слишком мелкий — не осколок
      const n = cnt[k];
      const nrm = V3.norm([acc[k * 6 + 3], acc[k * 6 + 4], acc[k * 6 + 5]]);
      remap[k] = parts.length;
      parts.push({
        center: [acc[k * 6] / n, acc[k * 6 + 1] / n, acc[k * 6 + 2] / n],
        nrm,
        radius: 0,
        verts: new Float32Array(n * 54),
        count: n * 6,
        _w: 0
      });
    }

    // Заполняем вершины
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NU; i++) {
        const k = assign[j * NU + i];
        const pi = remap[k];
        if (pi < 0) continue;
        const part = parts[pi];

        // трещина: ячейка на границе осколков (помечаем только одну сторону границы)
        let crack = 0;
        const nb = [
          j * NU + (i + 1) % NU,
          j * NU + (i + NU - 1) % NU,
          j > 0 ? (j - 1) * NU + i : -1,
          j < NV - 1 ? (j + 1) * NU + i : -1
        ];
        for (let q = 0; q < 4; q++) {
          if (nb[q] >= 0) {
            const o = assign[nb[q]];
            if (o !== k && k < o) crack = 1;
          }
        }

        const corners = [
          [i, j], [i + 1, j], [i, j + 1],
          [i + 1, j], [i + 1, j + 1], [i, j + 1]
        ];
        for (let v = 0; v < 6; v++) {
          const ci = corners[v][0], cj = corners[v][1];
          const gi = (cj * gw + ci) * 3;
          const px = GP[gi] - part.center[0];
          const py = GP[gi + 1] - part.center[1];
          const pz = GP[gi + 2] - part.center[2];
          const o = part._w;
          const a = part.verts;
          a[o] = px; a[o + 1] = py; a[o + 2] = pz;
          a[o + 3] = GN[gi]; a[o + 4] = GN[gi + 1]; a[o + 5] = GN[gi + 2];
          a[o + 6] = ci / NU;
          a[o + 7] = 1 - P.y[cj] / H;
          a[o + 8] = crack;
          part._w += 9;
          const dist = Math.hypot(px, py, pz);
          if (dist > part.radius) part.radius = dist;
        }
      }
    }
    parts.forEach(p => { delete p._w; });
    return { parts };
  }

  /*
    Роспись вазы в стиле чернофигурной керамики.
    segs — части надписи [{gr, ru}], read — массив булевых: какие части уже прочитаны (светятся золотом).
  */
  function makeTexture(segs, read) {
    const W = 2048, HC = 1024;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = HC;
    const x = cv.getContext('2d');
    const Y = v => (1 - v / H) * HC;
    const BLACK = '#1b100b';
    const FONT = '"Palatino Linotype","Book Antiqua",Palatino,Georgia,"Times New Roman",serif';

    // глина
    const gr = x.createLinearGradient(0, 0, 0, HC);
    gr.addColorStop(0, '#b4531f');
    gr.addColorStop(0.45, '#d4782f');
    gr.addColorStop(1, '#a8481a');
    x.fillStyle = gr;
    x.fillRect(0, 0, W, HC);
    for (let i = 0; i < 14000; i++) {
      x.fillStyle = Math.random() < 0.5 ? 'rgba(60,20,5,0.07)' : 'rgba(255,200,140,0.06)';
      x.fillRect(Math.random() * W, Math.random() * HC, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }

    const band = (a, b, c) => { x.fillStyle = c; x.fillRect(0, Y(b), W, Y(a) - Y(b)); };

    // ножка и лучи
    band(0, 0.2, BLACK);
    band(0.2, 0.235, '#e9b27a');
    x.fillStyle = BLACK;
    const rays = 36, rw = W / rays;
    for (let i = 0; i < rays; i++) {
      x.beginPath();
      x.moveTo(i * rw + 4, Y(0.26));
      x.lineTo((i + 1) * rw - 4, Y(0.26));
      x.lineTo(i * rw + rw / 2, Y(0.56));
      x.closePath();
      x.fill();
    }
    band(0.59, 0.65, BLACK);

    // меандр
    function meander(y0, y1) {
      const hpx = Y(y0) - Y(y1);
      const n = Math.max(1, Math.round(W / (6 * (hpx / 6))));
      const ux = W / (6 * n), uy = hpx / 6;
      const bottom = Y(y0);
      x.strokeStyle = BLACK;
      x.lineWidth = Math.min(ux, uy) * 0.52;
      x.lineJoin = 'miter';
      x.lineCap = 'butt';
      const P = (gx, gy) => [gx * ux, bottom - gy * uy];
      x.beginPath();
      let p = P(0, 0.5); x.moveTo(p[0], p[1]);
      p = P(6 * n, 0.5); x.lineTo(p[0], p[1]);
      x.stroke();
      const pts = [[0, 0.5], [0, 5.5], [5, 5.5], [5, 1.5], [2, 1.5], [2, 3.5], [3, 3.5]];
      for (let k = 0; k < n; k++) {
        x.beginPath();
        pts.forEach((q, idx) => {
          const pp = P(q[0] + k * 6, q[1]);
          if (idx === 0) x.moveTo(pp[0], pp[1]); else x.lineTo(pp[0], pp[1]);
        });
        x.stroke();
      }
    }
    meander(0.72, 0.92);
    band(0.96, 1.0, BLACK);

    // панель для письмен
    const pg = x.createLinearGradient(0, Y(1.9), 0, Y(1.0));
    pg.addColorStop(0, '#e6b27a');
    pg.addColorStop(0.5, '#efc08a');
    pg.addColorStop(1, '#e0a870');
    x.fillStyle = pg;
    x.fillRect(0, Y(1.9), W, Y(1.0) - Y(1.9));
    band(1.0, 1.035, BLACK);
    band(1.865, 1.9, BLACK);
    band(1.94, 1.98, BLACK);

    // волна под горлом
    const wy0 = Y(2.18), amp = 34, wn = 32;
    x.strokeStyle = BLACK;
    x.lineWidth = 12;
    x.lineCap = 'round';
    x.beginPath();
    for (let px = 0; px <= W; px += 4) {
      const py = wy0 + Math.sin(px / W * TAU * wn) * amp;
      if (px === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.stroke();
    x.fillStyle = BLACK;
    for (let i = 0; i < wn; i++) {
      x.beginPath();
      x.arc((i + 0.25) / wn * W, wy0 - amp - 20, 9, 0, TAU);
      x.fill();
      x.beginPath();
      x.arc((i + 0.75) / wn * W, wy0 + amp + 20, 9, 0, TAU);
      x.fill();
    }
    band(2.33, 2.38, BLACK);

    // пальметты на горле
    function palmette(cx, by, s) {
      x.save();
      x.translate(cx, by);
      x.fillStyle = BLACK;
      for (let a = -2; a <= 2; a++) {
        x.save();
        x.rotate(a * 0.42);
        x.beginPath();
        x.ellipse(0, -s * 0.55, s * 0.13, s * 0.5, 0, 0, TAU);
        x.fill();
        x.restore();
      }
      x.beginPath();
      x.arc(0, 0, s * 0.16, 0, TAU);
      x.fill();
      x.restore();
    }
    const pn = 20;
    for (let i = 0; i < pn; i++) palmette((i + 0.5) / pn * W, Y(2.43), 92);

    // венчик
    band(2.83, 3.0, BLACK);
    band(2.8, 2.82, '#e9b27a');

    // розетки между частями надписи
    const n = segs.length;
    function rosette(cx, cy) {
      x.save();
      x.translate(cx, cy);
      x.fillStyle = BLACK;
      for (let k = 0; k < 8; k++) {
        x.save();
        x.rotate(k * TAU / 8);
        x.beginPath();
        x.ellipse(0, -30, 9, 20, 0, 0, TAU);
        x.fill();
        x.restore();
      }
      x.beginPath();
      x.arc(0, 0, 11, 0, TAU);
      x.fill();
      x.restore();
    }
    const midY = Y(1.45);
    for (let k = 0; k <= n; k++) {
      const cx = k / n * W;
      rosette(cx, midY);
      x.fillStyle = BLACK;
      x.fillRect(cx - 3, Y(1.86), 6, Y(1.04) - Y(1.86));
    }

    // надписи
    function fitText(text, maxW) {
      const setSize = s => { x.font = '700 ' + s + 'px ' + FONT; };
      if ('letterSpacing' in x) x.letterSpacing = '3px';
      let size = 84;
      setSize(size);
      while (size > 56 && x.measureText(text).width > maxW) { size -= 4; setSize(size); }
      let lines = [text];
      if (x.measureText(text).width > maxW && text.indexOf(' ') > 0) {
        const w = text.split(' ');
        const mid = Math.ceil(w.length / 2);
        lines = [w.slice(0, mid).join(' '), w.slice(mid).join(' ')];
        size = 72;
        setSize(size);
      }
      const widest = () => Math.max.apply(null, lines.map(l => x.measureText(l).width));
      while (size > 36 && widest() > maxW) { size -= 3; setSize(size); }
      return { size, lines };
    }

    segs.forEach((seg, k) => {
      const cx = (k + 0.5) / n * W;
      const maxW = W / n * 0.74;
      const isRead = !!(read && read[k]);
      x.save();
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      const f = fitText(seg.gr, maxW);

      if (isRead) {
        const glow = x.createRadialGradient(cx, midY, 10, cx, midY, W / n * 0.45);
        glow.addColorStop(0, 'rgba(255,226,140,0.95)');
        glow.addColorStop(1, 'rgba(255,226,140,0)');
        x.fillStyle = glow;
        x.fillRect(cx - W / n / 2, Y(1.86), W / n, Y(1.04) - Y(1.86));
      }

      const lh = f.size * 1.12;
      f.lines.forEach((line, li) => {
        const ly = midY + (li - (f.lines.length - 1) / 2) * lh;
        if (isRead) {
          x.shadowColor = '#ffd36b';
          x.shadowBlur = 26;
          x.lineWidth = 5;
          x.strokeStyle = '#4a2a00';
          x.strokeText(line, cx, ly);
          x.fillStyle = '#fff2c0';
          x.fillText(line, cx, ly);
        } else {
          x.fillStyle = BLACK;
          x.fillText(line, cx, ly);
        }
      });
      x.restore();
    });

    return cv;
  }

  g.Vase = { H, buildShards, makeTexture };
})(typeof window !== 'undefined' ? window : globalThis);
