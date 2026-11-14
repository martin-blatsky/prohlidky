/* Záložka (bookmarklet) pro BMS: stáhne podklady k mostům pro aplikaci Prohlídky mostů.
   Spouští se na bms.clevera.cz v přihlášeném prohlížeči. Pouze čte (GET), nic neukládá do BMS.
   Výstup: balicek_RRRR-MM-DD.json (karta mostu + poslední hlavní prohlídka + náhledy fotek). */
(async () => {
  if (location.host !== 'bms.clevera.cz') { alert('Spusť na stránce bms.clevera.cz po přihlášení.'); return; }
  const inp = prompt('Ev. č. mostů oddělená čárkou\n(např. 605-026, 23617-1):');
  if (!inp) return;
  const BRIDGE = '13679448-696b-423b-94a5-e8a0d2e9f7e7'; // druh objektu Most
  const g = async u => { const r = await fetch(u, { credentials: 'same-origin' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
  const img = async u => {
    try {
      const r = await fetch(u, { credentials: 'same-origin' }); if (!r.ok) return null;
      const b = await r.blob();
      return await new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); });
    } catch (e) { return null; }
  };
  const strip = h => String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&#13;/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const code = n => (String(n || '').match(/^\s*(\d+(?:\.\d+)*)/) || [, ''])[1];
  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1f3a5f;color:#fff;padding:12px 16px;border-radius:8px;font:14px sans-serif;max-width:380px;white-space:pre-wrap;box-shadow:0 2px 10px #0006';
  document.body.appendChild(ui);
  const log = t => { ui.textContent = 'Balíček pro Prohlídky mostů\n' + t; };
  const out = { format: 'prohlidky-balicek', verze: 1, vytvoreno: new Date().toISOString(), mosty: [] };
  const errs = [];
  const list = inp.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
  for (const [i, evc] of list.entries()) {
    try {
      log(`${i + 1}/${list.length} ${evc}: hledám…`);
      const m = evc.match(/^\s*([^-\s]+)\s*-\s*(.+?)\s*$/);
      if (!m) throw new Error('neplatné ev. č.');
      const [, sil, por] = m;
      const L = await g(`/api/assetregisterdata/GetObjektList?filterDruhObjektuGuidIdList=${BRIDGE}&filterSilnice=${encodeURIComponent(sil)}&filterPoradoveCislo=${encodeURIComponent(por)}&filterJenPlatne=true&orderBy=Oznaceni&isOrderDescending=false&pageIndex=1&pageSize=50`);
      const cand = L.ObjektList || [];
      const o = cand.find(x => String(x.Silnice) === sil && String(x.PoradoveCislo) === por) || (cand.length === 1 ? cand[0] : null);
      if (!o) throw new Error(cand.length ? 'nejednoznačné (' + cand.length + ' výsledků)' : 'nenalezeno');
      log(`${i + 1}/${list.length} ${evc}: karta mostu…`);
      const d = await g(`/api/assetregisterdata/GetBridgeDetail?guidId=${o.GuidId}`);
      const sp = d.SpravniUdaje || {};
      const lok = (d.LokalizaceList || [])[0];
      const jtsk = sp.X && sp.Y ? { x: sp.X, y: sp.Y } : lok && lok.Souradnice ? { x: lok.Souradnice.X, y: lok.Souradnice.Y } : null;
      const most = {
        evc: `${sil}-${por}`, guid: o.GuidId, nazev: sp.Nazev || o.Nazev || '', staniceni: sp.ProvozniStaniceni ?? null,
        jtsk, poli: ((d.Charakteristika || {}).ZakladniUdaje || {}).CelkovyPocetPoli || null, smer: '', prohlidka: null,
      };
      const P = await g(`/api/inspectiondata/GetProhlidkaList?filterJenPlatne=true&filterObjektGuidId=${o.GuidId}&orderBy=Datum&isOrderDescending=true&pageIndex=1&pageSize=200`);
      const hl = (P.ProhlidkaList || []).filter(x => { const z = x.ZakladniUdaje || {}; return /^(HPM|PHM|PPM)$/.test(z.DruhKod) || /hlavn/i.test(z.DruhNazev || ''); })
        .sort((a, b) => String(b.ZakladniUdaje.Datum).localeCompare(String(a.ZakladniUdaje.Datum)))[0];
      if (hl) {
        log(`${i + 1}/${list.length} ${evc}: prohlídka…`);
        const p = await g(`/api/inspectiondata/GetProhlidkaDetail?guidId=${hl.GuidId}`);
        const z = p.ZakladniUdaje || {}, r = p.RozsireneUdaje || {}, ro = r.Rozhodnuti || {};
        most.smer = z.StaniceniVeSmeru || '';
        const fot = (r.PrilohaList || []).filter(a => !a.JeSmazan && /foto/i.test(a.TypPrilohyNazev || '')).sort((a, b) => a.Poradi - b.Poradi);
        const casti = (r.ObjektCastList || []).filter(c => !c.JeSmazan);
        most.prohlidka = {
          druh: z.DruhNazev, kod: z.DruhKod, datum: z.Datum, prohlizel: z.ProhlidkarNazev, pocasi: z.Pocasi,
          zpristupneni: strip(z.Zpristupneni), poznamka: strip(z.Poznamka),
          casti: casti.map(c => ({ code: code(c.CastObjektuNazev), nazev: String(c.CastObjektuNazev || '').replace(/^\s*[\d.]+\s*/, ''), pozice: c.PoziceNazev && c.PoziceNazev !== '-' ? c.PoziceNazev : '', popis: strip(c.Poznamka) })),
          zavady: casti.flatMap(c => (c.ZavadaList || []).filter(x => !x.JeSmazan).map(x => ({
            code: code(c.CastObjektuNazev), pozice: c.PoziceNazev && c.PoziceNazev !== '-' ? c.PoziceNazev : '',
            popis: strip(x.Popis), stav: x.StavNazev || '',
            opatreni: (x.OpatreniList || []).filter(q => !q.JeSmazan).map(q => ({ popis: strip(q.Popis), nalehavost: q.StupenNalehavostiNazev || '', splneno: !!q.Splneno })),
            fota: (x.PrilohaList || []).map(a => a.Poradi),
          }))),
          rozhodnuti: { ss: ro.SpodniStavbaStavNazev, nk: ro.NosnaKonstrukceStavNazev, pouzitelnost: ro.PouzitelnostNazev, vn: ro.Vn, vr: ro.Vr, ve: ro.Ve, naprava: ro.NapravovyTlak, poznamka: strip(ro.StavebniStavPoznamka) },
          fota: [],
        };
        for (const [k, a] of fot.entries()) {
          log(`${i + 1}/${list.length} ${evc}: fotky ${k + 1}/${fot.length}`);
          most.prohlidka.fota.push({ poradi: a.Poradi, popis: a.Popis || a.Soubor || '', img: await img(a._BigThumbnail) });
        }
      }
      out.mosty.push(most);
    } catch (e) { errs.push(`${evc}: ${e.message}`); }
  }
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `balicek_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 10000);
  log(`Hotovo: ${out.mosty.length} mostů, ${(blob.size / 1048576).toFixed(1)} MB${errs.length ? '\nChyby:\n' + errs.join('\n') : ''}\n(klikni pro zavření)`);
  ui.onclick = () => ui.remove();
})();
