'use strict';
/* Prohlídky mostů – PWA pro sběr fotodokumentace a závad v terénu.
   Data zůstávají v zařízení (IndexedDB), ven jen přes export ZIP. */
const APP_VERSION = '0.6.2';
const LEAF = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
const MAXPX = 2048;          // delší strana zmenšené fotky [px]
const TARGET = 550 * 1024;   // cílová velikost JPEG [B]

/* ---------- databáze ---------- */
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('prohlidky', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('bridges', { keyPath: 'id' });
      d.createObjectStore('insp', { keyPath: 'id' });
      d.createObjectStore('photos', { keyPath: 'id' }).createIndex('insp', 'inspId');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    let out;
    const r = fn(t.objectStore(store));
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
/* Safari (iOS) neumí spolehlivě znovu uložit Blob, který přečetl z IndexedDB – zápis se zasekne nebo selže.
   Proto se Bloby ukládají jako ArrayBuffer {__blob, type} a při čtení se z nich vytvoří nové Bloby v paměti. */
async function pack(x) {
  if (x instanceof Blob) return { __blob: await x.arrayBuffer(), type: x.type };
  if (Array.isArray(x)) { const a = []; for (const v of x) a.push(await pack(v)); return a; }
  if (x && typeof x === 'object' && !(x instanceof ArrayBuffer)) { const o = {}; for (const [k, v] of Object.entries(x)) o[k] = await pack(v); return o; }
  return x;
}
function unpack(x) {
  if (x && typeof x === 'object') {
    if (x.__blob instanceof ArrayBuffer) return new Blob([x.__blob], { type: x.type || '' });
    if (x instanceof Blob || x instanceof ArrayBuffer) return x;
    if (Array.isArray(x)) return x.map(unpack);
    const o = {}; for (const [k, v] of Object.entries(x)) o[k] = unpack(v); return o;
  }
  return x;
}
const put = async (st, o) => { const v = await pack(o); return tx(st, 'readwrite', s => s.put(v)); };
const get = async (st, id) => unpack(await tx(st, 'readonly', s => s.get(id)));
const all = async st => unpack(await tx(st, 'readonly', s => s.getAll()) || []);
const del = (st, id) => tx(st, 'readwrite', s => s.delete(id));
const photosOf = async inspId => unpack(await tx('photos', 'readonly', s => s.index('insp').getAll(inspId)) || []);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- pomocné ---------- */
const $ = s => document.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = d => { d = new Date(d); return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`; };
const fmtTime = d => { d = new Date(d); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const num = (x, n) => (x == null || isNaN(x)) ? '–' : Number(x).toFixed(n).replace('.', ',');
const isoDay = d => { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function slug(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
}
let toastT;
function toast(msg, ms = 2500) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}
let urls = [];
function blobUrl(b) { const u = URL.createObjectURL(b); urls.push(u); return u; }
function setTitle(t, back) {
  $('#title').textContent = t;
  const b = $('#nav-back');
  b.style.visibility = back ? 'visible' : 'hidden';
  b.onclick = () => { location.hash = back; };
}

/* ---------- číselníky ---------- */
// Kódy částí mostu podle exportů HPM z BMS (vzorové prohlídky ve složce BMS). Seznam není úplný.
const CODES = [
  ['1.1', 'Základy mostních podpěr a křídel'], ['1.2', 'Mostní podpěry křídla a čelní zdi'], ['1.2.2', 'Pilíř'],
  ['1.2.4', 'Křídlo'], ['1.3.1', 'Zemní těleso'], ['2.1', 'Nosná konstrukce'], ['2.2', 'Ložiska, klouby'],
  ['2.3', 'Mostní závěry'], ['2.4', 'Čelní zdi a přesypávka'], ['3.1', 'Vozovka'], ['3.2', 'Chodníky'],
  ['3.3', 'Římsy, obrubníky, zálivky'], ['3.3.1', 'Římsa'], ['3.5', 'Izolační systém NK'],
  ['4.1', 'Svodidla/Zábradelní svodidla'], ['4.2', 'Zábradlí'], ['4.3', 'Dopravní značení, označení objektu'],
  ['4.6', 'Území pod mostem a přístup. cesty'], ['4.7', 'Cizí zařízení'], ['4.8', 'Odvodnění'], ['5', 'Další části'],
];
const codeName = c => (CODES.find(x => x[0] === c) || [c, ''])[1];
const DRUHY = { bezna: 'Běžná', podjezd: 'Podjezdu', hlavni: 'Hlavní / první hlavní', mimoradna: 'Technická / mimořádná' };
// vývoj závady oproti minulé prohlídce (vlastní označení aplikace, ne číselník BMS)
const VYVOJ = { nova: 'nová', beze: 'beze změny', zhor: 'zhoršeno' };
const KONTROLA = [['beze', 'Beze změny'], ['zhor', 'Zhoršeno'], ['odst', 'Odstraněno'], ['nez', 'Nezkontrolováno']];

/* Kontrolní seznam fotodokumentace – ČSN 73 6221, tab. 4 (doporučený rozsah). */
const ALL = ['bezna', 'podjezd', 'hlavni', 'mimoradna'];
const GROUPS = [ // [prefix klíče, název skupiny, druhy prohlídek, pořadí ve zprávě]
  ['na', 'Prostorové uspořádání na mostě', ['bezna', 'hlavni', 'mimoradna']],
  ['bok', 'Boční pohledy na most', ALL],
  ['pod', 'Prostorové uspořádání pod mostem', ALL],
  ['sup', 'Pohledy na jednotlivé podpěry', ALL],
  ['kr', 'Pohledy na křídla krajních opěr', ALL],
  ['nk', 'Podhled NK v jednotlivých polích', ALL],
  ['loz', 'Ložiska a klouby', ['hlavni', 'mimoradna']],
  ['mz', 'Mostní závěry (pohled shora)', ['bezna', 'hlavni', 'mimoradna']],
];
function supports(br) {
  const n = Math.max(1, br.poli | 0), s = [];
  for (let i = 1; i <= n + 1; i++) s.push(i === 1 || i === n + 1 ? 'OP' + i : 'P' + i);
  return s;
}
function checklist(br, druh) {
  const n = Math.max(1, br.poli | 0), sup = supports(br), ends = [sup[0], sup[sup.length - 1]];
  const it = [];
  const add = (g, key, cap, dir) => { if (GROUPS.find(x => x[0] === g)[2].includes(druh)) it.push({ g, key, cap, dir }); };
  add('na', 'na-po', 'Pohled na most po směru staničení.');
  add('na', 'na-proti', 'Pohled na most proti směru staničení.');
  add('bok', 'bok-L', 'Pohled na most zleva ve směru staničení.');
  add('bok', 'bok-P', 'Pohled na most zprava ve směru staničení.');
  add('pod', 'pod', 'Pohled pod most.', true);
  sup.forEach(s => add('sup', 'sup-' + s, `Pohled na ${s}.`, true));
  ends.forEach(s => add('kr', 'kr-' + s, `Pohled na křídla ${s}.`, true));
  for (let i = 1; i <= n; i++) add('nk', 'nk-' + i, n === 1 ? 'Pohled na podhled NK.' : `Pohled na podhled NK v poli ${i}.`);
  sup.forEach(s => add('loz', 'loz-' + s, `Pohled na ložiska na ${s}.`));
  ends.forEach(s => add('mz', 'mz-' + s, `Pohled na mostní závěr na ${s}.`));
  return it;
}
const groupIdx = key => { const g = String(key || '').split('-')[0]; const i = GROUPS.findIndex(x => x[0] === g); return i >= 0 ? i : key === 'zavada' ? 90 : 99; };

/* Směr pohledu vůči staničení: heading = azimut osy kamery, az = azimut směru staničení. */
function dirWord(heading, az) {
  if (heading == null || az == null || az === '') return '';
  const r = ((heading - az) % 360 + 360) % 360;
  if (r < 45 || r >= 315) return 've směru staničení';
  if (r < 135) return 'zleva';      // kamera míří doprava → fotograf stojí vlevo
  if (r < 225) return 'proti směru staničení';
  return 'zprava';
}
function defaultCaption(item, dir) {
  if (!item) return '';
  if (item.dir && dir) return item.cap.replace(/\.$/, '') + ' ' + dir + '.';
  return item.cap;
}

/* Souřadnice: WGS84 desetinně nebo DMS. */
function parseCoords(s) {
  s = String(s || '').trim();
  if (!s) return null;
  const dms = [...s.matchAll(/(\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*['′]\s*)?(?:(\d+(?:[.,]\d+)?)\s*["″]\s*)?([NSEWsvjz])?/gi)];
  let v;
  if (dms.length === 2) {
    v = dms.map(m => {
      let x = parseFloat(m[1].replace(',', '.')) + (m[2] ? parseFloat(m[2].replace(',', '.')) / 60 : 0) + (m[3] ? parseFloat(m[3].replace(',', '.')) / 3600 : 0);
      if (/[SWjz]/i.test(m[4] || '')) x = -x;
      return x;
    });
  } else {
    const nums = s.replace(/(\d),(\d)/g, '$1.$2').match(/-?\d+(?:\.\d+)?/g);
    if (!nums || nums.length !== 2) return null;
    v = nums.map(Number);
  }
  if (Math.abs(v[0]) > 1000 || Math.abs(v[1]) > 1000) return { err: 'Vypadá to na S-JTSK – zatím podporuji jen WGS84 (např. 50.1234, 14.5678).' };
  const lat = Math.max(v[0], v[1]), lon = Math.min(v[0], v[1]); // v ČR je šířka (48–51) větší než délka (12–19)
  return { lat, lon };
}
/* S-JTSK (Křovák, Bessel) → WGS84. Vstup v podobě BMS (záporné X = −Y_JTSK, Y = −X_JTSK).
   Ověřeno na 605-026: BMS zobrazuje 49,966861 N / 14,075390 E pro X=-769210.396, Y=-1052861.912. */
function jtsk2wgs(bx, by, H = 245) {
  const X = Math.abs(by), Y = Math.abs(bx);
  const a = 6377397.15508, e = 0.081696831215303, n = 0.97992470462083, kro = 12310230.12797036,
    sinUQ = 0.863499969506341, cosUQ = 0.504348889819882, sinVQ = 0.420215144586493, cosVQ = 0.907424504992097,
    alfa = 1.000597498371542, k = 1.003419163966575;
  let ro = Math.sqrt(X * X + Y * Y);
  const D = 2 * Math.atan(Y / (ro + X)) / n, S = 2 * Math.atan(Math.exp(1 / n * Math.log(kro / ro))) - Math.PI / 2;
  const sinS = Math.sin(S), cosS = Math.cos(S), sinD = Math.sin(D), cosD = Math.cos(D);
  const sinU = sinUQ * sinS - cosUQ * cosS * cosD, cosU = Math.sqrt(1 - sinU * sinU);
  const sinDV = sinD * cosS / cosU, cosDV = Math.sqrt(1 - sinDV * sinDV);
  const sinV = sinVQ * cosDV - cosVQ * sinDV, cosV = cosVQ * cosDV + sinVQ * sinDV;
  const Lj = 2 * Math.atan(sinV / (1 + cosV)) / alfa;
  let t = Math.exp(2 / alfa * Math.log((1 + sinU) / cosU / k)), pom = (t - 1) / (t + 1), sinB, it = 0;
  do { sinB = pom; pom = t * Math.exp(e * Math.log((1 + e * sinB) / (1 - e * sinB))); pom = (pom - 1) / (pom + 1); } while (Math.abs(pom - sinB) > 1e-15 && ++it < 50);
  const Bj = Math.atan(pom / Math.sqrt(1 - pom * pom));
  const e2 = 1 - (1 - 1 / 299.152812853) ** 2; ro = a / Math.sqrt(1 - e2 * Math.sin(Bj) ** 2);
  const x = (ro + H) * Math.cos(Bj) * Math.cos(Lj), y = (ro + H) * Math.cos(Bj) * Math.sin(Lj), z = ((1 - e2) * ro + H) * Math.sin(Bj);
  const r = Math.PI / 180 / 3600, wz = -5.2611 * r, wy = -1.58676 * r, wx = -4.99821 * r, m = 3.543e-6;
  const xn = 570.69 + (1 + m) * (x + wz * y - wy * z), yn = 85.69 + (1 + m) * (-wz * x + y + wx * z), zn = 462.84 + (1 + m) * (wy * x - wx * y + z);
  const aW = 6378137.0, fW = 298.257223563, ab = fW / (fW - 1), p = Math.sqrt(xn * xn + yn * yn), e2W = 1 - (1 - 1 / fW) ** 2;
  const th = Math.atan(zn * ab / p), st = Math.sin(th), ct = Math.cos(th);
  const tt = (zn + e2W * ab * aW * st ** 3) / (p - e2W * aW * ct ** 3);
  return { lat: Math.atan(tt) * 180 / Math.PI, lon: 2 * Math.atan(yn / (p + xn)) * 180 / Math.PI };
}
const normEvc = s => String(s || '').replace(/\s+/g, '').toUpperCase();
async function dataUrlToBlob(u) { return u ? (await fetch(u)).blob() : null; }
/* overlay pro zvětšení obrázku */
function showBig(url, cap) {
  const o = document.createElement('div');
  o.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px';
  o.innerHTML = `<img src="${url}" style="max-width:100%;max-height:85vh;border-radius:8px"><div style="color:#fff;margin-top:8px;text-align:center">${esc(cap || '')}</div>`;
  o.onclick = () => o.remove();
  document.body.appendChild(o);
}
function distM(a, b, c, d) {
  const R = 6371000, r = Math.PI / 180;
  const x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/* ---------- senzory: GPS + kompas ---------- */
const S = { on: false, heading: null, lat: null, lon: null, acc: null, t: 0 };
function ensureSensors() {
  if (S.on) return;
  S.on = true;
  const listen = () => {
    window.addEventListener('deviceorientation', e => {
      if (e.webkitCompassHeading != null) S.heading = e.webkitCompassHeading;       // iOS
      else if (e.absolute && e.alpha != null) S.heading = (360 - e.alpha) % 360;
      hud();
    }, true);
  };
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(r => { if (r === 'granted') listen(); else toast('Kompas nepovolen'); }).catch(() => toast('Kompas nepovolen'));
    } else listen();
  } catch (e) { /* bez kompasu */ }
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(p => {
      S.lat = p.coords.latitude; S.lon = p.coords.longitude; S.acc = p.coords.accuracy; S.t = Date.now(); hud();
    }, e => toast('GPS: ' + e.message), { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }
}
function snap() {
  return {
    ts: Date.now(), heading: S.heading,
    lat: S.lat, lon: S.lon, acc: S.acc, gpsAge: S.t ? Math.round((Date.now() - S.t) / 1000) : null,
  };
}
let hudCtx = null; // {az}
function hud() {
  const h = document.getElementById('hud-sens');
  if (!h) return;
  const d = hudCtx ? dirWord(S.heading, hudCtx.az) : '';
  h.textContent = `${S.heading == null ? 'kompas –' : 'az ' + Math.round(S.heading) + '°'}${d ? ' · ' + d : ''} · ${S.acc == null ? 'GPS –' : 'GPS ±' + Math.round(S.acc) + ' m'}`;
}

/* ---------- zpracování fotky ---------- */
async function processImage(src, date) {
  const bmp = await createImageBitmap(src);
  const s = Math.min(1, MAXPX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  // datum pořízení do pravého dolního rohu (ČSN 73 6221, 9.1.8)
  const fs = Math.round(Math.max(w, h) * 0.028), txt = fmtDate(date);
  g.font = `bold ${fs}px -apple-system, Helvetica, Arial, sans-serif`;
  g.textAlign = 'right'; g.textBaseline = 'bottom';
  g.lineWidth = Math.max(2, fs * 0.16); g.strokeStyle = '#000'; g.lineJoin = 'round';
  g.strokeText(txt, w - fs * 0.6, h - fs * 0.45);
  g.fillStyle = '#ffd400'; g.fillText(txt, w - fs * 0.6, h - fs * 0.45);
  let q = 0.86, b;
  do { b = await new Promise(r => c.toBlob(r, 'image/jpeg', q)); q -= 0.06; } while (b.size > TARGET && q > 0.45);
  return b;
}

/* ---------- ZIP (bez komprese, bez knihoven) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [], now = new Date();
  const dt = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dd = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  let off = 0;
  for (const f of files) {
    const data = typeof f.data === 'string' ? enc.encode(f.data) : new Uint8Array(await f.data.arrayBuffer());
    const nm = enc.encode(f.name), crc = crc32(data);
    const l = new DataView(new ArrayBuffer(30));
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true);
    l.setUint16(10, dt, true); l.setUint16(12, dd, true); l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, nm.length, true);
    parts.push(l.buffer, nm, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true);
    c.setUint32(42, off, true);
    central.push(c.buffer, nm);
    off += 30 + nm.length + data.length;
  }
  const size = central.reduce((a, b) => a + b.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}
async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 10000);
  return true;
}

/* ---------- router ---------- */
let stream = null, recorder = null, mapObj = null, mapTimer = null;
function cleanup() {
  if (mapTimer) { clearInterval(mapTimer); mapTimer = null; }
  if (mapObj) { mapObj.remove(); mapObj = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (recorder && recorder.state === 'recording') recorder.stop();
  recorder = null; hudCtx = null;
  urls.forEach(u => URL.revokeObjectURL(u)); urls = [];
}
async function route() {
  cleanup();
  const [path, q] = location.hash.slice(1).split('?');
  const p = (path || '/').split('/').filter(Boolean);
  const qs = new URLSearchParams(q || '');
  window.scrollTo(0, 0);
  try {
    if (!p.length) return await vBridges();
    if (p[0] === 'most' && p[1] === 'novy') return await vBridgeEdit(null);
    if (p[0] === 'most' && p[2] === 'upravit') return await vBridgeEdit(p[1]);
    if (p[0] === 'most') return await vBridge(p[1]);
    if (p[0] === 'prohlidka') return await vInsp(p[1]);
    if (p[0] === 'kamera') return await vCamera(p[1], qs.get('k') || 'jine', qs.get('d'));
    if (p[0] === 'kontrola') return await vCheck(p[1]);
    if (p[0] === 'foto') return await vPhoto(p[1], qs.get('dal') === '1');
    if (p[0] === 'zavada') return await vDefect(p[1], p[2]);
    if (p[0] === 'data') return await vData();
    if (p[0] === 'mapa') return await vMap(p[1] === 'vse');
    if (p[0] === 'minula') return await vPrev(p[1], qs.get('p'));
    if (p[0] === 'mostni-list') return await vList(p[1]);
    if (p[0] === 'popis') return await vDesc(p[1]);
    location.hash = '#/';
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="card"><h2>Chyba</h2><p>${esc(e.message || e)}</p><a class="btn" href="#/">Domů</a></div>`;
  }
}

