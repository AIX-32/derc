
const AudioCtx = new (window.AudioContext || window.webkitAudioContext)();
let masterGain = AudioCtx.createGain();
masterGain.connect(AudioCtx.destination);
masterGain.gain.value = 0.5;
let previewGain = AudioCtx.createGain();
previewGain.gain.value = 0.15;
previewGain.connect(AudioCtx.destination);

const Synth = {
  playKick(time) {
    const osc = AudioCtx.createOscillator();
    const gain = AudioCtx.createGain();
    osc.connect(gain); gain.connect(masterGain);
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.3);
    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
    osc.start(time); osc.stop(time + 0.3);
  },
  playHat(time) {
    const osc = AudioCtx.createOscillator();
    const gain = AudioCtx.createGain();
    osc.type = 'square'; osc.connect(gain); gain.connect(masterGain);
    osc.frequency.setValueAtTime(8000, time);
    gain.gain.setValueAtTime(0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);
    osc.start(time); osc.stop(time + 0.05);
  }
};



const AudioCache = {};
async function getAudioBuffer(base64Data) {
  if (!base64Data) return null;
  const hash = base64Data.substring(0, 100);
  if (AudioCache[hash]) return AudioCache[hash];

  try {
    const res = await fetch(base64Data);
    const arr = await res.arrayBuffer();
    const buffer = await AudioCtx.decodeAudioData(arr);
    AudioCache[hash] = buffer;
    return buffer;
  } catch (e) {
    console.error("Audio Decode Error:", e);
    return null;
  }
}


function resizeImageFile(file, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 800; const MAX_HEIGHT = 600;
      let width = img.width, height = img.height;
      if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } }
      else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      callback(canvas.toDataURL('image/jpeg', 0.6));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

const DB = {
  async open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('DercMaps', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('maps', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async save(maps) {
    const db = await this.open();
    const tx = db.transaction('maps', 'readwrite');
    const store = tx.objectStore('maps');
    store.clear();
    for (let m of maps) {
      store.put({
        id: m.metadata.title + '_' + Date.now(),
        metadata: {
          title: m.metadata.title,
          artist: m.metadata.artist,
          bpm: m.metadata.bpm,
          difficulty: m.metadata.difficulty,
          imageData: m.metadata.imageData || '',
          audioData: m.metadata.audioData || '',
        },
        notes: m.notes,
        breaks: m.breaks || [],
        drops: m.drops || [],
      });
    }
    return new Promise(r => { tx.oncomplete = () => r(); tx.onerror = () => r(); });
  },
  async load() {
    const db = await this.open();
    const tx = db.transaction('maps', 'readonly');
    const store = tx.objectStore('maps');
    return new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve([]);
    });
  },
};

function showLoading() { let el = document.getElementById('loading-overlay'); el.style.display = 'flex'; requestAnimationFrame(() => el.style.opacity = '1'); }
function hideLoading() { let el = document.getElementById('loading-overlay'); el.style.opacity = '0'; setTimeout(() => el.style.display = 'none', 300); }

function dataUriToBlobUrl(dataUri) {
  if (!dataUri || typeof dataUri !== 'string' || !dataUri.startsWith('data:')) return '';
  let mime = dataUri.split(';')[0].split(':')[1];
  let raw = atob(dataUri.split(',')[1]);
  let arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return URL.createObjectURL(new Blob([arr], { type: mime }));
}

let _volume = 50, _volVelocity = 0, _volTimeout = null, _volAnimId = null;
const _volCanvas = document.getElementById('volume-canvas');
const _volCtx = _volCanvas.getContext('2d');

function drawVolume(v) {
  let c = _volCanvas, ctx = _volCtx, s = 100, ox = (c.width - s) / 2, oy = (c.height - s) / 2;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 4;
  ctx.strokeRect(ox, oy, s, s);
  ctx.strokeStyle = '#fff';
  let perim = s * 4, lit = (v / 100) * perim;
  ctx.beginPath();
  if (lit > 0) { let t = Math.min(lit, s); ctx.moveTo(ox, oy); ctx.lineTo(ox + t, oy); lit -= s; }
  if (lit > 0) { let t = Math.min(lit, s); ctx.moveTo(ox + s, oy); ctx.lineTo(ox + s, oy + t); lit -= s; }
  if (lit > 0) { let t = Math.min(lit, s); ctx.moveTo(ox + s, oy + s); ctx.lineTo(ox + s - t, oy + s); lit -= s; }
  if (lit > 0) { let t = Math.min(lit, s); ctx.moveTo(ox, oy + s); ctx.lineTo(ox, oy + s - t); }
  ctx.stroke();
  document.getElementById('volume-label').textContent = Math.round(v);
}

function volTick() {
  if (Math.abs(_volVelocity) < 0.05) { _volVelocity = 0; _volAnimId = null; _volTimeout = setTimeout(() => document.getElementById('volume-popup').classList.remove('show'), 300); return; }
  _volume = Math.max(0, Math.min(100, _volume + _volVelocity));
  _volVelocity *= 0.9;
  masterGain.gain.setValueAtTime(_volume / 100, AudioCtx.currentTime);
  previewGain.gain.value = 0.3 * (_volume / 100);
  drawVolume(_volume);
  document.getElementById('volume-popup').classList.add('show');
  _volAnimId = requestAnimationFrame(volTick);
}

window.addEventListener('wheel', (e) => {
  if (e.target.closest('#scrollContainer')) return;
  e.preventDefault();
  _volVelocity += -e.deltaY / 100;
  clearTimeout(_volTimeout);
  if (!_volAnimId) _volAnimId = requestAnimationFrame(volTick);
}, { passive: false });


