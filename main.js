/*
  Игра «Амфора мудрецов».
  Фазы: menu -> play (собираем) -> complete (читаем письмена) -> done (всё прочитано).
*/
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const wrapPi = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

  const FOV = 45 * Math.PI / 180;
  const TAN_H = Math.tan(FOV / 2);

  // assist — подсказки (контур места + камера сама поворачивается), sil — яркость силуэта вазы, tol — допуск
  const LEVELS = {
    easy:   { cols: 5, rows: 3, assist: true,  sil: 0.12, tol: 1.35 },
    normal: { cols: 7, rows: 4, assist: false, sil: 0.06, tol: 1.0 },
    hard:   { cols: 9, rows: 5, assist: false, sil: 0.0,  tol: 0.9 }
  };

  // ---------------------------------------------------------------- WebGL
  const canvas = $('gl');
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true }) ||
             canvas.getContext('experimental-webgl');
  if (!gl) {
    document.body.innerHTML = '<p style="color:#fff;padding:2em;font-family:serif">WebGL недоступен в этом браузере.</p>';
    return;
  }

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, Shaders.vertex));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, Shaders.fragment));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const U = {};
  ['uModel', 'uRot', 'uViewProj', 'uEye', 'uLight', 'uColor', 'uMode', 'uGhost', 'uFlash', 'uGold', 'uTime', 'uTex']
    .forEach(n => { U[n] = gl.getUniformLocation(prog, n); });
  const AT = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    nor: gl.getAttribLocation(prog, 'aNor'),
    uv: gl.getAttribLocation(prog, 'aUV'),
    crack: gl.getAttribLocation(prog, 'aCrack')
  };
  [AT.pos, AT.nor, AT.uv, AT.crack].forEach(a => gl.enableVertexAttribArray(a));

  function makeMesh(data) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buf, count: data.length / 9 };
  }
  function drawMesh(m) {
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
    gl.vertexAttribPointer(AT.pos, 3, gl.FLOAT, false, 36, 0);
    gl.vertexAttribPointer(AT.nor, 3, gl.FLOAT, false, 36, 12);
    gl.vertexAttribPointer(AT.uv, 2, gl.FLOAT, false, 36, 24);
    gl.vertexAttribPointer(AT.crack, 1, gl.FLOAT, false, 36, 32);
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
  }

  // Постамент
  function cylinder(rt, rb, y0, y1, seg) {
    const a = [];
    const push = (x, y, z, nx, ny, nz) => a.push(x, y, z, nx, ny, nz, 0, 0, 0);
    for (let i = 0; i < seg; i++) {
      const t0 = i / seg * TAU, t1 = (i + 1) / seg * TAU;
      const s0 = Math.sin(t0), c0 = Math.cos(t0), s1 = Math.sin(t1), c1 = Math.cos(t1);
      push(rb * s0, y0, rb * c0, s0, 0, c0); push(rb * s1, y0, rb * c1, s1, 0, c1); push(rt * s0, y1, rt * c0, s0, 0, c0);
      push(rb * s1, y0, rb * c1, s1, 0, c1); push(rt * s1, y1, rt * c1, s1, 0, c1); push(rt * s0, y1, rt * c0, s0, 0, c0);
      push(0, y1, 0, 0, 1, 0); push(rt * s1, y1, rt * c1, 0, 1, 0); push(rt * s0, y1, rt * c0, 0, 1, 0);
    }
    return new Float32Array(a);
  }
  const pedestal = [
    { mesh: makeMesh(cylinder(1.9, 2.0, -0.5, -0.28, 56)), color: [0.55, 0.5, 0.44] },
    { mesh: makeMesh(cylinder(1.45, 1.55, -0.28, -0.012, 56)), color: [0.88, 0.84, 0.76] }
  ];

  // Текстура вазы
  const tex = gl.createTexture();
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic') ||
                gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
  function uploadTexture(cv) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (aniso) {
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT,
        Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    }
  }

  // ---------------------------------------------------------------- Камера
  const cam = {
    yaw: 0, pitch: 0.28, zoom: 1, baseDist: 7.2, dist: 7.2, yawVel: 0,
    target: [0, 1.45, 0], eye: [0, 0, 1], f: [0, 0, -1], r: [1, 0, 0], u: [0, 1, 0]
  };
  let aspect = 1, vp = null, light = [0, 1, 0];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    aspect = w / h;
    // ваза целиком влезает и по высоте, и по ширине (на телефоне — по ширине кольца осколков)
    cam.baseDist = Math.max(7.2, 1.9 / (TAN_H * aspect));
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  function camUpdate() {
    const cp = Math.cos(cam.pitch);
    const d = cam.baseDist * cam.zoom;
    cam.dist = d;
    cam.eye = [
      cam.target[0] + d * Math.sin(cam.yaw) * cp,
      cam.target[1] + d * Math.sin(cam.pitch),
      cam.target[2] + d * Math.cos(cam.yaw) * cp
    ];
    cam.f = V3.norm(V3.sub(cam.target, cam.eye));
    cam.r = V3.norm(V3.cross(cam.f, [0, 1, 0]));
    cam.u = V3.cross(cam.r, cam.f);
    const view = M4.lookAt(cam.eye, cam.target, [0, 1, 0]);
    const proj = M4.perspective(FOV, aspect, 0.1, 80);
    vp = M4.mul(proj, view);
    // свет «с камеры»: сверху-слева, поэтому при вращении ваза всегда красиво освещена
    light = V3.norm(V3.add(V3.add(V3.mul(cam.r, -0.45), V3.mul(cam.u, 0.8)), V3.mul(cam.f, -0.65)));
  }

  function rayAt(px, py) {
    const nx = (px / window.innerWidth) * 2 - 1;
    const ny = 1 - (py / window.innerHeight) * 2;
    return V3.norm(V3.add(V3.add(cam.f, V3.mul(cam.r, nx * TAN_H * aspect)), V3.mul(cam.u, ny * TAN_H)));
  }

  // ---------------------------------------------------------------- Состояние игры
  let phase = 'menu';
  let level = LEVELS.normal;
  let shards = [];
  let placed = 0;
  let thought = null;
  let readFlags = [];
  let dwell = [];
  let gold = 0;
  let hintT = 0;
  let time = 0;
  let lastThoughtIdx = -1;

  let held = null, heldId = null;
  const ptr = { x: 0, y: 0, touch: false };

  function disposeShards() {
    shards.forEach(s => gl.deleteBuffer(s.mesh.buf));
    shards = [];
  }

  function pickThought() {
    let i;
    do { i = Math.floor(Math.random() * THOUGHTS.length); } while (i === lastThoughtIdx && THOUGHTS.length > 1);
    lastThoughtIdx = i;
    thought = THOUGHTS[i];
    readFlags = thought.segs.map(() => false);
    dwell = thought.segs.map(() => 0);
    uploadTexture(Vase.makeTexture(thought.segs, readFlags));
  }

  function buildShards(lv, assembled) {
    disposeShards();
    const data = Vase.buildShards(lv.cols, lv.rows);
    shards = data.parts.map(p => ({
      mesh: makeMesh(p.verts),
      center: p.center, nrm: p.nrm, radius: p.radius,
      state: 'placed', pos: p.center.slice(), rot: [0, 0, 0], rv: [0, 0, 0],
      flash: 0, rad: 0, ang: 0, h: 0, w: 0, ph: Math.random() * 6.28, depth: 0, grab: [0, 0, 0]
    }));
    placed = assembled ? shards.length : 0;
    if (assembled) return;

    // перемешанный порядок, чтобы соседние осколки не лежали рядом
    const order = shards.map((_, i) => i).sort(() => Math.random() - 0.5);
    order.forEach((idx, n) => {
      const s = shards[idx];
      s.state = 'loose';
      s.ang = n / shards.length * TAU + rand(-0.2, 0.2);
      s.rad = rand(2.1, 3.1);
      s.h = rand(0.5, 2.7);
      s.w = rand(0.07, 0.13);
      s.rot = [rand(0, TAU), rand(0, TAU), rand(0, TAU)];
      s.rv = [rand(-0.7, 0.7), rand(-0.7, 0.7), rand(-0.7, 0.7)];
      s.pos = [s.rad * Math.sin(s.ang), s.h, s.rad * Math.cos(s.ang)];
    });
  }

  function startPreview() {
    phase = 'menu';
    held = null; heldId = null;
    pickThought();
    buildShards(LEVELS.normal, true);
    gold = 0.7;
    cam.zoom = 1; cam.pitch = 0.28;
    $('menu').classList.remove('hidden');
    $('hud').classList.add('hidden');
    $('scroll').classList.add('hidden');
    $('final').classList.add('hidden');
  }

  function startGame(key) {
    GameAudio.start();
    level = LEVELS[key];
    held = null; heldId = null;
    pickThought();
    buildShards(level, false);
    gold = 0; hintT = 0;
    cam.yaw = 0; cam.pitch = 0.28; cam.zoom = 1; cam.yawVel = 0;
    phase = 'play';
    $('menu').classList.add('hidden');
    $('final').classList.add('hidden');
    $('scroll').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('help').classList.remove('hidden');
    $('btnHint').classList.remove('hidden');
    setProgress();
    toast(level.assist ? 'Возьми осколок — камера покажет, куда его нести' : 'Собери вазу из осколков');
  }

  // ---------------------------------------------------------------- HUD
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2800);
  }
  function setProgress() {
    $('cnt').textContent = placed + ' / ' + shards.length;
    $('bar').style.width = (shards.length ? placed / shards.length * 100 : 0) + '%';
  }

  function renderScroll() {
    const n = thought.segs.length;
    const done = readFlags.filter(Boolean).length;
    $('scTitle').textContent = 'Письмена на вазе: ' + done + ' из ' + n + '. Поворачивай вазу.';
    const list = $('scList');
    list.innerHTML = '';
    thought.segs.forEach((seg, k) => {
      const li = document.createElement('li');
      li.id = 'seg' + k;
      li.className = readFlags[k] ? 'on' : 'off';
      const b = document.createElement('b');
      b.textContent = readFlags[k] ? seg.gr : '· · ·';
      const sp = document.createElement('span');
      sp.textContent = readFlags[k] ? seg.ru : 'ещё не найдено';
      li.appendChild(b);
      li.appendChild(sp);
      list.appendChild(li);
    });
  }

  // ---------------------------------------------------------------- Игровые события
  function onPlaced() {
    placed++;
    GameAudio.snap();
    setProgress();
    if (placed === shards.length) complete();
  }

  function complete() {
    phase = 'complete';
    GameAudio.complete();
    $('help').classList.add('hidden');
    $('btnHint').classList.add('hidden');
    renderScroll();
    $('scroll').classList.remove('hidden');
    toast('Ваза собрана! Поверни её: на глине проступают письмена', 4200);
  }

  function discover(k) {
    readFlags[k] = true;
    uploadTexture(Vase.makeTexture(thought.segs, readFlags));
    GameAudio.discover();
    renderScroll();
    if (readFlags.every(Boolean)) {
      phase = 'done';
      setTimeout(showFinal, 1400);
    }
  }

  function showFinal() {
    if (phase !== 'done') return;
    $('finGr').textContent = thought.segs.map(s => s.gr).join(' ');
    $('finRu').textContent = thought.segs.map(s => s.ru).join(' ');
    $('finBy').textContent = thought.author;
    $('final').classList.remove('hidden');
  }

  function updateReading(dt) {
    const n = thought.segs.length;
    for (let k = 0; k < n; k++) {
      if (readFlags[k]) continue;
      const a = TAU * (k + 0.5) / n;
      const facing = Math.abs(wrapPi(cam.yaw - a)) < 0.3 && cam.pitch < 1.0;
      dwell[k] = clamp(dwell[k] + (facing ? dt : -dt), 0, 1);
      const li = $('seg' + k);
      if (li) li.style.setProperty('--p', (dwell[k] / 0.9).toFixed(3));
      if (dwell[k] >= 0.9) discover(k);
    }
  }

  // ---------------------------------------------------------------- Ввод
  const pointers = new Map();
  let dragCam = false, lastMoveT = 0, pinchD0 = 0, pinchZoom0 = 1;

  function pick(px, py) {
    const d = rayAt(px, py);
    let best = null, bd = 1e9;
    shards.forEach(s => {
      if (s.state !== 'loose') return;
      const oc = V3.sub(s.pos, cam.eye);
      const t = V3.dot(oc, d);
      if (t < 0) return;
      const dist2 = V3.dot(oc, oc) - t * t;
      const R = s.radius * 1.05 + 0.15;
      if (dist2 < R * R && dist2 < bd) { bd = dist2; best = s; }
    });
    return best;
  }

  function grabShard(s, e) {
    s.state = 'held';
    held = s;
    heldId = e.pointerId;
    ptr.x = e.clientX; ptr.y = e.clientY;
    ptr.touch = e.pointerType === 'touch';
    const d = rayAt(ptr.x, ptr.y);
    s.depth = V3.dot(V3.sub(s.pos, cam.eye), cam.f);
    const p0 = V3.add(cam.eye, V3.mul(d, s.depth / V3.dot(d, cam.f)));
    s.grab = V3.sub(s.pos, p0);
    GameAudio.pick();
  }

  function releaseShard() {
    const s = held;
    if (!s) return;
    held = null; heldId = null;

    const to = V3.sub(s.center, s.pos);
    const inPlane = V3.sub(to, V3.mul(cam.f, V3.dot(to, cam.f)));
    const facing = V3.dot(s.nrm, V3.norm(V3.sub(cam.eye, s.center))) > 0.2;
    const tol = clamp(s.radius * 0.6, 0.3, 0.8) * level.tol;

    if (facing && V3.len(inPlane) < tol) {
      s.state = 'snap';
    } else {
      s.state = 'loose';
      s.rad = Math.hypot(s.pos[0], s.pos[2]);
      s.ang = Math.atan2(s.pos[0], s.pos[2]);
      s.h = s.pos[1];
      if (s.rad < 2.0) s.rad = 2.0;                 // не оставляем осколки внутри вазы
      GameAudio.drop();
    }
  }

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (phase === 'menu') return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      if (held) releaseShard();
      dragCam = false;
      const p = Array.from(pointers.values());
      pinchD0 = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
      pinchZoom0 = cam.zoom;
      return;
    }
    if (pointers.size > 2) return;

    if (phase === 'play') {
      const s = pick(e.clientX, e.clientY);
      if (s) { grabShard(s, e); return; }
    }
    dragCam = true;
    cam.yawVel = 0;
    lastMoveT = performance.now();
  });

  canvas.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (pointers.size === 2) {
      const a = Array.from(pointers.values());
      const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
      cam.zoom = clamp(pinchZoom0 * pinchD0 / d, 0.65, 1.8);
      return;
    }
    if (held && e.pointerId === heldId) {
      ptr.x = e.clientX; ptr.y = e.clientY;
      return;
    }
    if (dragCam) {
      const now = performance.now();
      const dt = Math.max(0.008, (now - lastMoveT) / 1000);
      lastMoveT = now;
      cam.yaw -= dx * 0.0065;
      cam.pitch = clamp(cam.pitch + dy * 0.005, -0.05, 1.25);
      cam.yawVel = clamp(cam.yawVel * 0.5 + (-dx * 0.0065 / dt) * 0.5, -4, 4);
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (e.pointerId === heldId) releaseShard();
    if (pointers.size === 0) {
      dragCam = false;
      if (performance.now() - lastMoveT > 90) cam.yawVel = 0;
    }
    if (pointers.size === 1 && !held) {
      dragCam = true;
      lastMoveT = performance.now();
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.zoom = clamp(cam.zoom * (1 + e.deltaY * 0.001), 0.65, 1.8);
  }, { passive: false });

  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('contextmenu', e => e.preventDefault());

  // Кнопки
  document.querySelectorAll('.lvl').forEach(b => {
    b.addEventListener('click', () => startGame(b.dataset.level));
  });
  $('btnMenu').addEventListener('click', startPreview);
  $('btnMute').addEventListener('click', () => {
    const m = GameAudio.toggleMute();
    $('btnMute').innerHTML = m ? '&#128263;' : '&#128266;';
  });
  $('btnHint').addEventListener('click', () => {
    if (phase !== 'play') return;
    if (!held) { toast('Сначала возьми осколок, потом нажми подсказку'); return; }
    hintT = 3.5;
    GameAudio.hint();
  });
  $('btnAgain').addEventListener('click', startPreview);
  $('btnClose').addEventListener('click', () => $('final').classList.add('hidden'));

  // ---------------------------------------------------------------- Обновление
  function update(dt) {
    time += dt;
    if (hintT > 0) hintT -= dt;

    // камера
    if (phase === 'menu') {
      cam.yaw += dt * 0.25;
    } else if (phase === 'play') {
      if (held && (level.assist || hintT > 0)) {
        const a = Math.atan2(held.center[0], held.center[2]);
        cam.yaw += wrapPi(a - cam.yaw) * Math.min(1, dt * 3.2);
      } else if (!dragCam) {
        cam.yaw += cam.yawVel * dt;
        cam.yawVel *= Math.exp(-dt * 3);
      }
    } else {
      if (!dragCam) {
        const spin = phase === 'complete' ? 0.22 : 0.12;
        cam.yaw += (cam.yawVel + spin) * dt;
        cam.yawVel *= Math.exp(-dt * 2.5);
      }
      if (gold < 1) gold = Math.min(1, gold + dt * 0.5);
      if (phase === 'complete') updateReading(dt);
    }

    // осколки
    shards.forEach(s => {
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 2.2);

      if (s.state === 'loose') {
        s.ang += s.w * dt;
        s.pos[0] = s.rad * Math.sin(s.ang);
        s.pos[2] = s.rad * Math.cos(s.ang);
        s.pos[1] = s.h + Math.sin(time * 1.2 + s.ph) * 0.09;
        for (let k = 0; k < 3; k++) s.rot[k] += s.rv[k] * dt;
      } else if (s.state === 'held') {
        const d = rayAt(ptr.x, ptr.y);
        const facing = V3.dot(s.nrm, V3.norm(V3.sub(cam.eye, s.center))) > 0.2;
        const want = facing ? V3.dot(V3.sub(s.center, cam.eye), cam.f) : cam.dist - 2.2;
        s.depth += (want - s.depth) * Math.min(1, dt * 6);
        const p = V3.add(cam.eye, V3.mul(d, s.depth / V3.dot(d, cam.f)));
        const lift = ptr.touch ? V3.mul(cam.u, 0.6) : [0, 0, 0];
        s.grab = V3.add(s.grab, V3.mul(V3.sub(lift, s.grab), Math.min(1, dt * 5)));
        s.pos = V3.add(p, s.grab);
        for (let k = 0; k < 3; k++) {
          const target = Math.round(s.rot[k] / TAU) * TAU;
          s.rot[k] += (target - s.rot[k]) * Math.min(1, dt * 9);
        }
      } else if (s.state === 'snap') {
        const k = 1 - Math.exp(-dt * 16);
        s.pos = V3.add(s.pos, V3.mul(V3.sub(s.center, s.pos), k));
        for (let q = 0; q < 3; q++) {
          const target = Math.round(s.rot[q] / TAU) * TAU;
          s.rot[q] += (target - s.rot[q]) * Math.min(1, dt * 14);
        }
        if (V3.len(V3.sub(s.center, s.pos)) < 0.01) {
          s.state = 'placed';
          s.pos = s.center.slice();
          s.rot = [0, 0, 0];
          s.flash = 1;
          onPlaced();
        }
      }
    });
  }

  // ---------------------------------------------------------------- Отрисовка
  function setModel(pos, rot) {
    const m = M4.model(pos[0], pos[1], pos[2], rot[0], rot[1], rot[2]);
    gl.uniformMatrix4fv(U.uModel, false, m.m4);
    gl.uniformMatrix3fv(U.uRot, false, m.r3);
  }

  function render() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    camUpdate();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    gl.uniformMatrix4fv(U.uViewProj, false, vp);
    gl.uniform3fv(U.uEye, cam.eye);
    gl.uniform3fv(U.uLight, light);
    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uGhost, 0);
    gl.uniform1f(U.uFlash, 0);
    gl.uniform1f(U.uGold, 0);

    // постамент
    gl.uniform1f(U.uMode, 1);
    setModel([0, 0, 0], [0, 0, 0]);
    pedestal.forEach(p => {
      gl.uniform3fv(U.uColor, p.color);
      drawMesh(p.mesh);
    });

    // осколки вазы
    gl.uniform1f(U.uMode, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(U.uTex, 0);
    gl.uniform1f(U.uGold, gold);
    shards.forEach(s => {
      setModel(s.pos, s.rot);
      gl.uniform1f(U.uFlash, s.flash);
      drawMesh(s.mesh);
    });
    gl.uniform1f(U.uFlash, 0);

    // «призраки»: силуэт недостающих частей и место для осколка в руке
    if (phase === 'play') {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      const pulse = 0.38 + 0.1 * Math.sin(time * 5);
      shards.forEach(s => {
        if (s.state === 'placed') return;
        let a = level.sil;
        if (s === held && (level.assist || hintT > 0)) a = pulse;
        if (a <= 0) return;
        setModel(s.center, [0, 0, 0]);
        gl.uniform1f(U.uGhost, a);
        drawMesh(s.mesh);
      });
      gl.uniform1f(U.uGhost, 0);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  // ---------------------------------------------------------------- Старт
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  resize();
  startPreview();
  requestAnimationFrame(frame);
})();