/* ---------- seznam mostů ---------- */
async function vBridges() {
  setTitle('Prohlídky mostů', null);
  const today = isoDay(Date.now());
  const bs = (await all('bridges')).sort((a, b) => (b.plan === today) - (a.plan === today) || String(a.evc).localeCompare(String(b.evc), 'cs', { numeric: true }));
  const ins = await all('insp');
  const nToday = bs.filter(b => b.plan === today).length;
  app.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <a class="btn pri grow" href="#/most/novy">+ Nový most</a>
      <a class="btn" href="#/mapa${nToday ? '' : '/vse'}">🗺 Mapa</a>
      <a class="btn" href="#/data">Data</a>
    </div>
    <div class="card">${bs.length ? `<p class="muted" style="margin:0 0 4px">Tlačítkem „dnes“ označ mosty, na které dnes jedeš – zobrazí se nahoře a na mapě.</p><ul class="list">${bs.map(b => {
      const n = ins.filter(i => i.bridgeId === b.id), open = n.filter(i => !i.exportedAt).length, pl = b.plan === today;
      return `<li><a class="grow" href="#/most/${b.id}"><b>${esc(b.evc)}</b> ${esc(b.nazev)}<div class="muted">${b.poli || 1} ${(b.poli | 0) > 1 ? 'polí' : 'pole'}${n.length ? ` · prohlídek ${n.length}` : ''}${b.lat == null ? ' · bez souřadnic' : ''}</div></a>${open ? `<span class="badge miss">neexp. ${open}</span>` : ''}<button class="small${pl ? ' pri' : ''}" data-plan="${b.id}">${pl ? '✓ dnes' : 'dnes'}</button></li>`;
    }).join('')}</ul>` : '<p class="muted">Zatím žádné mosty. Přidej most ručně (údaje z BMS) nebo hromadně importem v sekci Data.</p>'}</div>`;
  // přepnutí „dnes“ na místě – bez překreslení seznamu a skoku nahoru; pořadí se srovná při dalším otevření
  app.querySelectorAll('[data-plan]').forEach(bt => bt.onclick = async ev => {
    ev.preventDefault(); ev.stopPropagation();
    if (bt.disabled) return; bt.disabled = true;
    try {
      const b = await get('bridges', bt.dataset.plan);           // čerstvý záznam (import ho mohl mezitím změnit)
      b.plan = b.plan === today ? null : today; await put('bridges', b);
      const on = b.plan === today;
      bt.classList.toggle('pri', on); bt.textContent = on ? '✓ dnes' : 'dnes';
      const n = app.querySelectorAll('[data-plan].pri').length;
      const mapa = app.querySelector('a[href^="#/mapa"]'); if (mapa) mapa.href = n ? '#/mapa' : '#/mapa/vse';
    } catch (e) { toast('Nepodařilo se uložit: ' + e.message, 4000); }
    bt.disabled = false;
  });
}

/* ---------- mapa mostů ---------- */
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return new Promise((res, rej) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = LEAF + 'leaflet.css'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = LEAF + 'leaflet.js';
    s.onload = res; s.onerror = () => rej(new Error('Mapu nelze načíst – chybí připojení k internetu.'));
    document.head.appendChild(s);
  });
}
async function vMap(showAll) {
  setTitle('Mapa mostů', '#/');
  const today = isoDay(Date.now());
  const bs = (await all('bridges')).filter(b => b.lat != null);
  const ins = await all('insp');
  const planned = bs.filter(b => b.plan === today);
  const sel = showAll ? bs : planned;
  app.innerHTML = `
    <div class="row" style="margin-bottom:8px">
      <a class="btn grow${showAll ? '' : ' pri'}" href="#/mapa">Dnes (${planned.length})</a>
      <a class="btn grow${showAll ? ' pri' : ''}" href="#/mapa/vse">Všechny (${bs.length})</a>
    </div>
    <div id="map" style="height:60vh;border-radius:12px;overflow:hidden;border:1px solid var(--line)"></div>
    <div class="row" style="margin-top:8px">
      <button class="grow" id="me">📍 Moje poloha</button>
      <button class="grow${planned.length ? ' pri' : ''}" id="route">Trasa po dnešních mostech</button>
    </div>
    <div id="routebox"></div>
    <p class="muted">Modrá = naplánováno na dnes, zelená = dnes již založená prohlídka, šedá = ostatní. Klepnutím na bod navigace. Mapa potřebuje signál.</p>`;
  await loadLeaflet();
  const m = mapObj = L.map('map');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
  const pts = [];
  for (const b of sel) {
    const done = ins.some(i => i.bridgeId === b.id && i.datum === today);
    const col = done ? '#1e7d3c' : b.plan === today ? '#2f6fb3' : '#888';
    L.circleMarker([b.lat, b.lon], { radius: 10, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 })
      .addTo(m)
      .bindTooltip(esc(b.evc), { permanent: sel.length <= 20, direction: 'top', offset: [0, -10] })
      .bindPopup(`<b>${esc(b.evc)}</b><br>${esc(b.nazev)}<br><br>
        <a href="https://maps.apple.com/?daddr=${b.lat},${b.lon}&dirflg=d">▶ Navigovat – Apple Mapy</a><br>
        <a href="https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lon}&travelmode=driving">▶ Navigovat – Google</a><br><br>
        <a href="#/most/${b.id}">Otevřít most</a>`);
    pts.push([b.lat, b.lon]);
  }
  if (pts.length) m.fitBounds(pts, { padding: [30, 30], maxZoom: 14 }); else m.setView([49.8, 15.5], 7);
  let me = null;
  const updMe = () => {
    if (S.lat == null) return;
    if (!me) me = L.circleMarker([S.lat, S.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#e53935', fillOpacity: 1 }).addTo(m).bindTooltip('já');
    else me.setLatLng([S.lat, S.lon]);
  };
  mapTimer = setInterval(updMe, 2000); updMe();
  $('#me').onclick = () => {
    ensureSensors();
    if (S.lat != null) m.setView([S.lat, S.lon], Math.max(m.getZoom(), 12)); else toast('Čekám na GPS…');
  };
  $('#route').onclick = () => {
    if (!planned.length) {
      const old = (bs.filter(b => b.plan && b.plan < today)).length;
      $('#routebox').innerHTML = `<div class="card" style="margin-top:8px"><b>Na dnešek není naplánovaný žádný most.</b>
        <p class="muted" style="margin-bottom:0">V seznamu mostů klepni u mostů, kam dnes jedeš, na „dnes“.${old ? ` ${old} most(y) mají označení z dřívějšího dne – to platí jen pro ten den.` : ''}</p></div>`;
      $('#routebox').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    ensureSensors();
    const me = S.lat != null ? [S.lat, S.lon] : null;
    // pořadí: nejbližší soused od aktuální polohy (bez GPS od nejzápadnějšího mostu)
    let rest = [...planned];
    let cur = me || (rest.sort((a, b) => a.lon - b.lon), [rest[0].lat, rest[0].lon]);
    const order = [];
    while (rest.length) {
      rest.sort((a, b) => distM(cur[0], cur[1], a.lat, a.lon) - distM(cur[0], cur[1], b.lat, b.lon));
      const n = rest.shift(); order.push(n); cur = [n.lat, n.lon];
    }
    const ll = b => `${b.lat},${b.lon}`, lonlat = b => `${b.lon},${b.lat}`;
    // Mapy.com: start, cíl a max. 15 průjezdních bodů (formát délka,šířka; oddělovač „;“)
    const mStart = me ? `${me[1]},${me[0]}` : lonlat(order[0]);
    const mPts = me ? order : order.slice(1);
    const mapy = mPts.length ? `https://mapy.com/fnc/v1/route?mapset=traffic&routeType=car_fast_traffic&start=${mStart}&end=${lonlat(mPts[mPts.length - 1])}` +
      (mPts.length > 1 ? `&waypoints=${mPts.slice(0, -1).slice(0, 15).map(lonlat).join(';')}` : '') : '';
    // Google na mobilu přijme jen 3 průjezdní body → úseky po 4 mostech
    const legs = [];
    for (let k = 0; k < order.length; k += 4) {
      const part = order.slice(k, k + 4), last = part[part.length - 1], wp = part.slice(0, -1).map(ll).join('|');
      const origin = k ? `&origin=${ll(order[k - 1])}` : '';
      legs.push({ from: k + 1, to: k + part.length, url: `https://www.google.com/maps/dir/?api=1${origin}&destination=${ll(last)}${wp ? '&waypoints=' + encodeURIComponent(wp) : ''}&travelmode=driving` });
    }
    const ext = 'target="_blank" rel="noopener"';
    $('#routebox').innerHTML = `<div class="card" style="margin-top:8px"><h2>Trasa po dnešních mostech (${order.length})</h2>
      <p class="muted" style="margin-top:0">Pořadí podle nejbližšího dalšího mostu ${me ? 'od tvé polohy' : '(bez GPS – od nejzápadnějšího mostu)'}.</p>
      <ol style="margin:0 0 10px;padding-left:22px">${order.map(b => `<li><b>${esc(b.evc)}</b> ${esc(b.nazev)}</li>`).join('')}</ol>
      ${mapy ? `<a class="btn pri wide" ${ext} href="${mapy}">▶ Celá trasa – Mapy.com</a>${order.length > 16 ? '<p class="muted">Mapy.com vezmou nejvýš 15 průjezdních bodů, další mosty doplň ručně.</p>' : ''}` : ''}
      <div class="row" style="margin-top:8px">${legs.map(l => `<a class="btn grow" ${ext} href="${l.url}">Google${legs.length > 1 ? ` – mosty ${l.from}–${l.to}` : ''}</a>`).join('')}</div>
      <p class="muted">Google na mobilu přijme jen 3 průjezdní body, proto je trasa rozdělená na úseky. Apple Mapy více zastávek přes odkaz neumí – navigace k jednotlivému mostu je v jeho bublině na mapě.</p></div>`;
    $('#routebox').scrollIntoView({ behavior: 'smooth' });
  };
}