const App = {
  view: 'select',
  maps: [],
  cards: [],
  activeMapIndex: 0,
  beatTimer: null,
  beatTimeout: null,
  previewSource: null,
  _previewing: false, _previewingIdx: -1, _userSelected: false,
  _searchQuery: '', _sortBy: 'bpm', _visibleIdx: [], _minDiff: 1, _rebuildTimer: null,
  _defaultTitles: new Set(['Looping the rooms', 'R.I.P', 'Break the Hierarchie', 'Zero talking']),
  modes: { auto: false, fail: false, hc: false, mirror: false, sd: false },

  async init() {
    showLoading();
    this.maps = [];
    let stored = await DB.load();
    if (stored.length) {
      let promises = [];
      for (let raw of stored) {
        if (!raw.metadata || !raw.notes) continue;
        raw.metadata.imageBlob = dataUriToBlobUrl(raw.metadata.imageData) || raw.metadata.imageData || '';
        raw.metadata.audioBlob = dataUriToBlobUrl(raw.metadata.audioData) || raw.metadata.audioData || '';
        let d = parseInt(raw.metadata.difficulty);
        raw.metadata.difficulty = (d >= 1 && d <= 13) ? d : 4;
        promises.push(getAudioBuffer(raw.metadata.audioBlob || raw.metadata.audioData).then(buf => { raw._audioBuffer = buf; this.maps.push(raw); }));
      }
      await Promise.all(promises);
    } else {
      let promises = [];
      for (let name of ['Looping_the_rooms.dcm', 'R.I.P.dcm', 'Break_the_Hierarchie.dcm', 'Zero_talking.dcm']) {
        promises.push((async () => {
          try {
            let res = await fetch(name);
            let raw = await res.json();
            if (raw.notes && raw.metadata) {
              raw.metadata.imageBlob = dataUriToBlobUrl(raw.metadata.imageData) || raw.metadata.imageData;
              raw.metadata.audioBlob = dataUriToBlobUrl(raw.metadata.audioData) || raw.metadata.audioData;
              let d = parseInt(raw.metadata.difficulty);
              raw.metadata.difficulty = (d >= 1 && d <= 13) ? d : 4;
              raw._audioBuffer = await getAudioBuffer(raw.metadata.audioBlob || raw.metadata.audioData);
              this.maps.push(raw);
            }
          } catch (e) { }
        })());
      }
      await Promise.all(promises);
    }
    if (!this.maps.length) this.maps.push({ metadata: { title: "No Map", artist: "", bpm: 120, difficulty: 1 }, notes: [] });
    await DB.save(this.maps);
    hideLoading();
    this.buildMapUI();
    this.bindEvents();
    let ds = document.getElementById('diff-slider');
    if (ds) { ds.style.backgroundImage = 'linear-gradient(to right, #fff 0%, #fff 0.5px, transparent 0.5px)'; }
    this.startUIPulse(this.maps[0].metadata.bpm);
    document.getElementById('play-btn').classList.add('show');
    requestAnimationFrame(() => this.updateStepping());
  },

  setView(v) {
    this.view = v;
    const ui = document.getElementById('ui-layer');

    if (v === 'game') {
      this.stopPreview();
      document.getElementById('play-btn').classList.remove('show');
      ui.classList.add('exiting');
      ui.style.pointerEvents = 'none';

      document.getElementById('game-layer').style.display = 'block';
      document.getElementById('game-layer').style.opacity = '0';

      document.getElementById('editor-layer').style.display = 'none';
      document.getElementById('game-back').style.display = 'block';

      setTimeout(() => {
        document.getElementById('game-layer').style.opacity = '1';
      }, 450);
    } else {
      ui.classList.remove('exiting');
      ui.style.opacity = v === 'select' ? '1' : '0';
      ui.style.pointerEvents = v === 'select' ? 'auto' : 'none';

      document.getElementById('game-layer').style.display = 'none';
      document.getElementById('game-layer').style.opacity = '0';

      document.getElementById('editor-layer').style.display = v === 'editor' ? 'flex' : 'none';
      document.getElementById('game-back').style.display = 'none';

      if (v !== 'game' && Game.isPlaying) this.exitGame();
      if (v === 'editor') Editor.init({ metadata: { title: '', artist: '', bpm: 120, difficulty: 1 }, notes: [] });
      if (v === 'select') {
        this.hideEndScreen();
        this.buildMapUI();
        this.startUIPulse(this.maps[this.activeMapIndex].metadata.bpm);
        document.getElementById('play-btn').classList.add('show');
        this.onSelectionChange(this.activeMapIndex);
      } else {
        this.stopUIPulse();
        this.stopPreview();
        document.getElementById('play-btn').classList.remove('show');
        this.hideEndScreen();
      }
    }
  },

  filterMaps() {
    let q = this._searchQuery.toLowerCase();
    let minD = this._minDiff || 1;
    let idxs = this.maps.map((_, i) => i).filter(i => {
      let m = this.maps[i];
      if ((m.metadata.difficulty || 1) < minD) return false;
      return !q || m.metadata.title.toLowerCase().includes(q) || (m.metadata.artist || '').toLowerCase().includes(q);
    });
    idxs.sort((a, b) => {
      let ma = this.maps[a], mb = this.maps[b];
      if (this._sortBy === 'title') return ma.metadata.title.localeCompare(mb.metadata.title);
      if (this._sortBy === 'diff') return (ma.metadata.difficulty || 1) - (mb.metadata.difficulty || 1);
      return (ma.metadata.bpm || 120) - (mb.metadata.bpm || 120);
    });
    this._visibleIdx = idxs;
  },

  buildMapUI() {
    if (this._rebuildTimer) clearTimeout(this._rebuildTimer);
    const wrap = document.getElementById('cardsWrapper');
    const oldCards = wrap.querySelectorAll('.card:not(.entering)');
    if (oldCards.length > 0) {
      oldCards.forEach(c => c.classList.add('exiting'));
      this._rebuildTimer = setTimeout(() => {
        this._rebuildTimer = null;
        this._doBuildUI();
      }, 200);
      return;
    }
    this._doBuildUI();
  },

  _doBuildUI() {
    if (this._rebuildTimer) { clearTimeout(this._rebuildTimer); this._rebuildTimer = null; }
    this.filterMaps();
    const wrap = document.getElementById('cardsWrapper');
    wrap.innerHTML = '';
    this.cards = [];
    this._visibleIdx.forEach((i) => {
      let m = this.maps[i];
      let d2 = parseInt(m.metadata.difficulty);
      m.metadata.difficulty = (d2 >= 1 && d2 <= 13) ? d2 : 4;
      let card = document.createElement('div');
      card.className = `card ${i === this.activeMapIndex ? 'active' : ''}`;
      card.dataset.index = i;

      let imgSrc = m.metadata.imageBlob || m.metadata.imageData || '';

      let rating = m.metadata.difficulty || 1;
      let pds = '';
      for (let j = 0; j < rating; j++) pds += '<img src="PD.png" alt="PD">';
      card.innerHTML = `
    <img class="card-image" src="${imgSrc}" alt="">
    <div class="card-flash"></div>
    <div class="card-overlay"></div>
    <div class="card-artist">${m.metadata.artist}</div>
    <div class="card-title">${m.metadata.title}</div>
    <div class="card-meta"><span class="card-badge">${pds}</span><span class="card-badge">${m.metadata.bpm} BPM</span><span class="card-badge">${m._audioBuffer ? Math.floor(m._audioBuffer.duration / 60) + ':' + String(Math.floor(m._audioBuffer.duration % 60)).padStart(2, '0') : '?:??'}</span>${['Break the Hierarchie', 'R.I.P', 'Looping the rooms'].includes(m.metadata.title) ? '<span class="card-badge extra">v0.2</span>' : ''}</div>
  `;
      card.onclick = () => this.selectMap(i);
      card.ondblclick = () => this.playSelected();
      card.oncontextmenu = (e) => { e.preventDefault(); this.showCtxMenu(e, i); };
      wrap.appendChild(card);
      this.cards.push(card);
      card.classList.add('entering');
      card.addEventListener('animationend', () => card.classList.remove('entering'), { once: true });
    });
    this.updateStepping();
  },

  updateStepping() {
    if (this.view !== 'select') return;
    const container = document.getElementById('scrollContainer');
    const centerY = container.getBoundingClientRect().height / 2;
    let minDist = Infinity, closestIdx = 0;

    this.cards.forEach((card, i) => {
      const rect = card.getBoundingClientRect();
      const cardCenter = rect.top + rect.height / 2;
      const dist = Math.abs(cardCenter - centerY);
      if (dist < minDist) { minDist = dist; closestIdx = i; }
    });

    this.cards.forEach((card, i) => {
      let realIdx = this._visibleIdx[i] ?? i;
      card.classList.toggle('active', realIdx === this.activeMapIndex);
    });
    let top = container.scrollTop;
    if (top === this._lastTop) this._topStable = (this._topStable || 0) + 1;
    else { this._topStable = 0; this._lastTop = top; }
    let closestReal = this._visibleIdx[closestIdx] ?? closestIdx;
    if (this.activeMapIndex !== closestReal && this._topStable >= 3 && !this._userSelected) {
      this.activeMapIndex = closestReal;
      this.onSelectionChange(closestReal);
    }
  },


  startUIPulse(bpm) {
    this.stopUIPulse();
    let interval = 60000 / bpm;
    this.beatTimer = setInterval(() => this.triggerBeat(), interval);
  },
  stopUIPulse() {
    if (this.beatTimer) clearInterval(this.beatTimer);
    if (this.beatTimeout) clearTimeout(this.beatTimeout);
  },
  triggerBeat() {
    if (this.view !== 'select') return;
    const activeCard = document.querySelector('.card.active');
    if (!activeCard) return;


    activeCard.style.setProperty('--beat-offset', '-12px');
    let flash = activeCard.querySelector('.card-flash');
    if (flash) {
      flash.style.transition = 'none';
      flash.style.opacity = '0.05';
      flash.offsetHeight;
      flash.style.transition = 'opacity 0.35s ease-out';
    }


    let btn = document.getElementById('play-btn');
    btn.style.transform = 'rotate(-4deg) translateX(-3%)';
    document.querySelector('.menu-box').classList.add('beat');
    let slider = document.getElementById('diff-slider');
    slider.style.transition = 'background-color 0.05s ease-out';
    slider.style.backgroundColor = '#3a3a3a';
    requestAnimationFrame(() => { slider.style.transition = ''; });

    if (this.beatTimeout) clearTimeout(this.beatTimeout);


    this.beatTimeout = setTimeout(() => {
      if (activeCard) {
        activeCard.style.setProperty('--beat-offset', '0px');

        let flash = activeCard.querySelector('.card-flash');
        if (flash) flash.style.opacity = '0';
      }
      btn.style.transform = '';
      document.querySelector('.menu-box').classList.remove('beat');
      slider.style.backgroundColor = '';
    }, 120);
  },

  async startGame(mapObj) {
    if (AudioCtx.state === 'suspended') await AudioCtx.resume();
    this.stopPreview();
    Editor.playerStop();
    this.setView('game');
    Game.start(mapObj);
  },
  exitGame() { Game.stop(); this.hideEndScreen(); this.setView('select'); },
  gradeFor(p) {
    if (p >= 95) return 'Z';
    if (p >= 85) return 'A';
    if (p >= 75) return 'B';
    if (p >= 60) return 'C';
    return 'D';
  },
  showEndScreen(g, failed) {
    Game.stop();
    let el = document.getElementById('end-screen');
    el.style.borderColor = failed ? '#800' : '#333';
    document.getElementById('end-title').textContent = failed ? 'YOU DIED' : 'YOU WIN';
    document.getElementById('end-grade').textContent = failed ? 'F' : this.gradeFor(g.totalNotes === 0 ? 100 : Math.max(0, (g.hits / g.notes.filter(n => n.hit || n.missed).length) * 100));
    document.getElementById('end-score').textContent = g.score;
    document.getElementById('end-acc').textContent = (g.totalNotes === 0 ? 100 : Math.max(0, (g.hits / g.notes.filter(n => n.hit || n.missed).length) * 100)).toFixed(1) + '%';
    document.getElementById('end-combo').textContent = 'x' + g.bestCombo;
    document.getElementById('end-share').style.display = !failed && g.map && !this._defaultTitles.has(g.map.metadata.title) ? 'inline-block' : 'none';
    document.getElementById('end-overlay').style.display = 'block';
    el.style.display = 'block';
    requestAnimationFrame(() => { document.getElementById('end-overlay').style.opacity = '1'; el.style.opacity = '1'; });
    if (!failed) {
      let key = g.map.metadata.title + '_scores';
      let scores = JSON.parse(localStorage.getItem(key) || '[]');
      let now = new Date();
      let timeStr = now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      let modeStr = Object.entries(App.modes).filter(([_, v]) => v).map(([k]) => k.toUpperCase()).join(' ');
      scores.push({ score: g.score, acc: (g.totalNotes === 0 ? 100 : Math.max(0, (g.hits / g.notes.filter(n => n.hit || n.missed).length) * 100)), combo: g.bestCombo, grade: this.gradeFor(g.totalNotes === 0 ? 100 : Math.max(0, (g.hits / g.notes.filter(n => n.hit || n.missed).length) * 100)), time: timeStr, modes: modeStr });
      scores.sort((a, b) => b.score - a.score);
      if (scores.length > 10) scores = scores.slice(0, 10);
      localStorage.setItem(key, JSON.stringify(scores));
      this.updateScoreSidebar(g.map.metadata.title);
    }
  },

  selectMap(i) {
    if (this.activeMapIndex === i) return;
    this._userSelected = true;
    this.activeMapIndex = i;
    this.onSelectionChange(i);
    let card = this.cards[i];
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.updateStepping();
    setTimeout(() => this._userSelected = false, 500);
  },

  onSelectionChange(i) {
    let map = this.maps[i];
    if (!map) return;
    const bg = document.getElementById('bg-blur');
    const flash = document.getElementById('bg-flash');
    flash.style.opacity = '0.5';
    setTimeout(() => {
      bg.src = map.metadata.imageBlob || map.metadata.imageData || '';
      flash.style.opacity = '0';
    }, 80);
    this.startUIPulse(map.metadata.bpm);
    this.updateScoreSidebar(map.metadata.title);
    document.getElementById('play-btn').classList.add('show');
    if (i !== this._previewingIdx) this.startPreview(i);
  },

  stopPreview() {
    this._previewing = false;
    this._previewingIdx = -1;
    if (this.previewSource) {
      try { this.previewSource.stop(); } catch (e) { }
      this.previewSource.disconnect();
      this.previewSource = null;
    }
    if (this._previewS2) {
      try { this._previewS2.stop(); } catch (e) { }
      this._previewS2.disconnect();
      this._previewS2 = null;
    }
    PreviewConfetti.stop();
  },

  async startPreview(i) {
    if (i !== this.activeMapIndex) return;
    if (Game.isPlaying) Game.stop();
    Editor.playerStop();
    this.stopPreview();
    let map = this.maps[i];
    if (!map || !(map.metadata.audioBlob || map.metadata.audioData)) return;
    this._previewingIdx = i;
    this._previewing = true;
    let buffer = map._audioBuffer;
    if (!buffer || i !== this.activeMapIndex || this.view !== 'select') { this._previewing = false; return; }
    let start = buffer.duration * 0.5;
    if (map.drops && map.drops.length) start = map.drops[0].time;
    let _previewOffset = start;
    this.previewSource = AudioCtx.createBufferSource();
    this.previewSource.buffer = buffer;
    this.previewSource.connect(previewGain);
    this.previewSource.start(0, start);
    let remaining = buffer.duration - start;
    this._previewS2 = AudioCtx.createBufferSource();
    this._previewS2.buffer = buffer; this._previewS2.connect(previewGain);
    this._previewS2.start(remaining > 0 ? remaining : 0, start);
    PreviewConfetti.start(map.drops, AudioCtx.currentTime, _previewOffset);
  },

  playSelected() {
    let map = this.maps[this.activeMapIndex];
    if (map) this.startGame(map);
  },

  toggleMode(key) {
    this.modes[key] = !this.modes[key];
    document.getElementById('mode-' + key).classList.toggle('active', this.modes[key]);
    this.updateModeHUD();
  },

  updateModeHUD() {
    let active = Object.entries(this.modes).filter(([_, v]) => v).map(([k]) => k.toUpperCase()).join(' | ');
    document.getElementById('hud-modes').textContent = active || '';
  },

  bindEvents() {
    const container = document.getElementById('scrollContainer');
    container.addEventListener('scroll', () => requestAnimationFrame(() => this.updateStepping()), { passive: true });

    window.addEventListener('resize', () => this.updateStepping(), { passive: true });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.view === 'game') this.exitGame();
        if (this.view === 'editor') this.setView('select');
      }
      if (this.view === 'select') {
        if (e.key === 'ArrowUp') { let idx = this._visibleIdx.indexOf(this.activeMapIndex); if (idx > 0) this.selectMap(this._visibleIdx[idx - 1]); }
        if (e.key === 'ArrowDown') { let idx = this._visibleIdx.indexOf(this.activeMapIndex); if (idx < this._visibleIdx.length - 1) this.selectMap(this._visibleIdx[idx + 1]); }
        if (e.key === 'ArrowRight') this.playSelected();
      }
      if (this.view === 'game') {
        if (e.key === 'Escape') { Game.togglePause(); return; }
        if (e.key === '0') { Game.ended = true; setTimeout(() => App.showEndScreen(Game), 500); return; }
        if (Game.paused) return;
        Game.handleInput(e.key.toLowerCase());
      }
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#ctx-menu')) this.hideCtxMenu(); });
    document.getElementById('ctx-save').onclick = () => { this.saveMapAsFile(parseInt(document.getElementById('ctx-menu').dataset.idx)); this.hideCtxMenu(); };
    document.getElementById('ctx-delete').onclick = () => { this.deleteMap(parseInt(document.getElementById('ctx-menu').dataset.idx)); this.hideCtxMenu(); };

    document.getElementById('search-input').oninput = () => { this._searchQuery = document.getElementById('search-input').value; this.buildMapUI(); };
    document.getElementById('sort-select').onchange = () => { this._sortBy = document.getElementById('sort-select').value; this.buildMapUI(); };
    document.getElementById('diff-slider').oninput = function () {
      let val = parseInt(this.value);
      let pct = ((val - 1) / 12) * 100;
      this.style.backgroundImage = `linear-gradient(to right, #fff ${pct}%, #fff calc(${pct}% + 0.5px), transparent calc(${pct}% + 0.5px))`;
      document.getElementById('diff-num').textContent = val;
      App._minDiff = val;
      App.buildMapUI();
    };

    let _cs = document.createElement('style'); _cs.id = '_cs'; document.head.appendChild(_cs);
    document.addEventListener('mousedown', () => _cs.textContent = '* { cursor: url("cursor-small.png") 0 0, auto !important; }');
    document.addEventListener('mouseup', () => _cs.textContent = '');
    window.addEventListener('mousemove', (e) => {
      if (this.view !== 'select') return;
      let x = (e.clientX / window.innerWidth - 0.5) * 20;
      let y = (e.clientY / window.innerHeight - 0.5) * 20;
      document.getElementById('bg-blur').style.transform = `translate(${x}px, ${y}px)`;
    });
    document.getElementById('play-btn').onclick = () => this.playSelected();
    document.getElementById('mode-auto').onclick = () => this.toggleMode('auto');
    document.getElementById('mode-fail').onclick = () => this.toggleMode('fail');
    document.getElementById('mode-hc').onclick = () => this.toggleMode('hc');
    document.getElementById('mode-mirror').onclick = () => this.toggleMode('mirror');
    document.getElementById('mode-sd').onclick = () => this.toggleMode('sd');
    document.getElementById('end-back').onclick = () => { this.hideEndScreen(); this.setView('select'); };
    document.getElementById('end-restart').onclick = () => { this.hideEndScreen(); this.playSelected(); };
    document.getElementById('end-share').onclick = () => {
      let m = Game.map;
      if (!m || App._defaultTitles.has(m.metadata.title)) return;
      let data = {
        metadata: { title: m.metadata.title, artist: m.metadata.artist, bpm: m.metadata.bpm, difficulty: m.metadata.difficulty, imageData: m.metadata.imageData || '', audioData: m.metadata.audioData || '' },
        notes: m.notes, breaks: m.breaks || [], drops: m.drops || [],
      };
      const a = document.createElement('a'); a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data));
      a.download = `${m.metadata.title.replace(/\s+/g, '_')}.dcm`; a.click();
    };
    document.getElementById('end-overlay').onclick = () => { this.hideEndScreen(); this.setView('select'); };
    document.getElementById('pause-resume').onclick = () => Game.togglePause();
    document.getElementById('pause-restart').onclick = () => { Game.togglePause(); App.playSelected(); };
    document.getElementById('pause-quit').onclick = () => { document.getElementById('pause-overlay').classList.remove('show'); App.exitGame(); };
  },
  hideEndScreen() {
    document.getElementById('end-screen').style.display = 'none';
    document.getElementById('end-overlay').style.display = 'none';
    document.getElementById('end-screen').style.opacity = '0';
    document.getElementById('end-overlay').style.opacity = '0';
  },
  updateScoreSidebar(mapTitle) {
    let el = document.getElementById('score-list');
    let key = mapTitle + '_scores';
    let scores = JSON.parse(localStorage.getItem(key) || '[]');
    if (!scores.length) { el.innerHTML = '<div class="score-entry" style="color:#555;font-size:0.7rem;border:none;">No scores yet</div>'; return; }
    el.innerHTML = scores.map(s => `<div class="score-entry"><div class="s-top"><span class="g">${s.grade}</span><span class="s-score">${s.score}</span></div><div class="s-time">${s.time || ''}${s.modes ? ' <span style="color:#666">' + s.modes + '</span>' : ''}</div></div>`).join('');
    document.getElementById('score-panel').style.display = 'block';
  },

  openImportModal() {
    document.getElementById('import-modal').classList.add('show');
  },
  closeImportModal() {
    document.getElementById('import-modal').classList.remove('show');
  },

  openPlaylistModal() {
    this.buildPlaylistUI();
    document.getElementById('playlist-modal').classList.add('show');
  },
  closePlaylistModal() {
    document.getElementById('playlist-modal').classList.remove('show');
  },

  buildPlaylistUI() {
    let el = document.getElementById('pl-map-list');
    if (!this.maps.length) { el.innerHTML = '<div style="color:#555;font-size:0.7rem;padding:12px;">No maps available</div>'; return; }
    el.innerHTML = this.maps.map((m, i) => {
      let dur = m._audioBuffer ? Math.floor(m._audioBuffer.duration / 60) + ':' + String(Math.floor(m._audioBuffer.duration % 60)).padStart(2, '0') : '?:??';
      return `<label class="pl-map-item"><input type="checkbox" data-idx="${i}" checked><div class="pl-info"><div class="pl-title">${m.metadata.title}</div><div class="pl-artist">${m.metadata.artist || ''}</div></div><div class="pl-dur">${dur}</div></label>`;
    }).join('');
  },

  exportPlaylist() {
    let checks = document.querySelectorAll('#pl-map-list input[type="checkbox"]');
    let selected = [];
    checks.forEach(c => { if (c.checked) selected.push(this.maps[parseInt(c.dataset.idx)]); });
    if (!selected.length) { alert('Select at least one map.'); return; }
    let bundle = selected.map(m => ({
      metadata: { title: m.metadata.title, artist: m.metadata.artist, bpm: m.metadata.bpm, difficulty: m.metadata.difficulty, imageData: m.metadata.imageData || '', audioData: m.metadata.audioData || '' },
      notes: m.notes,
      breaks: m.breaks || [],
      drops: m.drops || [],
    }));
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(bundle));
    const a = document.createElement('a'); a.href = dataStr;
    a.download = 'bundle.dcpl'; a.click();
  },

  async importPlaylist(e) {
    const file = e.target.files[0]; if (!file) return;
    try {
      let bundle = JSON.parse(await file.text());
      if (!Array.isArray(bundle) || !bundle.length) { alert('Invalid .dcpl file'); return; }
      showLoading();
      for (let raw of bundle) {
        if (!raw.notes || !raw.metadata) continue;
        raw.metadata.imageBlob = dataUriToBlobUrl(raw.metadata.imageData) || raw.metadata.imageData || '';
        raw.metadata.audioBlob = dataUriToBlobUrl(raw.metadata.audioData) || raw.metadata.audioData || '';
        raw.metadata.difficulty = Math.max(1, Math.min(13, parseInt(raw.metadata.difficulty) || 1));
        raw._audioBuffer = await getAudioBuffer(raw.metadata.audioBlob || raw.metadata.audioData);
        this.maps.push(raw);
      }
      await DB.save(this.maps);
      hideLoading();
      this.buildMapUI();
      e.target.value = '';
      alert(`Imported ${bundle.length} maps.`);
    } catch (err) { hideLoading(); alert('Failed to load bundle'); }
  },

  async importMapFile(e) {
    const file = e.target.files[0]; if (!file) return;
    this.closeImportModal();
    try {
      let raw = JSON.parse(await file.text());
      if (!raw.notes || !raw.metadata) { alert('Invalid .dcm file'); return; }
      raw.metadata.imageBlob = dataUriToBlobUrl(raw.metadata.imageData) || raw.metadata.imageData || '';
      raw.metadata.audioBlob = dataUriToBlobUrl(raw.metadata.audioData) || raw.metadata.audioData || '';
      raw.metadata.difficulty = Math.max(1, Math.min(13, parseInt(raw.metadata.difficulty) || 1));
      raw._audioBuffer = await getAudioBuffer(raw.metadata.audioBlob || raw.metadata.audioData);
      this.maps.push(raw);
      await DB.save(this.maps);
      this.buildMapUI();
      e.target.value = '';
    } catch (err) { alert('Failed to load map'); }
  },

  showCtxMenu(e, idx) {
    const menu = document.getElementById('ctx-menu');
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.dataset.idx = idx;
    menu.classList.add('show');
  },
  hideCtxMenu() {
    document.getElementById('ctx-menu').classList.remove('show');
  },

  deleteMap(idx) {
    this.maps.splice(idx, 1);
    if (this.activeMapIndex >= this.maps.length) this.activeMapIndex = Math.max(0, this.maps.length - 1);
    DB.save(this.maps);
    this.buildMapUI();
    this.stopPreview();
  },

  saveMapAsFile(idx) {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.maps[idx]));
    const a = document.createElement('a'); a.href = dataStr;
    a.download = `${this.maps[idx].metadata.title.replace(/\s+/g, '_')}.dcm`; a.click();
  },
};


