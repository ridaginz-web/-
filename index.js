import { getMascotSVG } from './mascots.js';
import {
  CATEGORIES,
  CATEGORY_KEYS,
  QUOTES,
  buildPromptText,
  createSnapshot,
  escapeHtml,
  estimateTokens,
  getChatStore,
  getST,
  getSettings,
  highlightMatch,
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
let showPromptPreview = false;
let bubbleTimer = null;
let eventsBound = false;

async function triggerFlashbackNow() {
  const store = getChatStore();
  if (!store.activeFlashback?.text) return;

  updateInjection();
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
  const activeCount = store.facts.filter((f) => f.enabled !== false).length;
  const badge = document.getElementById('memorize-fact-count');
  if (badge) badge.textContent = String(activeCount);

  const flashBadge = document.getElementById('memorize-flash-badge');
  if (flashBadge) {
    flashBadge.classList.toggle('active', Boolean(store.activeFlashback?.text));
  }

  const widget = document.getElementById('memorize-chibi-widget');
  const settings = getSettings();
  if (widget) {
    widget.classList.toggle('mem-hidden', !settings.enabled || !settings.showChibi);
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

  const backdrop = document.createElement('div');
  backdrop.id = 'memorize-modal-backdrop';
  backdrop.innerHTML = `
    <div class="mem-sheet" role="dialog" aria-modal="true">
      <div class="mem-sheet-header">
        <div class="mem-header-left">
          <div id="mem-mini-mascot-tap" style="width:32px;height:32px;cursor:pointer;flex-shrink:0;" title="Погладить маскота">${getMascotSVG('lg')}</div>
          <div class="mem-header-title">
            <strong>Память чата</strong>
            <div id="mem-prompt-status" class="mem-prompt-pill"></div>
          </div>
        </div>
        <div class="mem-header-actions">
          <div id="mem-run-extract" class="mem-chip accent" title="Сжать новые сообщения сейчас">✨ Сжать</div>
          <div id="mem-rollback-btn" class="mem-chip" title="Откат Лу Гуана к прошлому снимку">⏪</div>
          <div id="mem-clear-all" class="mem-chip" title="Очистить память этого чата">🗑</div>
          <div id="mem-close-modal" class="mem-close-x" title="Закрыть">✕</div>
        </div>
      </div>

      <div id="mem-top-tabs" class="mem-top-tabs"></div>

      <div class="mem-top-controls">
        <div class="mem-search-row">
          <div class="mem-search-box">
            <span class="mem-search-icon">🔍</span>
            <input id="mem-search-input" type="text" placeholder="Поиск по всем вкладкам (для флешбека)..." />
            <span id="mem-search-clear" class="mem-search-clear" style="display:none;" title="Очистить поиск">✕</span>
          </div>
          <div id="mem-toggle-add" class="mem-toggle-add-btn" title="Добавить факт в текущую вкладку">+</div>
        </div>
      </div>

      <div id="mem-sheet-body" class="mem-sheet-body"></div>
    </div>
  `;

  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });

  document.getElementById('mem-close-modal').addEventListener('click', closeModal);
  document.getElementById('mem-run-extract').addEventListener('click', () => runExtraction(true));
  document.getElementById('mem-rollback-btn').addEventListener('click', rollbackSnapshot);

  document.getElementById('mem-mini-mascot-tap').addEventListener('click', () => {
    const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    const status = document.getElementById('mem-prompt-status');
    if (status) status.textContent = q;
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
  document.getElementById('memorize-modal-backdrop')?.classList.remove('open');
}

function renderFlashbackBanner(store) {
  const fb = store.activeFlashback;
  if (!fb || !fb.text?.trim()) return '';
  return `
    <div class="mem-flashback-banner">
      <div class="mem-fb-head">
        <span>📸 Флешбек выбран для персонажа</span>
        <span id="mem-cancel-fb" style="cursor:pointer;color:var(--mem-sub);font-weight:500;">✕ Снять</span>
      </div>
      <div class="mem-fb-quote">«${escapeHtml(fb.text)}»</div>
      <div class="mem-fb-actions">
        <span class="mem-fb-hint">Вплетается в следующий ответ бота</span>
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
  document.getElementById('mem-fire-fb-now')?.addEventListener('click', () => {
    triggerFlashbackNow();
  });
}

function renderModalContent() {
  const backdrop = document.getElementById('memorize-modal-backdrop');
  if (!backdrop) return;

  const store = getChatStore();
  const settings = getSettings();
  const promptText = buildPromptText();
  const tokens = estimateTokens(promptText);
  const qLower = searchQuery.trim().toLowerCase();

  const statusEl = document.getElementById('mem-prompt-status');
  if (statusEl) {
    if (settings.enabled && promptText) {
      statusEl.innerHTML = `<span class="mem-dot"></span><span>В промпте · ~${tokens} ток. (глубина ${settings.injectionDepth})</span>`;
    } else if (!settings.enabled) {
      statusEl.innerHTML = `<span class="mem-dot off"></span><span>Память выключена</span>`;
    } else {
      statusEl.innerHTML = `<span class="mem-dot off"></span><span>Пусто — нажмите «✨ Сжать»</span>`;
    }
  }

  // Верхняя плашка отдельных вкладок: События · Отношения · Секреты · Сцена · Хроника
  const topTabsBar = document.getElementById('mem-top-tabs');
  if (topTabsBar) {
    const chronCount = store.chapters.length + (store.coreCanon?.trim() ? 1 : 0);
    const tabs = [
      ...CATEGORY_KEYS.map((k) => ({
        key: k,
        label: `${CATEGORIES[k].icon} ${CATEGORIES[k].label}`,
        count: store.facts.filter((f) => normalizeCategory(f.category, f.text) === k).length,
      })),
      {
        key: 'chronicle',
        label: '📖 Хроника',
        count: chronCount,
      },
    ];

    topTabsBar.innerHTML = tabs
      .map(
        (t) => `
        <div class="mem-top-tab ${!qLower && activeTopTab === t.key ? 'active' : ''}" data-tab="${t.key}">
          <span>${escapeHtml(t.label)}</span>
          <span class="mem-tab-badge">${t.count}</span>
        </div>`
      )
      .join('');

    topTabsBar.querySelectorAll('.mem-top-tab').forEach((tabEl) => {
      tabEl.addEventListener('click', () => {
        activeTopTab = tabEl.dataset.tab || 'events';
        if (CATEGORY_KEYS.includes(activeTopTab)) {
          quickAddCat = activeTopTab;
        }
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
  }

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

              return `
              <div class="mem-fact-row ${f.locked ? 'locked' : ''} ${f.enabled === false ? 'muted' : ''} ${
                isArmed ? 'flashback-armed' : ''
              }" data-id="${escapeHtml(f.id)}">
                <span class="mem-cat-badge" title="${escapeHtml(catMeta.full)} (нажми, чтобы перенести в другую вкладку)">${
                catMeta.icon
              }</span>
                ${
                  isEditing
                    ? `<textarea rows="1" class="mem-fact-edit">${escapeHtml(f.text)}</textarea>`
                    : `<div class="mem-fact-text-view" title="Нажми, чтобы персонаж вспомнил этот момент">${highlightMatch(
                        f.text,
                        searchQuery
                      )}</div>`
                }
                <div class="mem-row-tools">
                  <span class="mem-mini-act act-edit" title="Редактировать">✎</span>
                  <span class="mem-mini-act act-pin ${f.locked ? 'pinned' : ''}" title="Закрепить от перезаписи">${
                f.locked ? '📌' : '📍'
              }</span>
                  <span class="mem-mini-act act-mute" title="Вкл/выкл в промпте">${
                    f.enabled === false ? '🙈' : '👁'
                  }</span>
                  <span class="mem-mini-act act-del" title="Удалить">✕</span>
                </div>
              </div>`;
            })
            .join('') +
          `</div>`;

    body.innerHTML = `${renderFlashbackBanner(store)}${quickAddHtml}${rowsHtml}`;
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
          store.activeFlashback = { id: fact.id, text: fact.text, firedCount: 0 };
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

      row.querySelector('.act-edit')?.addEventListener('click', async () => {
        if (editingFactId === fact.id && commitEdit) {
          await commitEdit();
          return;
        }
        editingFactId = editingFactId === fact.id ? null : fact.id;
        renderModalContent();
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
        await saveChatStore();
        renderModalContent();
      });

      row.querySelector('.act-del')?.addEventListener('click', async () => {
        if (editingFactId === fact.id) editingFactId = null;
        if (store.activeFlashback?.id === fact.id) store.activeFlashback = null;
        store.facts = store.facts.filter((x) => x.id !== id);
        await saveChatStore();
        renderModalContent();
      });
    });
    return;
  }

  // Вкладка «📖 Хроника»
  const chaptersHtml =
    store.chapters.length === 0
      ? `<div class="mem-empty-hint" style="padding:12px;">Главы появятся автоматически по мере продвижения ролевой ✨</div>`
      : store.chapters
          .map((ch, idx) => {
            const chId = ch.id || `ch_${idx}`;
            const isArmed = store.activeFlashback?.id === chId;
            return `
            <div class="mem-chapter-item ${isArmed ? 'flashback-armed' : ''}" data-idx="${idx}" style="${
              isArmed ? 'border-left-color:var(--mem-gold);background:rgba(255,217,125,0.08);' : ''
            }">
              <div class="mem-chapter-meta">
                <span>Сообщения ${escapeHtml(ch.range || `#${idx + 1}`)}</span>
                <div style="display:inline-flex;gap:4px;">
                  <span class="mem-mini-act ch-fb" title="Вызвать флешбек по этой главе">📸</span>
                  <span class="mem-mini-act ch-del" title="Удалить главу">✕</span>
                </div>
              </div>
              <textarea rows="1" class="mem-fact-edit ch-edit" style="background:transparent!important;border:none!important;padding:0;">${escapeHtml(
                ch.text
              )}</textarea>
            </div>`;
          })
          .join('');

  body.innerHTML = `
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
      <span>Последние главы</span>
      <span id="mem-toggle-preview" style="cursor:pointer;text-transform:none;font-weight:500;color:var(--mem-sub);">
        ${showPromptPreview ? 'Скрыть промпт ▴' : 'Что видит бот ▾'}
      </span>
    </div>

    ${showPromptPreview ? `<div class="mem-preview-box">${escapeHtml(promptText || 'Промпт памяти пока пуст.')}</div>` : ''}

    <div class="mem-clean-list">${chaptersHtml}</div>
  `;

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
        store.activeFlashback = { id: ch.id, text: ch.text, firedCount: 0 };
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
