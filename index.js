const path = require('path');
const url = require('url');
let pluginApi = null;

const state = {
  eventChannel: 'smart.listening.lowbar',
  backgroundHome: '',
  floatPages: {},
  dirs: [],
  files: {},
  todayList: [],
  currentIndex: -1,
  playing: false,
  rate: 1.0,
  minuteTimes: [],
  windowIdKey: 'smart.listening.lowbar',
  defaultCenterItems: [
    { id: 'toggle-play', text: '播放', icon: 'ri-play-line' }
  ]
};

function emitUpdate(target, value) {
  try { pluginApi.emit(state.eventChannel, { type: 'update', target, value }); } catch {}
}

function currentAudioName() {
  try {
    const idx = state.currentIndex;
    const fp = (idx >= 0 && idx < state.todayList.length) ? state.todayList[idx] : '';
    return path.basename(String(fp || '')) || '';
  } catch { return ''; }
}

function buildCenterItems() {
  const name = currentAudioName();
  const playLabel = state.playing ? '暂停' : '播放';
  const playIcon = state.playing ? 'ri-pause-line' : 'ri-play-line';
  const items = [
    { id: 'display-name', text: (name ? name : '未选择音频'), icon: 'ri-music-2-line' },
    ...state.defaultCenterItems.map((x) => x.id === 'toggle-play' ? { ...x, text: playLabel, icon: playIcon } : x)
  ];
  return items;
}

function persist() {
  try {
    pluginApi.store.set('smartListening:dirs', state.dirs);
    pluginApi.store.set('smartListening:files', state.files);
    pluginApi.store.set('smartListening:todayList', state.todayList);
    pluginApi.store.set('smartListening:rate', state.rate);
    pluginApi.store.set('smartListening:minuteTimes', state.minuteTimes);
  } catch {}
}

function restore() {
  try {
    const dirs = pluginApi.store.get('smartListening:dirs');
    const files = pluginApi.store.get('smartListening:files');
    const today = pluginApi.store.get('smartListening:todayList');
    const rate = pluginApi.store.get('smartListening:rate');
    const times = pluginApi.store.get('smartListening:minuteTimes');
    if (Array.isArray(dirs)) state.dirs = dirs;
    if (files && typeof files === 'object') state.files = files;
    if (Array.isArray(today)) state.todayList = today;
    if (typeof rate === 'number') state.rate = rate;
    if (Array.isArray(times)) state.minuteTimes = times;
  } catch {}
}

function computeMinuteTimes(times) {
  const list = Array.isArray(times) ? times : [];
  return list.map((t) => String(t || '').slice(0,5)).filter((t) => /^\d{2}:\d{2}$/.test(t));
}

async function registerMinuteTriggers() {
  const times = computeMinuteTimes(state.minuteTimes);
  try { pluginApi.automation.registerMinuteTriggers('smart.listening', times, handleMinuteTrigger); } catch {}
}

function handleMinuteTrigger(hhmm) {
  try {
    const payloads = [ { mode: 'sound', which: 'in' }, { mode: 'sound', which: 'in' }, { mode: 'sound', which: 'in' } ];
    try { pluginApi.call('notify.plugin', 'enqueueBatch', [payloads]); } catch {}
    functions.openSmartListening({ activate: true });
    // 自动开始播放当日第一条未完成
    const nextIdx = state.todayList.findIndex((fp) => !(state.files[fp]?.listened));
    if (nextIdx >= 0) {
      state.currentIndex = nextIdx;
      state.playing = true;
      emitUpdate('centerItems', buildCenterItems());
      pluginApi.emit(state.eventChannel, { type: 'control', action: 'player', cmd: 'play', filePath: state.todayList[nextIdx], rate: state.rate });
    }
  } catch {}
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
        callerPluginId: 'smart.listening',
        windowMode: 'windowed_only',
        icon: 'ri-headphone-line',
        floatingSizePercent: 50,
        floatingBounds: 'center',
        leftItems: [],
        centerItems: buildCenterItems(),
        backgroundUrl: state.backgroundHome,
        floatingUrl: null
      };
      await pluginApi.call('ui.lowbar', 'openTemplate', [params]);
      emitUpdate('centerItems', buildCenterItems());
      return true;
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  onLowbarEvent: async (payload = {}) => {
    try {
      if (!payload || typeof payload !== 'object') return true;
      try { pluginApi.emit(state.eventChannel, payload); } catch {}
      if (payload.type === 'click') {
        if (payload.id === 'toggle-play') {
          state.playing = !state.playing;
          emitUpdate('centerItems', buildCenterItems());
          const cmd = state.playing ? 'resume' : 'pause';
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'player', cmd });
        } else if (payload.id === 'display-name') {
          // no-op
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
        // 可选：未来扩展在底栏显示进度文本
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
      const fs = require('fs');
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
          } catch {}
        }
      } catch {}
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
      // 验证均在 todayList 之内
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
    try { state.minuteTimes = []; persist(); pluginApi.automation.clearMinuteTriggers && pluginApi.automation.clearMinuteTriggers('smart.listening'); return { ok: true }; } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  listScheduleTimes: async () => { return { ok: true, times: state.minuteTimes.slice() }; },
  getDesktopPath: async () => {
    try {
      const os = require('os');
      const home = os.homedir();
      const guess = path.join(home, 'Desktop');
      return { ok: true, path: guess };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  listEntries: async (dirPath) => {
    try {
      const fs = require('fs');
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
          } catch {}
        }
      } catch {}
      return { ok: true, entries };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  getState: async () => {
    return { ok: true, dirs: state.dirs.slice(), files: state.files, today: state.todayList.slice(), rate: state.rate, playing: state.playing, currentIndex: state.currentIndex };
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
  name: '智慧听力',
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