const Game = {
  canvas: document.getElementById('gameCanvas'),
  ctx: document.getElementById('gameCanvas').getContext('2d'),
  isPlaying: false, map: null, startTime: 0, notes: [], breaks: [], inBreak: false, drops: [], _dropsTriggered: [], _nextNoteIdx: 0, particles: [],
  score: 0, combo: 0, bestCombo: 0, hits: 0, totalNotes: 0, health: 100,
  windows: { perfect: 0.040, good: 0.080, okay: 0.120 },
  approachTime: 1.5,
  audioSource: null, rafId: null, ended: false, paused: false,
  timeScale: 1,
  _judgedCount: 0,

  async start(mapObj) {
    this.resize();
    window.addEventListener('resize', this.resize.bind(this));
    this.map = JSON.parse(JSON.stringify(mapObj));
    this.notes = [...this.map.notes].sort((a, b) => a.time - b.time);
    this._judgedCount = 0;
    this._nextNoteIdx = 0;
    this.approachTime = Math.max(0.6, 2.2 - (this.map.metadata.difficulty || 1) * 0.12);
    this.timeScale = App.modes.hc ? 2 : 1;
    this.breaks = this.map.breaks || [];
    this.drops = this.map.drops || [];
    this._dropsTriggered = new Array(this.drops.length).fill(false);
    this.inBreak = false;
    this.totalNotes = this.notes.length;
    this.score = 0; this.combo = 0; this.bestCombo = 0; this.hits = 0; this.health = 100; this.particles = []; this.ended = false; this.paused = false;
    if (App.modes.mirror) {
      this.notes.forEach(n => {
        if (n.position === 'left') n.position = 'right';
        else if (n.position === 'right') n.position = 'left';
      });
      document.querySelector('.key-hints').innerHTML = '<span>W</span> TOP &nbsp; <span>D</span> LEFT &nbsp; <span>S</span> BOTTOM &nbsp; <span>A</span> RIGHT';
    }
    this.updateHUD();
    document.getElementById('pause-overlay').classList.remove('show');

    if (this.map.metadata.imageBlob || this.map.metadata.imageData) document.getElementById('game-bg').src = this.map.metadata.imageBlob || this.map.metadata.imageData;


    let buffer = await getAudioBuffer(this.map.metadata.audioBlob || this.map.metadata.audioData);

    this.startTime = AudioCtx.currentTime + 1.0;
    this.isPlaying = true;

    if (buffer) {
      this.map._audioBuffer = buffer;
      this.audioSource = AudioCtx.createBufferSource();
      this.audioSource.buffer = buffer;
      this.audioSource.playbackRate.value = this.timeScale;
      this.audioSource.connect(masterGain);
      this.audioSource.start(this.startTime);
    }

    this.loop();
  },

  stop() {
    this.isPlaying = false;
    cancelAnimationFrame(this.rafId);
    if (this.audioSource) { this.audioSource.stop(); this.audioSource.disconnect(); this.audioSource = null; }
    masterGain.gain.setValueAtTime(0, AudioCtx.currentTime);
    setTimeout(() => masterGain.gain.setValueAtTime(0.5, AudioCtx.currentTime), 100);
    document.querySelector('.key-hints').innerHTML = '<span>W</span> TOP &nbsp; <span>A</span> LEFT &nbsp; <span>S</span> BOTTOM &nbsp; <span>D</span> RIGHT';
  },

  resize() {
    this.canvas.width = window.innerWidth; this.canvas.height = window.innerHeight;
    this.cx = this.canvas.width / 2; this.cy = this.canvas.height / 2;
  },

  handleInput(key) {
    if (!this.isPlaying || this.ended || this.inBreak) return;
    const mapKeys = { 'w': 'top', 's': 'bottom', 'a': 'left', 'd': 'right' };
    const pos = mapKeys[key];
    if (!pos) return;

    let timeNow = (AudioCtx.currentTime - this.startTime) * this.timeScale;
    let targetNote = null, targetIdx = -1;
    for (let i = 0; i < this.notes.length; i++) {
      let n = this.notes[i];
      if (!n.hit && !n.missed && n.position === pos && Math.abs(n.time - timeNow) < this.windows.okay) {
        targetNote = n; targetIdx = i; break;
      }
    }

    this.spawnHitRing(pos);

    if (targetNote) {
      let diff = Math.abs(targetNote.time - timeNow);
      targetNote.hit = true;
      if (diff <= this.windows.perfect) this.registerHit(300, pos);
      else if (diff <= this.windows.good) this.registerHit(200, pos);
      else this.registerHit(100, pos);
    }
  },

  registerHit(points, pos) {
    this.score += points + (this.combo * 10); this.combo++;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    this.hits += (points / 300);
    this._judgedCount++;
    if (points === 300) this.health = Math.min(100, this.health + 5);
    else if (points === 200) this.health = Math.min(100, this.health + 3);
    else this.health = Math.max(0, this.health - 2);
    this.updateHUD();
    this.spawnParticles(pos, points === 300 ? '#fff' : (points === 200 ? '#aaa' : '#555'));
    this.spawnText(points.toString(), points === 300 ? '#fff' : '#aaa');
  },
  registerMiss() {
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    this.combo = 0;
    this.health = Math.max(0, this.health - 18);
    this._judgedCount++;
    this.updateHUD(); this.spawnText("MISS", "#f33");
    if (this.health <= 0 && !App.modes.fail) this.die();
    if (App.modes.fail) this.health = 1;
    if (App.modes.sd) { this.die(); return; }
  },
  die() {
    this.ended = true;
    this.isPlaying = false;
    cancelAnimationFrame(this.rafId);
    if (this.audioSource) {
      masterGain.gain.linearRampToValueAtTime(0, AudioCtx.currentTime + 1);
      setTimeout(() => { try { this.audioSource.stop(); this.audioSource.disconnect(); } catch (e) { } this.audioSource = null; }, 1100);
    }
    setTimeout(() => {
      masterGain.gain.setValueAtTime(0.5, AudioCtx.currentTime);
      App.showEndScreen(this, true);
    }, 500);
  },
  updateHUD() {
    document.getElementById('hud-score').innerText = this.score.toString().padStart(6, '0');
    document.getElementById('hud-combo').innerText = 'x' + this.combo;
    let denom = this.notes.filter(n => n.hit || n.missed).length;
    let acc = denom === 0 ? 100 : Math.max(0, (this.hits / denom) * 100);
    document.getElementById('hud-acc').innerText = (acc || 100).toFixed(1) + '%';
    let hp = document.getElementById('hud-health');
    hp.style.width = this.health + '%';
    hp.style.background = this.health > 60 ? '#0f0' : this.health > 30 ? '#fa0' : '#f33';
  },

  spawnParticles(pos, color) {
    let px = this.cx, py = this.cy, offset = 40;
    if (pos === 'top') py -= offset; if (pos === 'bottom') py += offset;
    if (pos === 'left') px -= offset; if (pos === 'right') px += offset;
    for (let i = 0; i < 10; i++) this.particles.push({ x: px, y: py, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, life: 1, color: color, type: 'spark' });
  },
  spawnHitRing(pos) {
    let px = this.cx, py = this.cy, offset = 60;
    if (pos === 'top') py -= offset; if (pos === 'bottom') py += offset;
    if (pos === 'left') px -= offset; if (pos === 'right') px += offset;
    this.particles.push({ x: px, y: py, life: 1, type: 'ring' });
  },
  spawnText(text, color) {
    this.particles.push({ x: this.cx, y: this.cy - 40, vy: -2, text: text, color: color, life: 1, type: 'text' });
  },

  spawnConfetti() {
    let speedMul = 8 / 3;
    for (let i = 0; i < 100; i++) {
      let shade = Math.random() * 200 + 55;
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: -Math.random() * 120,
        vx: (Math.random() - 0.5) * 4 * speedMul,
        vy: (1.5 + Math.random() * 3.5) * speedMul,
        life: 1,
        color: `rgb(${shade},${shade},${shade})`,
        type: 'confetti',
        w: 4 + Math.random() * 6,
        h: 3 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        rv: (Math.random() - 0.5) * 0.3 * speedMul,
        decay: 0.004 + Math.random() * 0.008,
      });
    }
  },

  loop() {
    if (!this.isPlaying) return;
    if (!this.paused) {
      this.render();
      this.rafId = requestAnimationFrame(this.loop.bind(this));
    }
  },

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      AudioCtx.suspend();
      this._pauseTime = performance.now();
      document.getElementById('pause-overlay').classList.add('show');
    } else {
      AudioCtx.resume().then(() => {
        let dt = (performance.now() - this._pauseTime) / 1000;
        this.startTime += dt;
        document.getElementById('pause-overlay').classList.remove('show');
        this.loop();
      });
    }
  },

  render() {
    let timeNow = (AudioCtx.currentTime - this.startTime) * this.timeScale;
    if (!this.ended && this._judgedCount >= this.totalNotes && timeNow > 1) {
      this.ended = true;
      if (this.combo > this.bestCombo) this.bestCombo = this.combo;
      setTimeout(() => App.showEndScreen(this), 500);
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.inBreak = this.breaks.some(b => timeNow >= b.start && timeNow < b.end);

    this.drops.forEach((d, i) => {
      if (!this._dropsTriggered[i] && timeNow >= d.time) {
        this._dropsTriggered[i] = true;
        this.spawnConfetti();
      }
    });

    if (this.inBreak) {
      let active = this.breaks.find(b => timeNow >= b.start && timeNow < b.end);
      let elapsed = timeNow - active.start;
      let total = active.end - active.start;

      this.ctx.fillStyle = 'rgba(255,255,255,0.05)';
      this.ctx.fillRect(this.cx - 120, this.cy - 60, 240, 120);

      this.ctx.fillStyle = '#888'; this.ctx.font = '800 14px Raleway'; this.ctx.textAlign = 'center';
      this.ctx.fillText('BREAK', this.cx, this.cy - 16);
      this.ctx.fillStyle = '#fff'; this.ctx.font = '900 36px Raleway'; this.ctx.textAlign = 'center';
      this.ctx.fillText(elapsed.toFixed(1), this.cx, this.cy + 28);
      return;
    }


    let beatLen = 60 / this.map.metadata.bpm;
    let beatPhase = ((timeNow % beatLen) / beatLen);
    let pulse = 1 - Math.pow(beatPhase, 2);


    this.ctx.strokeStyle = `rgba(255,255,255, ${0.05 + pulse * 0.05})`;
    this.ctx.lineWidth = 1; this.ctx.beginPath();
    this.ctx.moveTo(this.cx, 0); this.ctx.lineTo(this.cx, this.canvas.height);
    this.ctx.moveTo(0, this.cy); this.ctx.lineTo(this.canvas.width, this.cy);
    this.ctx.stroke();


    this.ctx.fillStyle = `rgba(255,255,255,${0.05 + pulse * 0.1})`;
    this.ctx.fillRect(this.cx - 30, this.cy - 30, 60, 60);
    this.ctx.strokeStyle = `rgba(255,255,255,${0.2 + pulse * 0.3})`;
    this.ctx.strokeRect(this.cx - 30, this.cy - 30, 60, 60);


    const drawRec = (x, y) => { this.ctx.strokeStyle = '#444'; this.ctx.lineWidth = 2; this.ctx.strokeRect(x - 20, y - 20, 40, 40); };
    drawRec(this.cx, this.cy - 60); drawRec(this.cx, this.cy + 60); drawRec(this.cx - 60, this.cy); drawRec(this.cx + 60, this.cy);


    this.ctx.fillStyle = '#fff';
    for (let i = this._nextNoteIdx; i < this.notes.length; i++) {
      let n = this.notes[i];
      if (n.hit || n.missed) { this._nextNoteIdx = i + 1; continue; }
      let dt = n.time - timeNow;

      if (App.modes.auto && Math.abs(dt) <= this.windows.perfect) {
        n.hit = true; this.registerHit(300, n.position); this._nextNoteIdx = i + 1; continue;
      }
      if (dt < -this.windows.okay) { n.missed = true; this.registerMiss(); this._nextNoteIdx = i + 1; continue; }
      if (dt > this.approachTime) break;
      if (dt <= 0) continue;

      let prog = dt / this.approachTime;
      let nx = this.cx, ny = this.cy, dist = prog * Math.max(this.cx, this.cy), toff = 60;

      if (n.position === 'top') ny = this.cy - toff - dist;
      if (n.position === 'bottom') ny = this.cy + toff + dist;
      if (n.position === 'left') nx = this.cx - toff - dist;
      if (n.position === 'right') nx = this.cx + toff + dist;

      this.ctx.globalAlpha = 1 - (prog * prog);
      this.ctx.fillRect(nx - 15, ny - 15, 30, 30);
      this.ctx.globalAlpha = 1.0;
    }


    let dur = this.map._audioBuffer ? this.map._audioBuffer.duration : 1;
    document.getElementById('hud-progress').style.width = Math.min(timeNow / dur, 1) * 100 + '%';


    for (let i = this.particles.length - 1; i >= 0; i--) {
      let p = this.particles[i];
      if (p.type === 'confetti') { p.life -= p.decay; } else { p.life -= 0.05; }
      if (p.life <= 0) { this.particles[i] = this.particles[this.particles.length - 1]; this.particles.pop(); continue; }
      this.ctx.globalAlpha = p.life;
      if (p.type === 'spark') { p.x += p.vx; p.y += p.vy; this.ctx.fillStyle = p.color; this.ctx.fillRect(p.x - 2, p.y - 2, 4, 4); }
      else if (p.type === 'text') { p.y += p.vy; this.ctx.fillStyle = p.color; this.ctx.font = '800 24px Raleway'; this.ctx.textAlign = 'center'; this.ctx.fillText(p.text, p.x, p.y); }
      else if (p.type === 'ring') { this.ctx.strokeStyle = '#fff'; this.ctx.lineWidth = 2; let s = (20 + (1 - p.life) * 30) * 2; this.ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s); }
      else if (p.type === 'confetti') { p.x += p.vx; p.vy += 0.08; p.y += p.vy; p.rot += p.rv; this.ctx.translate(p.x, p.y); this.ctx.rotate(p.rot); this.ctx.fillStyle = p.color; this.ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); this.ctx.setTransform(1, 0, 0, 1, 0, 0); }
      this.ctx.globalAlpha = 1.0;
    }

    if (App.modes.auto) {
      this.ctx.fillStyle = 'rgba(255,255,255,0.15)';
      this.ctx.font = '900 48px Raleway';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('AUTO', this.cx, this.cy + 120);
    }
  }
};


