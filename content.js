(function () {
  'use strict';

  const ext = typeof browser !== 'undefined' ? browser : chrome;
  const DAYS = 30; // grid size: DAYS departures x DAYS returns

  // ── Inject the page-context script (does the RPC interception + parallel fetch) ──
  const s = document.createElement('script');
  s.src = ext.runtime.getURL('injected.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);

  // ── Bridge to the injected script ────────────────────────────────────────────
  const pending = new Map();
  let seq = 0;

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const msg = e.data;
    if (!msg || msg.__gfe !== 'result') return;
    const resolve = pending.get(msg.id);
    if (resolve) { pending.delete(msg.id); resolve(msg); }
  });

  function call(action, extra) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, resolve);
      window.postMessage(Object.assign({ __gfe: 'request', id, action }, extra), location.origin);
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); } }, 30000);
    });
  }

  // ── Watch for the price-insights dialog, inject the button ───────────────────
  new MutationObserver(() => {
    const dialog = document.querySelector('[aria-label="Price insights"]');
    if (dialog && !dialog.querySelector('#gfe-btn')) injectButton(dialog);
  }).observe(document.documentElement, { childList: true, subtree: true });

  function injectButton(dialog) {
    const cancelButton = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === 'Cancel'
    );
    if (!cancelButton) return;

    // Reuse the native action button's structure and classes so this follows
    // Google's spacing, typography, hover state, and light/dark theme.
    const btn = cancelButton.cloneNode(true);
    btn.type = 'button';
    btn.removeAttribute('aria-label');

    // Remove Google's delegated action hooks from the clone, while preserving
    // visual class/style attributes on the button and its child elements.
    [btn, ...btn.querySelectorAll('*')].forEach((element) => {
      Array.from(element.attributes).forEach((attribute) => {
        if (attribute.name === 'id' ||
            attribute.name === 'jsaction' ||
            attribute.name === 'jscontroller' ||
            attribute.name === 'jsname' ||
            attribute.name.startsWith('data-')) {
          element.removeAttribute(attribute.name);
        }
      });
    });
    btn.id = 'gfe-btn';

    const label = Array.from(btn.querySelectorAll('*')).reverse().find(
      (element) => element.children.length === 0 && element.textContent.trim() === 'Cancel'
    );
    const setLabel = (text) => {
      if (label) label.textContent = text;
      else btn.textContent = text;
      btn.setAttribute('aria-label', text);
    };
    setLabel('Show 30 days');
    btn.addEventListener('click', () => run());

    // Join the native footer actions immediately to the left of Cancel.
    cancelButton.parentElement.insertBefore(btn, cancelButton);

    async function run() {
      btn.disabled = true;
      setLabel('Loading…');
      try {
        const status = await call('status');
        if (!status.hasTemplate) {
          setLabel('Scroll grid once, then retry');
          btn.disabled = false;
          return;
        }
        const res = await call('fetch', { days: DAYS });
        if (!res.ok) throw new Error(res.error || 'fetch failed');
        renderOverlay(res.cells, res.currency, res.depStart, res.retStart);
        setLabel('Show 30 days');
      } catch (err) {
        console.error('[GFE]', err);
        setLabel('⚠ ' + err.message);
      } finally {
        btn.disabled = false;
      }
    }
  }

  // ── Rendering (mirrors Google's native price grid, theme-aware) ───────────────
  const CUR = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', PKR: '₨', INR: '₹' };

  // Google's sparkle icon (same path the native "cheapest" marker uses).
  const SPARKLE = '<svg width="11" height="11" viewBox="0 0 24 24" style="vertical-align:-1px;margin-right:3px;fill:currentColor"><path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"></path></svg>';

  const THEMES = {
    light: { panel: '#fff', header: '#f1f3f4', text: '#3c4043', dateText: '#202124', dim: '#5f6368',
      line: '#dadce0', cheap: '#188038', cheapBg: '#e6f4ea', high: '#d93025', hover: '#f1f3f4',
      selBg: '#8ab4f8', selText: '#202124', band: '#e8f0fe', hoverBand: '#d2e3fc',
      hoverEdge: '#aecbfa', link: '#1a73e8',
      shadow: 'rgba(60,64,67,0.30)', overlay: 'rgba(32,33,36,0.50)' },
    dark: { panel: '#202124', header: '#2d2e31', text: '#e8eaed', dateText: '#e8eaed', dim: '#9aa0a6',
      line: '#3c4043', cheap: '#81c995', cheapBg: 'rgba(129,201,149,0.14)', high: '#f28b82', hover: '#3c4043',
      selBg: '#8ab4f8', selText: '#202124', band: 'rgba(138,180,248,0.16)',
      hoverBand: '#373f52', hoverEdge: '#596b89', link: '#8ab4f8',
      shadow: 'rgba(0,0,0,0.60)', overlay: 'rgba(0,0,0,0.60)' },
  };

  // Match the page's theme by sampling background luminance.
  function detectTheme() {
    const candidates = [document.querySelector('[aria-label="Price insights"]'), document.body, document.documentElement];
    for (const el of candidates) {
      if (!el) continue;
      const m = getComputedStyle(el).backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) continue;
      if (m[4] !== undefined && parseFloat(m[4]) < 0.5) continue; // transparent
      const lum = 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3];
      return lum < 128 ? 'dark' : 'light';
    }
    return (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }

  function injectStyles() {
    if (document.getElementById('gfe-style')) return;
    const css = `
#gfe-backdrop { position:fixed; inset:0; z-index:2147483646; }
#gfe-overlay { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
  display:flex; flex-direction:column; z-index:2147483647;
  background:var(--panel); color:var(--text); border-radius:8px; padding:18px 24px 10px;
  max-width:96vw; max-height:92vh; box-shadow:0 2px 6px var(--shadow),0 12px 34px var(--shadow);
  font-family:'Google Sans',Roboto,Arial,sans-serif; font-size:14px; }
#gfe-overlay * { box-sizing:border-box; }
#gfe-overlay .top { display:flex; justify-content:space-between; align-items:flex-start;
  margin:0 0 14px; flex:0 0 auto; gap:24px; }
#gfe-overlay .dep { font-size:16px; font-weight:500; color:var(--dateText); }
#gfe-overlay .note { text-align:right; font-size:12px; color:var(--dim); line-height:1.55; }
#gfe-overlay .note .c { color:var(--cheap); display:inline-flex; align-items:center; gap:4px; }
#gfe-overlay .x { position:absolute; top:8px; right:10px; background:none; border:none;
  color:var(--dim); font-size:18px; cursor:pointer; line-height:1; padding:7px; border-radius:50%; }
#gfe-overlay .x:hover { background:var(--hover); }
#gfe-overlay .wrap { overflow:auto; flex:1 1 auto; min-height:0; }
#gfe-overlay table { border-collapse:separate; border-spacing:0; white-space:nowrap; }
#gfe-overlay th,#gfe-overlay td { border-bottom:1px solid var(--line); border-right:1px solid var(--line); }
#gfe-overlay thead th { border-top:1px solid var(--line); }
#gfe-overlay th:first-child,#gfe-overlay td:first-child { border-left:1px solid var(--line); }
#gfe-overlay .hd { background:var(--header); color:var(--dim); font-weight:400; text-align:center;
  padding:9px 14px; position:sticky; line-height:1.3; isolation:isolate; background-clip:padding-box; }
#gfe-overlay .hd .d2 { color:var(--dateText); }
#gfe-overlay .cell { padding:12px 16px; text-align:center; color:var(--text); background:var(--panel); }
#gfe-overlay .cell.band { background:var(--band); }
#gfe-overlay .cell.cheap { background:var(--cheapBg); color:var(--cheap); font-weight:500; }
#gfe-overlay .cell.high { color:var(--high); }
#gfe-overlay .cell.click { cursor:pointer; }
#gfe-overlay .cell.click:hover { background:var(--hover); }
#gfe-overlay .cell.sel { background:var(--selBg)!important; color:var(--selText)!important; font-weight:500; }
#gfe-overlay .cell.sel .spk { fill:var(--selText); }
#gfe-overlay .hover-path { background:var(--hoverBand)!important;
  box-shadow:inset 0 0 0 2px var(--hoverEdge); }
#gfe-overlay .cell.sel.hover-path { background:var(--selBg)!important; }
#gfe-overlay .cell.click:focus-visible { outline:2px solid var(--selBg); outline-offset:-2px; }
#gfe-overlay .cell.empty { color:var(--dim); opacity:.5; cursor:default; }
#gfe-overlay .foot { display:flex; justify-content:space-between; align-items:center;
  margin-top:8px; padding-top:4px; flex:0 0 auto; color:var(--dim); font-size:13px; }
#gfe-overlay .foot .rng b { color:var(--text); font-weight:500; }
#gfe-overlay .btn { color:var(--link); font-weight:500; cursor:pointer; padding:9px 16px;
  border:none; background:none; font-family:inherit; font-size:14px; border-radius:4px; }
#gfe-overlay .btn:hover { background:var(--hover); }
#gfe-overlay .wrap::-webkit-scrollbar { width:12px; height:12px; }
#gfe-overlay .wrap::-webkit-scrollbar-thumb { background:var(--line); border-radius:8px; border:3px solid var(--panel); }
@keyframes gfe-in { from{opacity:0} to{opacity:1} }
#gfe-overlay,#gfe-backdrop { animation:gfe-in .14s ease both; }
@media (prefers-reduced-motion:reduce){ #gfe-overlay,#gfe-backdrop{animation:none} }`;
    const style = document.createElement('style');
    style.id = 'gfe-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Native price classes: cheapest gets the sparkle + green fill; notably high goes red.
  function priceClass(price, min) {
    if (price === min) return 'cheap';
    if (price >= min * 1.09) return 'high';
    return '';
  }

  // The page's current outbound/return (the two dates in tfs) → highlighted like native.
  function currentSelection() {
    try {
      const tfs = new URL(location.href).searchParams.get('tfs');
      if (!tfs) return null;
      const m = b64urlToBin(tfs).match(/\d{4}-\d{2}-\d{2}/g);
      if (m && m.length >= 2) return { dep: m[0], ret: m[1] };
    } catch (e) {}
    return null;
  }

  function renderOverlay(cells, currency, depStart, retStart) {
    injectStyles();
    document.getElementById('gfe-overlay')?.remove();
    document.getElementById('gfe-backdrop')?.remove();

    const C = THEMES[detectTheme()];
    const sym = CUR[currency] || (currency ? currency + ' ' : '');
    const fmtPrice = (p) => sym + p.toLocaleString();
    const map = new Map();
    for (const c of cells) map.set(c.dep + '|' + c.ret, c.price);

    const deps = [], rets = [];
    for (let i = 0; i < DAYS; i++) { deps.push(addDaysISO(depStart, i)); rets.push(addDaysISO(retStart, i)); }

    const min = Math.min.apply(null, cells.map(c => c.price));
    const sel = currentSelection();

    const backdrop = document.createElement('div');
    backdrop.id = 'gfe-backdrop';
    backdrop.style.background = C.overlay;

    const panel = document.createElement('div');
    panel.id = 'gfe-overlay';
    panel.tabIndex = -1;
    for (const k in C) panel.style.setProperty('--' + k, C[k]);

    const topBar = document.createElement('div');
    topBar.className = 'top';
    topBar.innerHTML =
      '<span class="dep">Departure</span>' +
      '<div class="note"><span class="c">' + SPARKLE.replace('class="spk"', '') + 'Cheapest</span>' +
      '<br>Compared with other prices shown</div>';

    const closeX = document.createElement('button');
    closeX.className = 'x'; closeX.setAttribute('aria-label', 'Close'); closeX.textContent = '✕';

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.appendChild(buildTable(deps, rets, map, fmtPrice, min, sel));

    const foot = document.createElement('div');
    foot.className = 'foot';
    let rngHtml = '';
    if (sel) {
      const p = map.get(sel.dep + '|' + sel.ret);
      rngHtml = '<span class="rng">' + fmt(sel.dep) + ' – ' + fmt(sel.ret) +
        (typeof p === 'number' ? '   <b>' + fmtPrice(p) + '</b> · Round trip' : '') + '</span>';
    } else {
      rngHtml = '<span class="rng">Cheapest <b>' + fmtPrice(min) + '</b> · Round trip</span>';
    }
    foot.innerHTML = rngHtml;
    const okBtn = document.createElement('button');
    okBtn.className = 'btn'; okBtn.textContent = 'Close';
    foot.appendChild(okBtn);

    panel.append(closeX, topBar, wrap, foot);
    document.body.append(backdrop, panel);
    panel.focus();

    const close = () => { panel.remove(); backdrop.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    closeX.addEventListener('click', close);
    okBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);
  }

  function buildTable(deps, rets, map, fmtPrice, min, sel) {
    const table = document.createElement('table');

    const hRow = table.createTHead().insertRow();
    deps.forEach((d, depIndex) => {
      const th = dateCell('th', d);
      th.style.cssText = 'top:0;z-index:2;min-width:64px;';
      th.dataset.depIndex = depIndex;
      hRow.appendChild(th);
    });
    const corner = document.createElement('th');
    corner.className = 'hd';
    corner.style.cssText =
      'top:0;right:0;z-index:3;color:var(--dim);writing-mode:vertical-rl;min-width:52px;';
    corner.textContent = 'Return';
    hRow.appendChild(corner);

    const tbody = table.createTBody();
    rets.forEach((ret, retIndex) => {
      const row = tbody.insertRow();
      deps.forEach((dep, depIndex) => {
        const price = map.get(dep + '|' + ret);
        const td = document.createElement('td');
        td.dataset.depIndex = depIndex;
        td.dataset.retIndex = retIndex;
        if (typeof price !== 'number') {
          td.className = 'cell empty';
          td.textContent = '—';
          row.appendChild(td);
          return;
        }
        const cls = priceClass(price, min);
        const isSelCol = sel && dep === sel.dep, isSelRow = sel && ret === sel.ret;
        td.className = 'cell click' + (cls ? ' ' + cls : '') +
          (isSelCol && isSelRow ? ' sel' : '');
        td.innerHTML = (cls === 'cheap' ? SPARKLE.replace('style="', 'class="spk" style="') : '') + fmtPrice(price);
        td.tabIndex = 0;
        td.title = fmtFull(dep) + ' → ' + fmtFull(ret) + ' · ' + fmtPrice(price);
        const go = () => { if (!goToDates(dep, ret)) td.title = 'Could not open this date pair'; };
        td.addEventListener('click', go);
        td.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        row.appendChild(td);
      });
      const rh = dateCell('td', ret);
      rh.style.cssText = 'right:0;z-index:1;text-align:center;min-width:86px;';
      rh.dataset.retIndex = retIndex;
      row.appendChild(rh);
    });

    const clearHoverPath = () => {
      table.querySelectorAll('.hover-path').forEach((element) => element.classList.remove('hover-path'));
    };
    table.addEventListener('mouseover', (event) => {
      const cell = event.target.closest('.cell[data-dep-index][data-ret-index]');
      if (!cell || !table.contains(cell)) return;

      clearHoverPath();
      const depIndex = Number(cell.dataset.depIndex);
      const retIndex = Number(cell.dataset.retIndex);

      table.querySelector('[data-dep-index="' + depIndex + '"]')?.classList.add('hover-path');
      for (let rowIndex = 0; rowIndex <= retIndex; rowIndex++) {
        table.querySelector(
          '.cell[data-dep-index="' + depIndex + '"][data-ret-index="' + rowIndex + '"]'
        )?.classList.add('hover-path');
      }
      for (let colIndex = depIndex; colIndex < deps.length; colIndex++) {
        table.querySelector(
          '.cell[data-dep-index="' + colIndex + '"][data-ret-index="' + retIndex + '"]'
        )?.classList.add('hover-path');
      }
      table.querySelector('tbody .hd[data-ret-index="' + retIndex + '"]')?.classList.add('hover-path');
    });
    table.addEventListener('mouseleave', clearHoverPath);

    return table;
  }

  // Sticky header/label cell: weekday above the date (native two-line style).
  function dateCell(tag, iso) {
    const el = document.createElement(tag);
    el.className = 'hd';
    const wd = document.createElement('div');
    wd.className = 'd1';
    wd.textContent = weekday(iso);
    const dt = document.createElement('div');
    dt.className = 'd2';
    dt.textContent = fmt(iso);
    el.append(wd, dt);
    return el;
  }

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function fmt(iso) {
    const [, m, d] = iso.split('-').map(Number);
    return MON[m - 1] + ' ' + d;
  }
  function dow(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }
  function weekday(iso) { return WD[dow(iso)]; }
  function fmtFull(iso) { return weekday(iso) + ' ' + fmt(iso); }
  function isHL(iso) { const w = dow(iso); return w === 5 || w === 6 || w === 0; } // Fri/Sat/Sun

  // ── Click-through: re-run Google's search for the chosen date pair ────────────
  // Native grid cells just rewrite the dates in the URL's `tfs` param and reload.
  // Dates live there as fixed 10-char strings, so we swap them in place (no need to
  // touch the surrounding protobuf length framing) and navigate.
  function goToDates(depISO, retISO) {
    const url = new URL(location.href);
    const tfs = url.searchParams.get('tfs');
    if (!tfs) return false;
    const next = rewriteTfs(tfs, depISO, retISO);
    if (!next) return false;
    url.searchParams.set('tfs', next);
    location.href = url.href; // navigation reruns the search and dismisses the overlay
    return true;
  }

  function rewriteTfs(tfs, depISO, retISO) {
    try {
      const bin = b64urlToBin(tfs);
      // Prefer the framed form (\x12\x0a = protobuf field 2, length 10) to avoid
      // matching a coincidental date-like byte run; fall back to bare dates.
      const framed = /\x12\x0a(\d{4}-\d{2}-\d{2})/g;
      let count = 0, out;
      if ((bin.match(framed) || []).length >= 2) {
        out = bin.replace(framed, (full) => {
          count++;
          return full.slice(0, 2) + (count === 1 ? depISO : count === 2 ? retISO : full.slice(2));
        });
      } else {
        const bare = /\d{4}-\d{2}-\d{2}/g;
        out = bin.replace(bare, (d) => { count++; return count === 1 ? depISO : count === 2 ? retISO : d; });
      }
      return count >= 1 ? binToB64url(out) : null;
    } catch (e) { return null; }
  }

  function b64urlToBin(s) {
    let b = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    return atob(b);
  }
  function binToB64url(s) {
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function addDaysISO(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }
})();