/* ---------- most: editace ---------- */
async function vBridgeEdit(id) {
  const b = id ? await get('bridges', id) : { id: uid(), evc: '', nazev: '', lat: null, lon: null, poli: 1, az: null, smer: '', pozn: '' };
  setTitle(id ? 'Upravit most' : 'Nový most', id ? `#/most/${id}` : '#/');
  app.innerHTML = `<div class="card">
    <label>Evidenční číslo</label><input id="evc" value="${esc(b.evc)}" placeholder="např. 118-039">
    <label>Název</label><input id="nazev" value="${esc(b.nazev)}">
    <label>Souřadnice WGS84 (z BMS, mapy.cz…)</label><input id="gps" value="${b.lat != null ? b.lat + ', ' + b.lon : ''}" placeholder="50.1234, 14.5678" inputmode="text">
    <label>Počet polí</label><input id="poli" type="number" min="1" value="${b.poli || 1}">
    <label>Staničení ve směru (text z BMS)</label><input id="smer" value="${esc(b.smer)}" placeholder="např. Nouzov → Kladno">
    <label>Azimut směru staničení [°] – lze nastavit na místě kompasem</label><input id="az" type="number" step="1" min="0" max="359" value="${b.az ?? ''}">
    <label>Poznámka</label><textarea id="pozn">${esc(b.pozn)}</textarea>
    <div class="row" style="margin-top:12px"><button class="pri grow" id="save">Uložit</button>${id ? '<button class="bad" id="del">Smazat</button>' : ''}</div>
  </div>`;
  $('#save').onclick = async () => {
    const g = parseCoords($('#gps').value);
    if (g && g.err) return toast(g.err, 5000);
    if ($('#gps').value.trim() && !g) return toast('Souřadnice nerozpoznány');
    Object.assign(b, {
      evc: $('#evc').value.trim(), nazev: $('#nazev').value.trim(), poli: Math.max(1, parseInt($('#poli').value) || 1),
      smer: $('#smer').value.trim(), az: $('#az').value === '' ? null : ((+$('#az').value % 360) + 360) % 360, pozn: $('#pozn').value,
      lat: g ? g.lat : null, lon: g ? g.lon : null,
    });
    if (!b.evc) return toast('Doplň evidenční číslo');
    await put('bridges', b);
    location.hash = `#/most/${b.id}`;
  };
  if (id) $('#del').onclick = async () => {
    const n = (await all('insp')).filter(i => i.bridgeId === id).length;
    if (n) return toast('Most má prohlídky – nejdřív je smaž.');
    if (!confirm('Smazat most?')) return;
    await del('bridges', id); location.hash = '#/';
  };
}

/* ---------- most: detail ---------- */
async function vBridge(id) {
  const b = await get('bridges', id);
  if (!b) { location.hash = '#/'; return; }
  setTitle(`${b.evc}`, '#/');
  const ins = (await all('insp')).filter(i => i.bridgeId === id).sort((a, c) => c.created - a.created);
  const has = b.lat != null;
  app.innerHTML = `
    <div class="card"><h2>${esc(b.evc)} ${esc(b.nazev)}</h2>
      <div class="kv">
        <b>Souřadnice</b><span>${has ? num(b.lat, 6) + ', ' + num(b.lon, 6) : '[doplnit]'}</span>
        <b>Polí</b><span>${b.poli || 1} (${supports(b).join(', ')})</span>
        <b>Staničení</b><span>${esc(b.smer) || '–'}</span>
        <b>Azimut stan.</b><span>${b.az != null ? Math.round(b.az) + '°' : '[nenastaven]'}</span>
        <b>Vzdálenost</b><span id="dist">–</span>
      </div>
      ${b.pozn ? `<p class="muted">${esc(b.pozn)}</p>` : ''}
      <div class="row" style="margin-top:10px">
        ${has ? `<a class="btn grow" href="https://maps.apple.com/?daddr=${b.lat},${b.lon}&dirflg=d">Apple Mapy</a>
        <a class="btn grow" href="https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lon}">Google</a>
        <a class="btn grow" href="https://mapy.cz/zakladni?source=coor&id=${b.lon},${b.lat}&x=${b.lon}&y=${b.lat}&z=17">Mapy.cz</a>` : ''}
      </div>
      <div class="row" style="margin-top:8px"><a class="btn grow" href="#/most/${id}/upravit">Upravit</a></div>
    </div>
    ${b.mostniList || b.prev ? `<div class="card"><h2>Podklady z BMS</h2>
      ${b.prev ? `<p style="margin:0 0 8px">Minulá: ${esc(prevTitle(b.prev))}<br><span class="muted">SS ${esc((b.prev.rozhodnuti || {}).ss || '–')} · NK ${esc((b.prev.rozhodnuti || {}).nk || '–')} · závad ${b.prev.zavady.length} · fotek ${b.prev.fota.length}${(b.prevOther || []).length ? ` · dalších prohlídek ${b.prevOther.length}` : ''}</span></p>` : ''}
      <div class="row">${b.mostniList ? `<a class="btn grow" href="#/mostni-list/${id}">Mostní list</a>` : ''}${b.prev ? `<a class="btn grow" href="#/minula/${id}">Minulé prohlídky</a>` : ''}</div></div>` : ''}
    <div class="card"><h2>Směr staničení kompasem</h2>
      <p class="muted">Postav se na most, namiř zadní stranu telefonu ve směru staničení a stiskni Uložit. Slouží k automatickému určení „zleva / zprava / po směru“ u fotek.</p>
      <div class="row"><span class="grow" id="hud-sens">senzory vypnuty</span><button id="sens">Zapnout</button><button class="pri" id="setaz">Uložit</button></div>
    </div>
    <div class="card"><h2>Prohlídky</h2>
      <div class="row"><select id="druh" class="grow">${Object.entries(DRUHY).map(([k, v]) => `<option value="${k}"${k === 'hlavni' ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <button class="pri" id="newi">+ Nová</button></div>
      <ul class="list">${ins.map(i => `<li><a class="grow" href="#/prohlidka/${i.id}">${esc(DRUHY[i.druh])} – ${fmtDate(i.datum)}</a>${i.exportedAt ? '<span class="badge ok">export</span>' : '<span class="badge miss">rozpracováno</span>'}</li>`).join('')}</ul>
    </div>`;
  const upd = () => { if (has && S.lat != null) $('#dist').textContent = `${num(distM(S.lat, S.lon, b.lat, b.lon) / 1000, 2)} km`; hud(); };
  if (S.on) upd();
  const ti = setInterval(() => { if (!document.getElementById('dist')) return clearInterval(ti); upd(); }, 1000);
  $('#sens').onclick = () => { ensureSensors(); toast('Senzory zapnuty'); };
  $('#setaz').onclick = async () => {
    ensureSensors();
    if (S.heading == null) return toast('Kompas zatím nemá hodnotu – zapni senzory a chvíli počkej.');
    b.az = Math.round(S.heading); await put('bridges', b); toast(`Azimut staničení ${b.az}° uložen`); route();
  };
  $('#newi').onclick = async () => {
    const i = { id: uid(), bridgeId: id, druh: $('#druh').value, datum: isoDay(Date.now()), created: Date.now(),
      pocasi: '', tVzd: '', tNK: '', zpristupneni: '', defects: [], na: {}, nextSeq: 0, exportedAt: null };
    await put('insp', i);
    location.hash = `#/prohlidka/${i.id}`;
  };
}