const PreviewConfetti = {
  canvas: document.getElementById('preview-confetti'),
  ctx: null, particles: [], rafId: null, drops: [], _triggered: [], _startTime: 0,

  start(drops, startTime, audioOffset) {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.drops = (drops || []).map(d => ({ time: d.time - (audioOffset || 0) }));
    this._triggered = new Array(this.drops.length).fill(false);
    this._startTime = startTime;
    this.canvas.style.display = 'block';
    this.loop();
  },

  stop() {
    this.canvas.style.display = 'none';
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    this.particles = [];
  },

  spawn() {
    let speedMul = 8 / 3;
    for (let i = 0; i < 300; i++) {
      let shade = Math.random() * 200 + 55;
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: -Math.random() * 120,
        vx: (Math.random() - 0.5) * 4 * speedMul,
        vy: (1.5 + Math.random() * 3.5) * speedMul,
        life: 1, color: `rgb(${shade},${shade},${shade})`,
        w: 4 + Math.random() * 6, h: 3 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        rv: (Math.random() - 0.5) * 0.3 * speedMul,
        decay: 0.004 + Math.random() * 0.008,
      });
    }
  },

  loop() {
    if (!this.ctx) return;
    let elapsed = AudioCtx.currentTime - this._startTime;
    for (let i = 0; i < this.drops.length; i++) {
      if (!this._triggered[i] && elapsed >= this.drops[i].time) {
        this._triggered[i] = true;
        this.spawn();
      }
    }
    this.render();
    this.rafId = requestAnimationFrame(this.loop.bind(this));
  },

  render() {
    let w = this.canvas.width, h = this.canvas.height;
    if (w !== window.innerWidth || h !== window.innerHeight) {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
      w = this.canvas.width; h = this.canvas.height;
    }
    this.ctx.clearRect(0, 0, w, h);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      let p = this.particles[i];
      p.life -= p.decay;
      if (p.life <= 0) { this.particles[i] = this.particles[this.particles.length - 1]; this.particles.pop(); continue; }
      p.x += p.vx; p.vy += 0.08; p.y += p.vy; p.rot += p.rv;
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate(p.rot);
      this.ctx.globalAlpha = p.life;
      this.ctx.fillStyle = p.color;
      this.ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    this.ctx.globalAlpha = 1;
  },
};


