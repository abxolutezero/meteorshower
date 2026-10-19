const ICON_PLAY = `<svg class="icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
const ICON_PAUSE = `<svg class="icon" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
const ICON_EDIT = `<svg class="icon" style="width:16px;height:16px" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
const ICON_MEMO = `<svg class="icon" style="width:16px;height:16px" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`;

const H={admin:'03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', view:'9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0'}; 
const ROOM='r-h7q3v9x2m5kd'; 
firebase.initializeApp({
  apiKey:"AIzaSyCYpNrelfnjLgBDZej7OUcJi3KTMXJo2Wg",
  authDomain:"jukeboxserver-adba9.firebaseapp.com",
  projectId:"jukeboxserver-adba9",
  appId:"1:575158783677:web:f4f15591fb9118f951b1d4",
  databaseURL:"https://jukeboxserver-adba9-default-rtdb.firebaseio.com"
});
const db = firebase.database(), ref = db.ref(ROOM), sref = ref.child('s');
const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,5);
const fmt = s => { s = Math.floor(s||0); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0') };

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const MAX_SONGS = 500;

const State = {
  off: 0, role: 'view', cur: null, yt: null, ytReady: false, seeking: false, 
  started: false, pi: 0, PL: [], USERS: [], audioUnlocked: false, entered: false,
  myVol: +(localStorage.getItem('myvol') || 100),
  sync: { q: [], i: -1, playing: false, pos: 0, at: 0, loop: 'off', vol: 100 }
};

function showModal(title, type = 'prompt', defaultValue = '') {
  return new Promise((resolve) => {
    const backdrop = $('#modal-backdrop');
    const titleEl = $('#modal-title');
    const inputEl = $('#modal-input');
    const btnCancel = $('#modal-cancel');
    const btnConfirm = $('#modal-confirm');

    titleEl.textContent = title;
    backdrop.classList.remove('hide');
    
    if (type === 'prompt') {
      inputEl.classList.remove('hide');
      inputEl.value = defaultValue;
      inputEl.focus();
      inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    } else {
      inputEl.classList.add('hide');
      btnConfirm.focus();
    }

    const cleanup = () => {
      backdrop.classList.add('hide');
      btnCancel.removeEventListener('click', onCancel);
      btnConfirm.removeEventListener('click', onConfirm);
      backdrop.removeEventListener('keydown', onKey);
    };

    const onCancel = () => { cleanup(); resolve(type === 'prompt' ? null : false); };
    const onConfirm = () => { cleanup(); resolve(type === 'prompt' ? inputEl.value : true); };
    
    const onKey = (e) => {
      if (e.key === 'Enter') onConfirm();
      if (e.key === 'Escape') onCancel();
    };

    btnCancel.addEventListener('click', onCancel);
    btnConfirm.addEventListener('click', onConfirm);
    backdrop.addEventListener('keydown', onKey);
  });
}

function showToast(msg) {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span class="toast-text">${msg}</span><button class="toast-close">X</button>`;
  
  const closeToast = () => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  };
  
  toast.querySelector('.toast-close').addEventListener('click', closeToast);
  container.append(toast);
  setTimeout(closeToast, 3500); 
}

document.addEventListener('click', () => {
  if (!State.audioUnlocked) {
    State.audioUnlocked = true;
    if (State.ytReady && State.yt) {
      State.yt.unMute();
      applyVol();
    }
  }
});

db.ref('.info/serverTimeOffset').on('value', s => State.off = s.val() || 0);
const now = () => Date.now() + State.off;
const ex = () => State.sync.playing ? State.sync.pos + (now()-State.sync.at)/1000 : State.sync.pos; 