/* ---------- prohlídka ---------- */
async function vInsp(id) {
  const i = await get('insp', id);
  if (!i) { location.hash = '#/'; return; }
  const b = await get('bridges', i.bridgeId);
  const ph = (await photosOf(id)).sort((a, c) => a.seq - c.seq);
  const items = checklist(b, i.druh);
  setTitle(`${b.evc} – ${DRUHY[i.druh]}`, `#/most/${b.id}`);
  const cnt = k => ph.filter(p => p.key === k).length;
  const missing = items.filter(t => !cnt(t.key) && !i.na[t.key]).length;
  const camLink = k => `#/kamera/${id}?k=${encodeURIComponent(k)}`;
  app.innerHTML = `
    <div class="card"><details><summary>Údaje o prohlídce</summary>
      <label>Datum</label><input id="datum" type="date" value="${i.datum}">
      <label>Druh</label><select id="druh">${Object.entries(DRUHY).map(([k, v]) => `<option value="${k}"${k === i.druh ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <label>Počasí</label><input id="pocasi" value="${esc(i.pocasi)}">
      <div class="row"><div class="grow"><label>Teplota vzduchu [°C]</label><input id="tVzd" inputmode="decimal" value="${esc(i.tVzd)}"></div>
      <div class="grow"><label>Teplota NK [°C]</label><input id="tNK" inputmode="decimal" value="${esc(i.tNK)}"></div></div>
      <button class="wide" id="wx" style="margin-top:8px">🌡 Doplnit teplotu a počasí podle polohy mostu</button>
      <p class="muted" id="wxst" style="margin:4px 0 0">${i.wx ? `Z Open-Meteo ${esc(i.wx)}` : 'Aktuální hodnota z modelu Open-Meteo (bez klíče), posílá se jen poloha mostu. Teplotu NK nedoplňuje.'}</p>
      <label>Způsob zpřístupnění</label><input id="zpr" value="${esc(i.zpristupneni)}">
      <div class="row" style="margin-top:10px"><button class="pri grow" id="savei">Uložit údaje</button><button class="bad" id="deli">Smazat prohlídku</button></div>
    </details></div>

    <div class="row" style="margin-bottom:12px">
      <a class="btn grow" href="#/popis/${id}">Popis částí (B) ${i.casti && i.casti.length ? `<span class="badge ok">${i.casti.length}</span>` : '<span class="badge miss">prázdný</span>'}</a>
      ${b.prev ? `<a class="btn grow" href="#/minula/${b.id}">Minulá prohlídka</a>` : ''}
    </div>
    ${b.prev && b.prev.zavady.length ? (() => {
      const pc = checkValid(i, b) ? i.prevCheck || {} : {}, done = b.prev.zavady.filter((z, k) => pc[k] && pc[k].st).length, tot = b.prev.zavady.length;
      return `<a class="btn wide" style="margin-bottom:12px" href="#/kontrola/${id}">Závady z minulé prohlídky <span class="badge ${done === tot ? 'ok' : 'miss'}">${done}/${tot}</span></a>`;
    })() : ''}
    <div class="row" style="margin-bottom:12px">
      <a class="btn pri grow" href="${camLink('zavada')}" data-cam>📷 Závada</a>
      <a class="btn grow" href="${camLink('jine')}" data-cam>📷 Jiné foto</a>
    </div>

    <div class="card"><h2>Povinné záběry (ČSN 73 6221, tab. 4) ${missing ? `<span class="badge miss">chybí ${missing}</span>` : '<span class="badge ok">kompletní</span>'}</h2>
      <ul class="list">${items.map(t => {
        const c = cnt(t.key), na = i.na[t.key];
        return `<li><a class="grow" href="${camLink(t.key)}" data-cam>${esc(t.cap)}<div class="muted">${esc(GROUPS.find(g => g[0] === t.g)[1])}</div></a>
          ${c ? `<span class="badge ok">${c}×</span>` : na ? '<span class="badge na">není</span>' : ''}
          ${c ? '' : `<button class="small" data-na="${t.key}">${na ? 'vrátit' : 'není'}</button>`}</li>`;
      }).join('')}</ul></div>

    <div class="card"><h2>Závady (${i.defects.length})</h2>
      ${i.defects.some(d => d.poloha) ? Nastroje.schema(supports(b), i.defects.map(d => ({ n: d.n, p: d.poloha }))) : ''}
      <ul class="list">${i.defects.map(d => `<li><a class="grow" href="#/zavada/${id}/${d.id}"><b>č. ${d.n}</b> [${esc(d.code)}] ${esc(codeName(d.code))}${d.vyvoj ? ` <span class="badge">${esc(VYVOJ[d.vyvoj])}</span>` : ''}<div class="muted">${d.poloha ? esc(d.polohaText) + ' – ' : ''}${esc(d.popis).slice(0, 140) || '[doplnit popis]'}</div></a><span class="badge">${ph.filter(p => p.defectId === d.id).length} foto</span></li>`).join('') || '<li class="muted">Zatím žádné.</li>'}</ul>
      <button class="wide" id="newd" style="margin-top:8px">+ Závada bez fotky</button>
    </div>

    <div class="card"><h2>Fotky (${ph.length}, ve zprávě ${ph.filter(p => p.include).length})</h2>
      <div class="grid">${ph.map(p => `<a class="thumb${p.include ? '' : ' off'}" href="#/foto/${p.id}"><img loading="lazy" src="${blobUrl(p.blob)}" alt=""><span class="n">${p.seq}</span><span class="cap">${esc(p.caption)}</span></a>`).join('')}</div>
    </div>

    <div class="card"><h2>Export</h2>
      <p class="muted">ZIP: zmenšené fotky s datem a názvy, text pro BMS (popisy, závady, seznam příloh), nahrávky a data JSON. ${i.exportedAt ? 'Naposledy ' + fmtDate(i.exportedAt) + ' ' + fmtTime(i.exportedAt) + '.' : 'Zatím neexportováno.'}</p>
      <button class="pri wide" id="exp">Exportovat ZIP</button>
    </div>`;
  app.querySelectorAll('[data-cam]').forEach(a => a.addEventListener('click', ensureSensors));
  app.querySelectorAll('[data-na]').forEach(bt => bt.onclick = async () => {
    const k = bt.dataset.na; if (i.na[k]) delete i.na[k]; else i.na[k] = true;
    await put('insp', i); route();
  });
  $('#savei').onclick = async () => {
    Object.assign(i, { datum: $('#datum').value || i.datum, druh: $('#druh').value, pocasi: $('#pocasi').value, tVzd: $('#tVzd').value, tNK: $('#tNK').value, zpristupneni: $('#zpr').value });
    await put('insp', i); toast('Uloženo'); route();
  };
  $('#wx').onclick = async () => {
    const lat = b.lat != null ? b.lat : S.lat, lon = b.lon != null ? b.lon : S.lon;
    if (lat == null) return toast('Most nemá souřadnice a GPS není zapnuté.');
    $('#wxst').textContent = 'Načítám…';
    try {
      const w = await Nastroje.weather(lat, lon);
      $('#tVzd').value = num(w.t, 1);
      if (!$('#pocasi').value.trim()) $('#pocasi').value = w.pocasi + '.';
      i.wx = `${w.cas ? w.cas.replace('T', ' ') : ''}: ${num(w.t, 1)} °C, ${w.pocasi.toLowerCase()}`;
      $('#wxst').textContent = `Z Open-Meteo ${i.wx}. Zkontroluj a dej Uložit údaje.`;
    } catch (e) { $('#wxst').textContent = 'Počasí nedostupné (' + e.message + '). Bez signálu doplň ručně.'; }
  };
  $('#deli').onclick = async () => {
    if (!confirm(`Smazat prohlídku včetně ${ph.length} fotek? Nelze vrátit.`)) return;
    for (const p of ph) await del('photos', p.id);
    await del('insp', id); location.hash = `#/most/${b.id}`;
  };
  $('#newd').onclick = async () => {
    const d = newDefect(i); await put('insp', i); location.hash = `#/zavada/${id}/${d.id}`;
  };
  $('#exp').onclick = async () => {
    const bt = $('#exp'); bt.disabled = true; bt.textContent = 'Připravuji…';
    try {
      const { blob, name } = await buildExport(i, b, ph);
      const ok = await saveFile(blob, name);
      if (ok) { i.exportedAt = Date.now(); await put('insp', i); toast('Exportováno'); }
    } catch (e) { toast('Export selhal: ' + e.message, 5000); }
    route();
  };
}
/* výběr závady z minulé prohlídky → předvyplní kód a popis (případně opatření) */
function prevDefSelect(b, sel) {
  if (!b || !b.prev || !b.prev.zavady.length) return '';
  return `<label>Navázat na závadu z minulé prohlídky</label><select id="fromprev"><option value="">– nová závada –</option>${b.prev.zavady.map((z, k) => `<option value="${k}"${sel === k ? ' selected' : ''}>[${esc(z.code)}${z.pozice ? ' ' + esc(z.pozice) : ''}] ${esc(z.popis.slice(0, 70))}</option>`).join('')}</select>`;
}
function bindPrevDef(b, withOpat) {
  const s = document.getElementById('fromprev'); if (!s) return;
  s.onchange = () => {
    const z = b.prev.zavady[+s.value]; if (!z) return;
    const c = $('#code'); if (![...c.options].some(o => o.value === z.code)) c.add(new Option(z.code, z.code));
    c.value = z.code;
    $('#popis').value = z.popis;
    if (withOpat && $('#opat') && !$('#opat').value) $('#opat').value = z.opatreni.map(o => o.popis).join('\n');
  };
}
function newDefect(i, code = '2.1') {
  const d = { id: uid(), n: Math.max(0, ...i.defects.map(x => x.n)) + 1, code, popis: '', opatreni: '', vyvoj: '', poloha: null, polohaText: '' };
  i.defects.push(d); return d;
}
/* propojení závady se závadou z minulé prohlídky (index k v b.prev.zavady) */
function linkPrev(i, d, k, st, b) {
  if (k === '' || k == null || isNaN(+k)) return;
  i.prevCheck = i.prevCheck || {};
  for (const [kk, c] of Object.entries(i.prevCheck)) if (c.defectId === d.id && kk !== String(k)) delete i.prevCheck[kk];
  d.prevIdx = +k; d.vyvoj = st || d.vyvoj || 'beze';
  i.prevCheck[k] = { st: d.vyvoj, defectId: d.id };
  if (b) i.prevRef = refKey(b.prev);
}

/* ---------- závady z minulé prohlídky ---------- */
async function vCheck(inspId) {
  const i = await get('insp', inspId);
  const b = i && await get('bridges', i.bridgeId);
  if (!b || !b.prev) { location.hash = `#/prohlidka/${inspId}`; return; }
  setTitle('Závady z minula', `#/prohlidka/${inspId}`);
  i.prevCheck = i.prevCheck || {};
  if (!checkValid(i, b) && Object.keys(i.prevCheck).length) {
    app.innerHTML = `<div class="card"><h2>Minulá prohlídka se změnila</h2>
      <p>Kontrola závad byla dělaná vůči jiné minulé prohlídce, než je teď nastavená (${esc(prevTitle(b.prev))}). Závady v této prohlídce zůstanou, jen se zruší jejich vazba na minulé závady.</p>
      <button class="pri wide" id="reset">Začít kontrolu znovu</button></div>`;
    $('#reset').onclick = async () => {
      i.prevCheck = {}; delete i.prevRef; i.defects.forEach(d => { delete d.prevIdx; });
      await put('insp', i); route();
    };
    return;
  }
  const zs = b.prev.zavady, ph = await photosOf(inspId);
  const fBy = n => b.prev.fota.find(f => f.poradi === n);
  const done = zs.filter((z, k) => i.prevCheck[k] && i.prevCheck[k].st).length;
  app.innerHTML = `<div class="card"><p class="muted" style="margin:0">${esc(prevTitle(b.prev))} · zkontrolováno ${done} z ${zs.length}.<br>
      „Beze změny“ a „Zhoršeno“ převezmou závadu do této prohlídky (kód, popis, opatření), popis pak uprav. „Odstraněno“ a „Nezkontrolováno“ se vypíší v exportu.</p></div>
    ${zs.map((z, k) => {
      const c = i.prevCheck[k] || {}, d = c.defectId && i.defects.find(x => x.id === c.defectId);
      const nph = d ? ph.filter(p => p.defectId === d.id).length : 0;
      return `<div class="card" id="z${k}">
        <div><b>[${esc(z.code)}] ${esc(codeName(z.code))}${z.pozice ? ' – ' + esc(z.pozice) : ''}</b></div>
        <div style="white-space:pre-wrap;margin:4px 0">${esc(z.popis)}</div>
        ${z.opatreni.map(o => `<div class="muted">➜ ${esc(o.popis)}</div>`).join('')}
        ${z.fota.length ? `<div class="grid" style="margin-top:6px">${z.fota.slice(0, 6).map(n => { const f = fBy(n); return f && f.blob ? `<a class="thumb" href="#" data-big="${f.poradi}"><img loading="lazy" src="${blobUrl(f.blob)}" alt=""><span class="n">${f.poradi}</span></a>` : ''; }).join('')}</div>` : ''}
        <div class="seg" style="margin-top:8px">${KONTROLA.map(([s, t]) => `<button class="${c.st === s ? 'pri' : ''}" data-k="${k}" data-s="${s}">${t}</button>`).join('')}</div>
        ${d ? `<div class="row" style="margin-top:8px"><a class="btn grow" href="#/zavada/${inspId}/${d.id}">Upravit závadu č. ${d.n}</a><a class="btn" data-cam href="#/kamera/${inspId}?k=zavada&d=${d.id}">📷 Foto${nph ? ' (' + nph + ')' : ''}</a></div>` : ''}
      </div>`;
    }).join('')}`;
  bindBig(app, b.prev.fota);
  app.querySelectorAll('[data-cam]').forEach(a => a.addEventListener('click', ensureSensors));
  app.querySelectorAll('[data-s]').forEach(bt => bt.onclick = async () => {
    const k = +bt.dataset.k, st = bt.dataset.s, z = zs[k], c = i.prevCheck[k] || {};
    let d = c.defectId && i.defects.find(x => x.id === c.defectId);
    if (st === 'beze' || st === 'zhor') {
      if (!d) {
        d = newDefect(i, z.code); d.popis = z.popis; d.opatreni = z.opatreni.map(o => o.popis).join('\n');
        if (z.pozice) d.pozice = z.pozice;
      }
      linkPrev(i, d, k, st, b);
    } else {
      if (d) {
        const dp = (await photosOf(inspId)).filter(p => p.defectId === d.id);
        if (!confirm(`Odebrat z této prohlídky závadu č. ${d.n}?${dp.length ? ` Její ${dp.length} fotky zůstanou jako „Jiné“.` : ''}`)) return;
        for (const p of dp) { p.defectId = null; p.key = 'jine'; await put('photos', p); }
        i.defects = i.defects.filter(x => x.id !== d.id);
      }
      i.prevCheck[k] = { st, defectId: null }; i.prevRef = refKey(b.prev);
    }
    await put('insp', i);
    const y = window.scrollY; await vCheck(inspId); window.scrollTo(0, y);
  });
}

