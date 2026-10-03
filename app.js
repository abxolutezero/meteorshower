const ICON_PLAY = `<svg class="icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
const ICON_PAUSE = `<svg class="icon" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;

const H={admin:'03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', view:'9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0'}; 
const ROOM='r-h7q3v9x2m5kd'; 
firebase.initializeApp({
  apiKey:"AIzaSyCYpNrelfnjLgBDZej7OUcJi3KTMXJo2Wg",
  authDomain:"jukeboxserver-adba9.firebaseapp.com",
  projectId:"jukeboxserver-adba9",
  appId:"1:575158783677:web:f4f15591fb9118f951b1d4",
  databaseURL:"https://jukeboxserver-adba9-default-rtdb.firebaseio.com"
});
const db=firebase.database(), ref=db.ref(ROOM), sref=ref.child('s');
const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,5);
const fmt = s => { s = Math.floor(s||0); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0') };

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const MAX_SONGS = 500;

let off=0, role='view', cur=null, yt, ytReady=false, seeking=false, started=false, pi=0, PL=[], USERS=[];
let S={ q:[], i:-1, playing:false, pos:0, at:0, loop:'off', vol:100 };
let myVol = +(localStorage.getItem('myvol') || 100);

let audioUnlocked = false;
document.addEventListener('click', () => {
  if (!audioUnlocked) {
    audioUnlocked = true;
    if (ytReady && yt) {
      yt.unMute();
      applyVol();
    }
  }
});

db.ref('.info/serverTimeOffset').on('value', s => off = s.val() || 0);
const now = () => Date.now() + off;
const ex = () => S.playing ? S.pos + (now()-S.at)/1000 : S.pos; 

async function sha(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

const rand_name = ['랜덤 이름1', '랜덤 이름 2'];

$('#enter').onclick = async () => {
  let name = $('#name').value.trim();
  const h = await sha($('#pw').value);

  if(!name) { 
    name = rand_name[Math.floor(Math.random() * rand_name.length)]; 
  }
  
  if(h !== H.admin && h !== H.view) { $('#msg').textContent = 'passcode error'; return; }
  sessionStorage.setItem('jb', JSON.stringify({name, h}));
  enter(name, h);
};
$('#pw').onkeydown = e => { if(e.key === 'Enter') $('#enter').click(); };

async function enter(name, h) {
  role = h === H.admin ? 'admin' : 'view';
  document.body.className = role;
  $('#lobby').classList.add('hide'); $('#app').classList.remove('hide');
  $('#myName').textContent = (role==='admin' ? '[Admin] ' : '') + name;
  $('#seek').disabled = role !== 'admin';
  $('#vol').value = myVol;
  
  entered = true;
  if(window.YT && YT.Player) initPlayer();
  
  const me = ref.child('users').push();
  db.ref('.info/connected').on('value', c => {
    if(c.val()) {
      me.onDisconnect().remove();
      me.set({ name, admin: role==='admin' });
    }
  });
  
  ref.child('users').on('value', s => {
    USERS = Object.values(s.val()||{});
    renderUsers();
  });
  
  ref.child('pl').on('value', s => {
    PL = Object.values(s.val()||{}).map(p => ({name: p.name, items: p.items||[]}));
    if(pi >= PL.length) pi = Math.max(0, PL.length-1);
    renderPl();
  });
  
  sref.on('value', s => {
    const v = s.val() || {};
    S = { q: v.q||[], i: v.i??-1, playing: !!v.playing, pos: v.pos||0, at: v.at||0, loop: v.loop||'off', vol: v.vol??100 };
    started = true;
    applyState();
  });
}

let entered = false;
window.onYouTubeIframeAPIReady = () => { if(entered) initPlayer(); };
const apiScript = document.createElement('script');
apiScript.src = 'https://www.youtube.com/iframe_api';
document.head.append(apiScript);

function initPlayer() { 
  if(yt) return;
  yt = new YT.Player('yt', {
    host: 'https://www.youtube-nocookie.com',
    width: '100%', height: '100%',
    playerVars: { controls: 0, disablekb: 1, iv_load_policy: 3, modestbranding: 1, playsinline: 1, rel: 0, origin: location.origin, mute: 1 },
    events: {
      onReady: () => { 
        ytReady = true; 
        if (audioUnlocked) yt.unMute();
        cur = null; 
        applyState(); 
      },
      onError: e => { $('#now').textContent = 'error: ' + (cur ? cur.title : ''); },
      onStateChange: e => {
        if(e.data === 0 && cur) {
          const id = cur.id;
          act(s => {
            if(!s.q[s.i] || s.q[s.i].id !== id) return false;
            if(s.loop === 'one') { s.pos = 0; s.playing = true; } 
            else step(s, 1, true);
          });
        }
        else if((e.data === 1 || e.data === 2) && cur) setTimeout(setPlay, 300);
      }
    }
  });
}

const getPos = () => ytReady && cur ? yt.getCurrentTime() : 0;
const getDur = () => ytReady && cur ? yt.getDuration() : 0;

function applyVol() {
  if(ytReady) yt.setVolume(Math.round(S.vol * myVol / 100));
  $('#mvol').value = S.vol;
}

function setPlay() {
  if(!cur || !ytReady) return;
  const t = ex();
  if(Math.abs(yt.getCurrentTime() - t) > 2) yt.seekTo(t, true);
  S.playing ? yt.playVideo() : yt.pauseVideo();
}

function applyState() {
  renderQ(); applyVol();
  
  const it = S.q[S.i];
  if(!it) {
    cur = null;
    if(ytReady) yt.pauseVideo();
    $('#now').textContent = 'empty queue';
    $('#pp').innerHTML = ICON_PLAY;
    
    $('.cover-img').style.backgroundImage = 'none';$('#memo').value = '';
    return;
  }
  if(!cur || cur.id !== it.id) {
    cur = it;
    if(ytReady) { yt.loadVideoById(it.vid, Math.max(0, ex())); applyVol(); }
    $('.cover-img').style.backgroundImage = `url('https://img.youtube.com/vi/${it.vid}/hqdefault.jpg')`;
  }
  $('#now').textContent = it.title;
  $('#pp').innerHTML = S.playing ? ICON_PAUSE : ICON_PLAY;

  $('#memo').value = it.memo || '';
  
  if(S.loop === 'off') $('#loop').style.opacity = '0.3';
  else $('#loop').style.opacity = '1'; 
  
  setPlay();
}

setInterval(() => {
  if(!cur) return;
  const d = getDur(), p = getPos();
  $('#seek').max = d || 1;
  if(!seeking) {
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
  if(n >= len) {
     if(auto) { s.playing = false; s.pos = 0; } return; 
  }
  if(n < 0) n = 0;
  s.i = n; s.pos = 0; s.playing = true;
}

$('#pp').onclick = () => { const p = getPos(); act(s => { s.pos = p; s.playing = !s.playing; }); };
$('#next').onclick = () => act(s => step(s, 1));
$('#prev').onclick = () => act(s => step(s, -1));
$('#loop').onclick = () => act(s => { s.loop = s.loop === 'off' ? 'one' : 'off'; });

$('#seek').onpointerdown = () => seeking = true;
$('#seek').oninput = e => e.target.style.setProperty('--p', (e.target.value / e.target.max * 100) + '%');
$('#seek').onchange = e => { seeking = false; const p = +e.target.value; act(s => { s.pos = p; }); };

$('#vol').oninput = e => { myVol = +e.target.value; localStorage.setItem('myvol', myVol); applyVol(); };
$('#mvol').onchange = e => { const v = +e.target.value; act(s => { s.vol = v; }); };

const qAdd = item => act(s => { 
  if (s.q.length >= MAX_SONGS) { alert('limit reached'); return false; }
  s.q.push({ ...item, id: uid(), memo: item.memo || '' }); 
  if(s.i < 0) { 
    s.i = 0; 
    s.playing = true; 
    s.pos = 0;
  } 
});

const qPlay = i => act(s => { 
  s.i = i; 
  s.playing = true; 
  s.pos = 0;
});

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
  
  return {
    type: 'yt',
    vid: vid,
    title: str(title, 200) || 'no title',
    memo: str(memo, 300)
  };
}

async function makeItem(url) {
  url = url.trim();
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
  const rawVid = m ? m[1] : url;

  if (!VIDEO_ID_RE.test(rawVid)) {
    alert('link error');
    return null;
  }

  let title = rawVid;
  try {
    const r = await fetch(
      'https://www.youtube.com/oembed?format=json&url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + rawVid)
    );
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
    t.onclick = () => { if(t.contentEditable !== 'true') o.click(i); };
    
    li.append(h, t);

    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex';
    btnGroup.style.gap = '4px';

    o.btns.forEach(([label, fn]) => {
      const b = document.createElement('button'); b.textContent = label;
      b.style.width = '28px';
      b.style.padding = '4px 0'; 
      b.style.display = 'inline-flex';
      b.style.justifyContent = 'center';
      b.style.alignItems = 'center';
      b.onclick = () => fn(i, t); btnGroup.append(b);
    });
    li.append(btnGroup);
    
    li.ondragstart = e => e.dataTransfer.setData('text/plain', i);
    li.ondragover = e => { e.preventDefault(); li.classList.add('over'); };
    li.ondragleave = () => li.classList.remove('over');
    li.ondrop = e => { e.preventDefault(); o.drop(+e.dataTransfer.getData('text/plain'), i); };
    ul.append(li);
  });
}

function renderQ() {
  makeList($('#queue'), S.q, {
    active: S.i, click: qPlay, drop: qMove,
    btns: [ ['x', qRemove] ]
  });
}

function renderUsers() {
  $('#utab').textContent = 'users (' + USERS.length + ')';
  const ul = $('#users'); ul.innerHTML = '';
  USERS.forEach(u => {
    const li = document.createElement('li');
    li.textContent = (u.admin ? 'admin ' : '') + u.name;
    ul.append(li);
  });
}

const savePl = () => ref.child('pl').set(PL);
function renderPl() {
  const sel = $('#plSel'); sel.innerHTML = '';
  PL.forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = p.name; sel.append(o); });
  sel.value = pi;
  
  const items = PL[pi] ? PL[pi].items : [];
  makeList($('#pl'), items, {
    click: i => qAdd({ ...items[i], id: uid(), memo: items[i].memo || '' }),
    drop: (a, b) => { const [x] = items.splice(a,1); items.splice(b,0,x); savePl(); },
    btns: [ 
      ['e', (i, t) => { 
        if (t.isEditing) return;
        t.isEditing = true;
        
        t.contentEditable = 'true'; 
        t.style.borderBottom = '1px solid var(--d)'; 
        t.focus(); 
        
        const sel = window.getSelection();
        sel.selectAllChildren(t);
        sel.collapseToEnd();

        const finishEdit = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault(); 
            
            t.contentEditable = 'false'; 
            t.style.borderBottom = ''; 
            t.scrollLeft = 0; 
            t.isEditing = false;
            
            window.getSelection().removeAllRanges();
            t.removeEventListener('keydown', finishEdit);

            if (items[i].title !== t.textContent) {
              items[i].title = t.textContent; 
              savePl(); 
            }
          }
        };

        t.addEventListener('keydown', finishEdit);
      }],
      ['m', i => { const m = prompt('edit memo', items[i].memo || ''); if(m !== null) { items[i].memo = m; savePl(); } }],
      ['x', i => { items.splice(i,1); savePl(); }] 
    ]
  });
}

