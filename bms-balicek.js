/* Záložka (bookmarklet) pro BMS: stáhne podklady k mostům pro aplikaci Prohlídky mostů.
   Spouští se na bms.clevera.cz v přihlášeném prohlížeči. Pouze čte (GET), nic neukládá do BMS.
   Postup: ev. č. + volby → kontrola nalezených mostů → stažení balicek_RRRR-MM-DD.json
   (mostní list vždy, vybrané prohlídky, volitelně náhledy fotek). */
(async () => {
  if (location.host !== 'bms.clevera.cz') { alert('Spusť na stránce bms.clevera.cz po přihlášení.'); return; }
  if (document.getElementById('pmb-ui')) return;
  const BRIDGE = '13679448-696b-423b-94a5-e8a0d2e9f7e7'; // druh objektu Most
  const g = async u => {
    const r = await fetch(u, { credentials: 'same-origin' }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(); if (j && j.ErrorMessage === 'NotLoggedIn') throw new Error('nejsi přihlášený do BMS'); return j;
  };
  const img = async u => {
    try {
      const r = await fetch(u, { credentials: 'same-origin' }); if (!r.ok) return null;
      const b = await r.blob();
      return await new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); });
    } catch (e) { return null; }
  };
  const ta = document.createElement('textarea');
  const ent = s => { ta.innerHTML = s; return ta.value; };     // &#34; &quot; &nbsp; … → znaky (textarea nic nespouští)
  const strip = h => ent(String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/ /g, ' ').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const code = n => (String(n || '').match(/^\s*(\d+(?:\.\d+)*)/) || [, ''])[1];
  const iso = s => { s = String(s || ''); const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s.slice(0, 10); };
  const cz = s => { const m = String(s || '').match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? `${+m[3]}. ${+m[2]}. ${m[1]}` : s; };
  const typ = z => { const k = String(z.DruhKod || ''), n = String(z.DruhNazev || '');
    return /HPM|PHM|PPM/.test(k) || /hlavn/i.test(n) ? 'hlavni' : /MPM/.test(k) || /mimořád|mimorad/i.test(n) ? 'mimoradna' : /BPM/.test(k) || /běžn|bezn/i.test(n) ? 'bezna' : k === 'A' || /aktualizace/i.test(n) ? 'aktualizace' : 'jina'; };
  const TYPN = { hlavni: 'hlavní', mimoradna: 'mimořádná', bezna: 'běžná', jina: 'jiná' };

  /* ---------- okno ---------- */
  const ui = document.createElement('div'); ui.id = 'pmb-ui';
  ui.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;background:#fff;color:#17202a;width:min(560px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;border-radius:10px;font:14px/1.4 Segoe UI,Arial,sans-serif;box-shadow:0 4px 24px #0007;border:1px solid #1f3a5f';
  document.body.appendChild(ui);
  const css = `<style>#pmb-ui h3{margin:0;padding:10px 14px;background:#1f3a5f;color:#fff;font-size:15px;display:flex;justify-content:space-between}
    #pmb-ui .b{padding:12px 14px}#pmb-ui label{display:block;margin:3px 0}#pmb-ui textarea{width:100%;box-sizing:border-box;min-height:60px;font:14px monospace}
    #pmb-ui button{padding:6px 14px;border-radius:6px;border:1px solid #1f3a5f;background:#fff;color:#1f3a5f;cursor:pointer;font:inherit}
    #pmb-ui button.p{background:#1f3a5f;color:#fff}#pmb-ui button:disabled{opacity:.5}#pmb-ui .m{color:#5f6b78;font-size:12px}
    #pmb-ui table{border-collapse:collapse;width:100%;font-size:13px}#pmb-ui td,#pmb-ui th{border-bottom:1px solid #d9dee5;padding:4px;text-align:left;vertical-align:top}
    #pmb-ui .err{color:#b3261e}#pmb-ui .row{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}#pmb-ui fieldset{border:1px solid #d9dee5;border-radius:6px;margin:8px 0}</style>`;
  const head = t => `${css}<h3><span>${t}</span><span style="cursor:pointer" id="pmb-x">✕</span></h3>`;
  const bindX = () => { ui.querySelector('#pmb-x').onclick = () => ui.remove(); };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let opt = { evc: '', typy: ['hlavni'], vse: false, foto: true };

  /* krok 1: zadání */
  function step1() {
    ui.innerHTML = head('Balíček z BMS pro Prohlídky mostů') + `<div class="b">
      <label>Ev. č. mostů (oddělená čárkou nebo na řádky)</label><textarea id="pmb-evc" placeholder="605-026, 23617-1">${esc(opt.evc)}</textarea>
      <fieldset><legend>Prohlídky</legend>
        <label><input type="checkbox" value="hlavni" class="pmb-t"> poslední hlavní</label>
        <label><input type="checkbox" value="mimoradna" class="pmb-t"> poslední mimořádná</label>
        <label><input type="checkbox" value="bezna" class="pmb-t"> poslední běžná</label>
        <label><input type="checkbox" id="pmb-vse"> všechny prohlídky</label></fieldset>
      <fieldset><legend>Fotky</legend>
        <label><input type="radio" name="pmb-f" value="1"> s náhledy fotek (cca 30 kB na fotku)</label>
        <label><input type="radio" name="pmb-f" value="0"> bez fotek (jen popisky)</label></fieldset>
      <div class="m">Mostní list se stahuje vždy. Záložka v BMS jen čte, nic neukládá.</div>
      <div class="row"><button class="p" id="pmb-go">Najít mosty</button></div></div>`;
    bindX();
    ui.querySelectorAll('.pmb-t').forEach(c => { c.checked = opt.typy.includes(c.value); });
    const vse = ui.querySelector('#pmb-vse'); vse.checked = opt.vse;
    const sync = () => ui.querySelectorAll('.pmb-t').forEach(c => { c.disabled = vse.checked; });
    vse.onchange = sync; sync();
    ui.querySelector(`[name=pmb-f][value="${opt.foto ? 1 : 0}"]`).checked = true;
    ui.querySelector('#pmb-go').onclick = () => {
      opt = { evc: ui.querySelector('#pmb-evc').value, vse: vse.checked, foto: ui.querySelector('[name=pmb-f]:checked').value === '1',
        typy: [...ui.querySelectorAll('.pmb-t:checked')].map(c => c.value) };
      if (!opt.evc.trim()) return alert('Zadej ev. č.');
      if (!opt.vse && !opt.typy.length && !confirm('Není vybraná žádná prohlídka – stáhnout jen mostní listy?')) return;
      step2();
    };
  }

  /* krok 2: vyhledání a kontrola */
  let rows = [];
  async function step2() {
    const list = opt.evc.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    ui.innerHTML = head('Kontrola mostů') + `<div class="b" id="pmb-b">Hledám…</div>`; bindX();
    const b = ui.querySelector('#pmb-b');
    rows = [];
    for (const [i, evc] of list.entries()) {
      b.textContent = `Hledám ${i + 1}/${list.length}: ${evc}`;
      const m = evc.match(/^\s*([^-\s]+)\s*-\s*(.+?)\s*$/);
      if (!m) { rows.push({ evc, err: 'neplatné ev. č. (tvar silnice-číslo)' }); continue; }
      const [, sil, por] = m;
      try {
        const L = await g(`/api/assetregisterdata/GetObjektList?filterDruhObjektuGuidIdList=${BRIDGE}&filterSilnice=${encodeURIComponent(sil)}&filterPoradoveCislo=${encodeURIComponent(por)}&filterJenPlatne=true&orderBy=Oznaceni&isOrderDescending=false&pageIndex=1&pageSize=50`);
        const cand = L.ObjektList || [];
        const exact = cand.filter(x => String(x.Silnice) === sil && String(x.PoradoveCislo) === por);
        const use = exact.length ? exact : cand;
        if (!use.length) { rows.push({ evc, err: 'v BMS nenalezeno' }); continue; }
        for (const o of use.slice(0, 10)) {
          const P = await g(`/api/inspectiondata/GetProhlidkaList?filterJenPlatne=true&filterObjektGuidId=${o.GuidId}&orderBy=Datum&isOrderDescending=true&pageIndex=1&pageSize=500`);
          const all = (P.ProhlidkaList || []).filter(x => !x.JeSmazan).map(x => ({ guid: x.GuidId, z: x.ZakladniUdaje || {} }))
            .map(x => ({ ...x, typ: typ(x.z), datum: iso(x.z.Datum) })).filter(x => x.typ !== 'aktualizace')
            .sort((a, c) => c.datum.localeCompare(a.datum));
          const pick = opt.vse ? all : opt.typy.map(t => all.find(x => x.typ === t)).filter(Boolean);
          rows.push({ evc: `${o.Silnice}-${o.PoradoveCislo}`, o, all, pick, check: exact.length === 1, multi: use.length > 1,
            miss: opt.vse ? [] : opt.typy.filter(t => !all.some(x => x.typ === t)) });
        }
      } catch (e) { rows.push({ evc, err: e.message }); }
    }
    b.innerHTML = `<div class="m">Zkontroluj, že jde opravdu o tyto mosty. Stáhnou se jen zaškrtnuté.</div>
      <table><tr><th></th><th>Most</th><th>Stáhne se</th></tr>${rows.map((r, k) => r.err
        ? `<tr><td></td><td><b>${esc(r.evc)}</b></td><td class="err">${esc(r.err)}</td></tr>`
        : `<tr><td><input type="checkbox" data-k="${k}" ${r.check ? 'checked' : ''}></td>
           <td><b>${esc(r.evc)}</b> ${esc(r.o.Nazev)}<div class="m">${esc((r.o.SpravceList || '').replace(/,\s*$/, ''))} · stav ${esc(r.o.StavebniStavNazev || '–')}${r.multi ? ' · <span class="err">více shod – vyber správný</span>' : ''}</div></td>
           <td>mostní list<br>${r.pick.map(p => `${TYPN[p.typ]} ${cz(p.datum)}`).join('<br>') || '<span class="m">žádná prohlídka</span>'}${r.miss.length ? `<div class="err">nemá: ${r.miss.map(t => TYPN[t]).join(', ')}</div>` : ''}</td></tr>`).join('')}</table>
      <div class="m" style="margin-top:6px">${opt.foto ? 'S náhledy fotek' : 'Bez fotek'}${opt.vse ? ' · všechny prohlídky – s fotkami může být soubor velký (desítky MB na most)' : ''}.</div>
      <div class="row"><button id="pmb-back">Zpět</button><button class="p" id="pmb-dl">Stáhnout</button></div>`;
    const cnt = () => { const n = ui.querySelectorAll('[data-k]:checked').length; const bt = ui.querySelector('#pmb-dl'); bt.textContent = `Stáhnout (${n})`; bt.disabled = !n; };
    ui.querySelectorAll('[data-k]').forEach(c => c.onchange = cnt); cnt();
    ui.querySelector('#pmb-back').onclick = step1;
    ui.querySelector('#pmb-dl').onclick = () => step3([...ui.querySelectorAll('[data-k]:checked')].map(c => rows[+c.dataset.k]));
  }

  /* mostní list z karty objektu */
  const ZU = { DelkaMostu: 'Délka mostu [m]', DelkaPremosteni: 'Délka přemostění [m]', DelkaNK: 'Délka NK [m]', CelkovaSirka: 'Celková šířka [m]',
    SirkaMeziZabradlimi: 'Šířka mezi zábradlími [m]', SirkaMeziObrubamy: 'Šířka mezi obrubami [m]', VolnaSirka: 'Volná šířka [m]',
    StavebniVyska: 'Stavební výška [m]', UloznaVyska: 'Úložná výška [m]', VyskaNadTerenem: 'Výška nad terénem [m]', VyskaNadHladinou: 'Výška nad hladinou [m]',
    HloubkaVody: 'Hloubka vody [m]', VolnaVyskaNadVozovkou: 'Volná výška nad vozovkou [m]', CelkovyPocetPoli: 'Počet polí', OznaceniSikmostiNazev: 'Šikmost',
    Sikmost: 'Šikmost (hodnota v BMS)', PlochaMostu: 'Plocha mostu [m²]', PlochaVozovky: 'Plocha vozovky [m²]', RokPostaveni: 'Rok postavení', RokRekonstrukce: 'Rok rekonstrukce' };
  const rnd = v => typeof v === 'number' && !Number.isInteger(v) ? +v.toFixed(2) : typeof v === 'string' ? v.trim() : v;   // 10.800000190734863 → 10.8
  function mostniList(d) {
    const sp = d.SpravniUdaje || {}, zu = (d.Charakteristika || {}).ZakladniUdaje || {}, pc = d.ProvozniCharakteristika || {}, so = pc.Soucasny || {};
    const kv = (o, map) => Object.entries(map).map(([k, l]) => [l, rnd(o[k])]).filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== 'Nezadaný');
    const attrs = {}; (d.CastObjektuList || []).forEach(c => { attrs[c.GuidId] = c.AttributeList || []; });
    const casti = (d.ObjektCastGroupList || []).flatMap(gr => (gr.ObjektCastList || []).filter(c => !c.JeSmazan).map(c => ({
      code: code(gr.CastObjektuNazev), nazev: String(gr.CastObjektuNazev || '').replace(/^\s*[\d.]+\s*/, ''),
      pozice: [c.PoziceNazev !== '-' ? c.PoziceNazev : '', c.PoziceText].filter(Boolean).join(' '), popis: strip(c.Poznamka),
      prvky: (c.MostElementList || []).filter(e => !e.JeSmazan).map(e => (attrs[gr.CastObjektuGuidId] || [])
        .map(a => [a.Name, rnd(e[a.Column + 'Nazev'] ?? e[a.Column])]).filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([n, v]) => `${n}: ${v}`).join(', ')).filter(Boolean),
    })));
    return {
      spravni: kv(sp, { Nazev: 'Název', MistniNazev: 'Místní název', TridaKomunikaceNazev: 'Třída komunikace', CisloUseku: 'Číslo úseku',
        ProvozniStaniceni: 'Provozní staničení [km]', UsekoveStaniceni: 'Úsekové staničení [km]', KrajNazev: 'Kraj', OkresNazev: 'Okres', ObecNazev: 'Obec',
        KatastralniUzemiNazev: 'Katastrální území', SpravceNazev: 'Správce', PredmetPremosteniNazev: 'Předmět přemostění', VodniTokNazev: 'Vodní tok',
        ZpusobUzivaniNazev: 'Způsob užívání', DruhZatimnihoMostuNazev: 'Druh zatímního mostu', OdpovednyUzivatelNazev: 'Odpovědná osoba', DatumPosledniZmeny: 'Poslední změna' })
        .concat(sp.SpravceList ? [['Správci', sp.SpravceList.filter(s => !s.JeSmazan).map(s => s.Popis).join(' / ')]] : []),
      poznamka: strip(sp.Poznamka),
      rozmery: kv(zu, ZU),
      popisSS: strip(zu.PopisSpodniStavby || d.PopisSpodniStavby), popisNK: strip(zu.PopisNosneKonstrukce || d.PopisNosneKonstrukce), poznNK: strip(d.PoznamkaNosneKonstrukce),
      stav: kv({ ...pc, ...so }, { SpodniStavbaStavNazev: 'Spodní stavba', NosnaKonstrukceStavNazev: 'Nosná konstrukce', PouzitelnostNazev: 'Použitelnost',
        Vn: 'Vn [t]', Vr: 'Vr [t]', Ve: 'Ve [t]', NapravovyTlak: 'Nápravový tlak [t]', ZpusobZjisteniNazev: 'Způsob zjištění zatížitelnosti' }),
      casti,
      historie: ((d.ProvozniStadium || {}).PolozkyList || []).filter(x => !x.JeSmazan).map(x => ({ druh: x.DruhNazev, datum: iso(x.Datum), text: strip(x.Text) })),
      prilohy: (d.PrilohaList || []).filter(a => !a.JeSmazan).map(a => a.Popis || a.Soubor),
    };
  }
  async function prohlidka(guid, p0, foto, log) {
    const p = await g(`/api/inspectiondata/GetProhlidkaDetail?guidId=${guid}`);
    const z = p.ZakladniUdaje || {}, r = p.RozsireneUdaje || {}, ro = r.Rozhodnuti || {};
    const fot = (r.PrilohaList || []).filter(a => !a.JeSmazan && /foto/i.test(a.TypPrilohyNazev || '')).sort((a, b) => a.Poradi - b.Poradi);
    const casti = (r.ObjektCastList || []).filter(c => !c.JeSmazan);
    const poz = c => [c.PoziceNazev && c.PoziceNazev !== '-' ? c.PoziceNazev : '', c.PoziceText].filter(Boolean).join(' ');
    const out = {
      guid, typ: p0.typ, druh: z.DruhNazev, kod: z.DruhKod, datum: iso(z.Datum), prohlizel: z.ProhlidkarNazev, pocasi: strip(z.Pocasi), smer: z.StaniceniVeSmeru || '',
      zpristupneni: strip(z.Zpristupneni), poznamka: strip(z.Poznamka), dokonceno: p0.z.StavDokonceni ?? null,
      casti: casti.map(c => ({ code: code(c.CastObjektuNazev), nazev: String(c.CastObjektuNazev || '').replace(/^\s*[\d.]+\s*/, ''), pozice: poz(c), popis: strip(c.Poznamka) })),
      zavady: casti.flatMap(c => (c.ZavadaList || []).filter(x => !x.JeSmazan).map(x => ({
        code: code(c.CastObjektuNazev), pozice: poz(c), popis: strip(x.Popis), stav: x.StavNazev || '',
        opatreni: (x.OpatreniList || []).filter(q => !q.JeSmazan).map(q => ({ popis: strip(q.Popis), nalehavost: q.StupenNalehavostiNazev || '', splneno: !!q.Splneno })),
        fota: (x.PrilohaList || []).map(a => a.Poradi),
      }))),
      rozhodnuti: { ss: ro.SpodniStavbaStavNazev, nk: ro.NosnaKonstrukceStavNazev, pouzitelnost: ro.PouzitelnostNazev, vn: ro.Vn, vr: ro.Vr, ve: ro.Ve, naprava: ro.NapravovyTlak, poznamka: strip(ro.StavebniStavPoznamka) },
      fota: [],
    };
    for (const [k, a] of fot.entries()) {
      if (foto) log(`fotky ${k + 1}/${fot.length}`);
      out.fota.push({ poradi: a.Poradi, popis: a.Popis || a.Soubor || '', img: foto ? await img(a._BigThumbnail) : null });
    }
    return out;
  }

  /* krok 3: stažení */
  async function step3(sel) {
    ui.innerHTML = head('Stahuji…') + `<div class="b" id="pmb-b"></div>`; bindX();
    const b = ui.querySelector('#pmb-b');
    const out = { format: 'prohlidky-balicek', verze: 2, vytvoreno: new Date().toISOString(), volby: { typy: opt.vse ? ['vse'] : opt.typy, foto: opt.foto }, mosty: [] };
    const errs = [];
    for (const [i, r] of sel.entries()) {
      const log = t => { b.textContent = `${i + 1}/${sel.length} ${r.evc}: ${t}`; };
      try {
        log('mostní list…');
        const d = await g(`/api/assetregisterdata/GetBridgeDetail?guidId=${r.o.GuidId}`);
        const sp = d.SpravniUdaje || {}, lok = (d.LokalizaceList || [])[0];
        const most = {
          evc: r.evc, guid: r.o.GuidId, nazev: sp.Nazev || r.o.Nazev || '', staniceni: sp.ProvozniStaniceni ?? null,
          jtsk: sp.X && sp.Y ? { x: sp.X, y: sp.Y } : lok && lok.Souradnice ? { x: lok.Souradnice.X, y: lok.Souradnice.Y } : null,
          poli: ((d.Charakteristika || {}).ZakladniUdaje || {}).CelkovyPocetPoli || null, smer: '',
          mostniList: mostniList(d), prohlidky: [], prohlidka: null,
        };
        for (const [k, p0] of r.pick.entries()) {
          const pl = t => log(`prohlídka ${k + 1}/${r.pick.length} (${TYPN[p0.typ]} ${cz(p0.datum)})${t ? ' – ' + t : ''}`);
          pl('');
          most.prohlidky.push(await prohlidka(p0.guid, p0, opt.foto, pl));
        }
        // zpětná kompatibilita: „prohlidka“ = poslední hlavní, jinak nejnovější stažená
        most.prohlidka = most.prohlidky.find(p => p.typ === 'hlavni') || most.prohlidky[0] || null;
        most.smer = (most.prohlidky.find(p => p.smer) || {}).smer || '';
        out.mosty.push(most);
      } catch (e) { errs.push(`${r.evc}: ${e.message}`); }
    }
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `balicek_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 10000);
    ui.querySelector('h3 span').textContent = 'Hotovo';
    b.innerHTML = `Staženo: ${out.mosty.length} mostů, ${out.mosty.reduce((s, m) => s + m.prohlidky.length, 0)} prohlídek, ${(blob.size / 1048576).toFixed(1)} MB.
      ${errs.length ? `<div class="err">Chyby:<br>${errs.map(esc).join('<br>')}</div>` : ''}<div class="row"><button class="p" id="pmb-ok">Zavřít</button></div>`;
    ui.querySelector('#pmb-ok').onclick = () => ui.remove();
  }

  step1();
})();
