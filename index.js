import { getMascotSVG } from './mascots.js';
import {
  CATEGORIES,
  CATEGORY_KEYS,
  FLASHBACK_MODES,
  QUOTES,
  buildPromptText,
  createSnapshot,
  escapeHtml,
  exportMemoryPack,
  getChatStore,
  getPromptTokenStats,
  getST,
  getSettings,
  highlightMatch,
  importMemoryPack,
  normalizeCategory,
  registerUiHooks,
  rollbackSnapshot,
  runExtraction,
  saveChatStore,
  saveSettings,
  toFiniteNumber,
  uid,
  updateInjection,
} from './memory-core.js';
import { mountSettingsPanel } from './settings-panel.js';

let activeTopTab = 'events';
let searchQuery = '';
let quickAddOpen = false;
let quickAddCat = 'events';
let editingFactId = null;
let openMenuFactId = null;
let showPromptPreview = false;
let transferOpen = false;
let lastFlashbackMode = 'thought';
let bubbleTimer = null;
let eventsBound = false;

const TAB_ITEMS = [
  { key: 'events', icon: '⏳', short: 'События' },
  { key: 'relations', icon: '💞', short: 'Отнош.' },
  { key: 'secrets', icon: '🗝', short: 'Секреты' },
  { key: 'scene', icon: '📍', short: 'Сцена' },
  { key: 'chronicle', icon: '📖', short: 'Хроника' },
];

function playShutterFlash() {
  const sheet = document.querySelector('#memorize-modal-backdrop .mem-sheet');
  if (sheet) {
    sheet.classList.remove('mem-shutter-flash');
    void sheet.offsetWidth;
    sheet.classList.add('mem-shutter-flash');
  }
  const wrap = document.getElementById('memorize-mascot-wrap');
  if (wrap) {
    wrap.classList.remove('mem-jelly');
    void wrap.offsetWidth;
    wrap.classList.add('mem-jelly');
  }
}

async function triggerFlashbackNow() {
  const store = getChatStore();
  if (!store.activeFlashback?.text) return;

  updateInjection();
  playShutterFlash();
  closeModal();
  showBubble('Чэн Сяоши: *Хлоп!* «Персонаж вспоминает этот момент...» 📸✨', 4000);

  const sendArea = document.getElementById('send_textarea');
  const sendBtn = document.getElementById('send_but');
  if (sendArea && typeof sendArea.value === 'string' && sendArea.value.trim() && sendBtn) {
    sendBtn.click();
    return;
  }

  const ctx = getST();
  try {
    if (typeof ctx?.executeSlashCommandsWithOptions === 'function') {
      await ctx.executeSlashCommandsWithOptions('/trigger');
      return;
    }
    if (typeof ctx?.executeSlashCommands === 'function') {
      await ctx.executeSlashCommands('/trigger');
      return;
    }
    if (typeof window.Generate === 'function') {
      window.Generate('normal');
      return;
    }
  } catch (err) {
    console.warn('[Memorize] Direct trigger fallback:', err);
  }

  showBubble('Флешбек заряжен! Отправь сообщение — и бот вспомнит этот момент ✨', 4200);
}

/* === Плавающий виджет === */
function showBubble(text, ms = 3400) {
  const bubble = document.getElementById('memorize-speech');
  if (!bubble) return;
  bubble.textContent = text;
  bubble.classList.add('visible');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove('visible'), ms);
}

function setSyncingState(syncing) {
  document.getElementById('memorize-chibi-widget')?.classList.toggle('mem-syncing', Boolean(syncing));
}

function renderWidgetMascot() {
  const wrap = document.getElementById('memorize-mascot-wrap');
  if (!wrap) return;
  const s = getSettings();
  const mode = s.mascotMode || 'duo';
  wrap.className = `mem-mascot-wrap ${mode === 'duo' ? 'mode-duo' : 'mode-single'}`;
  wrap.innerHTML = `
    ${getMascotSVG(mode)}
    <span id="memorize-flash-badge" class="mem-flash-indicator" title="Заряжен флешбек для персонажа">📸</span>
    <span id="memorize-fact-count" class="mem-corner-badge">0</span>
  `;
  updateWidgetBadge();
}

function updateWidgetBadge() {
  const store = getChatStore();
  const settings = getSettings();
  const activeCount = store.facts.filter((f) => f.enabled !== false).length;
  const badge = document.getElementById('memorize-fact-count');

  const chatLen = Array.isArray(getST()?.chat) ? getST().chat.length : 0;
  const unsummarized = Math.max(0, chatLen - Math.min(store.lastProcessedIndex || 0, chatLen));
  const interval = Math.max(4, toFiniteNumber(settings.everyNMessages, 16));
  const pct = settings.autoExtract ? Math.min(100, Math.round((unsummarized / interval) * 100)) : 0;

  if (badge) {
    badge.textContent = String(activeCount);
    badge.style.setProperty('--mem-prog', `${pct}%`);
    badge.title = settings.autoExtract
      ? `Фактов: ${activeCount} · До авто-сжатия: ${Math.max(0, interval - unsummarized)} сообщ. (${unsummarized}/${interval})`
      : `Фактов в памяти: ${activeCount}`;
  }

  const hasFb = Boolean(store.activeFlashback?.text);
  const flashBadge = document.getElementById('memorize-flash-badge');
  if (flashBadge) {
    flashBadge.classList.toggle('active', hasFb);
  }

  const widget = document.getElementById('memorize-chibi-widget');
  if (widget) {
    widget.classList.toggle('mem-hidden', !settings.enabled || !settings.showChibi);
    widget.classList.toggle('mem-fb-armed', hasFb);
  }
}

