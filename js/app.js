/* Prism Chat: a static, no-build AI chat client.
   Talks directly from the browser to OpenAI, Anthropic, Gemini, or any
   OpenAI-compatible endpoint. Keys live in localStorage only. */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);

  /* ---------- Providers ---------- */
  const PROVIDERS = {
    openai: {
      label: 'OpenAI',
      base: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini'],
      help: 'Create a key at platform.openai.com/api-keys.',
    },
    anthropic: {
      label: 'Anthropic',
      base: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-5-5',
      models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
      help: 'Create a key in the Anthropic Console (console.anthropic.com).',
    },
    gemini: {
      label: 'Gemini',
      base: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash',
      models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
      help: 'Create a key in Google AI Studio (aistudio.google.com/apikey).',
    },
    custom: {
      label: 'Custom',
      base: 'http://localhost:11434/v1',
      model: 'llama3.2',
      models: [],
      help: 'Any OpenAI-compatible server. A key is optional for local servers like Ollama.',
    },
  };

  const SUGGESTIONS = [
    { text: 'Explain how vaccines work in simple terms', color: 'var(--blue)' },
    { text: 'Draft a polite email asking for a deadline extension', color: 'var(--pink)' },
    { text: 'Help me debug a JavaScript error', color: 'var(--green)' },
    { text: 'Plan a relaxed weekend in a new city', color: 'var(--orange)' },
  ];

  /* ---------- Storage ---------- */
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  };

  const defaults = () => ({ provider: 'openai', system: '', temperature: null, providers: {} });
  let settings = Object.assign(defaults(), store.get('prism.settings', {}));
  let chats = store.get('prism.chats', []);
  let currentId = store.get('prism.current', null);
  let controller = null;
  let busy = false;

  /* Optional config.js (git-ignored) can pre-fill provider settings for local use. */
  function loadConfig() {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'config.js';
      s.onload = s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }

  function cfg(p = settings.provider) {
    const d = PROVIDERS[p];
    const saved = settings.providers[p] || {};
    const file = (window.PRISM_CONFIG && window.PRISM_CONFIG.providers && window.PRISM_CONFIG.providers[p]) || {};
    return {
      apiKey: saved.apiKey || file.apiKey || '',
      model: saved.model || file.model || d.model,
      baseUrl: (saved.baseUrl || file.baseUrl || d.base).replace(/\/+$/, ''),
    };
  }

  /* ---------- Helpers ---------- */
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const save = () => { store.set('prism.chats', chats); store.set('prism.current', currentId); };
  const current = () => chats.find((c) => c.id === currentId);

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------- Markdown (small, safe: everything is escaped first) ---------- */
  function inline(s) {
    return s
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function markdown(src) {
    const blocks = [];
    src = src.replace(/```([\w+-]*)\n?([\s\S]*?)(```|$)/g, (_, lang, code) => {
      blocks.push({ lang, code: code.replace(/\n$/, '') });
      return `\n\u0000${blocks.length - 1}\u0000\n`;
    });

    let out = '', list = null, para = [];
    const flushP = () => { if (para.length) { out += '<p>' + inline(para.join('<br>')) + '</p>'; para = []; } };
    const flushL = () => { if (list) { out += `</${list}>`; list = null; } };

    for (const raw of esc(src).split('\n')) {
      const line = raw.trimEnd();
      let m;
      if (/^\u0000\d+\u0000$/.test(line.trim())) { flushP(); flushL(); out += line.trim(); continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)/))) { flushP(); flushL(); const n = Math.min(m[1].length + 1, 5); out += `<h${n}>${inline(m[2])}</h${n}>`; continue; }
      if ((m = line.match(/^\s*[-*]\s+(.*)/))) { flushP(); if (list !== 'ul') { flushL(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flushP(); if (list !== 'ol') { flushL(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; continue; }
      if (!line.trim()) { flushP(); flushL(); continue; }
      flushL();
      para.push(line);
    }
    flushP(); flushL();

    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => {
      const b = blocks[+i];
      return `<div class="code"><div class="code-head"><span>${esc(b.lang || 'code')}</span><button type="button" data-copy-code>Copy</button></div><pre><code>${esc(b.code)}</code></pre></div>`;
    });
  }

  /* ---------- Streaming ---------- */
  async function* sse(res) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
  }

  async function ensureOk(res) {
    if (res.ok) return;
    let text = await res.text();
    try {
      const j = JSON.parse(text);
      const e = j.error || (Array.isArray(j) && j[0] && j[0].error);
      text = (e && (e.message || e)) || text;
    } catch { /* keep raw text */ }
    throw new Error(`${res.status}: ${typeof text === 'string' ? text : JSON.stringify(text)}`);
  }

  async function* streamOpenAI(c, msgs, signal) {
    const body = {
      model: c.model,
      stream: true,
      messages: [...(settings.system ? [{ role: 'system', content: settings.system }] : []), ...msgs],
    };
    if (settings.temperature != null) body.temperature = settings.temperature;
    const res = await fetch(c.baseUrl + '/chat/completions', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', ...(c.apiKey ? { Authorization: 'Bearer ' + c.apiKey } : {}) },
      body: JSON.stringify(body),
    });
    await ensureOk(res);
    for await (const d of sse(res)) {
      if (d === '[DONE]') return;
      try { const t = JSON.parse(d).choices?.[0]?.delta?.content; if (t) yield t; } catch { /* partial line */ }
    }
  }

  async function* streamAnthropic(c, msgs, signal) {
    const body = { model: c.model, max_tokens: 4096, stream: true, messages: msgs };
    if (settings.system) body.system = settings.system;
    if (settings.temperature != null) body.temperature = Math.min(1, settings.temperature);
    const res = await fetch(c.baseUrl + '/messages', {
      method: 'POST', signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': c.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
    await ensureOk(res);
    for await (const d of sse(res)) {
      try {
        const j = JSON.parse(d);
        if (j.type === 'content_block_delta' && j.delta?.text) yield j.delta.text;
        if (j.type === 'error') throw new Error(j.error?.message || 'Stream error');
      } catch (e) { if (e.message && !(e instanceof SyntaxError)) throw e; }
    }
  }

  async function* streamGemini(c, msgs, signal) {
    const body = {
      contents: msgs.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    };
    if (settings.system) body.systemInstruction = { parts: [{ text: settings.system }] };
    if (settings.temperature != null) body.generationConfig = { temperature: settings.temperature };
    const url = `${c.baseUrl}/models/${encodeURIComponent(c.model)}:streamGenerateContent?alt=sse`;
    const res = await fetch(url, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.apiKey },
      body: JSON.stringify(body),
    });
    await ensureOk(res);
    for await (const d of sse(res)) {
      try {
        const parts = JSON.parse(d).candidates?.[0]?.content?.parts || [];
        for (const p of parts) if (p.text) yield p.text;
      } catch { /* partial line */ }
    }
  }

  const STREAMERS = { openai: streamOpenAI, custom: streamOpenAI, anthropic: streamAnthropic, gemini: streamGemini };

  /* ---------- Rendering ---------- */
  const listEl = $('#chatList');
  const msgsEl = $('#messages');
  const input = $('#input');

  function renderList() {
    listEl.innerHTML = '';
    if (!chats.length) {
      listEl.innerHTML = '<p class="chat-empty">Your conversations will appear here.</p>';
      return;
    }
    for (const c of [...chats].sort((a, b) => b.updated - a.updated)) {
      const row = document.createElement('div');
      row.className = 'chat-item';
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      if (c.id === currentId) row.setAttribute('aria-current', 'true');
      row.innerHTML = `<span class="t">${esc(c.title)}</span><button class="del" type="button" aria-label="Delete chat" title="Delete">&times;</button>`;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.del')) { removeChat(c.id); return; }
        selectChat(c.id);
      });
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) selectChat(c.id); });
      listEl.appendChild(row);
    }
  }

  function renderHeader() {
    const c = current();
    $('#chatTitle').textContent = c ? c.title : 'New chat';
    $('#modelPill').textContent = `${PROVIDERS[settings.provider].label} \u00b7 ${cfg().model}`;
  }

  function messageHTML(m, i, last) {
    if (m.role === 'user') return `<div class="msg user"><div class="bubble">${esc(m.content)}</div></div>`;
    const pending = busy && last && !m.error;
    const actions = pending ? '' : `<div class="actions"><button type="button" data-copy-msg="${i}">Copy</button>${last ? '<button type="button" data-regen>Regenerate</button>' : ''}</div>`;
    const err = m.error ? `<div class="error">${esc(m.error)}<button type="button" data-regen>Try again</button></div>` : '';
    const body = m.content ? markdown(m.content) : '';
    return `<div class="msg assistant"><span class="orb avatar" aria-hidden="true"></span><div class="body"><div class="bubble${pending ? ' pending' : ''}"${!m.content && m.error ? ' hidden' : ''}>${body}</div>${err}${actions}</div></div>`;
  }

  function renderMessages(keepScroll) {
    const c = current();
    const nearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 120;
    if (!c || !c.messages.length) {
      const ready = cfg().apiKey || settings.provider === 'custom';
      msgsEl.innerHTML = `<div class="empty"><span class="orb" aria-hidden="true"></span><h2>How can I help?</h2><p>${ready ? 'Ask anything, or start with an idea below.' : 'Add an API key to start chatting.'}</p>${ready ? '' : '<button class="setup" type="button" data-open-settings>Add API key</button><br>'}<div class="chips">${SUGGESTIONS.map((s, i) => `<button class="chip" type="button" data-suggest="${i}" style="--c:${s.color}"><i></i>${esc(s.text)}</button>`).join('')}</div></div>`;
      return;
    }
    msgsEl.innerHTML = '<div class="thread">' + c.messages.map((m, i) => messageHTML(m, i, i === c.messages.length - 1)).join('') + '</div>';
    if (!keepScroll || nearBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  let raf = 0;
  function scheduleRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; renderMessages(true); });
  }

  function setBusy(v) {
    busy = v;
    $('#box').classList.toggle('busy', v);
    $('#send').setAttribute('aria-label', v ? 'Stop generating' : 'Send message');
    syncSend();
  }

  function syncSend() { $('#send').disabled = !busy && !input.value.trim(); }

  /* ---------- Chat actions ---------- */
  function newChat() {
    if (busy) controller?.abort();
    currentId = null;
    save(); renderList(); renderHeader(); renderMessages();
    closeNav();
    input.focus();
  }

  function selectChat(id) {
    if (busy) controller?.abort();
    currentId = id;
    save(); renderList(); renderHeader(); renderMessages();
    closeNav();
  }

  function removeChat(id) {
    if (id === currentId && busy) controller?.abort();
    chats = chats.filter((c) => c.id !== id);
    if (currentId === id) currentId = null;
    save(); renderList(); renderHeader(); renderMessages();
  }

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    let c = current();
    if (!c) {
      c = { id: uid(), title: text.length > 42 ? text.slice(0, 42) + '\u2026' : text, messages: [], updated: Date.now() };
      chats.push(c);
      currentId = c.id;
    }
    c.messages.push({ role: 'user', content: text });
    c.updated = Date.now();
    input.value = ''; autosize(); syncSend();
    save(); renderList(); renderHeader();
    await generate(c);
  }

  async function generate(c) {
    const p = settings.provider;
    const conf = cfg(p);
    if (!conf.apiKey && p !== 'custom') {
      renderMessages();
      openSettings();
      toast(`Add your ${PROVIDERS[p].label} API key to continue.`);
      return;
    }

    const history = c.messages.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content }));
    const reply = { role: 'assistant', content: '' };
    c.messages.push(reply);
    controller = new AbortController();
    setBusy(true);
    renderMessages();

    try {
      for await (const chunk of STREAMERS[p](conf, history, controller.signal)) {
        reply.content += chunk;
        scheduleRender();
      }
      if (!reply.content) reply.error = 'The model returned an empty response. Try again or pick another model.';
    } catch (e) {
      if (e.name === 'AbortError') {
        if (!reply.content) c.messages.pop();
      } else if (e instanceof TypeError) {
        reply.error = "Couldn't reach the API. Check the base URL and your connection. Some providers also block direct browser requests (CORS).";
      } else {
        reply.error = e.message;
      }
    } finally {
      controller = null;
      c.updated = Date.now();
      setBusy(false);
      save(); renderList(); renderMessages(true);
    }
  }

  function regenerate() {
    const c = current();
    if (!c || busy) return;
    if (c.messages.at(-1)?.role === 'assistant') c.messages.pop();
    generate(c);
  }

  /* ---------- Settings sheet ---------- */
  const dlg = $('#settings');
  let draft = null;

  function fillForm() {
    const p = draft.provider;
    const d = PROVIDERS[p];
    const s = draft.providers[p] || {};
    const file = (window.PRISM_CONFIG && window.PRISM_CONFIG.providers && window.PRISM_CONFIG.providers[p]) || {};
    document.querySelectorAll('#providerSeg button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.p === p)));
    $('#apiKey').value = s.apiKey ?? file.apiKey ?? '';
    $('#apiKey').placeholder = p === 'custom' ? 'Optional' : 'Paste your key';
    $('#model').value = s.model || file.model || d.model;
    $('#baseUrl').value = s.baseUrl || file.baseUrl || d.base;
    $('#modelList').innerHTML = d.models.map((m) => `<option value="${esc(m)}">`).join('');
    $('#keyHelp').textContent = d.help;
  }

  function readForm() {
    const p = draft.provider;
    draft.providers[p] = {
      apiKey: $('#apiKey').value.trim(),
      model: $('#model').value.trim(),
      baseUrl: $('#baseUrl').value.trim(),
    };
    draft.system = $('#system').value;
    draft.temperature = $('#tempAuto').checked ? null : parseFloat($('#temp').value);
  }

  function syncTemp() {
    const auto = $('#tempAuto').checked;
    $('#temp').disabled = auto;
    $('#tempOut').textContent = auto ? 'Auto' : $('#temp').value;
    $('#tempOut').style.width = auto ? '3em' : '';
  }

  function openSettings() {
    draft = JSON.parse(JSON.stringify(settings));
    fillForm();
    $('#system').value = draft.system || '';
    $('#tempAuto').checked = draft.temperature == null;
    $('#temp').value = draft.temperature ?? 0.7;
    syncTemp();
    $('#apiKey').type = 'password';
    $('#toggleKey').textContent = 'Show';
    if (!dlg.open) dlg.showModal();
    closeNav();
  }

  document.querySelectorAll('#providerSeg button').forEach((b) =>
    b.addEventListener('click', () => { readForm(); draft.provider = b.dataset.p; fillForm(); }));
  $('#toggleKey').addEventListener('click', () => {
    const k = $('#apiKey');
    const show = k.type === 'password';
    k.type = show ? 'text' : 'password';
    $('#toggleKey').textContent = show ? 'Hide' : 'Show';
  });
  $('#tempAuto').addEventListener('change', syncTemp);
  $('#temp').addEventListener('input', syncTemp);
  $('#clearKey').addEventListener('click', () => { $('#apiKey').value = ''; toast('Key cleared. Press Save to apply.'); });
  $('#cancelSettings').addEventListener('click', () => dlg.close());
  $('#settingsForm').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    readForm();
    settings = draft;
    store.set('prism.settings', settings);
    dlg.close();
    renderHeader(); renderMessages();
    toast('Settings saved');
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  /* ---------- Wiring ---------- */
  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  }
  input.addEventListener('input', () => { autosize(); syncSend(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
  });
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) { controller?.abort(); return; }
    send(input.value);
  });

  msgsEl.addEventListener('click', (e) => {
    const t = e.target;
    const chip = t.closest('[data-suggest]');
    if (chip) { send(SUGGESTIONS[+chip.dataset.suggest].text); return; }
    if (t.closest('[data-open-settings]')) { openSettings(); return; }
    if (t.closest('[data-regen]')) { regenerate(); return; }
    const cm = t.closest('[data-copy-msg]');
    if (cm) { copy(current().messages[+cm.dataset.copyMsg].content); return; }
    if (t.closest('[data-copy-code]')) { copy(t.closest('.code').querySelector('code').textContent); }
  });

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch { toast('Copy failed. Select the text and copy manually.'); }
  }

  const appEl = $('#app');
  const closeNav = () => appEl.classList.remove('nav-open');
  $('#menuBtn').addEventListener('click', () => appEl.classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', closeNav);
  $('#newChat').addEventListener('click', newChat);
  $('#openSettings').addEventListener('click', openSettings);
  $('#modelPill').addEventListener('click', openSettings);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });

  /* ---------- Init ---------- */
  loadConfig().then(() => {
    if (window.PRISM_CONFIG && window.PRISM_CONFIG.provider && !store.get('prism.settings', null)) {
      settings.provider = window.PRISM_CONFIG.provider;
    }
    if (currentId && !current()) currentId = null;
    renderList(); renderHeader(); renderMessages(); syncSend();
  });
})();