/* ---------- kamera ---------- */
async function vCamera(inspId, key, defId) {
  const i = await get('insp', inspId), b = await get('bridges', i.bridgeId);
  const item = checklist(b, i.druh).find(t => t.key === key);
  const dd = defId && i.defects.find(x => x.id === defId);
  if (!dd) defId = null;
  const label = item ? item.cap : dd ? `Závada č. ${dd.n} [${dd.code}]` : key === 'zavada' ? 'Závada' : 'Jiné foto';
  hudCtx = { az: b.az };
  app.innerHTML = `<div class="cam">
    <video id="v" playsinline autoplay muted></video>
    <img id="ov" class="ov" alt="" hidden>
    <div class="hud"><span class="tgt">${esc(label)}</span><span id="hud-sens"></span></div>
    <div class="ovbar" id="ovbar" hidden><span>Překrytí</span><input type="range" id="ovop" min="10" max="85" value="40" class="grow"><button id="ovx">✕</button></div>
    <div class="bar">
      <button id="x">Zpět</button>
      ${b.prev && b.prev.fota.length ? '<button id="prevph">Minulé</button>' : ''}
      <button id="shot" class="shutter" aria-label="Vyfotit"></button>
      <label class="btn" id="natl">Fotoaparát<input id="nat" type="file" accept="image/*" capture="environment" hidden></label>
    </div></div>`;
  hud();
  $('#x').onclick = () => { location.hash = `#/prohlidka/${inspId}`; };
  if ($('#prevph')) $('#prevph').onclick = () => {
    // galerie minulých fotek pro zopakování záběrů
    const o = document.createElement('div');
    o.style.cssText = 'position:fixed;inset:0;z-index:150;background:rgba(0,0,0,.95);overflow:auto;padding:calc(env(safe-area-inset-top) + 10px) 10px 80px';
    o.innerHTML = `<div class="row" style="margin-bottom:8px;color:#fff"><b class="grow">${esc(prevTitle(b.prev))}</b><button id="ovmode">Překrýt: vyp</button><button id="pclose">Zavřít</button></div>
      <p class="muted" id="ovhelp" style="color:#bbb;margin:0 0 8px">Klepnutím zvětšíš. Se zapnutým „Překrýt“ se vybraná fotka položí poloprůhledně přes kameru.</p>
      <div class="grid">${b.prev.fota.filter(f => f.blob).map(f => `<a class="thumb" href="#" data-big="${f.poradi}"><img loading="lazy" src="${blobUrl(f.blob)}" alt=""><span class="n">${f.poradi}</span><span class="cap">${esc(capClean(f.popis))}</span></a>`).join('')}</div>`;
    document.body.appendChild(o);
    o.querySelector('#pclose').onclick = () => o.remove();
    bindBig(o, b.prev.fota);
    let ovMode = false;
    o.querySelector('#ovmode').onclick = ev => { ovMode = !ovMode; ev.target.textContent = 'Překrýt: ' + (ovMode ? 'zap' : 'vyp'); ev.target.classList.toggle('pri', ovMode); };
    o.addEventListener('click', ev => {
      const a = ovMode && ev.target.closest('[data-big]'); if (!a) return;
      ev.preventDefault(); ev.stopPropagation();
      const f = b.prev.fota.find(x => String(x.poradi) === a.dataset.big);
      if (f && f.blob) setOverlay(f.blob);
      o.remove();
    }, true);
    window.addEventListener('hashchange', () => o.remove(), { once: true });
  };
  // překrytí minulou fotkou – umístí se přesně na obraz videa (object-fit: contain), fotka ho vyplní (cover)
  const placeOv = () => {
    const v = $('#v'), ov = $('#ov'); if (!v || !ov || ov.hidden || !v.videoWidth) return;
    const r = v.getBoundingClientRect(), k = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
    const w = v.videoWidth * k, h = v.videoHeight * k;
    Object.assign(ov.style, { left: r.left + (r.width - w) / 2 + 'px', top: r.top + (r.height - h) / 2 + 'px', width: w + 'px', height: h + 'px' });
  };
  function setOverlay(blob) {
    const ov = $('#ov'); ov.src = blobUrl(blob); ov.hidden = false; $('#ovbar').hidden = false;
    ov.style.opacity = $('#ovop').value / 100; placeOv();
  }
  $('#ovop').oninput = e => { $('#ov').style.opacity = e.target.value / 100; };
  $('#ovx').onclick = () => { $('#ov').hidden = true; $('#ovbar').hidden = true; };
  window.addEventListener('resize', placeOv);
  $('#v').addEventListener('loadedmetadata', placeOv);
  let metaNat = null;
  $('#natl').addEventListener('click', () => { metaNat = snap(); metaNat.src = 'fotoaparat'; });
  $('#nat').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    await storePhoto(i, b, key, item, f, metaNat || snap(), defId);
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } } });
    const v = $('#v'); v.srcObject = stream;
  } catch (e) {
    toast('Kamera v aplikaci nedostupná – použij tlačítko Fotoaparát.', 4000);
    $('#shot').disabled = true;
  }
  $('#shot').onclick = async () => {
    const v = $('#v'); if (!v.videoWidth) return;
    const meta = snap(); meta.src = 'aplikace';
    const fl = document.createElement('div'); fl.className = 'flash'; document.body.appendChild(fl); setTimeout(() => fl.remove(), 120);
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95));
    await storePhoto(i, b, key, item, blob, meta, defId);
  };
}
async function storePhoto(i, b, key, item, src, meta, defId) {
  toast('Ukládám…', 1500);
  const blob = await processImage(src, new Date(meta.ts));
  i = await get('insp', i.id);           // čerstvý stav (pořadí)
  i.nextSeq = (i.nextSeq || 0) + 1;
  await put('insp', i);
  const dir = dirWord(meta.heading, b.az);
  const p = { id: uid(), inspId: i.id, seq: i.nextSeq, key, blob, ...meta, dir, caption: defaultCaption(item, dir),
    include: true, defectId: defId || null, audio: null, note: '' };
  await put('photos', p);
  location.hash = `#/foto/${p.id}?dal=1`;
}

/* poloha závady ve schématu mostu */
function polohaHtml(b, p) {
  return `<label>Poloha na mostě (klepni do schématu)</label><div id="pol">${Nastroje.schema(supports(b), [], p)}</div>
    <div class="row"><span class="muted grow" id="poltx">${p ? esc(Nastroje.describe(supports(b), p)) : 'neurčeno'}</span><button type="button" class="small" id="polx">Smazat</button></div>`;
}
function bindPoloha(b, init) {
  let cur = init || null; const sup = supports(b);
  const upd = () => { $('#pol').innerHTML = Nastroje.schema(sup, [], cur); $('#poltx').textContent = cur ? Nastroje.describe(sup, cur) : 'neurčeno'; };
  $('#pol').addEventListener('click', ev => { const s = $('#pol svg'); if (!s) return; cur = Nastroje.hit(s, ev); upd(); });
  $('#polx').onclick = () => { cur = null; upd(); };
  return () => cur;
}
function setPoloha(b, d, p) { d.poloha = p || null; d.polohaText = p ? Nastroje.describe(supports(b), p) : ''; }