function clampWidgetToViewport(widget) {
  if (!widget || !widget.style.left || widget.style.left === 'auto') return;
  const w = widget.offsetWidth || 60;
  const h = widget.offsetHeight || 60;
  const maxLeft = Math.max(0, window.innerWidth - w);
  const maxTop = Math.max(0, window.innerHeight - h);
  const rawLeft = parseFloat(widget.style.left);
  const rawTop = parseFloat(widget.style.top);
  if (!Number.isFinite(rawLeft) || !Number.isFinite(rawTop)) return;
  widget.style.left = `${Math.round(Math.min(maxLeft, Math.max(0, rawLeft)))}px`;
  widget.style.top = `${Math.round(Math.min(maxTop, Math.max(0, rawTop)))}px`;
}

function createWidget() {
  if (document.getElementById('memorize-chibi-widget')) return;

  const settings = getSettings();
  const widget = document.createElement('div');
  widget.id = 'memorize-chibi-widget';
  if (!settings.enabled || !settings.showChibi) widget.classList.add('mem-hidden');

  if (settings.widgetPos?.left != null && settings.widgetPos?.top != null) {
    widget.style.left = `${settings.widgetPos.left}px`;
    widget.style.top = `${settings.widgetPos.top}px`;
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
  }

  widget.innerHTML = `
    <div id="memorize-speech" class="mem-speech-bubble"></div>
    <div id="memorize-mascot-wrap" class="mem-mascot-wrap mode-duo" title="Нажми — открыть память чата, перетащи — сдвинуть"></div>
  `;

  document.body.appendChild(widget);
  renderWidgetMascot();
  requestAnimationFrame(() => clampWidgetToViewport(widget));

  window.addEventListener('resize', () => {
    clampWidgetToViewport(document.getElementById('memorize-chibi-widget'));
  });

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;

  widget.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = false;
    const rect = widget.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    origLeft = rect.left;
    origTop = rect.top;
    widget.setPointerCapture?.(e.pointerId);
  });

  widget.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.hypot(dx, dy) > 6) moved = true;
    if (!moved) return;

    const maxLeft = Math.max(0, window.innerWidth - widget.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - widget.offsetHeight);
    widget.style.left = `${Math.min(maxLeft, Math.max(0, origLeft + dx))}px`;
    widget.style.top = `${Math.min(maxTop, Math.max(0, origTop + dy))}px`;
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
  });

  widget.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    widget.releasePointerCapture?.(e.pointerId);

    if (moved) {
      const rect = widget.getBoundingClientRect();
      getSettings().widgetPos = { left: Math.round(rect.left), top: Math.round(rect.top) };
      saveSettings();
      return;
    }

    const wrap = document.getElementById('memorize-mascot-wrap');
    if (wrap) {
      wrap.classList.remove('mem-jelly');
      void wrap.offsetWidth;
      wrap.classList.add('mem-jelly');
    }
    openModal();
  });

  widget.addEventListener('pointercancel', (e) => {
    if (!dragging) return;
    dragging = false;
    moved = false;
    widget.releasePointerCapture?.(e.pointerId);
  });
}