const Editor = {
  map: null,
  isRecording: false,
  recordStartTime: 0,
  audioSource: null,
  recordedNotes: [],
  isTimingOut: false,
  _timeoutStart: 0,
  breaks: [],
  drops: [],
  playerSource: null,
  playerGain: null,
  playerStartTime: 0,
  playerOffset: 0,
  playerPlaying: false,
  _audioBuffer: null,
  _bgImage: null,
  flash: { top: 0, bottom: 0, left: 0, right: 0 },
  canvas: document.getElementById('record-canvas'),
  ctx: document.getElementById('record-canvas').getContext('2d'),
  rafId: null,

  init(mapObj) {
    this.map = JSON.parse(JSON.stringify(mapObj));
    this._audioBuffer = mapObj._audioBuffer;
    cancelAnimationFrame(this.rafId);
    this.recordedNotes = [...this.map.notes];
    this.breaks = this.map.breaks ? this.map.breaks.map(b => ({ ...b })) : [];
    this.drops = this.map.drops ? this.map.drops.map(d => ({ ...d })) : [];
    this.isTimingOut = false;
    this._bgImage = null;
    let imgSrc = this.map.metadata.imageBlob || this.map.metadata.imageData;
    if (imgSrc) { let img = new Image(); img.onload = () => this._bgImage = img; img.src = imgSrc; }
    this.playerStop();
    this.renderDrops();
    let buf = this._audioBuffer;
    if (buf) document.getElementById('player-seek').max = buf.duration;
    document.getElementById('player-seek').value = 0;
    document.getElementById('player-time').textContent = '0:00 / ' + (buf ? Math.floor(buf.duration / 60) + ':' + String(Math.floor(buf.duration % 60)).padStart(2, '0') : '0:00');
    document.getElementById('ed-title').value = this.map.metadata.title;
    document.getElementById('ed-artist').value = this.map.metadata.artist;
    document.getElementById('ed-bpm').value = this.map.metadata.bpm;
    document.getElementById('ed-difficulty').value = this.map.metadata.difficulty || 1;
    document.getElementById('ed-img-lbl').innerText = (this.map.metadata.imageBlob || this.map.metadata.imageData) ? "Cover Image Loaded ✓" : "+ Upload Image (JPG/PNG)";
    document.getElementById('ed-audio-lbl').innerText = (this.map.metadata.audioBlob || this.map.metadata.audioData) ? "Audio Track Loaded ✓" : "+ Upload Audio";
    document.getElementById('recordNoteCount').innerText = this.map.notes.length;
    document.getElementById('recordStatus').innerText = this.map.notes.length ? `${this.map.notes.length} notes — RECORD to overwrite` : "Load audio, set BPM, press RECORD";
    this.loop();
  },

  updateMeta(key, val) { this.map.metadata[key] = val; },

  uploadImage(e) {
    const file = e.target.files[0]; if (!file) return;
    resizeImageFile(file, (dataUri) => {
      this.map.metadata.imageData = dataUri;
      this.map.metadata.imageBlob = dataUriToBlobUrl(dataUri) || dataUri;
      document.getElementById('ed-img-lbl').innerText = "Cover Image Loaded ✓";
      let img = new Image();
      img.onload = () => this._bgImage = img;
      img.src = dataUri;
    });
  },

  async uploadAudio(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    showLoading();
    reader.onload = async (ev) => {
      let dataUri = ev.target.result;
      this.map.metadata.audioData = dataUri;
      this.map.metadata.audioBlob = dataUriToBlobUrl(dataUri) || dataUri;
      document.getElementById('ed-audio-lbl').innerText = "Audio Track Loaded ✓";
      this._audioBuffer = await getAudioBuffer(this.map.metadata.audioBlob || this.map.metadata.audioData);
      hideLoading();
      if (this._audioBuffer) {
        document.getElementById('player-seek').max = this._audioBuffer.duration;
        this.updatePlayerTime(0);
      }
    };
    reader.readAsDataURL(file);
  },

  async toggleRecord() {
    if (this.isRecording) return this.stop();
    if (!(this.map.metadata.audioBlob || this.map.metadata.audioData)) { alert("Upload an audio track first"); return; }
    if (AudioCtx.state === 'suspended') await AudioCtx.resume();

    this.recordedNotes = [];
    this.isRecording = true;
    document.getElementById('ed-record-btn').innerText = 'STOP';
    document.getElementById('recordStatus').innerText = 'Recording — tap WASD to the beat';
    document.getElementById('recordNoteCount').innerText = '0';

    let buffer = await getAudioBuffer(this.map.metadata.audioBlob || this.map.metadata.audioData);
    this.recordStartTime = AudioCtx.currentTime + 1.0;

    if (buffer) {
      this.audioSource = AudioCtx.createBufferSource();
      this.audioSource.buffer = buffer;
      this.audioSource.connect(masterGain);
      this.audioSource.start(this.recordStartTime);
    }

    this._onKey = (e) => {
      if (!this.isRecording) return;
      const mapKeys = { 'w': 'top', 's': 'bottom', 'a': 'left', 'd': 'right' };
      let pos = mapKeys[e.key.toLowerCase()];
      if (!pos) return;
      let t = AudioCtx.currentTime - this.recordStartTime;
      if (t < 0) return;
      this.recordedNotes.push({ time: t, position: pos });
      this.flash[pos] = 1;
      Synth.playHat(AudioCtx.currentTime);
      document.getElementById('recordNoteCount').innerText = this.recordedNotes.length;
    };
    window.addEventListener('keydown', this._onKey);
  },

  stop() {
    if (this.isTimingOut) this.toggleTimeout();
    this.isRecording = false;
    document.getElementById('ed-record-btn').innerText = 'RECORD';
    if (this.audioSource) { this.audioSource.stop(); this.audioSource.disconnect(); this.audioSource = null; }
    if (this._onKey) window.removeEventListener('keydown', this._onKey);
    this.map.notes = [...this.recordedNotes].sort((a, b) => a.time - b.time);
    this.map.breaks = [...this.breaks.sort((a, b) => a.start - b.start)];
    document.getElementById('recordStatus').innerText = `${this.recordedNotes.length} notes — SAVE or record again`;
  },

  toggleTimeout() {
    if (!this.isRecording) return;
    if (this.isTimingOut) {
      let end = AudioCtx.currentTime - this.recordStartTime;
      this.breaks.push({ start: this._timeoutStart, end });
      this.isTimingOut = false;
      document.getElementById('ed-timeout-btn').classList.remove('active-timeout');
      document.getElementById('ed-timeout-btn').innerText = 'TIMEOUT';
      document.getElementById('recordStatus').innerText = `Timeout ${(end - this._timeoutStart).toFixed(1)}s — ${this.recordedNotes.length} notes`;
    } else {
      this._timeoutStart = AudioCtx.currentTime - this.recordStartTime;
      this.isTimingOut = true;
      document.getElementById('ed-timeout-btn').classList.add('active-timeout');
      document.getElementById('ed-timeout-btn').innerText = 'RESUME';
      document.getElementById('recordStatus').innerText = 'Timeout — timer counting';
    }
  },

  playerStop() {
    this.playerPlaying = false;
    if (this.playerSource) { this.playerSource.stop(); this.playerSource.disconnect(); this.playerSource = null; }
    document.getElementById('player-play-btn').textContent = '▶';
  },

  playerPlay() {
    let buffer = this._audioBuffer;
    if (!buffer) return;
    if (Game.isPlaying) Game.stop();
    App.stopPreview();
    if (this.playerPlaying) { this.playerPause(); return; }
    if (AudioCtx.state === 'suspended') AudioCtx.resume();
    if (!this.playerGain) { this.playerGain = AudioCtx.createGain(); this.playerGain.gain.value = 0.25; this.playerGain.connect(AudioCtx.destination); }
    this.playerSource = AudioCtx.createBufferSource();
    this.playerSource.buffer = buffer;
    this.playerSource.connect(this.playerGain);
    this.playerSource.start(0, this.playerOffset);
    this.playerStartTime = AudioCtx.currentTime;
    this.playerPlaying = true;
    document.getElementById('player-play-btn').textContent = '⏸';
    this._playerTick();
  },

  playerPause() {
    if (!this.playerPlaying) return;
    this.playerOffset += AudioCtx.currentTime - this.playerStartTime;
    this.playerPlaying = false;
    if (this.playerSource) { this.playerSource.stop(); this.playerSource.disconnect(); this.playerSource = null; }
    document.getElementById('player-play-btn').textContent = '▶';
  },

  _playerTick() {
    if (!this.playerPlaying) return;
    let now = this.playerOffset + AudioCtx.currentTime - this.playerStartTime;
    let buf = this._audioBuffer;
    if (buf && now >= buf.duration) { this.playerStop(); this.playerOffset = 0; document.getElementById('player-seek').value = 0; this.updatePlayerTime(0); return; }
    document.getElementById('player-seek').value = now;
    this.updatePlayerTime(now);
    requestAnimationFrame(() => this._playerTick());
  },

  playerSeek(val) {
    let t = parseFloat(val);
    this.playerOffset = t;
    if (this.playerPlaying) {
      this.playerPause();
      this.playerPlay();
    }
    this.updatePlayerTime(t);
  },

  updatePlayerTime(t) {
    let buf = this._audioBuffer;
    let dur = buf ? buf.duration : 0;
    document.getElementById('player-time').textContent = Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') + ' / ' + (dur ? Math.floor(dur / 60) + ':' + String(Math.floor(dur % 60)).padStart(2, '0') : '0:00');
  },

  markDrop() {
    let t = this.playerOffset;
    if (this.playerPlaying) t = this.playerOffset + AudioCtx.currentTime - this.playerStartTime;
    this.drops.push({ time: t });
    this.drops.sort((a, b) => a.time - b.time);
    this.renderDrops();
  },

  removeDrop(i) {
    this.drops.splice(i, 1);
    this.renderDrops();
  },

  renderDrops() {
    let el = document.getElementById('drop-list');
    if (!this.drops.length) { el.innerHTML = '<div style="font-size:0.7rem;color:#555;padding:4px 0;">No drops marked</div>'; return; }
    el.innerHTML = this.drops.map((d, i) =>
      '<div class="drop-item"><span>' + Math.floor(d.time / 60) + ':' + String(Math.floor(d.time % 60)).padStart(2, '0') + '.' + String(Math.floor((d.time % 1) * 10)) + '</span><span class="drop-del" onclick="Editor.removeDrop(' + i + ')">✕</span></div>'
    ).join('');
  },

  exportDCM() {
    this.map.breaks = [...this.breaks];
    this.map.drops = this.drops.map(d => ({ time: d.time }));
    this.map._audioBuffer = this._audioBuffer;
    this.map.metadata.imageBlob = dataUriToBlobUrl(this.map.metadata.imageData) || this.map.metadata.imageData;
    this.map.metadata.audioBlob = dataUriToBlobUrl(this.map.metadata.audioData) || this.map.metadata.audioData;
    if (!App.maps.includes(this.map)) { App.maps.push(this.map); DB.save(App.maps); App.buildMapUI(); }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.map));
    const a = document.createElement('a'); a.href = dataStr;
    a.download = `${this.map.metadata.title.replace(/\s+/g, '_')}.dcm`; a.click();
  },

  async importFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        let newMap = JSON.parse(ev.target.result);
        if (newMap.notes && newMap.metadata) {
          if (newMap.metadata.audioData || newMap.metadata.audioBlob) {
            newMap._audioBuffer = await getAudioBuffer(newMap.metadata.audioBlob || newMap.metadata.audioData);
          }
          this.init(newMap);
          App.maps.push(newMap);
          alert("Map loaded!");
        }
      } catch (err) { alert("Invalid .dcm file format."); }
    };
    reader.readAsText(file);
  },

  loop() {
    if (App.view !== 'editor') return;
    let ctx = this.ctx, c = this.canvas;
    let cx = 150, cy = 150, off = 55, s = 28;
    let now = this.isRecording ? AudioCtx.currentTime - this.recordStartTime : 0;

    if (this._bgImage) { ctx.drawImage(this._bgImage, 0, 0, c.width, c.height); } else { ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, c.width, c.height); }

    if (this.isTimingOut) {
      let elapsed = now - this._timeoutStart;
      ctx.fillStyle = '#555'; ctx.font = '800 32px Raleway'; ctx.textAlign = 'center';
      ctx.fillText(elapsed.toFixed(1), cx, cy + 10);
      document.getElementById('recordNoteCount').innerText = elapsed.toFixed(1) + 's';
    } else {
      for (let k in this.flash) this.flash[k] = Math.max(0, this.flash[k] - 0.04);

      let draw = (x, y, f) => {
        let b = f > 0.05;
        ctx.fillStyle = b ? `rgba(255,255,255,${f * 0.25})` : 'transparent';
        ctx.fillRect(x - s, y - s, s * 2, s * 2);
        ctx.strokeStyle = b ? '#fff' : '#444';
        ctx.lineWidth = b ? 3 : 2;
        ctx.strokeRect(x - s, y - s, s * 2, s * 2);
      };
      draw(cx, cy - off, this.flash.top);
      draw(cx, cy + off, this.flash.bottom);
      draw(cx - off, cy, this.flash.left);
      draw(cx + off, cy, this.flash.right);

      ctx.fillStyle = '#555'; ctx.font = '800 14px Raleway'; ctx.textAlign = 'center';
      ctx.fillText('W', cx, cy - off + 5);
      ctx.fillText('S', cx, cy + off + 5);
      ctx.fillText('A', cx - off, cy + 5);
      ctx.fillText('D', cx + off, cy + 5);
    }

    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }
};