/* ---------- editace fotky ---------- */
async function vPhoto(id, fromCam) {
  const p = await get('photos', id);
  if (!p) { location.hash = '#/'; return; }
  const i = await get('insp', p.inspId), b = await get('bridges', i.bridgeId);
  const items = checklist(b, i.druh);
  setTitle(`Foto ${p.seq}`, `#/prohlidka/${i.id}`);
  const isDef = p.key === 'zavada';
  const keyOpts = [...items.map(t => [t.key, t.cap]), ['zavada', 'Závada'], ['jine', 'Jiné']];
  app.innerHTML = `
    <img class="preview" id="prev" src="${blobUrl(p.blob)}" alt="">
    <div class="row" style="margin-top:8px"><button class="grow" id="draw">✏️ Kreslit do fotky</button>${p.blobOrig ? '<button id="undraw">Vrátit původní</button>' : ''}</div>
    <div class="card" style="margin-top:12px">
      <label>Zařazení</label><select id="key">${keyOpts.map(([k, v]) => `<option value="${k}"${k === p.key ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <div id="defbox" ${isDef ? '' : 'hidden'}>
        <label>Závada</label><select id="def"><option value="">+ nová závada</option>${i.defects.map(d => `<option value="${d.id}"${d.id === p.defectId ? ' selected' : ''}>č. ${d.n} [${esc(d.code)}] ${esc(d.popis.slice(0, 40))}</option>`).join('')}</select>
        <div id="newdef" ${p.defectId ? 'hidden' : ''}>
          ${prevDefSelect(b)}
          <label>Část mostu (kód BMS)</label><select id="code">${CODES.map(([c, n]) => `<option value="${c}">${c} ${esc(n)}</option>`).join('')}</select>
          <label>Popis závady (diktuj mikrofonem na klávesnici)</label><textarea id="popis" placeholder="např. Podélná trhlina šířky cca 0,3 mm na podhledu NK v poli 2, délka cca 1,5 m."></textarea>
          ${polohaHtml(b, null)}
        </div>
      </div>
      <label>Popisek fotky</label><textarea id="cap" style="min-height:60px">${esc(p.caption)}</textarea>
      <label>Poznámka (nejde do popisku)</label><input id="note" value="${esc(p.note)}">
      <label style="color:var(--fg)"><input type="checkbox" id="inc" ${p.include ? 'checked' : ''}>Použít ve zprávě</label>
      <div class="row" style="margin-top:8px"><button id="rec">🎙 ${p.audio ? 'Nahrát znovu' : 'Nahrát hlas'}</button><span id="recst" class="muted grow"></span></div>
      ${p.audio ? `<audio controls src="${blobUrl(p.audio)}" style="width:100%;margin-top:8px"></audio>` : ''}
      <div class="row" style="margin-top:12px">
        ${fromCam ? '<button class="pri grow" id="savenext">Uložit a fotit dál</button>' : ''}
        <button class="${fromCam ? '' : 'pri '}grow" id="save">Uložit</button>
      </div>
      <button class="bad wide" id="delp" style="margin-top:8px">Smazat fotku</button>
    </div>
    <div class="card"><div class="kv">
      <b>Pořízeno</b><span>${fmtDate(p.ts)} ${fmtTime(p.ts)} (${p.src === 'fotoaparat' ? 'Fotoaparát iOS – azimut z okamžiku otevření' : 'kamera v aplikaci'})</span>
      <b>GPS</b><span>${p.lat != null ? `${num(p.lat, 6)}, ${num(p.lon, 6)} ±${Math.round(p.acc)} m` : '–'}</span>
      <b>Azimut</b><span>${p.heading != null ? Math.round(p.heading) + '°' : '–'}${p.dir ? ' → ' + p.dir : ''}</span>
      <b>Velikost</b><span>${num(p.blob.size / 1024, 0)} kB</span>
    </div></div>`;
  const syncKey = () => {
    const k = $('#key').value, it = items.find(t => t.key === k);
    $('#defbox').hidden = k !== 'zavada';
    if (it && (!$('#cap').value.trim() || $('#cap').dataset.auto !== '0')) $('#cap').value = defaultCaption(it, p.dir);
  };
  $('#cap').addEventListener('input', () => { $('#cap').dataset.auto = '0'; });
  Diktat.attach($('#cap'), 'cap');
  Diktat.attach($('#popis'), 'def', () => $('#code').value);
  $('#key').onchange = syncKey;
  $('#def').onchange = () => { $('#newdef').hidden = !!$('#def').value; };
  bindPrevDef(b);
  const getPol = bindPoloha(b, null);
  $('#draw').onclick = async () => {
    const out = await Nastroje.draw(p.blob); if (!out) return;
    if (!p.blobOrig) p.blobOrig = p.blob;
    p.blob = out; const cur = await get('photos', id); cur.blob = out; cur.blobOrig = p.blobOrig; await put('photos', cur);
    $('#prev').src = blobUrl(out); toast('Kresba uložena');
  };
  if ($('#undraw')) $('#undraw').onclick = async () => {
    if (!confirm('Vrátit fotku bez kresby?')) return;
    const cur = await get('photos', id); cur.blob = cur.blobOrig; delete cur.blobOrig; await put('photos', cur);
    p.blob = cur.blob; delete p.blobOrig; $('#prev').src = blobUrl(p.blob); $('#undraw').remove();
  };
  let audio = p.audio, chunks = [];
  $('#rec').onclick = async () => {
    if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(ms); chunks = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = () => {
        ms.getTracks().forEach(t => t.stop());
        audio = new Blob(chunks, { type: recorder.mimeType || 'audio/mp4' });
        $('#recst').textContent = `nahráno ${num(audio.size / 1024, 0)} kB – ulož fotku`;
        $('#rec').textContent = '🎙 Nahrát znovu';
      };
      recorder.start();
      $('#rec').textContent = '⏹ Stop'; $('#recst').innerHTML = '<span class="rec">● nahrávám</span>';
    } catch (e) { toast('Mikrofon nedostupný: ' + e.message, 4000); }
  };
  const save = async () => {
    if (recorder && recorder.state === 'recording') { recorder.stop(); await new Promise(r => setTimeout(r, 300)); }
    const i2 = await get('insp', p.inspId);
    p.key = $('#key').value; p.caption = $('#cap').value.trim(); p.note = $('#note').value; p.include = $('#inc').checked; p.audio = audio;
    if (p.key === 'zavada') {
      let d = i2.defects.find(x => x.id === $('#def').value);
      if (!d) {
        d = newDefect(i2, $('#code').value); d.popis = $('#popis').value.trim();
        if ($('#fromprev') && $('#fromprev').value !== '') linkPrev(i2, d, $('#fromprev').value, 'beze', b); else d.vyvoj = b.prev ? 'nova' : '';
        setPoloha(b, d, getPol());
        await put('insp', i2);
        Diktat.learn('def', d.code, d.popis);
      }
      p.defectId = d.id;
      if (!p.caption) p.caption = `Závada č. ${d.n}${d.popis ? ' – ' + d.popis.split(/[.,;]/)[0] : ''}.`;
    } else p.defectId = null;
    await put('photos', p);
    if ($('#cap').dataset.auto === '0') Diktat.learn('cap', '', p.caption); // jen ručně upravené popisky
    return i2;
  };
  if (fromCam) $('#savenext').onclick = async () => { await save(); location.hash = `#/kamera/${p.inspId}?k=${encodeURIComponent(p.key)}${p.defectId ? '&d=' + p.defectId : ''}`; };
  $('#save').onclick = async () => { await save(); location.hash = `#/prohlidka/${p.inspId}`; };
  $('#delp').onclick = async () => { if (!confirm('Smazat fotku?')) return; await del('photos', id); location.hash = `#/prohlidka/${p.inspId}`; };
}

/* ---------- závada ---------- */
async function vDefect(inspId, defId) {
  const i = await get('insp', inspId);
  const d = i.defects.find(x => x.id === defId);
  if (!d) { location.hash = `#/prohlidka/${inspId}`; return; }
  const ph = (await photosOf(inspId)).filter(p => p.defectId === defId).sort((a, b) => a.seq - b.seq);
  setTitle(`Závada č. ${d.n}`, `#/prohlidka/${inspId}`);
  const b = await get('bridges', i.bridgeId);
  app.innerHTML = `<div class="card">
    ${prevDefSelect(b, d.prevIdx)}
    <label>Část mostu (kód BMS)</label><select id="code">${CODES.map(([c, n]) => `<option value="${c}"${c === d.code ? ' selected' : ''}>${c} ${esc(n)}</option>`).join('')}${CODES.some(x => x[0] === d.code) ? '' : `<option selected value="${esc(d.code)}">${esc(d.code)}</option>`}</select>
    ${b.prev ? `<label>Oproti minulé prohlídce</label><div class="seg" id="vyv">${Object.entries(VYVOJ).map(([k, t]) => `<button type="button" data-v="${k}" class="${d.vyvoj === k ? 'pri' : ''}">${t}</button>`).join('')}</div>` : ''}
    <label>Popis závady</label><textarea id="popis">${esc(d.popis)}</textarea>
    <label>Návrh opatření</label><textarea id="opat">${esc(d.opatreni)}</textarea>
    ${polohaHtml(b, d.poloha)}
    <div class="row" style="margin-top:12px"><button class="pri grow" id="save">Uložit</button><a class="btn" href="#/kamera/${inspId}?k=zavada&d=${d.id}" id="foto">📷 Přidat foto</a></div>
    <button class="bad wide" id="deld" style="margin-top:8px">Smazat závadu</button></div>
    <div class="card"><h2>Fotky (${ph.length})</h2><div class="grid">${ph.map(p => `<a class="thumb" href="#/foto/${p.id}"><img src="${blobUrl(p.blob)}" alt=""><span class="n">${p.seq}</span></a>`).join('')}</div></div>`;
  bindPrevDef(b, true);
  Diktat.attach($('#popis'), 'def', () => $('#code').value);
  Diktat.attach($('#opat'), 'opt', () => $('#code').value);
  const getPol = bindPoloha(b, d.poloha);
  let vyv = d.vyvoj || '';
  app.querySelectorAll('[data-v]').forEach(bt => bt.onclick = () => {
    vyv = vyv === bt.dataset.v ? '' : bt.dataset.v;
    app.querySelectorAll('[data-v]').forEach(x => x.classList.toggle('pri', x.dataset.v === vyv));
  });
  const save = async () => {
    d.code = $('#code').value; d.popis = $('#popis').value.trim(); d.opatreni = $('#opat').value.trim();
    setPoloha(b, d, getPol());
    const fp = $('#fromprev') ? $('#fromprev').value : '';
    if (fp !== '') linkPrev(i, d, fp, vyv === 'nova' || !vyv ? 'beze' : vyv, b);
    else {
      if (i.prevCheck) for (const [k, c] of Object.entries(i.prevCheck)) if (c.defectId === d.id) delete i.prevCheck[k];
      delete d.prevIdx; d.vyvoj = vyv;
    }
    await put('insp', i);
    Diktat.learn('def', d.code, d.popis); Diktat.learn('opt', d.code, d.opatreni);
  };
  $('#save').onclick = async () => { await save(); location.hash = `#/prohlidka/${inspId}`; };
  $('#foto').addEventListener('click', async ev => { ensureSensors(); await save(); });
  $('#deld').onclick = async () => {
    if (!confirm('Smazat závadu? Fotky zůstanou jako „Jiné“.')) return;
    for (const p of ph) { p.defectId = null; p.key = 'jine'; await put('photos', p); }
    if (i.prevCheck) for (const [k, c] of Object.entries(i.prevCheck)) if (c.defectId === defId) delete i.prevCheck[k];
    i.defects = i.defects.filter(x => x.id !== defId); await put('insp', i); location.hash = `#/prohlidka/${inspId}`;
  };
}

/* ---------- export ---------- */
async function buildExport(i, b, ph) {
  const items = checklist(b, i.druh), order = new Map(items.map((t, k) => [t.key, k]));
  const defN = new Map(i.defects.map(d => [d.id, d.n]));
  const sorted = [...ph].sort((a, c) =>
    groupIdx(a.key) - groupIdx(c.key) ||
    (order.get(a.key) ?? 999) - (order.get(c.key) ?? 999) ||
    (defN.get(a.defectId) ?? 0) - (defN.get(c.defectId) ?? 0) ||
    a.seq - c.seq);
  const used = sorted.filter(p => p.include), unused = sorted.filter(p => !p.include);
  // stejné popisky → " /1", " /2" (styl HPM)
  const capCount = {}; used.forEach(p => { capCount[p.caption] = (capCount[p.caption] || 0) + 1; });
  const capIdx = {};
  const finalCap = p => { if (capCount[p.caption] > 1) { capIdx[p.caption] = (capIdx[p.caption] || 0) + 1; return `${p.caption} /${capIdx[p.caption]}`; } return p.caption; };
  const pre = slug(b.evc), files = [], rows = [], photoNo = new Map();
  used.forEach((p, k) => {
    const n = String(k + 1).padStart(2, '0'), cap = finalCap(p) || 'bez popisku';
    const name = `${n}_${pre}_${slug(cap)}.jpg`;
    photoNo.set(p.id, k + 1);
    files.push({ name: `foto/${name}`, data: p.blob });
    if (p.audio) files.push({ name: `audio/${n}_${pre}.${/mp4|m4a|aac/.test(p.audio.type) ? 'm4a' : 'webm'}`, data: p.audio });
    rows.push(`${n}\t${cap}\t${name}${p.note ? '\t(pozn.: ' + p.note + ')' : ''}`);
  });
  unused.forEach((p, k) => {
    const n = 'x' + String(k + 1).padStart(2, '0');
    files.push({ name: `nepouzite/${n}_${pre}_${slug(p.caption || 'foto')}.jpg`, data: p.blob });
    if (p.audio) files.push({ name: `audio/${n}_${pre}.m4a`, data: p.audio });
  });
  const L = [];
  L.push(`${DRUHY[i.druh].toUpperCase()} PROHLÍDKA – most ev. č. ${b.evc} ${b.nazev}`);
  L.push(`Datum provedení prohlídky: ${fmtDate(i.datum)}`);
  L.push(`Počasí: ${i.pocasi || '[doplnit]'}`);
  L.push(`Způsob zpřístupnění: ${i.zpristupneni || '[doplnit]'}`);
  L.push(`Teplota vzduchu: ${i.tVzd !== '' ? i.tVzd + ' °C' : '[doplnit]'}    Teplota NK: ${i.tNK !== '' ? i.tNK + ' °C' : '[doplnit]'}`);
  if (b.smer) L.push(`Staničení ve směru: ${b.smer}`);
  L.push('', 'B. POPIS ČÁSTÍ MOSTU');
  if (i.casti && i.casti.length) i.casti.forEach(c => L.push('', `[${c.code}] ${c.nazev || codeName(c.code)}${c.pozice ? ' – ' + c.pozice : ''}`, c.popis || '[doplnit]'));
  else L.push('[doplnit]');
  L.push('', 'C. STAV A ZÁVADY ČÁSTÍ MOSTU');
  const byCode = {};
  [...i.defects].sort((a, c) => a.code.localeCompare(c.code, 'cs', { numeric: true }) || a.n - c.n).forEach(d => { (byCode[d.code] = byCode[d.code] || []).push(d); });
  for (const [code, ds] of Object.entries(byCode)) {
    L.push('', `[${code}] ${codeName(code)}`);
    ds.forEach(d => {
      const f = ph.filter(p => p.defectId === d.id && photoNo.has(p.id)).map(p => photoNo.get(p.id)).sort((a, c) => a - c);
      const info = [d.polohaText && 'poloha: ' + d.polohaText, d.vyvoj && 'oproti minulé prohlídce: ' + VYVOJ[d.vyvoj], f.length && 'foto ' + f.join(', ')].filter(Boolean);
      L.push(`${d.popis || '[doplnit popis]'}${info.length ? ` (${info.join('; ')})` : ''}`);
    });
  }
  if (!i.defects.length) L.push('Bez zaznamenaných závad.');
  if (b.prev && i.prevCheck && Object.keys(i.prevCheck).length && checkValid(i, b)) {
    const zs = b.prev.zavady, pc = i.prevCheck;
    const lst = st => zs.map((z, k) => [z, pc[k]]).filter(([, c]) => c && c.st === st).map(([z]) => `- [${z.code}] ${z.popis}`);
    const odst = lst('odst'), nez = lst('nez'), bez = zs.filter((z, k) => !pc[k] || !pc[k].st).map(z => `- [${z.code}] ${z.popis}`);
    L.push('', `ZÁVADY Z MINULÉ PROHLÍDKY (${prevTitle(b.prev)})`);
    L.push(odst.length ? 'Odstraněné:' : 'Odstraněné: žádné', ...odst);
    if (nez.length) L.push('Nezkontrolované:', ...nez);
    if (bez.length) L.push('Neprojité v aplikaci:', ...bez);
  }
  L.push('', 'E. NÁVRH OPATŘENÍ');
  const op = i.defects.filter(d => d.opatreni);
  op.forEach(d => L.push(`[${d.code}] ${codeName(d.code)}: ${d.opatreni}`));
  if (!op.length) L.push('[doplnit]');
  L.push('', 'J. OBRAZOVÉ PŘÍLOHY (pořadí, popisek, soubor)', ...rows);
  const miss = items.filter(t => !ph.some(p => p.key === t.key && p.include) && !i.na[t.key]);
  L.push('', 'KONTROLA FOTODOKUMENTACE (ČSN 73 6221, tab. 4 – doporučený rozsah)');
  if (miss.length) miss.forEach(t => L.push('- chybí: ' + t.cap));
  else L.push('Všechny doporučené záběry pořízeny nebo označeny „není“.');
  items.filter(t => i.na[t.key]).forEach(t => L.push('- není/nelze: ' + t.cap));
  L.push('', `Export: ${fmtDate(Date.now())} ${fmtTime(Date.now())}, aplikace Prohlídky mostů ${APP_VERSION}`);
  files.unshift({ name: 'prohlidka.txt', data: '﻿' + L.join('\r\n') });
  const meta = { app: APP_VERSION, bridge: b, inspection: i,
    photos: sorted.map(p => ({ ...p, blob: undefined, blobOrig: undefined, kresba: !!p.blobOrig, audio: !!p.audio, cislo: photoNo.get(p.id) || null })) };
  files.push({ name: 'data.json', data: JSON.stringify(meta, null, 1) });
  return { blob: await makeZip(files), name: `${pre}_${i.druh}_${i.datum}.zip` };
}

/* ---------- data: import/záloha mostů ---------- */
async function vData() {
  setTitle('Data', '#/');
  let est = '';
  try { const e = await navigator.storage.estimate(); est = `${num(e.usage / 1048576, 1)} MB z ${num(e.quota / 1048576, 0)} MB`; } catch (e) { /* */ }
  const pers = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  app.innerHTML = `
    <div class="card"><h2>Import balíčku z BMS</h2>
      <p class="muted">Soubor <code>balicek_….json</code> ze záložky „Balíček z BMS“ (návod na stránce <a href="bms.html">bms.html</a>). Doplní souřadnice, počet polí, směr staničení a poslední hlavní prohlídku vč. náhledů fotek. Mosty se párují podle ev. č.</p>
      <label class="btn pri wide">Vybrat balíček…<input type="file" id="pkg" accept=".json,application/json" hidden></label>
      <p class="muted" id="pkgst"></p>
    </div>
    <div class="card"><h2>Import mostů (CSV)</h2>
      <p class="muted">Řádek: <code>ev.č.;název;šířka;délka;počet polí;staničení ve směru</code>. Oddělovač středník, desetinná čárka i tečka. Existující ev. č. se aktualizuje.</p>
      <textarea id="csv" placeholder="118-039;Most přes potok Čeperka u osady Nouzov;50,1234;14,0567;1;Nouzov → Kladno"></textarea>
      <div class="row" style="margin-top:8px"><button class="pri grow" id="imp">Importovat</button><label class="btn">Ze souboru<input type="file" id="csvf" accept=".csv,.txt,text/plain" hidden></label></div>
    </div>
    <div class="card"><h2>Záloha seznamu mostů</h2>
      <button class="wide" id="bk">Exportovat mosty (CSV)</button>
    </div>
    <div class="card"><h2>Slovník diktátu</h2>
      <p class="muted">${(st => `Základ ${st.base} slov ze vzorových HPM, naučeno ${st.learned} slov a ${st.phrases} frází, vlastních oprav ${st.fix}.`)(Diktat.stats())}
        Vlastní opravy: jeden řádek <code>co diktát napíše = co má být</code>, např. <code>lůžko = ložisko</code>.</p>
      <textarea id="fixes" placeholder="lůžko = ložisko&#10;výluky = výluhy">${esc(Diktat.getFix())}</textarea>
      <div class="row" style="margin-top:8px"><button class="pri grow" id="fixsave">Uložit opravy</button><button id="dexp">Export</button><label class="btn">Import<input type="file" id="dimp" accept=".json" hidden></label></div>
      <button class="wide bad" id="dreset" style="margin-top:8px">Zapomenout naučené</button>
    </div>
    <div class="card"><h2>Úložiště</h2>
      <div class="kv"><b>Využito</b><span>${est || '–'}</span><b>Trvalé</b><span>${pers ? 'ano' : 'ne'}</span><b>Verze</b><span>${APP_VERSION}</span></div>
      <p class="muted">Fotky jsou jen v tomto telefonu. Po každé prohlídce udělej export ZIP.</p>
      ${pers ? '' : '<button class="wide" id="persist">Požádat o trvalé úložiště</button>'}
    </div>`;
  const doImport = async txt => {
    const bs = await all('bridges'); let n = 0, bad = [];
    txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach((l, k) => {
      const c = l.split(';').map(x => x.trim());
      if (c.length < 4 || /^ev/i.test(c[0])) { if (!/^ev/i.test(c[0])) bad.push(k + 1); return; }
      const g = parseCoords(c[2] + ' ' + c[3]);
      if (!g || g.err) { bad.push(k + 1); return; }
      let b = bs.find(x => x.evc === c[0]);
      if (!b) { b = { id: uid(), az: null, pozn: '' }; bs.push(b); }
      Object.assign(b, { evc: c[0], nazev: c[1], lat: g.lat, lon: g.lon, poli: Math.max(1, parseInt(c[4]) || b.poli || 1), smer: c[5] || b.smer || '' });
      b._dirty = true; n++;
    });
    for (const b of bs.filter(x => x._dirty)) { delete b._dirty; await put('bridges', b); }
    toast(`Importováno ${n}${bad.length ? ', chybné řádky: ' + bad.join(', ') : ''}`, 5000);
  };
  $('#pkg').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const st = $('#pkgst');
    try {
      st.textContent = 'Načítám…';
      const j = JSON.parse(await f.text());
      if (j.format !== 'prohlidky-balicek') throw new Error('Není to balíček z BMS.');
      const r = await importPackage(j, t => { st.textContent = t; });
      toast(r, 5000); st.textContent = r;
    } catch (err) { st.textContent = 'Chyba: ' + err.message; }
  };
  $('#fixsave').onclick = () => { Diktat.setFix($('#fixes').value); toast('Opravy uloženy'); route(); };
  $('#dexp').onclick = () => saveFile(new Blob([Diktat.exportJson()], { type: 'application/json' }), `slovnik_${isoDay(Date.now())}.json`);
  $('#dimp').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { Diktat.importJson(await f.text()); toast('Slovník sloučen'); route(); } catch (err) { toast('Chyba: ' + err.message, 4000); } };
  $('#dreset').onclick = () => { if (confirm('Zapomenout naučená slova a fráze? Vlastní opravy zůstanou.')) { Diktat.reset(); route(); } };
  $('#imp').onclick = () => doImport($('#csv').value);
  $('#csvf').onchange = async e => { const f = e.target.files[0]; if (f) doImport(await f.text()); };
  $('#bk').onclick = async () => {
    const bs = await all('bridges');
    const t = bs.map(b => [b.evc, b.nazev, b.lat ?? '', b.lon ?? '', b.poli || 1, b.smer || ''].join(';')).join('\r\n');
    saveFile(new Blob(['﻿' + t], { type: 'text/csv' }), `mosty_${isoDay(Date.now())}.csv`);
  };
  if (!pers && $('#persist')) $('#persist').onclick = async () => { const r = navigator.storage.persist ? await navigator.storage.persist() : false; toast(r ? 'Úložiště je trvalé' : 'Systém trvalé úložiště nepovolil'); route(); };
}