/* === Минималистичная Панель Памяти === */
function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(20, el.scrollHeight)}px`;
}

function createModal() {
  if (document.getElementById('memorize-modal-backdrop')) return;

  const tabsStaticHtml = TAB_ITEMS.map(
    (t) => `
      <div class="mem-top-tab" data-tab="${t.key}">
        <div class="mem-tab-top">
          <span class="mem-tab-icon">${t.icon}</span>
          <span id="mem-tab-count-${t.key}" class="mem-tab-badge">0</span>
        </div>
        <span class="mem-tab-label">${escapeHtml(t.short)}</span>
      </div>`
  ).join('');

  const backdrop = document.createElement('div');
  backdrop.id = 'memorize-modal-backdrop';
  backdrop.innerHTML = `
    <div id="mem-sheet-card" class="mem-sheet" role="dialog" aria-modal="true">
      <div id="mem-sheet-drag-handle" class="mem-sheet-handle-area" title="Потяните вниз, чтобы закрыть">
        <div class="mem-sheet-handle"></div>
      </div>

      <div class="mem-sheet-header">
        <div class="mem-header-left">
          <div id="mem-mini-mascot-tap" style="width:34px;height:34px;cursor:pointer;flex-shrink:0;" title="Погладить маскота">${getMascotSVG('lg')}</div>
          <div class="mem-header-title">
            <strong>Память чата</strong>
            <div id="mem-header-sub" class="mem-header-sub">Фотостудия «Время» · тап по факту для флешбека</div>
          </div>
        </div>
        <div class="mem-header-actions">
          <div id="mem-run-extract" class="mem-chip accent" title="Сжать новые сообщения сейчас">✨ Сжать</div>
          <div id="mem-close-modal" class="mem-close-x" title="Закрыть">✕</div>
          <input id="mem-import-file" type="file" accept=".json,application/json" style="display:none;" />
        </div>
      </div>

      <div id="mem-token-bar" class="mem-token-bar"></div>

      <div id="mem-top-tabs" class="mem-top-tabs">${tabsStaticHtml}</div>

      <div class="mem-top-controls">
        <div class="mem-search-row">
          <div class="mem-search-box">
            <span class="mem-search-icon">🔍</span>
            <input id="mem-search-input" type="text" placeholder="Поиск по всем вкладкам..." />
            <span id="mem-search-clear" class="mem-search-clear" style="display:none;" title="Очистить поиск">✕</span>
          </div>
          <div id="mem-toggle-add" class="mem-toggle-add-btn" title="Добавить факт вручную">+</div>
        </div>
      </div>

      <div id="mem-sheet-body" class="mem-sheet-body"></div>

      <div class="mem-sheet-footer">
        <div id="mem-transfer-btn" class="mem-footer-btn" title="Экспорт / Импорт слепка памяти">📦 Перенос</div>
        <div id="mem-rollback-btn" class="mem-footer-btn" title="Вернуть прошлый снимок памяти">⏪ Откат</div>
        <div id="mem-clear-all" class="mem-footer-btn" title="Очистить память только этого чата">🗑 Очистить</div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });

  // Свайп шторки вниз за ручку + стационарные вкладки без прыжков DOM
  const handleEl = document.getElementById('mem-sheet-drag-handle');
  const sheetCard = document.getElementById('mem-sheet-card');
  let sheetDragY = null;
  handleEl?.addEventListener('pointerdown', (e) => {
    sheetDragY = e.clientY;
    handleEl.setPointerCapture?.(e.pointerId);
  });
  handleEl?.addEventListener('pointermove', (e) => {
    if (sheetDragY === null || !sheetCard) return;
    const dy = Math.max(0, e.clientY - sheetDragY);
    sheetCard.style.transform = dy > 0 ? `translateY(${Math.round(dy * 0.75)}px)` : '';
  });
  handleEl?.addEventListener('pointerup', (e) => {
    if (sheetDragY === null || !sheetCard) return;
    const dy = e.clientY - sheetDragY;
    sheetDragY = null;
    sheetCard.style.transform = '';
    handleEl.releasePointerCapture?.(e.pointerId);
    if (dy > 68) closeModal();
  });
  handleEl?.addEventListener('pointercancel', () => {
    sheetDragY = null;
    if (sheetCard) sheetCard.style.transform = '';
  });

  document.querySelectorAll('#mem-top-tabs .mem-top-tab').forEach((tabEl) => {
    tabEl.addEventListener('click', () => {
      activeTopTab = tabEl.dataset.tab || 'events';
      openMenuFactId = null;
      if (CATEGORY_KEYS.includes(activeTopTab)) quickAddCat = activeTopTab;
      if (searchQuery) {
        searchQuery = '';
        const inp = document.getElementById('mem-search-input');
        const clr = document.getElementById('mem-search-clear');
        if (inp) inp.value = '';
        if (clr) clr.style.display = 'none';
      }
      renderModalContent();
    });
  });

  document.getElementById('mem-close-modal').addEventListener('click', closeModal);
  document.getElementById('mem-run-extract').addEventListener('click', () => runExtraction(true));
  document.getElementById('mem-rollback-btn').addEventListener('click', rollbackSnapshot);
  document.getElementById('mem-transfer-btn').addEventListener('click', () => {
    transferOpen = !transferOpen;
    renderModalContent();
  });

  document.getElementById('mem-import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const res = await importMemoryPack(text, 'replace');
      transferOpen = false;
      renderModalContent();
      showBubble(`Память перенесена (${res.facts} факт.) 📦✨`, 3800);
    } catch (err) {
      showBubble(`Ошибка импорта: ${err.message}`, 4000);
    }
  });

  document.getElementById('mem-mini-mascot-tap').addEventListener('click', () => {
    const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    const sub = document.getElementById('mem-header-sub');
    if (sub) sub.textContent = q;
  });

  document.getElementById('mem-clear-all').addEventListener('click', async () => {
    const ctx = getST();
    const confirmed = ctx?.Popup?.show?.confirm
      ? await ctx.Popup.show.confirm(
          'Очистка памяти чата',
          'Очистить память только для текущего чата? (Её можно будет вернуть кнопкой ⏪)'
        )
      : window.confirm('Очистить память только для текущего чата?');
    if (!confirmed) return;
    const store = getChatStore();
    store.previousSnapshot = createSnapshot(store);
    store.coreCanon = '';
    store.chapters = [];
    store.facts = [];
    store.activeFlashback = null;
    store.lastProcessedIndex = 0;
    await saveChatStore();
    renderModalContent();
  });

  const searchInp = document.getElementById('mem-search-input');
  const searchClear = document.getElementById('mem-search-clear');
  searchInp.addEventListener('input', () => {
    searchQuery = searchInp.value || '';
    searchClear.style.display = searchQuery ? 'inline' : 'none';
    renderModalContent();
  });

  searchClear.addEventListener('click', () => {
    searchQuery = '';
    searchInp.value = '';
    searchClear.style.display = 'none';
    renderModalContent();
  });

  document.getElementById('mem-toggle-add').addEventListener('click', () => {
    if (activeTopTab === 'chronicle') {
      activeTopTab = 'events';
    }
    quickAddOpen = !quickAddOpen;
    if (quickAddOpen && CATEGORY_KEYS.includes(activeTopTab)) {
      quickAddCat = activeTopTab;
    }
    renderModalContent();
    if (quickAddOpen) {
      setTimeout(() => document.getElementById('mem-quick-fact-input')?.focus(), 40);
    }
  });
}