async function sha(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

const rand_name = ['랜덤 이름1', '랜덤 이름 2'];

$('#enter').addEventListener('click', async () => {
  let name = $('#name').value.trim();
  const h = await sha($('#pw').value);

  if(!name) { name = rand_name[Math.floor(Math.random() * rand_name.length)]; }
  if(h !== H.admin && h !== H.view) { $('#msg').textContent = 'passcode error'; return; }
  
  sessionStorage.setItem('jb', JSON.stringify({name, h}));
  enter(name, h);
});

$('#pw').addEventListener('keydown', e => { if(e.key === 'Enter') $('#enter').click(); });

async function enter(name, h) {
  State.role = h === H.admin ? 'admin' : 'view';
  document.body.className = State.role;
  $('#lobby').classList.add('hide'); $('#app').classList.remove('hide');
  $('#myName').textContent = (State.role==='admin' ? '[Admin] ' : '') + name;
  $('#seek').disabled = State.role !== 'admin';
  $('#vol').value = State.myVol;
  
  State.entered = true;
  if(window.YT && YT.Player) initPlayer();
  
  const me = ref.child('users').push();
  db.ref('.info/connected').on('value', c => {
    if(c.val()) {
      me.onDisconnect().remove();
      me.set({ name, admin: State.role==='admin' });
    }
  });
  
  ref.child('users').on('value', s => {
    State.USERS = Object.values(s.val()||{});
    renderUsers();
  });
  
  ref.child('pl').on('value', s => {
    State.PL = Object.values(s.val()||{}).map(p => ({name: p.name, items: p.items||[]}));
    if(State.pi >= State.PL.length) State.pi = Math.max(0, State.PL.length-1);
    renderPl();
  });
  
  sref.on('value', s => {
    const v = s.val() || {};
    State.sync = { q: v.q||[], i: v.i??-1, playing: !!v.playing, pos: v.pos||0, at: v.at||0, loop: v.loop||'off', vol: v.vol??100 };
    State.started = true;
    applyState();
  });
}

window.onYouTubeIframeAPIReady = () => { if(State.entered) initPlayer(); };
const apiScript = document.createElement('script');
apiScript.src = 'https://www.youtube.com/iframe_api';
document.head.append(apiScript);

function initPlayer() { 
  if(State.yt) return;
  State.yt = new YT.Player('yt', {
    host: 'https://www.youtube-nocookie.com',
    width: '100%', height: '100%',
    playerVars: { controls: 0, disablekb: 1, iv_load_policy: 3, modestbranding: 1, playsinline: 1, rel: 0, origin: location.origin, mute: 1 },
    events: {
      onReady: () => { 
        State.ytReady = true; 
        if (State.audioUnlocked) State.yt.unMute();
        State.cur = null; 
        applyState(); 
      },
      onError: e => { $('#now').textContent = 'error: ' + (State.cur ? State.cur.title : ''); },
      onStateChange: e => {
        if(e.data === 0 && State.cur) {
          const id = State.cur.id;
          act(s => {
            if(!s.q[s.i] || s.q[s.i].id !== id) return false;
            if(s.loop === 'one') { s.pos = 0; s.playing = true; } 
            else step(s, 1, true);
          });
        }
        else if((e.data === 1 || e.data === 2) && State.cur) setTimeout(setPlay, 300);
      }
    }
  });
}

const getPos = () => State.ytReady && State.cur ? State.yt.getCurrentTime() : 0;
const getDur = () => State.ytReady && State.cur ? State.yt.getDuration() : 0;

function applyVol() {
  if(State.ytReady) State.yt.setVolume(Math.round(State.sync.vol * State.myVol / 100));
  $('#mvol').value = State.sync.vol;
}

function setPlay() {
  if(!State.cur || !State.ytReady) return;
  const t = ex();
  if(Math.abs(State.yt.getCurrentTime() - t) > 2) State.yt.seekTo(t, true);
  State.sync.playing ? State.yt.playVideo() : State.yt.pauseVideo();
}

function applyState() {
  renderQ(); applyVol();
  
  const it = State.sync.q[State.sync.i];
  if(!it) {
    State.cur = null;
    if(State.ytReady) State.yt.pauseVideo();
    $('#now').textContent = 'empty queue';
    $('#pp').innerHTML = ICON_PLAY;
    $('.cover-img').style.backgroundImage = 'none';$('#memo').value = '';
    return;
  }
  if(!State.cur || State.cur.id !== it.id) {
    State.cur = it;
    if(State.ytReady) { State.yt.loadVideoById(it.vid, Math.max(0, ex())); applyVol(); }
    $('.cover-img').style.backgroundImage = `url('https://img.youtube.com/vi/${it.vid}/hqdefault.jpg')`;
  }
  $('#now').textContent = it.title;
  $('#pp').innerHTML = State.sync.playing ? ICON_PAUSE : ICON_PLAY;
  $('#memo').value = it.memo || '';
  
  if(State.sync.loop === 'off') $('#loop').style.opacity = '0.3';
  else $('#loop').style.opacity = '1'; 
  
  setPlay();
}

setInterval(() => {
  if(!State.cur) return;
  const d = getDur(), p = getPos();
  $('#seek').max = d || 1;
  if(!State.seeking) {
    $('#seek').value = p;
    $('#seek').style.setProperty('--p', (d ? (p/d)*100 : 0) + '%');
  }
  $('#time').textContent = fmt(p) + ' / ' + fmt(d);
}, 500);

function act(fn) {
  sref.transaction(s => {
    s = s || { q:[], i:-1, playing:false, pos:0, loop:'off', vol:100 };
    s.q = s.q || []; if(s.i == null) s.i = -1;
    if(s.playing && s.at) s.pos += (now() - s.at) / 1000;
    if(fn(s) === false) return;
    s.at = now(); return s;
  });
}

function step(s, d, auto) {
  let n = s.i + d, len = s.q.length;
  if(n >= len) { if(auto) { s.playing = false; s.pos = 0; } return; }
  if(n < 0) n = 0;
  s.i = n; s.pos = 0; s.playing = true;
}

$('#pp').addEventListener('click', () => { const p = getPos(); act(s => { s.pos = p; s.playing = !s.playing; }); });
$('#next').addEventListener('click', () => act(s => step(s, 1)));
$('#prev').addEventListener('click', () => act(s => step(s, -1)));
$('#loop').addEventListener('click', () => act(s => { s.loop = s.loop === 'off' ? 'one' : 'off'; }));

$('#seek').addEventListener('pointerdown', () => State.seeking = true);
$('#seek').addEventListener('input', e => e.target.style.setProperty('--p', (e.target.value / e.target.max * 100) + '%'));
$('#seek').addEventListener('change', e => { State.seeking = false; const p = +e.target.value; act(s => { s.pos = p; }); });

$('#vol').addEventListener('input', e => { State.myVol = +e.target.value; localStorage.setItem('myvol', State.myVol); applyVol(); });
$('#mvol').addEventListener('change', e => { const v = +e.target.value; act(s => { s.vol = v; }); });

const qAdd = item => act(s => { 
  if (s.q.length >= MAX_SONGS) { showToast('limit reached'); return false; }
  s.q.push({ ...item, id: uid(), memo: item.memo || '' }); 
  if(s.i < 0) { s.i = 0; s.playing = true; s.pos = 0; } 
});

const qPlay = i => act(s => { s.i = i; s.playing = true; s.pos = 0; });
const qRemove = i => act(s => {
  s.q.splice(i, 1);
  if(!s.q.length) { s.i = -1; s.playing = false; s.pos = 0; }
  else if(i < s.i) s.i--;
  else if(i === s.i) { s.i = Math.min(s.i, s.q.length-1); s.pos = 0; }
});
const qMove = (a, b) => act(s => { const c = s.q[s.i], [x] = s.q.splice(a, 1); s.q.splice(b, 0, x); s.i = s.q.indexOf(c); });

function sanitizeSong(vid, title, memo = '') {
  if (!vid || typeof vid !== 'string' || !VIDEO_ID_RE.test(vid)) return null;
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  return { type: 'yt', vid: vid, title: str(title, 200) || 'no title', memo: str(memo, 300) };
}

async function makeItem(url) {
  url = url.trim();
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
  const rawVid = m ? m[1] : url;

  if (!VIDEO_ID_RE.test(rawVid)) {
    showToast('link error'); 
    return null;
  }

  let title = rawVid;
  try {
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + rawVid));
    if (r.ok) title = (await r.json()).title || rawVid;
  } catch {}
  return sanitizeSong(rawVid, title);
}

