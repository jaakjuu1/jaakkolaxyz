// Laulun harjoitustyökalu. Kaikki ääni käsitellään selaimessa; mitään ei lähetetä minnekään.
"use strict";
(() => {
  const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const midiToFreq = m => 440 * 2 ** ((m - 69) / 12);
  const freqToMidi = f => 69 + 12 * Math.log2(f / 440);
  const noteName = m => NOTES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

  const DRILLS = {
    sniper: { name: "Pitkät sävelet", steps: [0, 2, 4, 5, 7], dur: 3.2 },
    triad: { name: "Kolmisointu 1–3–5–3–1", steps: [0, 4, 7, 4, 0], dur: 2.0 },
    scale: { name: "Viiden sävelen asteikko", steps: [0, 2, 4, 5, 7, 5, 4, 2, 0], dur: 1.4 },
    leap: { name: "Oktaavihyppy 1–8–1–5–8–1", steps: [0, 12, 0, 7, 12, 0], dur: 2.4 },
    free: { name: "Vapaa laulu", steps: [], dur: 0 },
  };
  const LEAD_IN = 2.0;          // s ennen ensimmäistä säveltä
  const F_MIN = 65, F_MAX = 1100;
  const YIN_THRESHOLD = 0.15;
  const RMS_GATE = 0.008;       // tätä hiljaisempaa ei analysoida
  const HISTORY_S = 8;
  const ONSET_S = 0.15;         // aloituksen mittausikkuna
  const SETTLE_S = 0.4;         // tämän jälkeen sävel katsotaan asettuneeksi
  const PRE_ONSET_S = 0.3;      // aloitusta seurataan näin paljon ennen kohdesäveltä

  const $ = id => document.getElementById(id);
  const el = {
    base: $("base"), drill: $("drill"), tol: $("tol"), cue: $("cue"),
    mic: $("mic"), go: $("go"), ref: $("ref"),
    note: $("note"), hz: $("hz"), dot: $("cent-dot"), zone: $("cent-zone"), centText: $("cent-text"),
    target: $("target"), stab: $("stab"), vib: $("vib"), onset: $("onset"),
    vol: $("vol"), volText: $("vol-text"), volVar: $("vol-var"),
    ring: $("ring"), ringText: $("ring-text"),
    hintTitle: $("hint-title"), hintText: $("hint-text"),
    status: $("status"), results: $("results"),
    pitch: $("pitch-canvas"), spec: $("spec-canvas"),
  };
  const pctx = el.pitch.getContext("2d");
  const sctx = el.spec.getContext("2d");

  // --- Asetukset URL:sta: ?drill=sniper&base=53&tol=25 ---
  const params = new URLSearchParams(location.search);
  if (DRILLS[params.get("drill")]) el.drill.value = params.get("drill");
  if (params.get("base") && el.base.querySelector(`option[value="${CSS.escape(params.get("base"))}"]`)) el.base.value = params.get("base");
  if (["50", "25", "15"].includes(params.get("tol"))) el.tol.value = params.get("tol");
  try { const saved = localStorage.getItem("laulu-base"); if (saved && !params.get("base") && el.base.querySelector(`option[value="${CSS.escape(saved)}"]`)) el.base.value = saved; } catch { /* ei tallennusta */ }

  // --- Tila ---
  let ctx = null, analyser = null, stream = null;
  let timeBuf = null, freqBuf = null, yinBuf = null, yinWindow = 1024;
  let listening = false;
  let hist = [];                // { t, midi|null, db, hit }
  let mutes = [];               // [from, to] sekunteina: referenssiääni soi, mikrofonia ei uskota
  let run = null;               // käynnissä oleva harjoitus
  let ringEma = null;
  let freeCenter = null;

  const now = () => performance.now() / 1000;
  const base = () => parseInt(el.base.value, 10);
  const tol = () => parseInt(el.tol.value, 10);
  const drill = () => DRILLS[el.drill.value];

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // --- Referenssiääni ---
  function playTone(midi, at, dur) {
    const c = getCtx();
    const when = c.currentTime + Math.max(0, at - now());
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "triangle";
    osc.frequency.value = midiToFreq(midi);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.22, when + 0.04);
    gain.gain.setValueAtTime(0.22, when + dur - 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(when);
    osc.stop(when + dur + 0.02);
    mutes.push([at, at + dur + 0.2]);
  }
  const muted = t => mutes.some(([a, b]) => t >= a && t <= b);

  el.ref.addEventListener("click", () => {
    const b = run && !run.done ? (currentBlock(now()) || nextBlock(now())) : null;
    playTone(b ? b.midi : base(), now() + 0.02, 1.2);
  });

  // --- Mikrofoni ---
  el.mic.addEventListener("click", async () => {
    if (listening) { stopMic(); return; }
    try {
      const c = getCtx();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
      });
      const src = c.createMediaStreamSource(stream);
      analyser = c.createAnalyser();
      analyser.fftSize = c.sampleRate > 50000 ? 4096 : 2048;
      analyser.smoothingTimeConstant = 0.5;
      src.connect(analyser);
      timeBuf = new Float32Array(analyser.fftSize);
      freqBuf = new Float32Array(analyser.frequencyBinCount);
      yinWindow = analyser.fftSize / 2;
      yinBuf = new Float32Array(yinWindow + 2);
      listening = true;
      el.mic.textContent = "Sulje mikrofoni";
      el.mic.classList.add("secondary");
      el.go.disabled = false;
      setHint("Mikrofoni päällä", el.drill.value === "free"
        ? "Laula mitä tahansa. Näet sävelen, vakauden, vibraton ja kirkkauden."
        : "Paina ”Aloita harjoitus”. Ensimmäinen sävel tulee kahden sekunnin päästä.");
      requestAnimationFrame(frame);
    } catch (err) {
      setHint("Mikrofoni ei auennut", "Selain ei antanut mikrofonia (" + err.message + "). Salli mikrofoni osoiterivin lukkokuvakkeesta ja yritä uudelleen.");
    }
  });

  function stopMic() {
    listening = false;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    run = null;
    el.mic.textContent = "Avaa mikrofoni";
    el.mic.classList.remove("secondary");
    el.go.disabled = true;
    el.go.textContent = "Aloita harjoitus";
    setHint("Mikrofoni suljettu", "Avaa mikrofoni jatkaaksesi.");
  }

  // --- Harjoituksen kulku ---
  el.go.addEventListener("click", () => {
    if (run && !run.done) { run = null; el.go.textContent = "Aloita harjoitus"; el.status.textContent = "Keskeytetty."; return; }
    startRun();
  });
  [el.drill, el.base, el.tol, el.cue].forEach(x => x.addEventListener("change", () => {
    run = null;
    el.go.textContent = "Aloita harjoitus";
    el.status.textContent = "";
    try { localStorage.setItem("laulu-base", el.base.value); } catch { /* ei tallennusta */ }
    updateZone();
  }));

  function startRun() {
    const d = drill();
    el.results.innerHTML = "";
    if (!d.steps.length) { run = null; el.status.textContent = "Vapaa laulu: ei kohdesäveliä."; return; }
    const cue = el.cue.checked;
    const gap = cue ? 1.4 : 0.6;
    const t0 = now();
    let t = LEAD_IN + (cue ? 1.0 : 0);
    const blocks = d.steps.map(s => {
      const b = { midi: base() + s, start: t, end: t + d.dur, frames: 0, voiced: 0, hits: 0, cents: [], firstT: null, onsetC: [], settle: [], onset: null };
      t += d.dur + gap;
      return b;
    });
    if (cue) blocks.forEach(b => playTone(b.midi, t0 + b.start - 1.2, 0.8));
    run = { t0, blocks, end: blocks[blocks.length - 1].end + 0.3, done: false, name: d.name };
    el.go.textContent = "Keskeytä";
  }

  const elapsed = t => t - run.t0;
  function currentBlock(t) {
    if (!run) return null;
    const e = elapsed(t);
    return run.blocks.find(b => e >= b.start && e < b.end) || null;
  }
  function nextBlock(t) {
    if (!run) return null;
    const e = elapsed(t);
    return run.blocks.find(b => b.start > e) || null;
  }

  const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

  function trackRun(t, midi, isMuted) {
    if (!run || run.done) return false;
    const e = elapsed(t);
    let hit = false;
    const b = currentBlock(t);
    // Aloitusta seurataan jo vähän ennen säveltä: moni aloittaa hieman etuajassa.
    const ob = b || run.blocks.find(x => e >= x.start - PRE_ONSET_S && e < x.start);
    if (ob && !isMuted && ob.onset === null) {
      if (midi === null) {
        if (ob.firstT !== null && e - ob.firstT < SETTLE_S) { ob.firstT = null; ob.onsetC = []; ob.settle = []; }
      } else {
        const c = (midi - ob.midi) * 100;
        if (ob.firstT === null) ob.firstT = e;
        if (e - ob.firstT <= ONSET_S) ob.onsetC.push(c);
        else if (e - ob.firstT >= SETTLE_S) ob.settle.push(c);
        if (e - ob.firstT > SETTLE_S + 0.3 && ob.settle.length > 5) {
          ob.onset = mean(ob.onsetC) - median(ob.settle);
          showOnset(ob.onset);
        }
      }
    }
    if (b && !isMuted) {
      b.frames++;
      if (midi !== null) {
        const c = (midi - b.midi) * 100;
        b.voiced++;
        hit = Math.abs(c) <= tol();
        if (hit) b.hits++;
        if (b.firstT !== null && e - b.firstT >= SETTLE_S) b.cents.push(c);
      }
    }
    if (e >= run.end) finishRun();
    return hit;
  }

  function showOnset(d) {
    const r = Math.round(d);
    el.onset.textContent = (r > 0 ? "+" : "") + r + " c";
    el.onset.className = Math.abs(r) <= 20 ? "good" : Math.abs(r) <= 50 ? "warnc" : "bad";
  }

  function finishRun() {
    run.done = true;
    el.go.textContent = "Aloita uudelleen";
    let voiced = 0, hits = 0;
    const rows = run.blocks.map(b => {
      voiced += b.voiced; hits += b.hits;
      const hitPct = b.voiced ? Math.round(100 * b.hits / b.voiced) : null;
      const med = median(b.cents);
      return {
        note: noteName(b.midi),
        hit: hitPct,
        med: med === null ? null : Math.round(med),
        onset: b.onset === null ? null : Math.round(b.onset),
        sung: b.frames ? Math.round(100 * b.voiced / b.frames) : 0,
      };
    });
    const total = voiced ? Math.round(100 * hits / voiced) : 0;
    const fmt = (v, unit) => v === null ? "–" : (v > 0 && unit === " c" ? "+" : "") + v + unit;
    const cls = (v, ok, warn) => v === null ? "" : Math.abs(v) <= ok ? "good" : Math.abs(v) <= warn ? "warnc" : "bad";
    el.results.innerHTML = `
      <h2>Tulos: ${total} % osumia (±${tol()} c)</h2>
      <p class="small">${run.name}, pohjasävel ${noteName(base())}. Osuma-% lasketaan niistä hetkistä, joina mikrofoni kuuli sävelen. Mediaani kertoo, mihin sävel asettui. Aloitus kertoo, kuinka paljon ensimmäiset 0,15 s poikkesivat asettuneesta sävelestä (miinus = liu'ut alhaalta).</p>
      <table class="results"><thead><tr><th>Sävel</th><th>Osuma</th><th>Mediaani</th><th>Aloitus</th><th>Ääntä</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${r.note}</td><td>${fmt(r.hit, " %")}</td><td class="${cls(r.med, tol(), 50)}">${fmt(r.med, " c")}</td><td class="${cls(r.onset, 20, 50)}">${fmt(r.onset, " c")}</td><td>${r.sung} %</td></tr>`).join("")}
      </tbody></table>
      <button type="button" id="copy-results" class="secondary">Kopioi tulokset</button><span class="small" id="copy-status"></span>`;
    const text = [`${run.name}, pohjasävel ${noteName(base())}, toleranssi ±${tol()} c: ${total} % osumia`]
      .concat(rows.map(r => `${r.note}: osuma ${fmt(r.hit, " %")}, mediaani ${fmt(r.med, " c")}, aloitus ${fmt(r.onset, " c")}`)).join("\n");
    $("copy-results").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); $("copy-status").textContent = " Kopioitu."; }
      catch { $("copy-status").textContent = " Kopiointi ei onnistunut."; }
    });
    el.status.textContent = "Valmis. Tulokset alla.";
    setHint("Harjoitus valmis", "Katso taulukosta, mikä sävel jäi ohi ja mihin suuntaan. Toista sama harjoitus ennen kuin vaihdat seuraavaan.");
  }

  // --- YIN-sävelentunnistus (de Cheveigné & Kawahara 2002) ---
  function yin(buf, sr) {
    const W = yinWindow;
    const minTau = Math.max(2, Math.floor(sr / F_MAX));
    const maxTau = Math.min(Math.ceil(sr / F_MIN), buf.length - W - 1);
    const d = yinBuf;
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= maxTau; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) { const x = buf[j] - buf[j + tau]; s += x * x; }
      running += s;
      d[tau] = running > 0 ? s * tau / running : 1;
    }
    let tau = -1;
    for (let t = minTau; t < maxTau; t++) {
      if (d[t] < YIN_THRESHOLD) {
        while (t + 1 < maxTau && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return -1;
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const denom = a + c - 2 * b;
    const shift = denom ? (a - c) / (2 * denom) : 0;
    const f = sr / (tau + shift);
    return f >= F_MIN && f <= F_MAX ? f : -1;
  }

  function rmsOf(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  // --- Mittarit ---
  function stability(t) {
    const c = hist.filter(h => t - h.t <= 0.5 && h.midi !== null).map(h => h.midi * 100);
    if (c.length < 12) return null;
    const m = mean(c);
    return Math.sqrt(mean(c.map(x => (x - m) ** 2)));
  }

  // Vibrato: viimeiset 1,6 s yhtenäistä ääntä, lineaarinen trendi pois, nollan ylitykset hystereesillä.
  function vibrato(t) {
    const seg = [];
    for (let i = hist.length - 1; i >= 0; i--) {
      const h = hist[i];
      if (t - h.t > 1.6) break;
      if (h.midi === null) return null;
      seg.push(h);
    }
    if (seg.length < 40 || t - seg[seg.length - 1].t < 1.2) return null;
    seg.reverse();
    const xs = seg.map(h => h.t), ys = seg.map(h => h.midi * 100);
    const mx = mean(xs), my = mean(ys);
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    const slope = den ? num / den : 0;
    const r = ys.map((y, i) => y - my - slope * (xs[i] - mx));
    const sorted = [...r].sort((a, b) => a - b);
    const extent = (sorted[Math.floor(sorted.length * 0.95)] - sorted[Math.floor(sorted.length * 0.05)]) / 2;
    const H = Math.max(4, extent * 0.3);
    let state = 0, crossings = 0;
    for (const v of r) {
      if (v > H && state !== 1) { if (state === -1) crossings++; state = 1; }
      else if (v < -H && state !== -1) { if (state === 1) crossings++; state = -1; }
    }
    const dur = xs[xs.length - 1] - xs[0];
    return { rate: crossings / (2 * dur), extent };
  }

  function volumeVar(t) {
    const d = hist.filter(h => t - h.t <= 1.0 && h.midi !== null).map(h => h.db);
    if (d.length < 20) return null;
    const m = mean(d);
    return Math.sqrt(mean(d.map(x => (x - m) ** 2)));
  }

  // Singing power ratio (Omori ym. 1996): voimakkain huippu 2–4 kHz miinus voimakkain huippu 0–2 kHz.
  function ringRatio(sr) {
    const bin = sr / analyser.fftSize;
    let low = -Infinity, high = -Infinity;
    for (let i = 1; i < freqBuf.length; i++) {
      const f = i * bin;
      if (f > 4000) break;
      if (f < 2000) low = Math.max(low, freqBuf[i]);
      else high = Math.max(high, freqBuf[i]);
    }
    return high - low;
  }

  function setHint(title, text) {
    if (el.hintTitle.textContent !== title) el.hintTitle.textContent = title;
    if (el.hintText.textContent !== text) el.hintText.textContent = text;
  }

  function coach(cents, b, volVar) {
    if (!b) return;
    if (cents === null) { setHint(`Kohde: ${noteName(b.midi)}`, "Laula kohdesävel. Jos et kuule sitä mielessäsi, paina ”Soita kohdesävel” (kuulokkeilla)."); return; }
    const octave = Math.round(cents / 1200);
    if (octave !== 0 && Math.abs(cents - octave * 1200) <= 50) {
      setHint("Oikea sävel, eri oktaavi", `Laulat sävelen ${noteName(b.midi)} oktaavin ${octave > 0 ? "ylempää" : "alempaa"}. Se on musiikillisesti sama sävel, mutta harjoitus mittaa juuri tätä oktaavia. Vaihda pohjasäveltä, jos ala on sinulle väärä.`);
      return;
    }
    if (Math.abs(cents) > 150) { setHint("Kaukana kohteesta", `Olet ${Math.round(Math.abs(cents) / 100)} puolisävelaskelta ${cents < 0 ? "alempana" : "ylempänä"}. Pysähdy, kuuntele kohdesävel ja hyräile se ensin.`); return; }
    if (Math.abs(cents) <= tol()) { setHint("Osuu", "Pidä sama sävel ja sama voimakkuus. Huomaa, miltä tämä tuntuu: tuntuma on se, mitä harjoittelet."); return; }
    if (cents < 0) {
      setHint(`Matalalla (${Math.round(cents)} c)`, volVar !== null && volVar > 3
        ? "Voimakkuus vaihtelee. Sävel laskee usein, kun ilmavirta hiipuu. Kokeile pitää voimakkuus tasaisena koko sävelen ajan."
        : "Kuuntele kohdesävel uudelleen ja kuvittele se ennen kuin laulat. Hiljainen hyräily ennen sävelen aloitusta auttaa.");
    } else {
      setHint(`Korkealla (+${Math.round(cents)} c)`, "Kokeile laulaa hiukan hiljempaa: voimakkuuden kasvu nostaa usein sävelkorkeutta. Älä tavoittele säveltä ylhäältä puristamalla.");
    }
  }

  // --- Pääsilmukka ---
  function frame() {
    if (!listening) return;
    const t = now();
    const sr = ctx.sampleRate;
    analyser.getFloatTimeDomainData(timeBuf);
    analyser.getFloatFrequencyData(freqBuf);
    const rms = rmsOf(timeBuf);
    const db = 20 * Math.log10(Math.max(rms, 1e-6));
    const isMuted = muted(t);
    const f = rms > RMS_GATE && !isMuted ? yin(timeBuf, sr) : -1;
    const midi = f > 0 ? freqToMidi(f) : null;
    const hit = trackRun(t, midi, isMuted);
    hist.push({ t, midi, db, hit });
    while (hist.length && t - hist[0].t > HISTORY_S) hist.shift();
    mutes = mutes.filter(([, b]) => b > t);

    const b = run && !run.done ? currentBlock(t) : null;
    let cents = null;
    if (midi !== null) {
      const ref = b ? b.midi : Math.round(midi);
      cents = (midi - ref) * 100;
      el.note.textContent = noteName(Math.round(midi));
      el.hz.textContent = f.toFixed(1) + " Hz";
      const shown = Math.max(-50, Math.min(50, b ? cents : (midi - Math.round(midi)) * 100));
      el.dot.style.left = (50 + shown) + "%";
      el.dot.style.background = Math.abs(cents) <= tol() ? "var(--teal)" : "var(--gold)";
      el.centText.textContent = (cents > 0 ? "+" : "") + Math.round(cents) + " c" + (b ? " kohteesta" : " lähimmästä");
    } else {
      el.note.textContent = "--";
      el.hz.textContent = isMuted ? "referenssi soi" : "–";
      el.dot.style.left = "50%";
      el.dot.style.background = "var(--muted)";
      el.centText.textContent = "–";
    }

    el.target.textContent = b ? noteName(b.midi) : run && !run.done ? (nextBlock(t) ? "→ " + noteName(nextBlock(t).midi) : "–") : "vapaa";

    const st = stability(t);
    el.stab.textContent = st === null ? "–" : "±" + Math.round(st) + " c";
    const v = vibrato(t);
    if (!v) el.vib.textContent = "–";
    else if (v.extent < 15) el.vib.textContent = "suora";
    else if (v.rate >= 4 && v.rate <= 8) el.vib.textContent = v.rate.toFixed(1) + " Hz ±" + Math.round(v.extent) + " c";
    else el.vib.textContent = "epätasainen ±" + Math.round(v.extent) + " c";

    const volPct = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
    el.vol.style.width = volPct + "%";
    el.volText.textContent = rms > RMS_GATE ? Math.round(db) + " dBFS" : "hiljaista";
    const vv = volumeVar(t);
    el.volVar.textContent = vv === null ? "–" : "±" + vv.toFixed(1) + " dB";

    if (midi !== null) {
      const r = ringRatio(sr);
      ringEma = ringEma === null ? r : ringEma * 0.85 + r * 0.15;
    }
    if (ringEma !== null) {
      el.ring.style.width = Math.max(0, Math.min(100, (ringEma + 40) / 40 * 100)) + "%";
      el.ringText.textContent = ringEma.toFixed(0) + " dB";
    }

    if (run && !run.done) {
      if (b) coach(cents, b, vv);
      else {
        const nb = nextBlock(t);
        setHint(nb ? `Valmistaudu: ${noteName(nb.midi)}` : "…", "Hengitä tauon aikana. Kuule seuraava sävel mielessäsi ennen kuin aloitat.");
      }
      el.status.textContent = `${run.name}: ${Math.max(0, elapsed(t)).toFixed(1)} / ${run.end.toFixed(1)} s`;
    } else if (el.drill.value === "free") {
      setHint("Vapaa laulu", "Pidä yksi vokaali ja sävel muutaman sekunnin ajan, niin vakaus-, vibrato- ja kirkkauslukemat ehtivät laskea.");
    }

    drawPitch(t);
    drawSpectrum(sr);
    requestAnimationFrame(frame);
  }

  // --- Piirto ---
  function fitCanvas(c) {
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return { w, h, dpr };
  }

  function drawPitch(t) {
    const { w, h, dpr } = fitCanvas(el.pitch);
    pctx.clearRect(0, 0, w, h);
    let lo, hi;
    if (run) {
      const ms = run.blocks.map(b => b.midi);
      lo = Math.min(...ms) - 4; hi = Math.max(...ms) + 4;
      if (hi - lo < 14) { const m = (hi + lo) / 2; lo = m - 7; hi = m + 7; }
    } else {
      const recent = hist.filter(x => x.midi !== null && t - x.t < 2).map(x => x.midi);
      const target = recent.length ? median(recent) : base() + 5;
      freeCenter = freeCenter === null ? target : freeCenter + (target - freeCenter) * 0.03;
      lo = freeCenter - 8; hi = freeCenter + 8;
    }
    const y = m => h - (m - lo) / (hi - lo) * h;
    const playX = w * 0.4, pps = w / 9;

    pctx.font = `${11 * dpr}px ui-monospace, monospace`;
    for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) {
      const isC = ((m % 12) + 12) % 12 === 0;
      pctx.strokeStyle = isC ? "#2f4256" : "#18222f";
      pctx.lineWidth = dpr;
      pctx.beginPath(); pctx.moveTo(0, y(m)); pctx.lineTo(w, y(m)); pctx.stroke();
      pctx.fillStyle = isC ? "#9aaaba" : "#566577";
      pctx.fillText(noteName(m), 6 * dpr, y(m) - 3 * dpr);
    }

    if (run) {
      const e = elapsed(t);
      const band = Math.max(tol() / 100 / (hi - lo) * h, 3 * dpr);
      for (const b of run.blocks) {
        const x = playX + (b.start - e) * pps;
        const bw = (b.end - b.start) * pps;
        if (x > w || x + bw < 0) continue;
        const active = e >= b.start && e < b.end;
        pctx.fillStyle = active ? "rgba(103,216,178,.28)" : "rgba(98,196,255,.12)";
        pctx.strokeStyle = active ? "#67d8b2" : "#35506a";
        pctx.lineWidth = 1.5 * dpr;
        pctx.fillRect(x, y(b.midi) - band, bw, band * 2);
        pctx.strokeRect(x, y(b.midi) - band, bw, band * 2);
        pctx.fillStyle = "#eaf0f4";
        pctx.fillText(noteName(b.midi), x + 6 * dpr, y(b.midi) - band - 4 * dpr);
      }
      if (e < LEAD_IN) {
        pctx.fillStyle = "#f4c76b";
        pctx.font = `700 ${18 * dpr}px Inter, system-ui, sans-serif`;
        pctx.fillText("Valmistaudu…", playX + 12 * dpr, 28 * dpr);
        pctx.font = `${11 * dpr}px ui-monospace, monospace`;
      }
    } else if (el.drill.value !== "free") {
      pctx.fillStyle = "#9aaaba";
      pctx.font = `${15 * dpr}px Inter, system-ui, sans-serif`;
      pctx.fillText(listening ? "Paina ”Aloita harjoitus”" : "Avaa ensin mikrofoni", playX + 12 * dpr, 28 * dpr);
      pctx.font = `${11 * dpr}px ui-monospace, monospace`;
    }

    pctx.strokeStyle = "rgba(154,170,186,.4)";
    pctx.lineWidth = 1.5 * dpr;
    pctx.beginPath(); pctx.moveTo(playX, 0); pctx.lineTo(playX, h); pctx.stroke();

    pctx.lineWidth = 3 * dpr;
    pctx.lineCap = "round";
    for (let i = 1; i < hist.length; i++) {
      const a = hist[i - 1], c = hist[i];
      if (a.midi === null || c.midi === null || Math.abs(a.midi - c.midi) > 1.5) continue;
      pctx.strokeStyle = c.hit ? "#67d8b2" : "#62c4ff";
      pctx.beginPath();
      pctx.moveTo(playX - (t - a.t) * pps, y(a.midi));
      pctx.lineTo(playX - (t - c.t) * pps, y(c.midi));
      pctx.stroke();
    }
    const last = hist[hist.length - 1];
    if (last && last.midi !== null) {
      pctx.fillStyle = last.hit ? "#67d8b2" : "#62c4ff";
      pctx.beginPath(); pctx.arc(playX, y(last.midi), 6 * dpr, 0, Math.PI * 2); pctx.fill();
    }
  }

  function drawSpectrum(sr) {
    const { w, h, dpr } = fitCanvas(el.spec);
    sctx.clearRect(0, 0, w, h);
    const maxF = 5000, bin = sr / analyser.fftSize;
    const x = f => f / maxF * w;
    sctx.fillStyle = "rgba(185,156,255,.12)";
    sctx.fillRect(x(2000), 0, x(4000) - x(2000), h);
    sctx.fillStyle = "#b99cff";
    sctx.font = `${10 * dpr}px ui-monospace, monospace`;
    sctx.fillText("2–4 kHz", x(2000) + 5 * dpr, 13 * dpr);
    sctx.fillStyle = "#566577";
    for (const f of [1000, 2000, 3000, 4000]) sctx.fillText(f / 1000 + " kHz", x(f) + 3 * dpr, h - 4 * dpr);
    sctx.beginPath();
    sctx.moveTo(0, h);
    for (let i = 1; i * bin <= maxF && i < freqBuf.length; i++) {
      const v = Math.max(0, Math.min(1, (freqBuf[i] + 100) / 80));
      sctx.lineTo(x(i * bin), h - v * h);
    }
    sctx.lineTo(w, h);
    sctx.closePath();
    sctx.fillStyle = "rgba(98,196,255,.35)";
    sctx.strokeStyle = "#62c4ff";
    sctx.lineWidth = dpr;
    sctx.fill();
    sctx.stroke();
  }

  function updateZone() {
    const z = Math.min(50, tol());
    el.zone.style.left = (50 - z) + "%";
    el.zone.style.width = (2 * z) + "%";
  }
  updateZone();
  el.go.disabled = true;
  drawIdle();
  function drawIdle() {
    const { w, h, dpr } = fitCanvas(el.pitch);
    pctx.clearRect(0, 0, w, h);
    pctx.fillStyle = "#9aaaba";
    pctx.font = `${15 * dpr}px Inter, system-ui, sans-serif`;
    pctx.fillText("Avaa mikrofoni aloittaaksesi", 16 * dpr, 30 * dpr);
  }
})();