function openModal() {
  createModal();
  const store = getChatStore();
  if (
    CATEGORY_KEYS.includes(activeTopTab) &&
    store.facts.length > 0 &&
    store.facts.filter((f) => normalizeCategory(f.category, f.text) === activeTopTab).length === 0
  ) {
    const firstNonEmpty = CATEGORY_KEYS.find(
      (k) => store.facts.filter((f) => normalizeCategory(f.category, f.text) === k).length > 0
    );
    if (firstNonEmpty) activeTopTab = firstNonEmpty;
  }

  document.getElementById('memorize-modal-backdrop')?.classList.add('open');
  renderModalContent();
}

function closeModal() {
  editingFactId = null;
  openMenuFactId = null;
  transferOpen = false;
  document.getElementById('memorize-modal-backdrop')?.classList.remove('open');
}

function renderTransferBox() {
  if (!transferOpen) return '';
  return `
    <div class="mem-transfer-box">
      <div class="mem-fb-head" style="color:var(--mem-accent);">
        <span>📦 Перенос памяти («2-й сезон» чата)</span>
        <span id="mem-close-transfer" style="cursor:pointer;color:var(--mem-sub);font-weight:500;">✕ Закрыть</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <div id="mem-copy-pack" class="mem-chip accent">📋 Скопировать</div>
        <div id="mem-download-pack" class="mem-chip">💾 Скачать .json</div>
        <div id="mem-upload-pack" class="mem-chip">📂 Из файла</div>
      </div>
      <textarea id="mem-transfer-json" class="mem-transfer-textarea" placeholder="Чтобы перенести память в новый чат: нажмите «📋 Скопировать» в старом чате, вставьте JSON сюда и выберите режим ниже..."></textarea>
      <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;">
        <div id="mem-import-merge" class="mem-chip" title="Добавить факты и канон к текущей памяти">➕ Объединить</div>
        <div id="mem-import-replace" class="mem-chip gold" title="Заменить память этого чата (можно отменить кнопкой ⏪)">📥 Загрузить слепок</div>
      </div>
    </div>
  `;
}

function bindTransferEvents() {
  if (!transferOpen) return;
  document.getElementById('mem-close-transfer')?.addEventListener('click', () => {
    transferOpen = false;
    renderModalContent();
  });

  document.getElementById('mem-copy-pack')?.addEventListener('click', async () => {
    const json = exportMemoryPack();
    const ta = document.getElementById('mem-transfer-json');
    if (ta) ta.value = json;
    try {
      await navigator.clipboard.writeText(json);
      showBubble('Слепок памяти скопирован в буфер 📋✨', 3400);
    } catch (_) {
      ta?.select?.();
      showBubble('Слепок показан в поле — скопируйте текст 📋', 3600);
    }
  });

  document.getElementById('mem-download-pack')?.addEventListener('click', () => {
    const json = exportMemoryPack();
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `memorize-chat-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showBubble('Файл памяти сохранён 💾✨', 3200);
  });

  document.getElementById('mem-upload-pack')?.addEventListener('click', () => {
    document.getElementById('mem-import-file')?.click();
  });

  const runTextImport = async (mode) => {
    const raw = document.getElementById('mem-transfer-json')?.value?.trim();
    if (!raw) {
      showBubble('Сначала вставьте JSON слепка в поле выше 📝', 3200);
      return;
    }
    try {
      const res = await importMemoryPack(raw, mode);
      transferOpen = false;
      renderModalContent();
      showBubble(`Память загружена (${res.facts} факт.) 📦✨`, 3600);
    } catch (err) {
      showBubble(`Ошибка: ${err.message}`, 3800);
    }
  };

  document.getElementById('mem-import-replace')?.addEventListener('click', () => runTextImport('replace'));
  document.getElementById('mem-import-merge')?.addEventListener('click', () => runTextImport('merge'));
}

function renderFlashbackBanner(store) {
  const fb = store.activeFlashback;
  if (!fb || !fb.text?.trim()) return '';
  const curMode = FLASHBACK_MODES[fb.mode] ? fb.mode : 'thought';
  const modePills = Object.entries(FLASHBACK_MODES)
    .map(
      ([k, meta]) =>
        `<span class="mem-fb-mode-pill ${curMode === k ? 'active' : ''}" data-fb-mode="${k}" title="${escapeHtml(
          meta.hint
        )}">${meta.icon} ${escapeHtml(meta.label)}</span>`
    )
    .join('');

  return `
    <div class="mem-flashback-banner">
      <div class="mem-fb-head">
        <span>📸 Флешбек выбран для персонажа</span>
        <span id="mem-cancel-fb" style="cursor:pointer;color:var(--mem-sub);font-weight:500;">✕ Снять</span>
      </div>
      <div class="mem-fb-quote">«${escapeHtml(fb.text)}»</div>
      <div class="mem-fb-modes">${modePills}</div>
      <div class="mem-fb-actions">
        <span class="mem-fb-hint">${escapeHtml(FLASHBACK_MODES[curMode].hint)}</span>
        <div id="mem-fire-fb-now" class="mem-chip gold">⚡ Вспомнить сейчас</div>
      </div>
    </div>
  `;
}