function makeList(ul, items, o) {
  ul.innerHTML = '';
  items.forEach((it, i) => {
    const li = document.createElement('li'); li.draggable = true;
    if(o.active === i) li.className = 'on';
    
    const h = document.createElement('span'); h.className = 'h'; h.textContent = '☰';
    const t = document.createElement('span'); t.className = 't'; t.textContent = it.title;
    t.addEventListener('click', () => { if(t.contentEditable !== 'true') o.click(i); });
    
    li.append(h, t);

    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex'; btnGroup.style.gap = '4px';

    o.btns.forEach(([label, fn]) => {
      const b = document.createElement('button');
      if (label.startsWith('<svg')) b.innerHTML = label; else b.textContent = label;
      b.style.width = '28px'; b.style.padding = '4px 0'; 
      b.style.display = 'inline-flex'; b.style.justifyContent = 'center'; b.style.alignItems = 'center';
      b.addEventListener('click', () => fn(i, t)); btnGroup.append(b);
    });
    li.append(btnGroup);
    
    li.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', i));
    li.addEventListener('dragover', e => { e.preventDefault(); li.classList.add('over'); });
    li.addEventListener('dragleave', () => li.classList.remove('over'));
    li.addEventListener('drop', e => { e.preventDefault(); o.drop(+e.dataTransfer.getData('text/plain'), i); });
    ul.append(li);
  });
}