App.init();


let _titleDone = false, _mapsLoaded = false;

document.getElementById('start-btn').onclick = async () => {
  if (AudioCtx.state === 'suspended') await AudioCtx.resume();
  document.getElementById('start-btn').classList.add('hidden');
  document.getElementById('start-title').style.display = 'block';
  document.getElementById('start-sub').style.display = 'block';

  let el = document.getElementById('start-title');
  let target = 'Derc_';
  let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_#%@&*$';
  let frame = 0, totalFrames = 40;

  let iv = setInterval(() => {
    frame++;
    let progress = Math.min(frame / totalFrames, 1);
    let locked = Math.floor(progress * target.length);
    let txt = '';
    for (let i = 0; i < target.length; i++) {
      if (i < locked) txt += target[i];
      else txt += chars[Math.floor(Math.random() * chars.length)];
    }
    el.textContent = txt;
    if (locked >= target.length) {
      clearInterval(iv);
      _titleDone = true;
      tryTransition();
    }
  }, 60);


  setTimeout(() => {
    if (!_mapsLoaded) document.getElementById('start-loading').style.display = 'block';
  }, 3000);


  (function waitMaps() {
    if (App.maps.length) { _mapsLoaded = true; tryTransition(); }
    else setTimeout(waitMaps, 100);
  })();
};

function tryTransition() {
  if (!_titleDone || !_mapsLoaded) return;
  document.getElementById('start-loading').style.display = 'none';
  document.getElementById('start-modal').style.display = 'none';
  App.onSelectionChange(0);
}