function bindFlashbackBannerEvents(store) {
  document.getElementById('mem-cancel-fb')?.addEventListener('click', async () => {
    store.activeFlashback = null;
    await saveChatStore();
    renderModalContent();
  });
  document.querySelectorAll('.mem-fb-mode-pill').forEach((pill) => {
    pill.addEventListener('click', async () => {
      const nextMode = pill.dataset.fbMode;
      if (!nextMode || !FLASHBACK_MODES[nextMode] || !store.activeFlashback) return;
      store.activeFlashback.mode = nextMode;
      lastFlashbackMode = nextMode;
      await saveChatStore();
      renderModalContent();
    });
  });
  document.getElementById('mem-fire-fb-now')?.addEventListener('click', () => {
    triggerFlashbackNow();
  });
}

function renderModalContent() {
  const backdrop = document.getElementById('memorize-modal-backdrop');
  if (!backdrop) return;

  const store = getChatStore();
  const promptText = buildPromptText();
  const stats = getPromptTokenStats();
  const qLower = searchQuery.trim().toLowerCase();

  // Наглядная плашка и шкала инжектируемых в промпт токенов
  const tokenBar = document.getElementById('mem-token-bar');
  if (tokenBar) {
    if (!stats.enabled) {
      tokenBar.innerHTML = `
        <div class="mem-token-row">
          <span class="mem-token-main"><span class="mem-dot off"></span>Память выключена</span>
          <span class="mem-token-breakdown">0 ток.</span>
        </div>
        <div class="mem-token-track"><div class="mem-token-fill" style="width:0%"></div></div>`;
    } else if (stats.totalTokens === 0) {
      tokenBar.innerHTML = `
        <div class="mem-token-row">
          <span class="mem-token-main"><span class="mem-dot off"></span>В промпте: 0 ток.</span>
          <span class="mem-token-breakdown">Нажмите «✨ Сжать» для первой выжимки</span>
        </div>
        <div class="mem-token-track"><div class="mem-token-fill" style="width:0%"></div></div>`;
    } else {
      const fillPct = Math.min(100, Math.max(4, Math.round((stats.totalTokens / 1400) * 100)));
      const lvl = stats.totalTokens >= 1100 ? 'high' : stats.totalTokens >= 650 ? 'warn' : '';
      const parts = [];
      if (stats.canonTokens) parts.push(`Канон ${stats.canonTokens}`);
      if (stats.chaptersTokens) parts.push(`Гл. ${stats.chaptersTokens}`);
      if (stats.factsTokens) parts.push(`Факты ${stats.factsTokens}`);
      if (stats.flashbackTokens) parts.push(`📸+${stats.flashbackTokens}`);
      parts.push(`Глуб. ${stats.depth}`);
      tokenBar.innerHTML = `
        <div class="mem-token-row">
          <span class="mem-token-main"><span class="mem-dot"></span>В промпте: ~${stats.totalTokens} ток.</span>
          <span class="mem-token-breakdown">${escapeHtml(parts.join(' · '))}</span>
        </div>
        <div class="mem-token-track"><div class="mem-token-fill ${lvl}" style="width:${fillPct}%"></div></div>`;
    }
  }

  // Точечное обновление стационарных 5 вкладок без пересоздания DOM
  const countsMap = {
    events: 0,
    relations: 0,
    secrets: 0,
    scene: 0,
    chronicle: store.chapters.length + (store.coreCanon?.trim() ? 1 : 0),
  };
  for (const f of store.facts) {
    const k = normalizeCategory(f.category, f.text);
    if (countsMap[k] !== undefined) countsMap[k]++;
  }
  document.querySelectorAll('#mem-top-tabs .mem-top-tab').forEach((tabEl) => {
    const k = tabEl.dataset.tab;
    tabEl.classList.toggle('active', !qLower && activeTopTab === k);
    const badgeEl = document.getElementById(`mem-tab-count-${k}`);
    if (badgeEl && countsMap[k] !== undefined) badgeEl.textContent = String(countsMap[k]);
  });

  document.getElementById('mem-transfer-btn')?.classList.toggle('active', transferOpen);

  const addToggleBtn = document.getElementById('mem-toggle-add');
  if (addToggleBtn) {
    addToggleBtn.classList.toggle('open', quickAddOpen);
  }

  const body = document.getElementById('mem-sheet-body');
  if (!body) return;

  if (activeTopTab !== 'chronicle' || qLower) {
    const filtered = store.facts.filter((f) => {
      if (qLower) {
        return String(f.text || '').toLowerCase().includes(qLower);
      }
      return normalizeCategory(f.category, f.text) === activeTopTab;
    });

    const quickAddHtml = quickAddOpen
      ? `
      <div class="mem-quick-add">
        <span id="mem-quick-cat-btn" class="mem-quick-cat-cycle" title="Сменить вкладку для нового факта">
          ${CATEGORIES[quickAddCat]?.icon || '⏳'} ${CATEGORIES[quickAddCat]?.label || 'События'}
        </span>
        <input id="mem-quick-fact-input" type="text" placeholder="Записать факт..." />
        <div id="mem-quick-fact-btn" class="mem-quick-add-btn">＋</div>
      </div>`
      : '';

    const currentCatTitle = CATEGORIES[activeTopTab]?.full || 'Факты';
    const rowsHtml =
      filtered.length === 0
        ? `<div class="mem-empty-hint">${
            qLower
              ? 'По этому запросу ничего не найдено 🔍'
              : `Во вкладке <b>«${escapeHtml(currentCatTitle)}»</b> пока нет записей.<br>Нажмите <b>«✨ Сжать»</b> вверху или <b>«+»</b>, чтобы добавить факт.`
          }</div>`
        : `<div class="mem-subhint">${
            qLower
              ? `🔍 Найдено совпадений: ${filtered.length} — нажми на факт для Флешбека`
              : '💡 Нажми на любой факт — и персонаж вспомнит этот момент'
          }</div>
           <div class="mem-clean-list">` +
          filtered
            .map((f) => {
              const catKey = normalizeCategory(f.category, f.text);
              const catMeta = CATEGORIES[catKey] || CATEGORIES.events;
              const isArmed = store.activeFlashback?.id === f.id;
              const isEditing = editingFactId === f.id;
              const isMenuOpen = openMenuFactId === f.id && !isEditing;

              return `
              <div class="mem-fact-row ${f.locked ? 'locked' : ''} ${f.enabled === false ? 'muted' : ''} ${
                isArmed ? 'flashback-armed' : ''
              }" data-id="${escapeHtml(f.id)}">
                <div class="mem-fact-main">
                  <span class="mem-cat-badge" title="${escapeHtml(catMeta.full)}">${catMeta.icon}</span>
                  ${
                    isEditing
                      ? `<textarea rows="1" class="mem-fact-edit">${escapeHtml(f.text)}</textarea>`
                      : `<div class="mem-fact-text-view" title="Нажми, чтобы персонаж вспомнил этот момент">${highlightMatch(
                          f.text,
                          searchQuery
                        )}${f.isNew ? '<span class="mem-new-tag">new</span>' : ''}</div>`
                  }
                  <div class="mem-row-tools">
                    <span class="mem-mini-act act-pin ${f.locked ? 'pinned' : ''}" title="Закрепить от перезаписи">${
                f.locked ? '📌' : '📍'
              }</span>
                    <span class="mem-mini-act act-more ${isMenuOpen ? 'open' : ''}" title="Ещё действия">⋯</span>
                  </div>
                </div>
                ${
                  isMenuOpen
                    ? `<div class="mem-card-drawer">
                        <span class="mem-drawer-btn act-edit">✎ Изменить</span>
                        <span class="mem-drawer-btn act-move">⇄ Рубрика</span>
                        <span class="mem-drawer-btn act-mute">${f.enabled === false ? '👁 Включить' : '🙈 Скрыть'}</span>
                        <span class="mem-drawer-btn danger act-del">🗑 Удалить</span>
                      </div>`
                    : ''
                }
              </div>`;
            })
            .join('') +
          `</div>`;

    body.innerHTML = `${renderTransferBox()}${renderFlashbackBanner(store)}${quickAddHtml}${rowsHtml}`;
    bindTransferEvents();
    bindFlashbackBannerEvents(store);

    document.getElementById('mem-quick-cat-btn')?.addEventListener('click', () => {
      const nextIdx = (CATEGORY_KEYS.indexOf(quickAddCat) + 1) % CATEGORY_KEYS.length;
      quickAddCat = CATEGORY_KEYS[nextIdx];
      renderModalContent();
    });

    const addFactNow = async () => {
      const inp = document.getElementById('mem-quick-fact-input');
      const val = inp?.value?.trim();
      if (!val) return;
      const targetCat = quickAddCat || (CATEGORY_KEYS.includes(activeTopTab) ? activeTopTab : 'events');
      store.facts.unshift({
        id: uid('f'),
        category: targetCat,
        text: val,
        enabled: true,
        locked: true,
      });
      activeTopTab = targetCat;
      inp.value = '';
      await saveChatStore();
      renderModalContent();
    };

    document.getElementById('mem-quick-fact-btn')?.addEventListener('click', addFactNow);
    document.getElementById('mem-quick-fact-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addFactNow();
    });

    body.querySelectorAll('.mem-fact-row').forEach((row) => {
      const id = row.dataset.id;
      const fact = store.facts.find((x) => x.id === id);
      if (!fact) return;

      row.querySelector('.mem-cat-badge')?.addEventListener('click', async () => {
        const cur = normalizeCategory(fact.category, fact.text);
        fact.category = CATEGORY_KEYS[(CATEGORY_KEYS.indexOf(cur) + 1) % CATEGORY_KEYS.length];
        await saveChatStore();
        renderModalContent();
      });

      row.querySelector('.mem-fact-text-view')?.addEventListener('click', async () => {
        if (store.activeFlashback?.id === fact.id) {
          store.activeFlashback = null;
        } else {
          store.activeFlashback = {
            id: fact.id,
            text: fact.text,
            mode: lastFlashbackMode || 'thought',
            firedCount: 0,
          };
          playShutterFlash();
        }
        await saveChatStore();
        renderModalContent();
      });

      const editTa = row.querySelector('.mem-fact-edit');
      let commitEdit = null;
      if (editTa) {
        let editFinished = false;
        requestAnimationFrame(() => autoResizeTextarea(editTa));
        editTa.focus();
        editTa.addEventListener('input', () => autoResizeTextarea(editTa));
        commitEdit = async () => {
          if (editFinished) return;
          editFinished = true;
          const nextText = editTa.value.trim();
          if (nextText) fact.text = nextText;
          fact.isNew = false;
          if (store.activeFlashback?.id === fact.id && nextText) {
            store.activeFlashback.text = nextText;
          }
          editingFactId = null;
          await saveChatStore();
          renderModalContent();
        };
        editTa.addEventListener('blur', commitEdit);
        editTa.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commitEdit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            editFinished = true;
            editingFactId = null;
            renderModalContent();
          }
        });

        row.querySelector('.mem-row-tools')?.addEventListener('mousedown', (e) => e.preventDefault());
        row.querySelector('.mem-cat-badge')?.addEventListener('mousedown', (e) => e.preventDefault());
      }

      row.querySelector('.act-more')?.addEventListener('click', async () => {
        if (editingFactId === fact.id && commitEdit) {
          await commitEdit();
          return;
        }
        openMenuFactId = openMenuFactId === fact.id ? null : fact.id;
        renderModalContent();
      });

      row.querySelector('.act-edit')?.addEventListener('click', async () => {
        openMenuFactId = null;
        if (editingFactId === fact.id && commitEdit) {
          await commitEdit();
          return;
        }
        editingFactId = editingFactId === fact.id ? null : fact.id;
        renderModalContent();
      });

      row.querySelector('.act-move')?.addEventListener('click', async () => {
        const cur = normalizeCategory(fact.category, fact.text);
        const nextCat = CATEGORY_KEYS[(CATEGORY_KEYS.indexOf(cur) + 1) % CATEGORY_KEYS.length];
        fact.category = nextCat;
        openMenuFactId = null;
        await saveChatStore();
        renderModalContent();
        showBubble(`Перенесено в «${CATEGORIES[nextCat].label}» ${CATEGORIES[nextCat].icon}`, 2200);
      });

      row.querySelector('.act-pin')?.addEventListener('click', async () => {
        if (editTa) {
          const nextText = editTa.value.trim();
          if (nextText) fact.text = nextText;
        }
        fact.locked = !fact.locked;
        await saveChatStore();
        renderModalContent();
      });

      row.querySelector('.act-mute')?.addEventListener('click', async () => {
        if (editTa) {
          const nextText = editTa.value.trim();
          if (nextText) fact.text = nextText;
        }
        fact.enabled = fact.enabled === false;
        openMenuFactId = null;
        await saveChatStore();
        renderModalContent();
      });

      row.querySelector('.act-del')?.addEventListener('click', async () => {
        if (editingFactId === fact.id) editingFactId = null;
        if (openMenuFactId === fact.id) openMenuFactId = null;
        if (store.activeFlashback?.id === fact.id) store.activeFlashback = null;
        store.facts = store.facts.filter((x) => x.id !== id);
        await saveChatStore();
        renderModalContent();
      });
    });
    return;
  }

  // Вкладка «📖 Хроника» (Дневник кадров с вертикальной нитью таймлайна)
  const chaptersHtml =
    store.chapters.length === 0
      ? `<div class="mem-empty-hint" style="padding:14px;">Кадры хроники появятся автоматически по мере продвижения ролевой ✨</div>`
      : `<div class="mem-timeline">` +
        store.chapters
          .map((ch, idx) => {
            const chId = ch.id || `ch_${idx}`;
            const isArmed = store.activeFlashback?.id === chId;
            return `
            <div class="mem-chapter-item ${isArmed ? 'flashback-armed' : ''}" data-idx="${idx}">
              <div class="mem-chapter-meta">
                <span>⏱ Кадр ${escapeHtml(ch.range || `#${idx + 1}`)}</span>
                <div style="display:inline-flex;gap:4px;">
                  <span class="mem-mini-act ch-fb" title="Вызвать флешбек по этому кадру">📸</span>
                  <span class="mem-mini-act ch-del" title="Удалить кадр">✕</span>
                </div>
              </div>
              <textarea rows="1" class="mem-fact-edit ch-edit" style="background:transparent!important;border:none!important;padding:0;">${escapeHtml(
                ch.text
              )}</textarea>
            </div>`;
          })
          .join('') +
        `</div>`;

  body.innerHTML = `
    ${renderTransferBox()}
    ${renderFlashbackBanner(store)}
    <div class="mem-canon-card">
      <div class="mem-section-label">
        <span>Основа сюжета (долгосрочный канон)</span>
      </div>
      <textarea id="mem-canon-input" class="mem-canon-textarea" placeholder="Сюда автоматически уплотняются старые главы больших чатов (можно редактировать вручную)...">${escapeHtml(
        store.coreCanon || ''
      )}</textarea>
    </div>

    <div class="mem-section-label" style="padding:2px 2px 0;">
      <span>Таймлайн последних сцен</span>
      <span id="mem-toggle-preview" style="cursor:pointer;text-transform:none;font-weight:500;color:var(--mem-sub);">
        ${showPromptPreview ? 'Скрыть промпт ▴' : 'Что видит бот ▾'}
      </span>
    </div>

    ${showPromptPreview ? `<div class="mem-preview-box">${escapeHtml(promptText || 'Промпт памяти пока пуст.')}</div>` : ''}

    ${chaptersHtml}
  `;

  bindTransferEvents();
  bindFlashbackBannerEvents(store);

  const canonInput = document.getElementById('mem-canon-input');
  requestAnimationFrame(() => autoResizeTextarea(canonInput));
  canonInput?.addEventListener('input', () => autoResizeTextarea(canonInput));
  canonInput?.addEventListener('change', async () => {
    store.coreCanon = canonInput.value.trim();
    await saveChatStore();
    renderModalContent();
  });

  document.getElementById('mem-toggle-preview')?.addEventListener('click', () => {
    showPromptPreview = !showPromptPreview;
    renderModalContent();
  });

  body.querySelectorAll('.mem-chapter-item').forEach((item) => {
    const idx = Number(item.dataset.idx);
    const ch = store.chapters[idx];
    if (!ch) return;
    if (!ch.id) ch.id = uid('ch');

    const ta = item.querySelector('.ch-edit');
    requestAnimationFrame(() => autoResizeTextarea(ta));
    ta.addEventListener('input', () => autoResizeTextarea(ta));
    ta.addEventListener('change', async () => {
      ch.text = ta.value.trim();
      await saveChatStore();
      renderModalContent();
    });

    item.querySelector('.ch-fb')?.addEventListener('click', async () => {
      if (store.activeFlashback?.id === ch.id) {
        store.activeFlashback = null;
      } else {
        store.activeFlashback = {
          id: ch.id,
          text: ch.text,
          mode: lastFlashbackMode || 'thought',
          firedCount: 0,
        };
        playShutterFlash();
      }
      await saveChatStore();
      renderModalContent();
    });

    item.querySelector('.ch-del').addEventListener('click', async () => {
      if (store.activeFlashback?.id === ch.id) store.activeFlashback = null;
      store.chapters.splice(idx, 1);
      await saveChatStore();
      renderModalContent();
    });
  });
}

registerUiHooks({ showBubble, setSyncingState, renderModalContent, updateWidgetBadge });

/* === Жизненный цикл и гарантированный инжект перед каждым ответом === */
function bindEvents() {
  if (eventsBound) return;
  const ctx = getST();
  if (!ctx?.eventSource || !ctx?.event_types) return;
  eventsBound = true;
  const ev = ctx.event_types;

  const syncProcessedIndex = () => {
    const latestCtx = getST();
    const chat = latestCtx?.chat;
    const store = getChatStore();
    if (Array.isArray(chat) && store.lastProcessedIndex > chat.length) {
      store.lastProcessedIndex = chat.length;
      latestCtx?.saveMetadata?.();
    }
  };

  const refreshState = () => {
    syncProcessedIndex();
    updateInjection();
    updateWidgetBadge();
    if (document.getElementById('memorize-modal-backdrop')?.classList.contains('open')) {
      renderModalContent();
    }
  };

  if (ev.CHAT_CHANGED) ctx.eventSource.on(ev.CHAT_CHANGED, refreshState);
  if (ev.GENERATION_STARTED) ctx.eventSource.on(ev.GENERATION_STARTED, updateInjection);
  if (ev.MESSAGE_DELETED) ctx.eventSource.on(ev.MESSAGE_DELETED, refreshState);

  document.addEventListener('focusin', (e) => {
    if (e.target?.id === 'send_textarea' && window.innerWidth <= 680) {
      document.getElementById('memorize-chibi-widget')?.classList.add('mem-typing-dim');
    }
  });
  document.addEventListener('focusout', (e) => {
    if (e.target?.id === 'send_textarea') {
      document.getElementById('memorize-chibi-widget')?.classList.remove('mem-typing-dim');
    }
  });

  if (ev.MESSAGE_SENT) {
    ctx.eventSource.on(ev.MESSAGE_SENT, async () => {
      const store = getChatStore();
      // Если бот уже отыграл заряженный флешбек (поддерживая свайпы), снимаем его на новом ходе игрока
      if (store.activeFlashback && (store.activeFlashback.firedCount || 0) > 0) {
        store.activeFlashback = null;
        await saveChatStore();
      } else {
        updateInjection();
      }
    });
  }

  if (ev.MESSAGE_RECEIVED) {
    ctx.eventSource.on(ev.MESSAGE_RECEIVED, async () => {
      const latestCtx = getST();
      const store = getChatStore();
      if (store.activeFlashback?.text) {
        store.activeFlashback.firedCount = (store.activeFlashback.firedCount || 0) + 1;
        await saveChatStore();
      } else {
        updateInjection();
      }

      const settings = getSettings();
      if (!settings.enabled || !settings.autoExtract) return;

      const chat = Array.isArray(latestCtx?.chat) ? latestCtx.chat : [];
      if (store.lastProcessedIndex > chat.length) {
        store.lastProcessedIndex = chat.length;
      }
      const unsummarized = chat.length - (store.lastProcessedIndex || 0);

      if (unsummarized >= Math.max(4, toFiniteNumber(settings.everyNMessages, 16))) {
        await runExtraction(false);
      }
    });
  }
}

function initExtension() {
  createWidget();
  createModal();
  mountSettingsPanel({ openModal, renderWidgetMascot, updateWidgetBadge });
  bindEvents();
  updateInjection();
  updateWidgetBadge();
}

jQuery(() => {
  const ctx = getST();
  if (ctx?.eventSource && ctx?.event_types?.APP_READY) {
    ctx.eventSource.on(ctx.event_types.APP_READY, () => setTimeout(initExtension, 150));
  }
  // Также запускаем инициализацию, если расширение установлено на лету уже после APP_READY
  if (document.getElementById('extensions_settings') || document.getElementById('send_textarea')) {
    setTimeout(initExtension, 200);
  } else {
    setTimeout(initExtension, 800);
  }
});
