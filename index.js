const path = require('path');
const url = require('url');
const os = require('os');
const fs = require('fs');
let pluginApi = null;

const state = {
  eventChannel: 'smart-listening-lowbar',
  backgroundHome: '',
  floatPages: {},
  dirs: [],
  files: {},
  todayList: [],
  currentIndex: -1,
  playing: false,
  rate: 1.0,
  minuteTimes: [],
  windowIdKey: 'smart-listening-lowbar',
  defaultCenterItems: []
};

function emitUpdate(target, value) {
  try { pluginApi.emit(state.eventChannel, { type: 'update', target, value }); } catch (e) {}
}

function currentAudioName() {
  try {
    const idx = state.currentIndex;
    const fp = (idx >= 0 && idx < state.todayList.length) ? state.todayList[idx] : '';
    return path.basename(String(fp || '')) || '';
  } catch (e) { return ''; }
}

function buildCenterItems() {
  return [];
}

function persist() {
  try {
    pluginApi.store.set('smart-listening:dirs', state.dirs);
    pluginApi.store.set('smart-listening:files', state.files);
    pluginApi.store.set('smart-listening:todayList', state.todayList);
    pluginApi.store.set('smart-listening:rate', state.rate);
    pluginApi.store.set('smart-listening:minuteTimes', state.minuteTimes);
  } catch (e) {}
}

function restore() {
  try {
    const dirs = pluginApi.store.get('smart-listening:dirs');
    const files = pluginApi.store.get('smart-listening:files');
    const today = pluginApi.store.get('smart-listening:todayList');
    const rate = pluginApi.store.get('smart-listening:rate');
    const times = pluginApi.store.get('smart-listening:minuteTimes');
    if (Array.isArray(dirs)) state.dirs = dirs;
    if (files && typeof files === 'object') state.files = files;
    if (Array.isArray(today)) state.todayList = today;
    if (typeof rate === 'number') state.rate = rate;
    if (Array.isArray(times)) state.minuteTimes = times;
  } catch (e) {}
}

function computeMinuteTimes(times) {
  const list = Array.isArray(times) ? times : [];
  return list.map((t) => String(t || '').slice(0,5)).filter((t) => /^\d{2}:\d{2}$/.test(t));
}

async function registerMinuteTriggers() {
  const times = computeMinuteTimes(state.minuteTimes);
  try { pluginApi.automation.registerMinuteTriggers('smart-listening', times, handleMinuteTrigger); } catch (e) {}
}

function handleMinuteTrigger(hhmm) {
  try {
    const payloads = [ { mode: 'sound', which: 'in' }, { mode: 'sound', which: 'in' }, { mode: 'sound', which: 'in' } ];
    try { pluginApi.call('notify-plugin', 'enqueueBatch', [payloads]); } catch (e) {}
    functions.openSmartListening({ activate: true });
    const nextIdx = state.todayList.findIndex((fp) => !(state.files[fp]?.listened));
    if (nextIdx >= 0) {
      state.currentIndex = nextIdx;
      state.playing = true;
      emitUpdate('centerItems', buildCenterItems());
      pluginApi.emit(state.eventChannel, { type: 'control', action: 'player', cmd: 'play', filePath: state.todayList[nextIdx], rate: state.rate });
    }
  } catch (e) {}
}

