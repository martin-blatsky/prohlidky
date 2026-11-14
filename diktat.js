/* Opravy diktátu a návrhy frází.
   Zdroje: slovnik.js (vzorové HPM), naučené texty (uložené popisky a závady, importované minulé prohlídky),
   vlastní opravy uživatele (Data → Slovník diktátu). Nic se neodesílá, vše je v localStorage telefonu. */
(function () {
  const S = self.SLOVNIK || { w: {}, cap: [], def: {}, opt: {}, desc: {} };
  const KEY = 'prohlidky-slovnik';
  let U = null;
  const load = () => {
    if (U) return U;
    try { U = JSON.parse(localStorage.getItem(KEY)); } catch (e) { U = null; }
    U = U || {}; U.w = U.w || {}; U.ph = U.ph || {}; U.fix = U.fix || []; return U;
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(U)); } catch (e) { /* plné / zakázané úložiště */ } };

  const L = '\\p{L}\\p{N}';
  const B = `(^|[^${L}])`, E = `(?=$|[^${L}])`;
  const base = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const lc = w => (w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w)) || /\d/.test(w) ? w : w.toLowerCase();

  /* ---------- slovník ---------- */
  const freq = w => (S.w[lc(w)] || 0) + 3 * (load().w[lc(w)] || 0);
  const known = w => /^\d/.test(w) || (S.w[lc(w)] || 0) > 0 || (load().w[lc(w)] || 0) >= 2;
  let idx = null; // base → [{w, f}]
  const index = () => {
    if (idx) return idx;
    idx = [];
    const all = { ...S.w };
    for (const [w, n] of Object.entries(load().w)) if (n >= 2) all[w] = (all[w] || 0) + 3 * n;
    for (const [w, f] of Object.entries(all)) if (f >= 2 && w.length >= 3 && !/\d/.test(w)) idx.push({ w, b: base(w), f });
    return idx;
  };
  function dl(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = []; for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      let rowMin = 99;
      for (let j = 1; j <= b.length; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
        d[i][j] = v; if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
    }
    return d[a.length][b.length];
  }
  function nearest(w) {
    const b = base(w), max = w.length <= 5 ? 1 : 2;
    let best = null, bestD = 9, tie = false;
    for (const c of index()) {
      const d = c.b === b ? 0 : dl(b, c.b, max);
      if (d > max) continue;
      // jen jiná koncovka = jiný tvar slova (vysunuté/vysunutá), to neopravovat
      if (d > 0 && (b.slice(0, -1) === c.b.slice(0, -1) || b.startsWith(c.b) || c.b.startsWith(b))) continue;
      if (d < bestD || (d === bestD && c.f > best.f)) { tie = d === bestD && best && c.f === best.f; best = c; bestD = d; }
    }
    if (!best || tie) return null;
    let r = best.w;
    if (w[0] === w[0].toUpperCase() && r === r.toLowerCase()) r = r[0].toUpperCase() + r.slice(1);
    return r === w ? null : r;
  }

  /* ---------- pravidla pro zkratky a čísla ---------- */
  const NUMS = { nula: 0, jedna: 1, jeden: 1, jednu: 1, jedné: 1, jednom: 1, dva: 2, dvě: 2, dvou: 2, tři: 3, tří: 3, čtyři: 4, čtyř: 4, pět: 5, šest: 6, sedm: 7, osm: 8, devět: 9, deset: 10, jedenáct: 11, dvanáct: 12 };
  const NUM = `(${Object.keys(NUMS).join('|')}|\\d{1,2})`;
  const n = s => /^\d/.test(s) ? +s : NUMS[s.toLowerCase()];
  const rx = (s, f = 'giu') => new RegExp(s, f);
  const RULES = [
    // OP1: „ó pé jedna“, „o p 1“, „OP jedna“, „OP 1“
    [rx(`${B}(?:ó|o)\\.?\\s*(?:pé|pe|p)\\.?\\s*${NUM}${E}`), (m, a, x) => `${a}OP${n(x)}`],
    // opěra jedna → opěra OP1
    [rx(`${B}(opěr(?:a|y|u|ou|e|ě|ami|ách)|opěře)\\s+(?:číslo\\s+|č\\.\\s*)?${NUM}${E}`), (m, a, o, x) => `${a}${o} OP${n(x)}`],
    // pilíř dva → pilíř P2; „pé dva“ → P2; „P 2“ → P2
    [rx(`${B}(pilíř(?:e|i|em|ů|ích)?)\\s+(?:číslo\\s+|č\\.\\s*)?${NUM}${E}`), (m, a, o, x) => `${a}${o} P${n(x)}`],
    [rx(`${B}(?:pé|pe)\\s*${NUM}${E}`), (m, a, x) => `${a}P${n(x)}`],
    [rx(`${B}P\\s+(\\d{1,2})${E}`, 'gu'), (m, a, x) => `${a}P${x}`],
    // pole dva → pole 2
    [rx(`${B}(pol(?:e|i|em)|polích)\\s+(?:číslo\\s+|č\\.\\s*)?${NUM}${E}`), (m, a, o, x) => `${a}${o} ${n(x)}`],
    // NK, SDZ, PKO
    [rx(`${B}(?:en\\s?k[áa]|enká|n\\s?k|Nk)${E}`), (m, a) => `${a}NK`],
    [rx(`${B}(?:es\\s?d[ée]\\s?(?:zet|z)|sdz)${E}`), (m, a) => `${a}SDZ`],
    [rx(`${B}(?:pé\\s?ká\\s?ó|pko)${E}`), (m, a) => `${a}PKO`],
    // nula celá tři → 0,3 ; tři desetiny milimetru → 0,3 mm
    [rx(`${B}${NUM}\\s+(?:celá|celé|celých|cela)\\s+${NUM}${E}`), (m, a, x, y) => `${a}${n(x)},${n(y)}`],
    [rx(`${B}${NUM}\\s+desetin[ay]?\\s+milimetr\\p{L}*`), (m, a, x) => `${a}0,${n(x)} mm`],
    // jednotky za číslem
    [rx(`(\\d)\\s*(?:milimetr(?:ů|u|y|ech)?|milimetrů)${E}`), (m, a) => `${a} mm`],
    [rx(`(\\d)\\s*(?:centimetr(?:ů|u|y|ech)?)${E}`), (m, a) => `${a} cm`],
    [rx(`(\\d)\\s*(?:metr(?:ů|u|y|ech)?)${E}`), (m, a) => `${a} m`],
    [rx(`(\\d)\\s*(?:stup(?:eň|ně|ňů) celsia|stup(?:eň|ně|ňů))${E}`), (m, a) => `${a} °C`],
    // „číslo jedna“ v trhlina č. 1
    [rx(`${B}(trhlin(?:a|y|u|ou|ě)|závad(?:a|y|u|ou|ě))\\s+(?:číslo|č\\.)\\s*${NUM}${E}`), (m, a, o, x) => `${a}${o} č. ${n(x)}`],
  ];

  function rulesApply(t) {
    let s = t;
    for (const [fx, a, b] of load().fix) { // vlastní opravy mají přednost
      if (!a) continue;
      s = s.replace(rx(`${B}${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${E}`), (m, p) => p + b);
    }
    for (const [r, f] of RULES) s = s.replace(r, f);
    return s;
  }

  /* Návrh opravy: vrací {text, parts:[{o, r, fuzzy}]} nebo null */
  function suggest(text, kind) {
    if (!text || !text.trim()) return null;
    let s = rulesApply(text);
    // tokeny: slovo / ostatní
    const tok = s.match(rx(`[${L}]+|[^${L}]+`, 'gu')) || [];
    const isW = t => rx(`^[${L}]+$`, 'u').test(t);
    // slepení rozdělených slov („svod idla“ → „svodidla“)
    for (let i = 0; i + 2 < tok.length; i++) {
      if (isW(tok[i]) && tok[i + 1] === ' ' && isW(tok[i + 2]) && (!known(tok[i]) || !known(tok[i + 2]))) {
        const j = tok[i] + tok[i + 2];
        if (freq(j) >= 2) { tok.splice(i, 3, j); }
      }
    }
    const parts = tok.map(t => {
      if (!isW(t) || t.length < 4 || known(t) || /\d/.test(t)) return { o: t, r: t };
      const r = nearest(t);
      return r ? { o: t, r, fuzzy: true } : { o: t, r: t };
    });
    let out = parts.map(p => p.r).join('');
    out = tidy(out, kind);
    // přenést úklid do parts zjednodušeně: když se liší jen úklidem, vrátit jako jeden díl
    const joined = parts.map(p => p.r).join('');
    if (out !== joined) parts.push({ o: '', r: '', tidy: out });
    return out === text ? null : { text: out, parts };
  }
  function tidy(s, kind) {
    s = s.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').replace(/([.,;:])(?=\p{L})/gu, '$1 ').trim();
    if (s) s = s[0].toUpperCase() + s.slice(1);
    s = s.replace(/([.!?]\s+)(\p{Ll})/gu, (m, a, c) => a + c.toUpperCase());
    if (kind === 'cap' && s && !/[.!?]$/.test(s)) s += '.';
    return s;
  }

  /* ---------- fráze ---------- */
  const sentences = t => String(t || '').split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(x => x.length >= 6);
  function phrases(kind, code) {
    const u = load().ph, m = new Map();
    const add = (s, f) => { const k = s.trim(); if (k) m.set(k, (m.get(k) || 0) + f); };
    if (kind === 'cap') { S.cap.forEach(([s, f]) => add(s, f)); Object.entries(u.cap || {}).forEach(([s, f]) => add(s, 3 * f)); }
    else {
      const src = S[kind] || {};
      // stejný kód části má výrazně přednost, ostatní kódy jen jako záloha
      for (const [c, lst] of Object.entries(src)) lst.forEach(([s, f]) => add(s, c === code ? 100 + f : f * 0.05));
      for (const [c, o] of Object.entries(u)) {
        if (!c.startsWith(kind + ':')) continue;
        const cc = c.slice(kind.length + 1);
        Object.entries(o).forEach(([s, f]) => add(s, cc === code ? 100 + 3 * f : 0.5 * f));
      }
    }
    return [...m.entries()].map(([s, f]) => ({ s, f, b: base(s), t: base(s).split(/[^a-z0-9]+/).filter(Boolean) }));
  }
  function matchPhrases(text, kind, code, k = 5) {
    const t = String(text || '');
    const cut = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '), /[.!?]\s*$/.test(t) ? t.length : -1);
    const frag = t.slice(cut + 1).trim();
    const done = base(t);
    const fw = base(frag).split(/[^a-z0-9]+/).filter(w => w.length >= 2);
    let list = phrases(kind, code).filter(p => !done.includes(p.b));
    if (fw.length) {
      list = list.map(p => {
        let hit = 0;
        for (const w of fw) { const pre = w.slice(0, Math.min(w.length, 4)); if (p.t.some(x => x.startsWith(pre))) hit++; }
        return { ...p, sc: hit / fw.length };
      }).filter(p => p.sc >= (fw.length <= 2 ? 1 : 0.67));
      list.sort((a, b) => b.sc - a.sc || b.f - a.f);
    } else list.sort((a, b) => b.f - a.f);
    return { frag, start: frag ? t.length - t.slice(cut + 1).replace(/^\s+/, '').length : t.length, items: list.slice(0, k).map(p => p.s) };
  }

  /* ---------- učení ---------- */
  function learn(kind, code, text) {
    const u = load(); const t = String(text || '').trim(); if (!t) return;
    const key = kind === 'cap' ? 'cap' : `${kind}:${code || ''}`;
    u.ph[key] = u.ph[key] || {};
    const list = kind === 'cap' ? [t.replace(/\s*\/\d+$/, '')] : sentences(t);
    list.forEach(s => { u.ph[key][s] = (u.ph[key][s] || 0) + 1; });
    for (const w of t.match(rx(`[${L}]+`, 'gu')) || []) if (!/^\d+$/.test(w)) u.w[lc(w)] = (u.w[lc(w)] || 0) + 1;
    // omezit velikost: fráze s četností 1 nad 400 položek zahodit nejstarší
    const ks = Object.keys(u.ph[key]); if (ks.length > 400) ks.slice(0, ks.length - 400).forEach(s => { if (u.ph[key][s] < 2) delete u.ph[key][s]; });
    idx = null; save();
  }
  function learnPrev(p) { // minulá prohlídka z BMS – texty prohlížejících jsou spolehlivé
    if (!p) return;
    (p.casti || []).forEach(c => learn('desc', c.code, c.popis));
    (p.zavady || []).forEach(z => { learn('def', z.code, z.popis); (z.opatreni || []).forEach(o => learn('opt', z.code, o.popis)); });
    (p.fota || []).forEach(f => { const c = String(f.popis || '').replace(/\.(jpe?g|png)$/i, '').replace(/^\d+[_\s-]*/, '').trim(); if (c && !/^IMG|^DSC/i.test(c)) learn('cap', '', c); });
  }

  /* ---------- UI: návrhy pod textovým polem ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function attach(el, kind, getCode) {
    if (!el || el._assist) return; el._assist = true;
    const box = document.createElement('div'); box.className = 'assist';
    box.innerHTML = '<div class="fixbar" hidden></div><div class="chips"></div>';
    el.after(box);
    const fixbar = box.firstChild, chips = box.lastChild;
    let timer = 0, cur = null;
    const code = () => (getCode ? getCode() : '') || '';
    const set = v => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el._fromAssist = true; };
    function renderFix() {
      cur = suggest(el.value, kind);
      if (!cur) { fixbar.hidden = true; return; }
      const fi = cur.parts.findIndex(p => p.r.trim());
      if (fi >= 0 && !cur.parts[fi].fuzzy) cur.parts[fi].r = cur.parts[fi].r.replace(/^\s*\p{Ll}/u, c => c.toUpperCase());
      const body = cur.parts.filter(p => !p.tidy).map((p, i) => p.fuzzy
        ? `<span class="fz" data-i="${i}" title="${esc(p.o)}">${esc(p.r)}</span>` : esc(p.r)).join('');
      fixbar.innerHTML = `<div class="fxt"><b>Oprava:</b> ${body}</div><div class="row"><button class="small pri" data-a="ok">Použít</button><button class="small" data-a="no">✕</button></div>`;
      fixbar.hidden = false;
    }
    function renderChips() {
      const r = matchPhrases(el.value, kind, code());
      chips.innerHTML = r.items.map((s, i) => `<button type="button" class="chip" data-i="${i}">${esc(s)}</button>`).join('');
      chips._r = r;
    }
    const update = () => { renderFix(); renderChips(); };
    el.addEventListener('input', () => { if (el._fromAssist) { el._fromAssist = false; } clearTimeout(timer); timer = setTimeout(update, 700); });
    el.addEventListener('focus', renderChips);
    fixbar.addEventListener('click', e => {
      const fz = e.target.closest('.fz');
      if (fz) { // přepnout jednotlivou opravu zpět na původní slovo
        const p = cur.parts[+fz.dataset.i]; [p.r, p.o] = [p.o, p.r]; p.fuzzy = true;
        fz.textContent = p.r; fz.classList.toggle('off'); return;
      }
      const a = e.target.dataset.a;
      if (a === 'ok') {
        const t = tidy(cur.parts.filter(p => !p.tidy).map(p => p.r).join(''), kind);
        set(t); fixbar.hidden = true; renderChips();
      } else if (a === 'no') fixbar.hidden = true;
    });
    chips.addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      const r = chips._r, s = r.items[+b.dataset.i], v = el.value;
      const head = v.slice(0, r.start).replace(/\s*$/, '');
      set((head ? head + ' ' : '') + s);
      fixbar.hidden = true; renderChips(); el.focus();
    });
    if (el.value) setTimeout(() => { renderFix(); }, 0);
  }

  function stats() { const u = load(); return { base: Object.keys(S.w).length, learned: Object.values(u.w).filter(n => n >= 2).length, phrases: Object.values(u.ph).reduce((a, o) => a + Object.keys(o).length, 0), fix: u.fix.length }; }
  function getFix() { return load().fix.map(([, a, b]) => `${a} = ${b}`).join('\n'); }
  function setFix(txt) {
    load().fix = String(txt || '').split(/\r?\n/).map(l => l.split(/\s*=\s*/)).filter(x => x.length === 2 && x[0].trim() && x[1].trim()).map(([a, b]) => [1, a.trim(), b.trim()]);
    save();
  }
  function reset() { U = { w: {}, ph: {}, fix: load().fix }; idx = null; save(); }
  function exportJson() { return JSON.stringify(load()); }
  function importJson(t) {
    const j = JSON.parse(t), u = load();
    for (const [w, n] of Object.entries(j.w || {})) u.w[w] = (u.w[w] || 0) + n;
    for (const [k, o] of Object.entries(j.ph || {})) { u.ph[k] = u.ph[k] || {}; for (const [s, n] of Object.entries(o)) u.ph[k][s] = (u.ph[k][s] || 0) + n; }
    const have = new Set(u.fix.map(x => x[1])); (j.fix || []).forEach(x => { if (!have.has(x[1])) u.fix.push(x); });
    idx = null; save();
  }

  self.Diktat = { suggest, matchPhrases, learn, learnPrev, attach, stats, getFix, setFix, reset, exportJson, importJson, _rules: rulesApply };
})();