/* ---------- balíček z BMS ---------- */
async function importPackage(j, progress) {
  const bs = await all('bridges'); let nNew = 0, nUpd = 0, nPh = 0, nInsp = 0;
  for (const [k, m] of (j.mosty || []).entries()) {
    progress && progress(`${k + 1}/${j.mosty.length} ${m.evc}`);
    let b = bs.find(x => normEvc(x.evc) === normEvc(m.evc));
    if (!b) { b = { id: uid(), evc: m.evc, az: null, pozn: '', plan: null }; bs.push(b); nNew++; } else nUpd++;
    b.nazev = m.nazev || b.nazev || '';
    if (m.jtsk && m.jtsk.x && m.jtsk.y) { const w = jtsk2wgs(m.jtsk.x, m.jtsk.y); b.lat = +w.lat.toFixed(6); b.lon = +w.lon.toFixed(6); }
    if (m.poli) b.poli = m.poli;
    if (m.smer) b.smer = m.smer;
    if (m.staniceni != null) b.staniceni = m.staniceni;
    b.bmsGuid = m.guid;
    if (m.mostniList) b.mostniList = decEnt(m.mostniList);
    const incoming = m.prohlidky && m.prohlidky.length ? m.prohlidky : m.prohlidka ? [m.prohlidka] : [];
    if (incoming.length) {
      // sloučit s dříve importovanými prohlídkami (podle GUID, u starých balíčků podle data a druhu)
      const key = p => p.guid || `${String(p.datum).slice(0, 10)}|${p.kod || p.druh}`;
      const have = new Map([b.prev, ...(b.prevOther || [])].filter(Boolean).map(p => [key(p), p]));
      const pinned = b.prev && b.prevPinned ? key(b.prev) : null;
      for (const p0 of incoming) {
        const { fota: f0, ...rest } = p0;
        const p = decEnt(rest);
        if (!p.typ) p.typ = /hlavn/i.test(p.druh || '') ? 'hlavni' : /mimořád/i.test(p.druh || '') ? 'mimoradna' : /běžn/i.test(p.druh || '') ? 'bezna' : 'jina';
        p.datum = String(p.datum || '').slice(0, 10);
        const fota = [];
        for (const f of f0 || []) { fota.push({ poradi: f.poradi, popis: decEnt(f.popis), blob: f.img ? await dataUrlToBlob(f.img) : null }); if (f.img) nPh++; }
        have.set(key(p), { ...p, fota, importovano: Date.now() });
        nInsp++;
        Diktat.learnPrev({ ...p, fota });
      }
      const listP = [...have.values()].sort((a, c) => String(c.datum).localeCompare(String(a.datum)));
      // referenční „minulá prohlídka“ (kontrolní seznam závad z minula): ručně zvolená, jinak poslední hlavní, jinak nejnovější
      const ref = (pinned && have.get(pinned)) || listP.find(p => p.typ === 'hlavni') || listP[0];
      b.prev = ref; b.prevOther = listP.filter(p => p !== ref);
    }
    await put('bridges', b);
  }
  return `Import hotov: nových ${nNew}, aktualizovaných ${nUpd}, prohlídek ${nInsp}, fotek ${nPh}.`;
}
/* HTML entity v textech z BMS (&#34; &quot; …) → znaky; rekurzivně, obrázky (data:) beze změny */
const _ta = document.createElement('textarea');
function decEnt(x) {
  if (typeof x === 'string') { if (!/&[#a-z0-9]+;/i.test(x) || x.startsWith('data:')) return x; _ta.innerHTML = x; return _ta.value; }
  if (Array.isArray(x)) return x.map(decEnt);
  if (x && typeof x === 'object' && !(x instanceof Blob)) { const o = {}; for (const [k, v] of Object.entries(x)) o[k] = decEnt(v); return o; }
  return x;
}
const prevTitle = p => `${p.kod || p.druh} ${fmtDate(p.datum)}${p.prohlizel ? ', ' + p.prohlizel : ''}`;
const refKey = p => p ? (p.guid || `${String(p.datum).slice(0, 10)}|${p.kod || p.druh}`) : '';
const prevAll = b => [b.prev, ...(b.prevOther || [])].filter(Boolean).sort((a, c) => String(c.datum).localeCompare(String(a.datum)));
/* kontrola závad z minula v prohlídce i patří k aktuální referenční minulé prohlídce mostu? */
const checkValid = (i, b) => !i.prevRef || i.prevRef === refKey(b.prev);
const capClean = s => String(s || '').replace(/\.(jpe?g|png)$/i, '').replace(/^\d+[_\s-]*/, '');

/* minulá prohlídka */
async function vPrev(id, sel) {
  const b = await get('bridges', id);
  if (!b || !b.prev) { location.hash = `#/most/${id}`; return; }
  const list = prevAll(b);
  const p = list.find(x => refKey(x) === sel) || b.prev, ro = p.rozhodnuti || {}, isRef = p === b.prev;
  setTitle(`${b.evc} – minulé prohlídky`, `#/most/${id}`);
  const fBy = n => p.fota.find(f => f.poradi === n);
  const th = f => f && f.blob ? `<a class="thumb" href="#" data-big="${f.poradi}"><img loading="lazy" src="${blobUrl(f.blob)}" alt=""><span class="n">${f.poradi}</span></a>` : f ? `<span class="badge">foto ${f.poradi}</span>` : '';
  const TYP = { hlavni: 'hlavní', mimoradna: 'mimořádná', bezna: 'běžná', jina: 'jiná' };
  app.innerHTML = `
    ${list.length > 1 ? `<div class="card"><label style="margin-top:0">Prohlídka (${list.length} importováno)</label>
      <select id="psel">${list.map(x => `<option value="${esc(refKey(x))}"${x === p ? ' selected' : ''}>${fmtDate(x.datum)} – ${esc(TYP[x.typ] || x.druh || '')}${x === b.prev ? ' ★ minulá pro kontrolu závad' : ''}</option>`).join('')}</select>
      ${isRef ? '<p class="muted" style="margin:6px 0 0">★ Tato prohlídka slouží jako „minulá“ pro závady z minula, popis částí (B) a galerii Minulé v kameře.</p>'
        : '<button class="wide" id="mkref" style="margin-top:8px">Použít jako minulou prohlídku (závady z minula, popis B, galerie)</button>'}</div>` : ''}
    <div class="card"><h2>${esc(prevTitle(p))}</h2>
      <div class="kv">
        <b>Spodní stavba</b><span>${esc(ro.ss || '–')}</span>
        <b>Nosná konstrukce</b><span>${esc(ro.nk || '–')}</span>
        <b>Použitelnost</b><span>${esc(ro.pouzitelnost || '–')}</span>
        <b>Vn / Vr / Ve</b><span>${num(ro.vn, 1)} / ${num(ro.vr, 0)} / ${num(ro.ve, 0)} t</span>
        <b>Staničení ve směru</b><span>${esc(b.smer || '–')}</span>
        <b>Zpřístupnění</b><span>${esc(p.zpristupneni || '–')}</span>
      </div></div>
    <div class="card"><h2>Závady (${p.zavady.length})</h2>
      <ul class="list">${p.zavady.map(z => `<li style="display:block">
        <div><b>[${esc(z.code)}] ${esc(codeName(z.code))}${z.pozice ? ' – ' + esc(z.pozice) : ''}</b> ${z.stav ? `<span class="badge">${esc(z.stav)}</span>` : ''}</div>
        <div style="white-space:pre-wrap">${esc(z.popis)}</div>
        ${z.opatreni.map(o => `<div class="muted">➜ ${esc(o.popis)} ${o.nalehavost ? '(' + esc(o.nalehavost) + ')' : ''}</div>`).join('')}
        ${z.fota.length ? `<div class="grid" style="margin-top:6px">${z.fota.map(n => th(fBy(n))).join('')}</div>` : ''}
      </li>`).join('') || '<li class="muted">Bez závad.</li>'}</ul></div>
    <div class="card"><details><summary>Popis částí mostu (${p.casti.length})</summary>
      ${p.casti.map(c => `<p><b>[${esc(c.code)}] ${esc(c.nazev)}${c.pozice ? ' – ' + esc(c.pozice) : ''}</b><br><span style="white-space:pre-wrap">${esc(c.popis) || '–'}</span></p>`).join('')}
    </details></div>
    <div class="card"><h2>Fotky (${p.fota.length})</h2>
      ${p.fota.some(f => f.blob) ? `<div class="grid">${p.fota.map(f => f.blob ? `<a class="thumb" href="#" data-big="${f.poradi}"><img loading="lazy" src="${blobUrl(f.blob)}" alt=""><span class="n">${f.poradi}</span><span class="cap">${esc(capClean(f.popis))}</span></a>` : '').join('')}</div>` : ''}
      ${p.fota.some(f => !f.blob) ? `<details${p.fota.some(f => f.blob) ? '' : ' open'}><summary>Popisky fotek bez náhledu (${p.fota.filter(f => !f.blob).length})</summary><ol style="padding-left:22px">${p.fota.filter(f => !f.blob).map(f => `<li value="${f.poradi}">${esc(capClean(f.popis))}</li>`).join('')}</ol></details>` : ''}
    </div>`;
  bindBig(app, p.fota);
  if ($('#psel')) $('#psel').onchange = e => { location.hash = `#/minula/${id}?p=${encodeURIComponent(e.target.value)}`; };
  if ($('#mkref')) $('#mkref').onclick = async () => {
    const ins = (await all('insp')).filter(i => i.bridgeId === id && i.prevCheck && Object.keys(i.prevCheck).length && checkValid(i, b));
    if (ins.length && !confirm(`Rozpracovaná kontrola závad z minula (${ins.length} prohlídka/y) je vázaná na dosavadní minulou prohlídku a bude potřeba ji projít znovu. Pokračovat?`)) return;
    b.prevOther = list.filter(x => x !== p); b.prev = p; b.prevPinned = true;
    await put('bridges', b); toast('Nastaveno jako minulá prohlídka'); route();
  };
}

/* mostní list z BMS */
async function vList(id) {
  const b = await get('bridges', id);
  if (!b || !b.mostniList) { location.hash = `#/most/${id}`; return; }
  const m = b.mostniList;
  setTitle(`${b.evc} – mostní list`, `#/most/${id}`);
  const kv = rows => rows.length ? `<div class="kv">${rows.map(([k, v]) => `<b>${esc(k)}</b><span>${esc(typeof v === 'number' ? String(v).replace('.', ',') : v)}</span>`).join('')}</div>` : '<p class="muted">–</p>';
  const txt = (t, s) => s ? `<p><b>${t}</b><br><span style="white-space:pre-wrap">${esc(s)}</span></p>` : '';
  app.innerHTML = `
    <div class="card"><h2>${esc(b.evc)} ${esc(b.nazev)}</h2>${kv(m.spravni || [])}${txt('Poznámka', m.poznamka)}</div>
    <div class="card"><h2>Stav a zatížitelnost (evidence)</h2>${kv(m.stav || [])}</div>
    <div class="card"><h2>Rozměry a základní údaje</h2>${kv(m.rozmery || [])}${txt('Spodní stavba', m.popisSS)}${txt('Nosná konstrukce', m.popisNK)}${txt('Poznámka k NK', m.poznNK)}</div>
    <div class="card"><details><summary>Části mostu (${(m.casti || []).length})</summary>
      ${(m.casti || []).map(c => `<p><b>[${esc(c.code)}] ${esc(c.nazev)}${c.pozice ? ' – ' + esc(c.pozice) : ''}</b>
        ${(c.prvky || []).map(x => `<br><span class="muted">${esc(x)}</span>`).join('')}
        ${c.popis ? `<br><span style="white-space:pre-wrap">${esc(c.popis)}</span>` : ''}</p>`).join('')}</details></div>
    ${(m.historie || []).length ? `<div class="card"><details><summary>Provozní historie (${m.historie.length})</summary>${m.historie.map(h => `<p><b>${fmtDate(h.datum)} ${esc(h.druh)}</b><br><span style="white-space:pre-wrap">${esc(h.text)}</span></p>`).join('')}</details></div>` : ''}
    ${(m.prilohy || []).length ? `<div class="card"><h2>Přílohy v BMS (jen názvy)</h2><ul>${m.prilohy.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}`;
}
function bindBig(root, fota) {
  root.querySelectorAll('[data-big]').forEach(a => a.onclick = ev => {
    ev.preventDefault();
    const f = fota.find(x => String(x.poradi) === a.dataset.big);
    if (f && f.blob) showBig(blobUrl(f.blob), `${f.poradi}: ${capClean(f.popis)}`);
  });
}

/* popis částí mostu (oddíl B) pro novou prohlídku */
async function vDesc(inspId) {
  const i = await get('insp', inspId), b = await get('bridges', i.bridgeId);
  setTitle('Popis částí mostu', `#/prohlidka/${inspId}`);
  if (!i.casti) i.casti = [];
  app.innerHTML = `
    <div class="card">
      <p class="muted">Oddíl B zprávy. ${b.prev ? `Převzít lze z ${esc(prevTitle(b.prev))}.` : 'Minulá prohlídka není importovaná (Data → Import balíčku z BMS).'}</p>
      <div class="row">${b.prev ? '<button class="grow" id="take">Převzít z minulé prohlídky</button>' : ''}<button class="grow" id="add">+ Část</button></div>
    </div>
    ${i.casti.map((c, k) => `<div class="card">
      <div class="row"><select class="grow" data-code="${k}">${CODES.map(([cd, n]) => `<option value="${cd}"${cd === c.code ? ' selected' : ''}>${cd} ${esc(n)}</option>`).join('')}${CODES.some(x => x[0] === c.code) ? '' : `<option selected value="${esc(c.code)}">${esc(c.code)} ${esc(c.nazev)}</option>`}</select>
      <button class="small bad" data-del="${k}">✕</button></div>
      <input data-poz="${k}" placeholder="pozice (např. Opěry)" value="${esc(c.pozice)}" style="margin-top:6px">
      <textarea data-pop="${k}" style="margin-top:6px;min-height:110px">${esc(c.popis)}</textarea>
    </div>`).join('')}
    ${i.casti.length ? '<button class="pri wide" id="save">Uložit</button>' : ''}`;
  const collect = () => {
    i.casti.forEach((c, k) => {
      c.code = app.querySelector(`[data-code="${k}"]`).value; c.nazev = codeName(c.code) || c.nazev;
      c.pozice = app.querySelector(`[data-poz="${k}"]`).value.trim(); c.popis = app.querySelector(`[data-pop="${k}"]`).value.trim();
    });
  };
  if ($('#take')) $('#take').onclick = async () => {
    if (i.casti.length && !confirm('Přepsat současný popis popisem z minulé prohlídky?')) return;
    i.casti = b.prev.casti.map(c => ({ ...c })); await put('insp', i); route();
  };
  $('#add').onclick = async () => { collect(); i.casti.push({ code: '2.1', nazev: codeName('2.1'), pozice: '', popis: '' }); await put('insp', i); route(); };
  app.querySelectorAll('[data-del]').forEach(bt => bt.onclick = async () => { collect(); i.casti.splice(+bt.dataset.del, 1); await put('insp', i); route(); });
  app.querySelectorAll('[data-pop]').forEach(t => Diktat.attach(t, 'desc', () => app.querySelector(`[data-code="${t.dataset.pop}"]`).value));
  if ($('#save')) $('#save').onclick = async () => { collect(); await put('insp', i); i.casti.forEach(c => Diktat.learn('desc', c.code, c.popis)); toast('Uloženo'); location.hash = `#/prohlidka/${inspId}`; };
}

/* ---------- start ---------- */
$('#ver').textContent = 'v' + APP_VERSION;
window.addEventListener('hashchange', route);
route();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