const functions = {
  openSmartListening: async (_params = {}) => {
    try {
      restore();
      const bgHome = path.join(__dirname, 'background', 'home.html');
      state.backgroundHome = url.pathToFileURL(bgHome).href;
      const params = {
        id: state.windowIdKey,
        title: '智慧听力',
        eventChannel: state.eventChannel,
        subscribeTopics: [state.eventChannel],
        callerPluginId: 'smart-listening',
        windowMode: 'windowed_only',
        icon: 'ri-headphone-line',
        floatingSizePercent: 50,
        floatingBounds: 'center',
        leftItems: [],
        centerItems: buildCenterItems(),
        backgroundUrl: state.backgroundHome,
        floatingUrl: null
      };
      await pluginApi.call('ui-lowbar', 'openTemplate', [params]);
      emitUpdate('centerItems', buildCenterItems());
      return true;
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  onLowbarEvent: async (payload = {}) => {
    try {
      if (!payload || typeof payload !== 'object') return true;
      try { pluginApi.emit(state.eventChannel, payload); } catch (e) {}
      if (payload.type === 'click') {
        if (payload.id === 'toggle-play') {
          state.playing = !state.playing;
          emitUpdate('centerItems', buildCenterItems());
          const cmd = state.playing ? 'resume' : 'pause';
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'player', cmd });
        } else if (payload.id === 'display-name') {
        } else if (payload.id === 'open-settings') {
          const settingsPath = path.join(__dirname, 'float', 'settings.html');
          const settingsUrl = url.pathToFileURL(settingsPath).href;
          emitUpdate('floatingUrl', settingsUrl);
        }
      } else if (payload.type === 'player-ended') {
        const fp = String(payload.filePath || '');
        if (fp) {
          state.files[fp] = { ...(state.files[fp] || {}), listened: true };
          const idx = state.todayList.findIndex((x) => x === fp);
          if (idx >= 0) state.todayList.splice(idx, 1);
          persist();
          if (state.todayList.length) {
            state.currentIndex = Math.min(state.currentIndex, state.todayList.length - 1);
          } else {
            state.currentIndex = -1; state.playing = false;
          }
          emitUpdate('centerItems', buildCenterItems());
        }
      } else if (payload.type === 'player-progress') {
      } else if (payload.type === 'float.settings') {
        if (payload.settings) {
          if (typeof payload.settings.defaultSpeed === 'number') {
            state.rate = payload.settings.defaultSpeed;
            persist();
          }
        }
      }
      return true;
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },

  addDirectory: async (dirPath) => {
    try {
      const p = String(dirPath || '').trim(); if (!p) return { ok: false, error: 'empty_dir' };
      if (!state.dirs.includes(p)) state.dirs.push(p);
      persist();
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'dirs', value: state.dirs });
      return { ok: true, dirs: state.dirs };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  removeDirectory: async (dirPath) => {
    try {
      const p = String(dirPath || '').trim(); if (!p) return { ok: false, error: 'empty_dir' };
      state.dirs = state.dirs.filter((d) => d !== p);
      persist();
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'dirs', value: state.dirs });
      return { ok: true, dirs: state.dirs };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  listDirectories: async () => { return { ok: true, dirs: state.dirs.slice() }; },
  listFiles: async (dirPath) => {
    try {
      const p = String(dirPath || '').trim(); if (!p) return { ok: false, error: 'empty_dir' };
      const entries = [];
      try {
        const names = fs.readdirSync(p);
        for (const name of names) {
          const f = path.join(p, name);
          try {
            const st = fs.statSync(f);
            if (st.isFile() && /\.(mp3|wav|m4a|flac|ogg)$/i.test(name)) {
              const key = f;
              const meta = state.files[key] || { selected: false, listened: false };
              entries.push({ path: key, name, selected: !!meta.selected, listened: !!meta.listened });
            }
          } catch (e) {}
        }
      } catch (e) {}
      return { ok: true, files: entries };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  addToToday: async (filePath) => {
    try {
      const fp = String(filePath || '').trim(); if (!fp) return { ok: false, error: 'empty_file' };
      if (!state.todayList.includes(fp)) state.todayList.push(fp);
      state.files[fp] = { ...(state.files[fp] || {}), selected: true };
      persist();
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'todayList', value: state.todayList });
      return { ok: true, today: state.todayList.slice() };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  reorderToday: async (order) => {
    try {
      const arr = Array.isArray(order) ? order : [];
      const valid = arr.every((x) => state.todayList.includes(x));
      if (!valid) return { ok: false, error: 'invalid_order' };
      state.todayList = arr.slice();
      persist();
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'todayList', value: state.todayList });
      return { ok: true };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  markListened: async (filePath) => {
    try {
      const fp = String(filePath || '').trim(); if (!fp) return { ok: false, error: 'empty_file' };
      state.files[fp] = { ...(state.files[fp] || {}), listened: true };
      const idx = state.todayList.findIndex((x) => x === fp);
      if (idx >= 0) state.todayList.splice(idx, 1);
      persist();
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'todayList', value: state.todayList });
      emitUpdate('centerItems', buildCenterItems());
      return { ok: true };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  setScheduleTimes: async (times) => {
    try {
      state.minuteTimes = computeMinuteTimes(times);
      persist();
      registerMinuteTriggers();
      return { ok: true, times: state.minuteTimes };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  clearSchedule: async () => {
    try { state.minuteTimes = []; persist(); pluginApi.automation.clearMinuteTriggers && pluginApi.automation.clearMinuteTriggers('smart-listening'); return { ok: true }; } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  listScheduleTimes: async () => { return { ok: true, times: state.minuteTimes.slice() }; },
  getDesktopPath: async () => {
    try {
      const home = os.homedir();
      let guess = path.join(home, 'Desktop');
      
      if (fs.existsSync(guess)) {
        return { ok: true, path: guess };
      }

      const oneDrive = path.join(home, 'OneDrive', 'Desktop');
      if (fs.existsSync(oneDrive)) {
        return { ok: true, path: oneDrive };
      }

      return { ok: true, path: home };
    } catch (e) { 
      return { ok: false, error: e?.message || String(e) }; 
    }
  },
  listEntries: async (dirPath) => {
    try {
      const p = String(dirPath || '').trim(); if (!p) return { ok: false, error: 'empty_dir' };
      const entries = [];
      try {
        const names = fs.readdirSync(p);
        for (const name of names) {
          const f = path.join(p, name);
          try {
            const st = fs.statSync(f);
            if (st.isDirectory()) {
              entries.push({ path: f, name, type: 'dir' });
            } else if (st.isFile()) {
              const isAudio = /\.(mp3|wav|m4a|flac|ogg)$/i.test(name);
              const meta = state.files[f] || { selected: false, listened: false };
              entries.push({ path: f, name, type: 'file', isAudio, selected: !!meta.selected, listened: !!meta.listened });
            }
          } catch (e) {}
        }
      } catch (e) {}
      return { ok: true, entries };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  getState: async () => {
    return { ok: true, dirs: state.dirs.slice(), files: state.files, today: state.todayList.slice(), rate: state.rate, playing: state.playing, currentIndex: state.currentIndex };
  },
  setRate: async (rate) => {
    try {
      const r = Number(rate);
      if (isNaN(r) || r <= 0) return { ok: false, error: 'invalid_rate' };
      state.rate = Math.max(0.25, Math.min(4.0, r));
      persist();
      pluginApi.emit(state.eventChannel, { type: 'control', action: 'player', cmd: 'rate', rate: state.rate });
      return { ok: true, rate: state.rate };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  resetAllListened: async () => {
    try {
      const keys = Object.keys(state.files);
      for (const key of keys) {
        if (state.files[key]) {
          state.files[key].listened = false;
        }
      }
      persist();
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'files', value: state.files });
      return { ok: true };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  clearTodayList: async () => {
    try {
      state.todayList = [];
      state.currentIndex = -1;
      state.playing = false;
      persist();
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'todayList', value: [] });
      emitUpdate('centerItems', buildCenterItems());
      return { ok: true };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  playAtIndex: async (index) => {
    try {
      const idx = parseInt(index, 10);
      if (isNaN(idx) || idx < 0 || idx >= state.todayList.length) {
        return { ok: false, error: 'invalid_index' };
      }
      state.currentIndex = idx;
      state.playing = true;
      emitUpdate('centerItems', buildCenterItems());
      pluginApi.emit(state.eventChannel, { 
        type: 'control', 
        action: 'player', 
        cmd: 'play', 
        filePath: state.todayList[idx], 
        rate: state.rate 
      });
      return { ok: true };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  pause: async () => {
    try {
      state.playing = false;
      emitUpdate('centerItems', buildCenterItems());
      pluginApi.emit(state.eventChannel, { type: 'control', action: 'player', cmd: 'pause' });
      return { ok: true };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  resume: async () => {
    try {
      state.playing = true;
      emitUpdate('centerItems', buildCenterItems());
      pluginApi.emit(state.eventChannel, { type: 'control', action: 'player', cmd: 'resume' });
      return { ok: true };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  playNext: async () => {
    try {
      if (state.todayList.length === 0) return { ok: false, error: 'empty_list' };
      let idx = state.currentIndex + 1;
      if (idx >= state.todayList.length) idx = 0;
      return await functions.playAtIndex(idx);
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  playPrev: async () => {
    try {
      if (state.todayList.length === 0) return { ok: false, error: 'empty_list' };
      let idx = state.currentIndex - 1;
      if (idx < 0) idx = state.todayList.length - 1;
      return await functions.playAtIndex(idx);
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  removeFromToday: async (index) => {
    try {
      const idx = parseInt(index, 10);
      if (isNaN(idx) || idx < 0 || idx >= state.todayList.length) {
        return { ok: false, error: 'invalid_index' };
      }
      const fp = state.todayList[idx];
      state.todayList.splice(idx, 1);
      if (state.files[fp]) {
        state.files[fp].selected = false;
      }
      if (state.currentIndex === idx) {
        state.currentIndex = Math.min(state.currentIndex, state.todayList.length - 1);
        if (state.todayList.length === 0) {
          state.currentIndex = -1;
          state.playing = false;
        }
      } else if (state.currentIndex > idx) {
        state.currentIndex--;
      }
      persist();
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'todayList', value: state.todayList });
      emitUpdate('centerItems', buildCenterItems());
      return { ok: true };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  }
};

const init = async (api) => {
  pluginApi = api;
  api.splash.setStatus('plugin:init', '初始化 智慧听力');
  restore();
  registerMinuteTriggers();
  api.splash.setStatus('plugin:init', '可通过动作打开 智慧听力 窗口');
  api.splash.setStatus('plugin:init', '智慧听力加载完成');
};

module.exports = {
  name: 'smart-listening',
  version: '0.1.0',
  init,
  functions: {
    ...functions,
    getVariable: async (name) => {
      const k = String(name||'');
      if (k==='timeISO') return new Date().toISOString();
      if (k==='currentAudioName') return currentAudioName();
      if (k==='todayCount') return String(state.todayList.length || 0);
      return '';
    },
    listVariables: () => ['timeISO','currentAudioName','todayCount']
  }
};
