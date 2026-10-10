/*
  Музыка и звуки целиком генерируются в браузере (Web Audio), файлов не нужно.
  Лад: фригийский доминантный (E F G# A B C D) — тот самый «восточно-эллинский» оттенок.
  Слои: тихий пад-бурдон, щипковая «лира», рамочный барабан.
  Если захочешь свой трек — подключи <audio> и вызови play() из GameAudio.start().
*/
(function (g) {
  'use strict';

  let ctx = null, master = null, bus = null, verb = null, noiseBuf = null;
  let timer = null, nextT = 0, step = 0, mel = 6, pattern = [0, 1, 2, 1, 0, 2, 3, 2];
  let muted = false, running = false;

  const ROOT = 164.81;                       // E3
  const SC = [0, 1, 4, 5, 7, 8, 10, 12, 13, 16, 17, 19];
  const STEP = 60 / 72 / 2;                  // восьмая при 72 bpm
  const PROG = [0, 0, 1, 0, 0, 10, 1, 0];    // корни по тактам (в полутонах от E)
  const CHORD = {
    0:  [0, 4, 7, 12],
    1:  [1, 5, 8, 13],
    10: [10, 13, 17, 22]
  };
  const PATTERNS = [
    [0, 1, 2, 1, 3, 2, 1, 2],
    [0, 2, 1, 2, 0, 3, 2, 1],
    [2, 1, 0, 1, 2, 3, 2, 1],
    [0, 1, 2, 3, 2, 1, 2, 1]
  ];

  const hz = semi => ROOT * Math.pow(2, semi / 12);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function ensure() {
    if (ctx) return true;
    const AC = g.AudioContext || g.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.connect(master);
    master.connect(ctx.destination);

    bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(comp);

    // Простая реверберация из затухающего шума
    verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    verb.buffer = ir;
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.38;
    verb.connect(verbOut);
    verbOut.connect(comp);

    // Белый шум для ударных
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend(); else ctx.resume();
    });
    return true;
  }

  // ---------- инструменты ----------
  function pluck(freq, t, vol, dur) {
    vol = vol || 0.16;
    dur = dur || 1.8;
    const g1 = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(freq * 6, 9000), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.4, 300), t + dur * 0.6);
    g1.gain.setValueAtTime(0.0001, t);
    g1.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g1.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2;
    o2.detune.value = 4;
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;

    o1.connect(g1);
    o2.connect(g2);
    g2.connect(g1);
    g1.connect(lp);
    lp.connect(bus);
    lp.connect(verb);

    o1.start(t); o2.start(t);
    o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  function pad(freq, t, dur, vol) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.Q.value = 0.7;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(vol, t + 1.4);
    gn.gain.setValueAtTime(vol, t + dur - 1.6);
    gn.gain.linearRampToValueAtTime(0.0001, t + dur);
    [-7, 7].forEach(det => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(gn);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
    gn.connect(lp);
    lp.connect(bus);
    lp.connect(verb);
  }

  function drum(t, vol) {
    const o = ctx.createOscillator();
    const gn = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.18);
    gn.gain.setValueAtTime(vol, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(gn);
    gn.connect(bus);
    o.start(t);
    o.stop(t + 0.4);
  }

  function tak(t, vol) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 2400;
    hp.Q.value = 1.2;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(vol, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(hp);
    hp.connect(gn);
    gn.connect(bus);
    src.start(t);
    src.stop(t + 0.12);
  }

  // ---------- секвенсор ----------
  function scheduleStep(t) {
    const s = step % 8;
    const barIdx = Math.floor(step / 8);
    const root = PROG[barIdx % PROG.length];
    const tones = CHORD[root];

    if (s === 0) {
      pad(hz(root - 12), t, STEP * 8 + 0.8, 0.055);
      pad(hz(root - 5), t, STEP * 8 + 0.8, 0.035);
      pattern = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
    }
    if (Math.random() < 0.88) {
      pluck(hz(tones[pattern[s]] + 12), t, s % 4 === 0 ? 0.2 : 0.14, 1.9);
    }
    if (s % 2 === 1 && Math.random() < 0.26) {
      mel = clamp(mel + Math.floor(Math.random() * 5) - 2, 3, SC.length - 1);
      pluck(hz(SC[mel] + 12), t + 0.02, 0.1, 2.6);
    }
    if (barIdx >= 2) {
      if (s === 0 || s === 4) drum(t, 0.26);
      if (s === 2 || s === 6) tak(t, 0.05);
    }
  }

  function tick() {
    if (!ctx) return;
    while (nextT < ctx.currentTime + 0.35) {
      scheduleStep(nextT);
      nextT += STEP;
      step++;
    }
  }

  // ---------- звуковые эффекты ----------
  function note(semi, delay, vol, dur) {
    if (!ctx) return;
    pluck(hz(semi), ctx.currentTime + (delay || 0), vol, dur);
  }

  const GameAudio = {
    start() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (!running) {
        running = true;
        nextT = ctx.currentTime + 0.15;
        timer = setInterval(tick, 80);
      }
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
      return muted;
    },
    isMuted() { return muted; },

    pick()  { note(24, 0, 0.09, 0.5); },
    drop()  { note(7, 0, 0.1, 0.5); },
    snap()  { note(31, 0, 0.18, 1.6); note(36, 0.09, 0.14, 1.8); },
    hint()  { note(28, 0, 0.1, 0.8); },
    discover() { note(28, 0, 0.14, 1.8); note(32, 0.1, 0.12, 1.8); note(35, 0.2, 0.12, 2.2); },
    complete() {
      [12, 16, 19, 24, 28, 31, 36].forEach((s, i) => note(s, i * 0.16, 0.2, 2.8));
    }
  };

  g.GameAudio = GameAudio;
})(typeof window !== 'undefined' ? window : globalThis);
