/* Nástroje: schéma mostu (poloha závady), kreslení do fotky, počasí. */
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- schéma mostu (půdorys, staničení zleva doprava) ----------
     PŘEDPOKLAD: pole jsou kreslena stejně dlouhá (skutečné délky polí aplikace nezná). */
  const W = 340, X0 = 26, X1 = 314, Y0 = 34, Y1 = 94;
  const sx = (k, n) => X0 + (X1 - X0) * k / n;          // poloha k-té podpěry (0..n)
  function svg(sup, marks, sel) {
    const n = sup.length - 1;
    let s = `<svg viewBox="0 0 ${W} 124" class="schema" xmlns="http://www.w3.org/2000/svg">
      <rect x="${X0}" y="${Y0}" width="${X1 - X0}" height="${Y1 - Y0}" class="deck"/>
      <line x1="${X0}" y1="${(Y0 + Y1) / 2}" x2="${X1}" y2="${(Y0 + Y1) / 2}" class="axis"/>
      <text x="${X0 + 10}" y="${Y0 + 12}" class="sl">vlevo</text>
      <text x="${X0 + 10}" y="${Y1 - 5}" class="sl">vpravo</text>
      <text x="${X1 - 10}" y="${(Y0 + Y1) / 2 - 4}" text-anchor="end" class="sl">staničení →</text>`;
    for (let k = 0; k <= n; k++) {
      const x = sx(k, n), end = k === 0 || k === n;
      s += `<rect x="${x - (end ? 5 : 3)}" y="${Y0 - 4}" width="${end ? 10 : 6}" height="${Y1 - Y0 + 8}" class="sup"/>
        <text x="${x}" y="${Y0 - 8}" text-anchor="middle" class="sn">${esc(sup[k])}</text>`;
      if (k < n && n > 1) s += `<text x="${(x + sx(k + 1, n)) / 2}" y="${Y1 + 18}" text-anchor="middle" class="sl">pole ${k + 1}</text>`;
    }
    for (const m of marks || []) {
      if (!m.p) continue;
      const x = X0 + (X1 - X0) * m.p.x, y = Y0 + (Y1 - Y0) * m.p.y;
      s += `<g class="mk${m.sel ? ' sel' : ''}"><circle cx="${x}" cy="${y}" r="9"/><text x="${x}" y="${y + 4}" text-anchor="middle">${esc(m.n)}</text></g>`;
    }
    if (sel) { const x = X0 + (X1 - X0) * sel.x, y = Y0 + (Y1 - Y0) * sel.y; s += `<g class="mk sel"><circle cx="${x}" cy="${y}" r="9"/><text x="${x}" y="${y + 4}" text-anchor="middle">●</text></g>`; }
    return s + '</svg>';
  }
  /* klepnutí → relativní poloha 0..1 */
  function hit(svgEl, ev) {
    const r = svgEl.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width * W, y = (ev.clientY - r.top) / r.height * 124;
    return { x: Math.min(1, Math.max(0, (x - X0) / (X1 - X0))), y: Math.min(1, Math.max(0, (y - Y0) / (Y1 - Y0))) };
  }
  /* slovní popis polohy, např. „pole 2 u P3, vlevo“ */
  function describe(sup, p) {
    if (!p) return '';
    const n = sup.length - 1, t = p.x * n, k = Math.round(t);
    const strana = p.y < 0.34 ? 'vlevo' : p.y > 0.66 ? 'vpravo' : 'uprostřed';
    let kde;
    if (Math.abs(t - k) * (X1 - X0) / n < 12) kde = sup[k];                 // u podpěry (±12 px)
    else {
      const f = Math.floor(t), r = t - f;                                    // pole f+1
      const pole = n > 1 ? `pole ${f + 1}` : 'pole';
      kde = r < 0.33 ? `${pole} u ${sup[f]}` : r > 0.67 ? `${pole} u ${sup[f + 1]}` : `${pole}, střed`;
    }
    return `${kde}, ${strana}`;
  }

  /* ---------- kreslení do fotky ---------- */
  function draw(blob) {
    return new Promise(async resolve => {
      const img = await createImageBitmap(blob);
      const o = document.createElement('div'); o.className = 'drw';
      o.innerHTML = `<div class="drw-bar">
          <button data-t="arrow" class="on">➚ Šipka</button><button data-t="ell">◯ Kruh</button><button data-t="free">✎ Čára</button><button data-t="text">T Text</button>
          <button data-c="#ff2a2a" class="col on" style="background:#ff2a2a"></button><button data-c="#ffd400" class="col" style="background:#ffd400"></button><button data-c="#ffffff" class="col" style="background:#fff"></button>
        </div>
        <div class="drw-wrap"><canvas></canvas></div>
        <div class="drw-bar"><button data-a="undo">↶ Zpět</button><span class="grow"></span><button data-a="cancel">Zrušit</button><button data-a="ok" class="pri">Uložit</button></div>`;
      document.body.appendChild(o);
      const cv = o.querySelector('canvas'), g = cv.getContext('2d');
      cv.width = img.width; cv.height = img.height;
      const lw = Math.max(4, Math.round(Math.max(img.width, img.height) / 220));
      let tool = 'arrow', col = '#ff2a2a', shapes = [], cur = null;
      const pt = ev => { const r = cv.getBoundingClientRect(); return [(ev.clientX - r.left) / r.width * cv.width, (ev.clientY - r.top) / r.height * cv.height]; };
      function paint(s) {
        g.strokeStyle = g.fillStyle = s.c; g.lineWidth = lw; g.lineCap = g.lineJoin = 'round';
        g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = lw;
        if (s.t === 'free') { g.beginPath(); s.p.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); }
        else if (s.t === 'ell') { g.beginPath(); g.ellipse((s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, Math.abs(s.b[0] - s.a[0]) / 2 + 1, Math.abs(s.b[1] - s.a[1]) / 2 + 1, 0, 0, 2 * Math.PI); g.stroke(); }
        else if (s.t === 'arrow') {
          const [x0, y0] = s.a, [x1, y1] = s.b, an = Math.atan2(y1 - y0, x1 - x0), h = lw * 5;
          g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
          g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - h * Math.cos(an - 0.45), y1 - h * Math.sin(an - 0.45));
          g.lineTo(x1 - h * Math.cos(an + 0.45), y1 - h * Math.sin(an + 0.45)); g.closePath(); g.fill();
        } else if (s.t === 'text') {
          g.font = `bold ${lw * 7}px -apple-system, Arial, sans-serif`; g.textBaseline = 'middle';
          g.lineWidth = lw * 1.2; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(s.s, s.a[0], s.a[1]); g.fillText(s.s, s.a[0], s.a[1]);
        }
        g.shadowBlur = 0;
      }
      const redraw = () => { g.drawImage(img, 0, 0); shapes.forEach(paint); if (cur) paint(cur); };
      redraw();
      cv.addEventListener('pointerdown', ev => {
        ev.preventDefault(); const p = pt(ev);
        if (tool === 'text') {
          const s = prompt('Text do fotky:'); if (s && s.trim()) { shapes.push({ t: 'text', c: col, a: p, s: s.trim() }); redraw(); }
          return;
        }
        cv.setPointerCapture(ev.pointerId);
        cur = tool === 'free' ? { t: 'free', c: col, p: [p] } : { t: tool, c: col, a: p, b: p };
      });
      cv.addEventListener('pointermove', ev => { if (!cur) return; const p = pt(ev); if (cur.t === 'free') cur.p.push(p); else cur.b = p; redraw(); });
      cv.addEventListener('pointerup', () => {
        if (!cur) return;
        const big = cur.t === 'free' ? cur.p.length > 2 : Math.hypot(cur.b[0] - cur.a[0], cur.b[1] - cur.a[1]) > lw * 2;
        if (big) shapes.push(cur); cur = null; redraw();
      });
      const finish = async ok => {
        let out = null;
        if (ok && shapes.length) {
          for (const q of [0.88, 0.8, 0.7, 0.6, 0.5]) { out = await new Promise(r => cv.toBlob(r, 'image/jpeg', q)); if (out.size <= 550 * 1024) break; }
        }
        o.remove(); img.close && img.close(); resolve(out);
      };
      o.addEventListener('click', ev => {
        const b = ev.target.closest('button'); if (!b) return;
        if (b.dataset.t) { tool = b.dataset.t; o.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b)); }
        if (b.dataset.c) { col = b.dataset.c; o.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b)); }
        if (b.dataset.a === 'undo') { shapes.pop(); redraw(); }
        if (b.dataset.a === 'cancel') finish(false);
        if (b.dataset.a === 'ok') finish(true);
      });
      window.addEventListener('hashchange', () => { if (o.isConnected) finish(false); }, { once: true });
    });
  }

  /* ---------- počasí (Open-Meteo, bez klíče) ----------
     Posílá se jen poloha mostu, nic dalšího. Kódy počasí WMO → slovní popis. */
  const WMO = c => c === 0 ? 'Jasno' : c <= 2 ? 'Polojasno' : c === 3 ? 'Zataženo' : c <= 48 ? 'Mlha' : c <= 57 ? 'Mrholení'
    : c <= 67 ? 'Déšť' : c <= 77 ? 'Sněžení' : c <= 82 ? 'Dešťové přeháňky' : c <= 86 ? 'Sněhové přeháňky' : 'Bouřka';
  async function weather(lat, lon) {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code&timezone=auto`;
    const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(); const c = j.current || {};
    if (c.temperature_2m == null) throw new Error('bez údaje');
    return { t: c.temperature_2m, pocasi: WMO(c.weather_code), cas: c.time };
  }

  self.Nastroje = { schema: svg, hit, describe, draw, weather };
})();
