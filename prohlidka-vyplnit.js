/* Vyplnit prohlídku v BMS / CEV2 (M. Blatský + Claude), verze 0.1
   Spouští se na otevřeném detailu NEDOKONČENÉ prohlídky v bms.clevera.cz nebo cev2.rsd.cz/bridge.
   Vstup: vyplneni.json (z pracovního protokolu) nebo data.json z exportu aplikace Prohlídky mostů
          + volitelně fotky ze složky foto/ exportu (párují se podle čísla na začátku názvu souboru).
   Zápis jde stejným voláním jako dialogy stránky (UpdateProhlidkaDetail, InspectionUpload).
   Zápis nic nemaže a nepřepisuje: části a závady jen přidává, základní údaje doplní jen zaškrtnutá pole.
   Režim „Smazat vložené“ smaže vybrané části / závady / přílohy (předvybrané jsou ty, které vložila záložka),
   jen v nedokončené prohlídce a po potvrzení v okně. Prohlídku nikdy nedokončuje ani neschvaluje.
   Stavební stav, použitelnost a zatížitelnost nezapisuje – ty volí prohlížející sám. */
(async () => {
  const H = location.host;
  const SYS = H === 'cev2.rsd.cz' ? { n: 'CEV2', app: '/bridge' } : H === 'bms.clevera.cz' ? { n: 'BMS', app: '' } : null;
  if (!SYS) { alert('Spusť na detailu prohlídky v bms.clevera.cz nebo cev2.rsd.cz/bridge.'); return; }
  if (document.getElementById('pvy-ui')) return;
  const API = SYS.app + '/api';
  const m = location.href.match(/Inspection\/Detail\/([0-9a-f-]{36})/i);
  if (!m) { alert('Otevři detail prohlídky (stránka Prohlídky → detail), pak spusť záložku znovu.'); return; }
  const PG = m[1];

  const chk = async r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (!/json/i.test(r.headers.get('content-type') || '')) throw new Error(`nejsi přihlášený do ${SYS.n} – obnov stránku a přihlas se`);
    const j = await r.json(); if (j && j.ErrorMessage) throw new Error(j.ErrorMessage === 'NotLoggedIn' ? `nejsi přihlášený do ${SYS.n}` : j.ErrorMessage); return j;
  };
  const get = u => fetch(API + u, { credentials: 'same-origin' }).then(chk);
  // POJISTKA: záložka smí volat jen UpdateProhlidkaDetail; nikdy nedokončuje, neschvaluje ani nepřebírá.
  // Mazání (JeSmazan: true) jen v režimu „Smazat vložené“ po potvrzení v okně.
  const ZAKAZ = ['Dokonceni', 'Autorizace', 'Prevzeti', 'DokonceniAutorizace'];
  const post = (u, body, smazat = false) => {
    if (u !== '/inspectiondata/UpdateProhlidkaDetail') return Promise.reject(new Error('nepovolené volání ' + u));
    const s = JSON.stringify(body);
    if (!smazat && /"JeSmazan":true/.test(s)) return Promise.reject(new Error('pojistka: mazání není povoleno'));
    if (ZAKAZ.some(k => new RegExp('"' + k + '"\\s*:').test(s))) return Promise.reject(new Error('pojistka: dokončení / schválení není povoleno'));
    return fetch(API + u, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: s }).then(chk);
  };
  const upd = (body, smazat) => post('/inspectiondata/UpdateProhlidkaDetail', body, smazat);
  // záznam toho, co záložka do prohlídky vložila (v prohlížeči, localStorage stránky BMS / CEV2)
  const RK = `pvy:${SYS.n}:${PG}`;
  const rec = () => { try { return JSON.parse(localStorage.getItem(RK)) || { casti: [], zavady: [], prilohy: [] }; } catch (e) { return { casti: [], zavady: [], prilohy: [] }; } };
  const recAdd = (k, g) => { if (!g) return; const r = rec(); if (!r[k].includes(g)) r[k].push(g); r.kdy = new Date().toISOString(); try { localStorage.setItem(RK, JSON.stringify(r)); } catch (e) { } };
  const detail = () => get(`/inspectiondata/GetProhlidkaDetail?guidId=${PG}`);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = t => String(t || '').trim().split(/\n{2,}/).map(p => '<p>' + esc(p).replace(/\n/g, '<br/>') + '</p>').join('');
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  const code = n => (String(n || '').match(/(\d+(?:\.\d+)*)/) || [, ''])[1];
  const TODO = s => /\[doplnit/i.test(String(s || ''));
  const newGuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : r & 3 | 8).toString(16); }));

  /* ---------- okno ---------- */
  const ui = document.createElement('div'); ui.id = 'pvy-ui';
  ui.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;background:#fff;color:#17202a;width:min(820px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;border-radius:10px;font:14px/1.4 Segoe UI,Arial,sans-serif;box-shadow:0 4px 24px #0007;border:1px solid #1f3a5f';
  document.body.appendChild(ui);
  const css = `<style>#pvy-ui h3{margin:0;padding:10px 14px;background:#1f3a5f;color:#fff;font-size:15px;display:flex;justify-content:space-between;position:sticky;top:0}
    #pvy-ui h4{margin:12px 0 4px;font-size:14px;color:#1f3a5f}#pvy-ui .b{padding:12px 14px}#pvy-ui label{display:block;margin:4px 0}
    #pvy-ui button{padding:6px 14px;border-radius:6px;border:1px solid #1f3a5f;background:#fff;color:#1f3a5f;cursor:pointer;font:inherit}
    #pvy-ui button.p{background:#1f3a5f;color:#fff}#pvy-ui button:disabled{opacity:.5}#pvy-ui .m{color:#5f6b78;font-size:12px}
    #pvy-ui table{border-collapse:collapse;width:100%;font-size:12.5px}#pvy-ui td,#pvy-ui th{border-bottom:1px solid #d9dee5;padding:3px 4px;text-align:left;vertical-align:top}
    #pvy-ui .e{color:#b3261e}#pvy-ui .w{background:#fff4d6}#pvy-ui select{font:inherit;font-size:12px;max-width:230px}#pvy-ui .row{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
    #pvy-ui pre{white-space:pre-wrap;font-size:12px;background:#f4f6f9;padding:6px;max-height:300px;overflow:auto}</style>`;
  const head = t => `${css}<h3><span>${t}</span><span style="cursor:pointer" id="pvy-x">✕</span></h3>`;
  const bindX = () => { ui.querySelector('#pvy-x').onclick = () => ui.remove(); };
  const say = (t, cls = '') => { ui.innerHTML = head(`Vyplnit prohlídku – ${SYS.n}`) + `<div class="b ${cls}">${t}</div>`; bindX(); };

  /* ---------- načtení prohlídky a číselníků ---------- */
  say('Načítám prohlídku a číselníky…');
  let D, CIS, CASTI, TYP_FOTO;
  try {
    D = await detail();
    CIS = await get('/codelistdata/GetCiselnikListForProhlidkaEdit?skupinaCiselniku=Prohlidka');
    CASTI = ((await get('/inspectiondata/GetProhlidkaObjektCastList')).ProhlidkaObjektCastList || []);
    const P = await get('/codelistdata/GetCiselnikList?skupinaCiselniku=PrilohaInspekce');
    TYP_FOTO = ((P.TypPrilohyList || []).find(t => /^fotografie$/i.test(t.Nazev)) || (P.TypPrilohyList || [])[0] || {}).GuidId;
  } catch (e) { say('Chyba: ' + esc(e.message), 'e'); return; }
  const ZU = D.ZakladniUdaje || {}, RU = D.RozsireneUdaje || {};
  if (!/není dokon|neni dokon|nedokon/i.test(String(ZU.Dokonceni || ''))) { say(`Prohlídka je „${esc(ZU.Dokonceni)}“. Záložka zapisuje jen do nedokončené prohlídky.`, 'e'); return; }
  const druhObj = String(ZU.DruhObjektuNazev || 'Most');
  // „Most 2.3 Mostní závěry“ → kód 2.3
  const castByCode = {};
  CASTI.forEach(c => { const nm = String(c.Nazev || ''); if (!nm.startsWith(druhObj + ' ')) return; const k = code(nm.slice(druhObj.length)); if (k && !castByCode[k]) castByCode[k] = c; });
  const NAL = (CIS.StupenNalehavostiList || []).filter(x => !x.JeSmazan);
  const nalGuid = t => { const n = norm(t); if (!n) return ''; const x = NAL.find(x => norm(x.Nazev) === n) || NAL.find(x => n.startsWith(norm(x.Nazev).slice(0, 12))); return x ? x.GuidId : ''; };

  /* ---------- převod vstupu na jednotný model ---------- */
  function model(j) {
    if (j && j.format === 'prohlidka-vyplneni') return j;
    if (j && j.inspection && j.photos) {           // data.json z aplikace
      const i = j.inspection, b = j.bridge || {};
      const fot = j.photos.filter(p => p.include && p.cislo);
      return {
        format: 'prohlidka-vyplneni', zdroj: 'aplikace ' + (j.app || ''), evc: b.evc, datum: i.datum,
        zakladni: { Pocasi: i.pocasi, Zpristupneni: i.zpristupneni, TeplotaVzduchu: i.tVzd, TeplotaNosneKonstrukce: i.tNK, StaniceniVeSmeru: b.smer },
        casti: (i.casti || []).map(c => ({ code: c.code, pozice: c.pozice || '', popis: c.popis || '' })),
        zavady: (i.defects || []).map(d => ({ id: 'A' + d.n, code: String(d.code || '').replace(/^([1-5])000$/, '$1'), pozice: d.polohaText || '', popis: d.popis || '',
          opatreni: d.opatreni ? [{ popis: d.opatreni, nalehavost: '' }] : [], fota: fot.filter(p => p.defectId === d.id).map(p => p.cislo) })),
        fota: fot.map(p => ({ cislo: p.cislo, popis: p.caption || '' })),
      };
    }
    throw new Error('Neznámý formát souboru (čekám vyplneni.json z protokolu nebo data.json z exportu aplikace).');
  }

  /* ---------- krok 1: výběr souborů ---------- */
  let M, FILES = {};
  function step1() {
    say(`<div><b>${esc(ZU.Oznaceni || '').replace('|', ' – ')}</b><div class="m">${esc(ZU.Dokonceni)} · v prohlídce je ${(RU.ObjektCastList || []).filter(c => !c.JeSmazan).length} částí a ${(RU.PrilohaList || []).filter(a => !a.JeSmazan).length} příloh</div></div>
      <label style="margin-top:10px"><b>1. Data prohlídky</b> – vyplneni.json (protokol) nebo data.json (export aplikace)<br><input type="file" id="pvy-j" accept=".json,application/json"></label>
      <label><b>2. Fotky</b> (nepovinné) – vyber všechny soubory ze složky <code>foto</code> exportu (Ctrl+A)<br><input type="file" id="pvy-f" accept="image/jpeg,image/png" multiple></label>
      <div class="m">Po výběru se zobrazí náhled. Do ${SYS.n} se nic nezapíše, dokud nedáš „Zapsat“.</div>
      <div class="row"><button id="pvy-del" style="margin-right:auto">Smazat vložené…</button><button class="p" id="pvy-go" disabled>Náhled</button></div>`);
    ui.querySelector('#pvy-del').onclick = stepDel;
    const jIn = ui.querySelector('#pvy-j'), fIn = ui.querySelector('#pvy-f'), go = ui.querySelector('#pvy-go');
    jIn.onchange = () => { go.disabled = !jIn.files.length; };
    go.onclick = async () => {
      try { M = model(JSON.parse(await jIn.files[0].text())); } catch (e) { alert('Soubor nejde načíst: ' + e.message); return; }
      FILES = {};
      [...fIn.files].forEach(f => { const n = (f.name.match(/^(\d{1,4})[_\- .]/) || [])[1]; if (n) FILES[+n] = f; });
      step2();
    };
  }

  /* ---------- krok 2: náhled ---------- */
  const ZUF = [['StaniceniVeSmeru', 'Staničení ve směru'], ['Pocasi', 'Počasí'], ['Zpristupneni', 'Způsob zpřístupnění'], ['TeplotaVzduchu', 'Teplota vzduchu', 1],
    ['TeplotaVzduchuPoznamka', 'Pozn. k teplotě vzduchu'], ['TeplotaNosneKonstrukce', 'Teplota NK', 1], ['TeplotaNosneKonstrukcePoznamka', 'Pozn. k teplotě NK'], ['Poznamka', 'Poznámka']];
  const numv = v => { const x = parseFloat(String(v ?? '').replace(',', '.').replace(/[^\d.\-]/g, '')); return isFinite(x) ? x : null; };
  function step2() {
    const warn = [];
    const objEvc = String(ZU.ObjektNazev || '');
    if (M.evc && norm(M.evc) !== norm(objEvc)) warn.push(`Ev. č. v souboru (${esc(M.evc)}) nesouhlasí s prohlídkou (${esc(objEvc)}).`);
    const dIso = String(ZU.Datum || '').slice(0, 10);
    if (M.datum && /^\d{4}-\d\d-\d\d$/.test(M.datum) && M.datum !== dIso) warn.push(`Datum v souboru (${esc(M.datum)}) nesouhlasí s datem prohlídky (${esc(dIso)}).`);
    if ((RU.ObjektCastList || []).some(c => !c.JeSmazan && (c.ZavadaList || []).some(z => !z.JeSmazan))) warn.push('Prohlídka už obsahuje závady – zápis přidá další (případně duplicitní).');
    const z = M.zakladni || {};
    const zuRows = ZUF.filter(([k]) => z[k] != null && String(z[k]).trim() !== '').map(([k, l, num]) => {
      const nv = num ? numv(z[k]) : z[k], cur = ZU[k];
      const bad = TODO(z[k]) || (num && nv === null);
      return `<tr class="${bad ? 'w' : ''}"><td><input type="checkbox" class="pvy-zu" data-k="${k}" ${!bad && (cur == null || cur === '') ? 'checked' : ''} ${bad ? 'disabled' : ''}></td>
        <td>${l}</td><td>${esc(String(nv ?? z[k]).slice(0, 400))}</td><td class="m">${cur != null && cur !== '' ? 'nyní: ' + esc(String(cur).replace(/<[^>]+>/g, ' ').slice(0, 80)) : ''}</td></tr>`;
    }).join('');
    const nalSel = (v, i, k) => `<select class="pvy-n" data-i="${i}" data-k="${k}"><option value="">(bez naléhavosti)</option>${NAL.map(x => `<option value="${x.GuidId}" ${x.GuidId === nalGuid(v) ? 'selected' : ''}>${esc(x.Nazev)}</option>`).join('')}</select>`;
    const zRows = (M.zavady || []).map((d, i) => {
      const c = castByCode[code(d.code)], bad = !c || TODO(d.popis);
      const fm = (d.fota || []).map(n => FILES[n] ? n : `<span class="e">${n}✗</span>`).join(', ');
      return `<tr class="${bad ? 'w' : ''}"><td><input type="checkbox" class="pvy-z" data-i="${i}" ${bad ? '' : 'checked'} ${c ? '' : 'disabled'}></td>
        <td>${esc(d.id || i + 1)}</td><td>${c ? esc(code(d.code)) : `<span class="e">${esc(d.code)}?</span>`}${d.pozice ? '<div class="m">' + esc(d.pozice) + '</div>' : ''}</td>
        <td>${esc(d.popis)}${(d.opatreni || []).map((o, k) => `<div style="margin-top:3px">→ ${esc(o.popis)}<br>${nalSel(o.nalehavost, i, k)}</div>`).join('')}</td><td>${fm}</td></tr>`;
    }).join('');
    const cRows = (M.casti || []).map((c, i) => { const ok = castByCode[code(c.code)]; return `<tr><td><input type="checkbox" class="pvy-c" data-i="${i}" ${ok ? 'checked' : 'disabled'}></td><td>${esc(c.code)}</td><td>${esc(c.pozice)}</td><td>${esc(String(c.popis).slice(0, 160))}</td></tr>`; }).join('');
    const nF = Object.keys(FILES).length, fot = (M.fota || []).filter(f => FILES[f.cislo]);
    say(`${warn.map(w => `<div class="e">⚠ ${w}</div>`).join('')}
      <div class="m">Zdroj: ${esc(M.zdroj || 'protokol')} · ${esc(M.evc || '')} · ${esc(M.datum || '')}</div>
      <h4>Základní údaje</h4>${zuRows ? `<table>${zuRows}</table>` : '<div class="m">nic k doplnění</div>'}
      <h4>Fotky (${fot.length} ze ${(M.fota || []).length} spárováno, vybráno souborů ${nF})</h4>
      <label><input type="checkbox" id="pvy-fo" ${fot.length ? 'checked' : 'disabled'}> nahrát spárované fotky s popisky a připojit je k závadám</label>
      <h4>Popisy částí (oddíl B) – ${(M.casti || []).length}</h4>
      <label><input type="checkbox" id="pvy-call"> zapsat i části bez závad (jen popis)</label>
      ${cRows ? `<details><summary class="m">seznam</summary><table>${cRows}</table></details>` : ''}
      <h4>Závady a opatření – ${(M.zavady || []).length}</h4>
      <div class="m">Žlutě: chybí část objektu v číselníku nebo text obsahuje [doplnit] – nejsou předvybrané. Naléhavost lze změnit.</div>
      <table><tr><th></th><th>ID</th><th>Část</th><th>Popis / opatření</th><th>Foto</th></tr>${zRows}</table>
      <div class="m" style="margin-top:8px">Stavební stav, použitelnost a zatížitelnost záložka nezapisuje.</div>
      <div class="row"><button id="pvy-back">Zpět</button><button class="p" id="pvy-w">Zapsat do ${SYS.n}</button></div>`);
    ui.querySelector('#pvy-back').onclick = step1;
    ui.querySelector('#pvy-w').onclick = () => {
      const zu = [...ui.querySelectorAll('.pvy-zu:checked')].map(c => c.dataset.k);
      const zs = [...ui.querySelectorAll('.pvy-z:checked')].map(c => +c.dataset.i);
      const cs = [...ui.querySelectorAll('.pvy-c:checked')].map(c => +c.dataset.i);
      const nal = {}; ui.querySelectorAll('.pvy-n').forEach(s => { nal[s.dataset.i + '_' + s.dataset.k] = s.value; });
      const opt = { zu, zs, cs, nal, foto: ui.querySelector('#pvy-fo').checked, castiAll: ui.querySelector('#pvy-call').checked };
      const nFoto = opt.foto ? fot.length : 0;
      // potvrzení ve vlastním okně (systémový confirm() některé prohlížeče/panely tiše blokují)
      const row = ui.querySelector('#pvy-w').parentNode;
      row.innerHTML = `<div style="flex:1" class="e">Zapsat do ${SYS.n} do prohlídky ${esc(String(ZU.Oznaceni || '').split('|')[0])}: základní údaje ${zu.length} polí, závady ${zs.length}, fotky ${nFoto}. Hromadně vrátit nejde (smazat se dá ručně v ${SYS.n}).</div>
        <button id="pvy-no">Zpět k náhledu</button><button class="p" id="pvy-yes">Ano, zapsat</button>`;
      row.querySelector('#pvy-no').onclick = step2;
      row.querySelector('#pvy-yes').onclick = () => step3(opt, fot);
    };
  }

  /* ---------- krok 3: zápis ---------- */
  async function step3(o, fot) {
    say('<div id="pvy-log"></div>');
    const logEl = ui.querySelector('#pvy-log'), lines = [];
    const log = (t, cls = '') => { lines.push(`<div class="${cls}">${esc(t)}</div>`); logEl.innerHTML = lines.join(''); };
    const errs = [];
    try {
      // 1) základní údaje
      if (o.zu.length) {
        const z = { ...ZU };
        ['Dokonceni', 'Autorizace', 'Prevzeti', 'DatumPosledniZmeny', 'Oznaceni'].forEach(k => delete z[k]);   // jen editovatelná pole
        o.zu.forEach(k => { const v = M.zakladni[k]; z[k] = ['TeplotaVzduchu', 'TeplotaNosneKonstrukce'].includes(k) ? numv(v) : k === 'Poznamka' ? html(v) : String(v); });
        await upd({ GuidId: PG, ZakladniUdaje: z }); log(`✓ základní údaje (${o.zu.length})`);
      }
      // 2) fotky
      const fotoGuid = {};
      if (o.foto && fot.length) {
        const s = window.angular && angular.element(document.body).injector && angular.element(document.body).injector();
        const url = s ? s.get('settingsService').getActionUrl('api/InspectionUpload', 'InspectionFiles') : `${API}/InspectionUpload/InspectionFiles`;
        let por = 0; try { const r = await get(`/inspectiondata/GetLastPoradiPrilohyProhlidky?guidId=${PG}`); por = +(r.Poradi ?? r.LastPoradi ?? r.Value ?? 0) || 0; } catch (e) { }
        if (!por) por = Math.max(0, ...(RU.PrilohaList || []).filter(a => !a.JeSmazan).map(a => a.Poradi || 0));
        for (const [k, f] of fot.entries()) {
          const file = FILES[f.cislo];
          const at = { GuidId: PG, DatumVlozeni: new Date().toISOString(), Popis: f.popis, Tisknout: true, Poradi: por + k + 1, TypPrilohyGuidId: TYP_FOTO, Popis_New: f.popis };
          const fd = new FormData(); fd.append('UploadedFile', file, file.name); fd.append('Atributy', JSON.stringify(at)); fd.append('StopMarker', 'true');
          const r = await fetch(url, { method: 'POST', credentials: 'same-origin', body: fd });
          if (!r.ok) { errs.push(`foto ${f.cislo}: HTTP ${r.status}`); log(`✗ foto ${f.cislo} (${file.name}): HTTP ${r.status}`, 'e'); continue; }
          log(`✓ foto ${k + 1}/${fot.length}: ${file.name}`);
        }
        const D2 = await detail();
        const pl = ((D2.RozsireneUdaje || {}).PrilohaList || []).filter(a => !a.JeSmazan);
        fot.forEach(f => { const a = pl.find(a => a.Soubor === FILES[f.cislo].name); if (a) { fotoGuid[f.cislo] = a.GuidId; recAdd('prilohy', a.GuidId); } });
        log(`fotky v ${SYS.n} dohledány: ${Object.keys(fotoGuid).length}/${fot.length}`);
      }
      // 3) části objektu (jedna část na kód + pozici; popisy B stejného kódu se spojí)
      const zs = o.zs.map(i => ({ ...M.zavady[i], _i: i }));
      const key = (c, p) => code(c) + '|' + norm(p);
      const need = new Map();
      zs.forEach(d => { const k = key(d.code, d.pozice); if (!need.has(k)) need.set(k, { code: code(d.code), pozice: d.pozice || '', popisy: [] }); });
      (M.casti || []).forEach((c, i) => {
        if (!o.cs.includes(i)) return;
        const k = key(c.code, c.pozice);
        if (!need.has(k)) { if (!o.castiAll) return; need.set(k, { code: code(c.code), pozice: c.pozice || '', popisy: [] }); }
        if (c.popis) need.get(k).popisy.push(c.popis);
      });
      const exist = () => ((RU.ObjektCastList || []).filter(c => !c.JeSmazan));
      for (const [k, p] of need) {
        const cg = castByCode[p.code].GuidId;
        const ex = exist().find(c => c.CastObjektuGuidId === cg && norm(c.PoziceText) === norm(p.pozice));
        if (ex) { p.guid = ex.GuidId; log(`• část ${p.code} už existuje – použita`); continue; }
        await upd({ GuidId: PG, ObjektCastList: [{ GuidId: undefined, JeSmazan: false, CastObjektuGuidId: cg, PoziceGuidId: undefined, PoziceText: p.pozice || undefined,
          StavGuidId: undefined, PouzitelnostGuidId: undefined, Poznamka: p.popisy.length ? html(p.popisy.join('\n\n')) : undefined }] });
        log(`✓ část ${p.code}${p.pozice ? ' – ' + p.pozice : ''}`);
      }
      const D3 = await detail(); RU.ObjektCastList = (D3.RozsireneUdaje || {}).ObjektCastList || [];
      for (const [k, p] of need) if (!p.guid) { const c = exist().find(c => c.CastObjektuGuidId === castByCode[p.code].GuidId && norm(c.PoziceText) === norm(p.pozice)); p.guid = c && c.GuidId; recAdd('casti', p.guid); }
      // 4) závady s opatřeními a fotkami
      for (const d of zs) {
        const p = need.get(key(d.code, d.pozice));
        if (!p || !p.guid) { errs.push(`závada ${d.id}: část nenalezena`); log(`✗ závada ${d.id || d._i + 1}: část ${d.code} nenalezena`, 'e'); continue; }
        const zg = newGuid();
        // připojení fotky k závadě: ZavadaGuidIdList musí obsahovat GUID závady (jinak CEV2 hlásí chybu ukládání)
        const pril = (d.fota || []).map(n => fotoGuid[n]).filter(Boolean).map(g => ({ GuidId: g, ZavadaGuidIdList: [zg], ItemChecked: true }));
        const op = (d.opatreni || []).map((q, k) => ({ GuidId: undefined, JeSmazan: false, Popis: html(q.popis), Priorita: undefined, Splneno: false,
          StupenNalehavostiGuidId: o.nal[d._i + '_' + k] || undefined }));
        try {
          // nová závada musí mít GUID z klienta (stránka: getNewGuid), jinak ji server tiše zahodí
          await upd({ GuidId: PG, JeSmazan: false, ZavadaList: [{ GuidId: zg, ObjektCastGuidId: p.guid, JeSmazan: undefined, Popis: html(d.popis),
            StavGuidId: undefined, PouzitelnostGuidId: undefined, Priorita: undefined, PrilohaList: pril, OdpojitPrilohyList: [], OpatreniList: op }] });
          recAdd('zavady', zg);
          log(`✓ závada ${d.id || d._i + 1} (${p.code})${op.length ? ', opatření ' + op.length : ''}${pril.length ? ', foto ' + pril.length : ''}`);
        } catch (e) { errs.push(`závada ${d.id}: ${e.message}`); log(`✗ závada ${d.id || d._i + 1}: ${e.message}`, 'e'); }
      }
    } catch (e) { errs.push(e.message); log('✗ ' + e.message, 'e'); }
    logEl.insertAdjacentHTML('beforeend', `<div style="margin-top:8px"><b>${errs.length ? 'Hotovo s chybami: ' + errs.length : 'Hotovo.'}</b> Obnov stránku (F5) a zkontroluj prohlídku v ${SYS.n}.</div>
      <div class="row"><button class="p" id="pvy-r">Obnovit stránku</button></div>`);
    ui.querySelector('#pvy-r').onclick = () => location.reload();
  }

  /* ---------- smazání vložených údajů ---------- */
  // stejná volání jako koše na stránce: část (i se závadami), závada (i s opatřeními), příloha
  const txt = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  async function stepDel() {
    say('Načítám obsah prohlídky…');
    let DD; try { DD = await detail(); } catch (e) { say('Chyba: ' + esc(e.message), 'e'); return; }
    if (!/není dokon|neni dokon|nedokon/i.test(String((DD.ZakladniUdaje || {}).Dokonceni || ''))) { say('Prohlídka už není rozpracovaná – mazat nelze.', 'e'); return; }
    const R = rec(), RR = DD.RozsireneUdaje || {};
    const casti = (RR.ObjektCastList || []).filter(c => !c.JeSmazan), pril = (RR.PrilohaList || []).filter(a => !a.JeSmazan);
    const tag = ok => ok ? ' <span class="m">(vloženo záložkou)</span>' : '';
    const rows = casti.map((c, i) => {
      const zs = (c.ZavadaList || []).filter(z => !z.JeSmazan);
      return `<tr><td><input type="checkbox" class="pvd-c" data-i="${i}" ${R.casti.includes(c.GuidId) ? 'checked' : ''}></td>
        <td><b>${esc(c.CastObjektuNazev)}</b>${c.PoziceText ? ' – ' + esc(c.PoziceText) : ''}${tag(R.casti.includes(c.GuidId))}
        <div class="m">smaže i všech ${zs.length} závad této části</div>
        ${zs.map((z, k) => `<label style="margin-left:14px"><input type="checkbox" class="pvd-z" data-i="${i}" data-k="${k}" ${R.zavady.includes(z.GuidId) ? 'checked' : ''}>
          závada: ${esc(txt(z.Popis).slice(0, 110))}${(z.OpatreniList || []).length ? ` <span class="m">+ ${(z.OpatreniList || []).length} opatření</span>` : ''}${tag(R.zavady.includes(z.GuidId))}</label>`).join('')}</td></tr>`;
    }).join('');
    const prow = pril.map((a, i) => `<tr><td><input type="checkbox" class="pvd-p" data-i="${i}" ${R.prilohy.includes(a.GuidId) ? 'checked' : ''}></td>
      <td>${a.Poradi}. ${esc(a.Soubor)} <span class="m">${esc(txt(a.Popis).slice(0, 80))}${(a.ZavadaGuidIdList || []).length ? ' · připojena k závadě' : ''}</span>${tag(R.prilohy.includes(a.GuidId))}</td></tr>`).join('');
    say(`<div class="m">Předvybrané jsou položky, které do této prohlídky vložila záložka v tomto prohlížeči${R.kdy ? ' (naposledy ' + esc(new Date(R.kdy).toLocaleString('cs-CZ')) + ')' : ''}. Ostatní lze zaškrtnout ručně.</div>
      <h4>Části a závady (${casti.length})</h4>${rows ? `<table>${rows}</table>` : '<div class="m">žádné</div>'}
      <h4>Fotografie a dokumenty (${pril.length})</h4>${prow ? `<table>${prow}</table>` : '<div class="m">žádné</div>'}
      <div class="m" style="margin-top:8px">Základní údaje a rozhodnutí se nemažou. Prohlídka se nedokončuje ani neschvaluje.</div>
      <div class="row"><button id="pvd-back">Zpět</button><button class="p" id="pvd-go">Smazat vybrané</button></div>`);
    // zaškrtnutá část = i všechny její závady
    ui.querySelectorAll('.pvd-c').forEach(c => c.onchange = () => ui.querySelectorAll(`.pvd-z[data-i="${c.dataset.i}"]`).forEach(z => { if (c.checked) z.checked = true; z.disabled = c.checked; }));
    ui.querySelectorAll('.pvd-c:checked').forEach(c => c.onchange());
    ui.querySelector('#pvd-back').onclick = step1;
    ui.querySelector('#pvd-go').onclick = () => {
      const sc = [...ui.querySelectorAll('.pvd-c:checked')].map(c => casti[+c.dataset.i]);
      const sz = [...ui.querySelectorAll('.pvd-z:checked:not(:disabled)')].map(z => (casti[+z.dataset.i].ZavadaList || []).filter(x => !x.JeSmazan)[+z.dataset.k]);
      const sp = [...ui.querySelectorAll('.pvd-p:checked')].map(p => pril[+p.dataset.i]);
      if (!sc.length && !sz.length && !sp.length) return alert('Nic není vybráno.');
      const row = ui.querySelector('#pvd-go').parentNode;
      row.innerHTML = `<div style="flex:1" class="e">Trvale smazat v ${SYS.n}: části ${sc.length} (i s jejich závadami), další závady ${sz.length}, přílohy ${sp.length}? Vrátit to nejde.</div>
        <button id="pvd-no">Ne</button><button class="p" id="pvd-yes" style="background:#b3261e;border-color:#b3261e">Ano, smazat</button>`;
      row.querySelector('#pvd-no').onclick = stepDel;
      row.querySelector('#pvd-yes').onclick = () => doDel(sc, sz, sp);
    };
  }
  async function doDel(sc, sz, sp) {
    say('<div id="pvy-log"></div>');
    const logEl = ui.querySelector('#pvy-log'), lines = [], log = (t, cls = '') => { lines.push(`<div class="${cls}">${esc(t)}</div>`); logEl.innerHTML = lines.join(''); };
    let err = 0;
    const R = rec(), forget = (k, g) => { R[k] = R[k].filter(x => x !== g); };
    const run = async (t, body) => { try { await upd(body, true); log('✓ ' + t); return true; } catch (e) { err++; log('✗ ' + t + ': ' + e.message, 'e'); return false; } };
    for (const z of sz) if (await run('závada ' + txt(z.Popis).slice(0, 60), { GuidId: PG, JeSmazan: false, ZavadaList: [{ ...z, JeSmazan: true }] })) forget('zavady', z.GuidId);
    for (const c of sc) if (await run('část ' + c.CastObjektuNazev, { GuidId: PG, ObjektCastList: [{ GuidId: c.GuidId, JeSmazan: true }], ZavadaList: c.ZavadaList })) {
      forget('casti', c.GuidId); (c.ZavadaList || []).forEach(z => forget('zavady', z.GuidId)); }
    for (const a of sp) if (await run('příloha ' + a.Soubor, { GuidId: PG, PrilohaList: [{ GuidId: a.GuidId, JeSmazan: true }] })) forget('prilohy', a.GuidId);
    try { localStorage.setItem(RK, JSON.stringify(R)); } catch (e) { }
    logEl.insertAdjacentHTML('beforeend', `<div style="margin-top:8px"><b>${err ? 'Hotovo s chybami: ' + err : 'Hotovo.'}</b> Obnov stránku (F5).</div>
      <div class="row"><button class="p" id="pvy-r">Obnovit stránku</button></div>`);
    ui.querySelector('#pvy-r').onclick = () => location.reload();
  }

  step1();
})();