$('#plSel').onchange = e => { pi = +e.target.value; renderPl(); };
$('#plNew').onclick = () => { const n = prompt('input playlist name'); if(n) { PL.push({name:n, items:[]}); pi = PL.length-1; savePl(); } };
$('#plRen').onclick = () => { if(!PL[pi]) return; const n = prompt('edit playlist name', PL[pi].name); if(n) { PL[pi].name = n; savePl(); } };
$('#plDel').onclick = () => { if(PL[pi] && confirm('delete playlist '+PL[pi].name+'?')) { PL.splice(pi,1); savePl(); } };

$('#plAdd').onclick = async () => {
  if(!PL[pi]) return alert('select playlist');
  if(PL[pi].items.length >= MAX_SONGS) return alert(`limit reached`);
  
  const it = await makeItem($('#plUrl').value);
  if(it) { 
    PL[pi].items.push(it); 
    $('#plUrl').value = ''; 
    savePl(); 
  }
};

$('#qAddDirect').onclick = async () => {
  const url = $('#plUrl').value;
  if(!url) return;
  
  const it = await makeItem(url);
  if(it) { 
    qAdd(it); 
    $('#plUrl').value = ''; 
  }
};

$('#plAll').onclick = () => { 
  (PL[pi] ? PL[pi].items : []).forEach(it => qAdd({ ...it, id: uid(), memo: it.memo || '' })); 
};

document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.add('hide'));
  $('#t' + b.dataset.tab).classList.remove('hide');
});

$('#out').onclick = () => { sessionStorage.removeItem('jb'); location.reload(); };

try {
  const j = JSON.parse(sessionStorage.getItem('jb') || 'null');
  if(j && (j.h === H.admin || j.h === H.view)) enter(j.name, j.h);
} catch {}