function renderQ() {
  makeList($('#queue'), State.sync.q, { active: State.sync.i, click: qPlay, drop: qMove, btns: [ ['x', qRemove] ] });
}

function renderUsers() {
  $('#utab').textContent = 'users (' + State.USERS.length + ')';
  const ul = $('#users'); ul.innerHTML = '';
  State.USERS.forEach(u => {
    const li = document.createElement('li');
    li.textContent = (u.admin ? 'admin ' : '') + u.name;
    ul.append(li);
  });
}

const savePl = () => ref.child('pl').set(State.PL);
function renderPl() {
  const sel = $('#plSel'); sel.innerHTML = '';
  State.PL.forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = p.name; sel.append(o); });
  sel.value = State.pi;
  
  const items = State.PL[State.pi] ? State.PL[State.pi].items : [];
  makeList($('#pl'), items, {
    click: i => qAdd({ ...items[i], id: uid(), memo: items[i].memo || '' }),
    drop: (a, b) => { const [x] = items.splice(a,1); items.splice(b,0,x); savePl(); },
    btns: [ 
      [ICON_EDIT, (i, t) => { 
        if (t.isEditing) return;
        t.isEditing = true;
        t.contentEditable = 'true'; 
        t.style.borderBottom = '1px solid var(--d)'; 
        t.focus(); 
        
        const sel = window.getSelection();
        sel.selectAllChildren(t);
        sel.collapseToEnd();

        const finishEdit = () => {
          t.contentEditable = 'false'; 
          t.style.borderBottom = ''; 
          t.scrollLeft = 0; 
          t.isEditing = false;
          
          window.getSelection().removeAllRanges();
          t.removeEventListener('keydown', onKeyDown);
          t.removeEventListener('blur', finishEdit);

          if (items[i].title !== t.textContent) {
            items[i].title = t.textContent; 
            savePl(); 
          }
        };

        const onKeyDown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault(); 
            t.blur(); 
          }
        };

        t.addEventListener('keydown', onKeyDown);
        t.addEventListener('blur', finishEdit);
      }],
      
      [ICON_MEMO, async i => { 
        const m = await showModal('edit memo', 'prompt', items[i].memo || ''); 
        if(m !== null) { items[i].memo = m; savePl(); } 
      }],
      ['x', i => { items.splice(i,1); savePl(); }] 
    ]
  });
}

$('#plSel').addEventListener('change', e => { State.pi = +e.target.value; renderPl(); });

$('#plNew').addEventListener('click', async () => { 
  const n = await showModal('input playlist name'); 
  if(n) { State.PL.push({name:n, items:[]}); State.pi = State.PL.length-1; savePl(); } 
});

$('#plRen').addEventListener('click', async () => { 
  if(!State.PL[State.pi]) return; 
  const n = await showModal('edit playlist name', 'prompt', State.PL[State.pi].name); 
  if(n) { State.PL[State.pi].name = n; savePl(); } 
});

$('#plDel').addEventListener('click', async () => { 
  if(State.PL[State.pi]) {
    const ok = await showModal('delete playlist ' + State.PL[State.pi].name + '?', 'confirm');
    if (ok) { State.PL.splice(State.pi,1); savePl(); }
  }
});

$('#plAdd').addEventListener('click', async () => {
  if(!State.PL[State.pi]) return showToast('select playlist');
  if(State.PL[State.pi].items.length >= MAX_SONGS) return showToast('limit reached');
  
  const it = await makeItem($('#plUrl').value);
  if(it) { State.PL[State.pi].items.push(it); $('#plUrl').value = ''; savePl(); }
});

$('#qAddDirect').addEventListener('click', async () => {
  const url = $('#plUrl').value;
  if(!url) return;
  const it = await makeItem(url);
  if(it) { qAdd(it); $('#plUrl').value = ''; }
});

$('#plAll').addEventListener('click', () => { 
  (State.PL[State.pi] ? State.PL[State.pi].items : []).forEach(it => qAdd({ ...it, id: uid(), memo: it.memo || '' })); 
});

document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.add('hide'));
  $('#t' + b.dataset.tab).classList.remove('hide');
}));

$('#out').addEventListener('click', () => { sessionStorage.removeItem('jb'); location.reload(); });

try {
  const j = JSON.parse(sessionStorage.getItem('jb') || 'null');
  if(j && (j.h === H.admin || j.h === H.view)) enter(j.name, j.h);
} catch {}
