// Runs in the PAGE context (not the content-script isolated world).
// 1) Intercepts the page's own GetCalendarGrid RPC to capture a request template
//    (full URL with f.sid/bl, the f.req body, the `at` token, and x-goog-* headers).
// 2) On request from the content script, replays that RPC in parallel — one call per
//    return date, each spanning a 14-day departure window — to build a 14x14 grid fast.
(function () {
  'use strict';

  const RPC_MARKER = '/GetCalendarGrid';
  const origFetch = window.fetch;

  let template = null; // { url, headers:{lowercased}, body }

  // ── Capture: patch fetch ────────────────────────────────────────────────────
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url);
      if (url && url.includes(RPC_MARKER)) {
        if (init && init.body != null) {
          capture(url, init.headers, init.body);
        } else if (input && typeof input.clone === 'function') {
          // Request object: body is a stream — read a clone asynchronously.
          const hdrs = input.headers;
          input.clone().text().then(t => capture(url, hdrs, t)).catch(() => {});
        }
      }
    } catch (e) { /* never break the page */ }
    return origFetch.apply(this, arguments);
  };

  // ── Capture: patch XHR (batchexecute usually goes through XHR) ───────────────
  const xhrProto = XMLHttpRequest.prototype;
  const origOpen = xhrProto.open;
  const origSend = xhrProto.send;
  const origSetHeader = xhrProto.setRequestHeader;

  xhrProto.open = function (method, url) {
    this.__gfeUrl = url;
    this.__gfeHeaders = {};
    return origOpen.apply(this, arguments);
  };
  xhrProto.setRequestHeader = function (k, v) {
    try { if (this.__gfeHeaders) this.__gfeHeaders[k.toLowerCase()] = v; } catch (e) {}
    return origSetHeader.apply(this, arguments);
  };
  xhrProto.send = function (body) {
    try {
      if (this.__gfeUrl && this.__gfeUrl.includes(RPC_MARKER) && body) {
        capture(this.__gfeUrl, this.__gfeHeaders, body);
      }
    } catch (e) {}
    return origSend.apply(this, arguments);
  };

  function normalizeBody(body) {
    if (body == null) return '';
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const p = new URLSearchParams();
      for (const pair of body.entries()) p.append(pair[0], pair[1]);
      return p.toString();
    }
    try { return String(body); } catch (e) { return ''; }
  }

  function capture(url, headers, rawBody) {
    const body = normalizeBody(rawBody);
    if (body.indexOf('f.req') === -1) return; // not the calendar payload — ignore
    const h = {};
    if (headers) {
      if (typeof headers.forEach === 'function') headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
      else for (const k in headers) h[k.toLowerCase()] = headers[k];
    }
    template = { url: new URL(url, location.origin).href, headers: h, body };
  }

  // ── Request bridge ──────────────────────────────────────────────────────────
  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    const msg = e.data;
    if (!msg || msg.__gfe !== 'request') return;

    if (msg.action === 'status') {
      reply(msg.id, { ok: true, hasTemplate: !!template });
      return;
    }
    if (msg.action === 'fetch') {
      fetchGrid(msg.days || 14)
        .then(payload => reply(msg.id, { ok: true, ...payload }))
        .catch(err => reply(msg.id, { ok: false, error: String(err && err.message || err) }));
    }
  });

  function reply(id, data) {
    window.postMessage(Object.assign({ __gfe: 'result', id }, data), location.origin);
  }

  // ── Core: parallel fetch of the full grid ────────────────────────────────────
  async function fetchGrid(days) {
    if (!template) throw new Error('no-template');

    const params = new URLSearchParams(template.body);
    const fReqStr = params.get('f.req');
    // `at` (XSRF token) is normally in the body; fall back to the page global.
    const at = params.get('at') || (window.WIZ_global_data && window.WIZ_global_data.SNlM0e) || '';
    if (!fReqStr) throw new Error('no f.req in captured body');

    const outer = JSON.parse(fReqStr);          // [null, "<innerStr>"]
    const inner = JSON.parse(outer[1]);          // [..., [depStart,depEnd], [retStart,retEnd]]
    const depRange = inner[inner.length - 2];
    const retRange = inner[inner.length - 1];
    if (!isDateRange(depRange) || !isDateRange(retRange)) throw new Error('unexpected-payload');

    const depStart = depRange[0];
    const retStart = retRange[0];
    const depEnd = addDays(depStart, days - 1);

    // One request per return date; each returns the whole departure window.
    // Limit concurrency + retry empties: firing all at once trips Google's
    // anti-abuse throttling and rejected calls come back empty.
    const retDates = [];
    for (let r = 0; r < days; r++) retDates.push(addDays(retStart, r));

    const cells = [];
    await runPool(retDates, 12, async (retDate) => {
      // The server returns a row only if EVERY departure in the window is on or
      // before the return date (can't depart after you return). So clamp the
      // departure window to end at this return date — yields a triangular grid.
      const depEndClamped = retDate < depEnd ? retDate : depEnd;
      if (depEndClamped < depStart) return; // return precedes all departures
      let got = [];
      for (let attempt = 0; attempt < 3 && got.length === 0; attempt++) {
        if (attempt) await sleep(250 * attempt);
        try {
          got = await fetchOne(outer, inner, [depStart, depEndClamped], [retDate, retDate], at);
        } catch (e) { got = []; }
      }
      for (const c of got) cells.push(c);
    });

    return { cells, currency: currencyFromTemplate(), depStart, retStart };
  }

  async function fetchOne(outer, inner, depRange, retRange, at) {
    const innerCopy = inner.slice();
    innerCopy[innerCopy.length - 2] = depRange;
    innerCopy[innerCopy.length - 1] = retRange;
    const fReq = JSON.stringify([outer[0], JSON.stringify(innerCopy)]);

    const params = new URLSearchParams(template.body);
    params.set('f.req', fReq);
    if (at) params.set('at', at);
    const body = params.toString();

    const headers = { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' };
    for (const k in template.headers) {
      if (k.startsWith('x-goog') || k === 'x-same-domain') headers[k] = template.headers[k];
    }

    const res = await origFetch(buildUrl(template.url), {
      method: 'POST', headers, body, credentials: 'include',
    });
    if (!res.ok) throw new Error('http ' + res.status);
    return parseBatch(await res.text());
  }

  function buildUrl(base) {
    const u = new URL(base);
    u.searchParams.set('_reqid', String(Math.floor(100000 + Math.random() * 900000)));
    u.searchParams.set('rt', 'c');
    return u.href;
  }

  // ── Response parsing (length-prefixed wrb.fr batch) ──────────────────────────
  function parseBatch(text) {
    const out = [];
    text = text.replace(/^\)\]\}'\s*/, '');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t.indexOf('"wrb.fr"') === -1) continue;
      let arr;
      try { arr = JSON.parse(t); } catch (e) { continue; }
      let innerStr = null;
      for (const item of arr) if (Array.isArray(item) && item[0] === 'wrb.fr') { innerStr = item[2]; break; }
      if (!innerStr) continue;
      let inner;
      try { inner = JSON.parse(innerStr); } catch (e) { continue; }
      const cell = Array.isArray(inner[1]) ? inner[1][0] : null;
      if (!Array.isArray(cell) || cell.length < 3) continue;
      const dep = cell[0], ret = cell[1];
      const price = cell[2] && cell[2][0] && cell[2][0][1];
      if (typeof dep === 'string' && typeof ret === 'string' && typeof price === 'number') {
        out.push({ dep, ret, price });
      }
    }
    return out;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Runs `worker` over `items` with at most `limit` in flight at once.
  async function runPool(items, limit, worker) {
    let i = 0;
    const runners = [];
    for (let k = 0; k < Math.min(limit, items.length); k++) {
      runners.push((async () => { while (i < items.length) await worker(items[i++]); })());
    }
    await Promise.all(runners);
  }

  function isDateRange(a) {
    return Array.isArray(a) && a.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(a[0]) && /^\d{4}-\d{2}-\d{2}$/.test(a[1]);
  }
  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }
  function currencyFromTemplate() {
    try {
      const raw = template.headers['x-goog-ext-259736195-jspb'];
      if (raw) { const a = JSON.parse(raw); if (Array.isArray(a) && a[2]) return a[2]; }
    } catch (e) {}
    return null;
  }
})();
