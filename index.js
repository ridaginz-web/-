const MODULE_NAME = 'memorize_time_studio';
const PROMPT_KEY = 'memorize_time_studio_prompt';
const FLASHBACK_PROMPT_KEY = 'memorize_time_studio_flashback';
const LOCAL_API_KEY_STORAGE = 'memorize_studio_secret_api_key';
const LOCAL_MODELS_CACHE = 'memorize_studio_models_cache';

const MAX_RECENT_CHAPTERS = 4;
const MAX_AUTO_FACTS = 20;

const CATEGORIES = {
  events: { icon: '⏳', label: 'События', full: '⏳ События' },
  relations: { icon: '💞', label: 'Отношения', full: '💞 Отношения' },
  secrets: { icon: '🗝', label: 'Секреты', full: '🗝 Секреты и детали' },
  scene: { icon: '📍', label: 'Сцена', full: '📍 Текущая сцена' },
};
const CATEGORY_KEYS = Object.keys(CATEGORIES);

const QUOTES = [
  'Лу Гуан: «Нажми на любой факт — и персонаж вспомнит этот момент.»',
  'Чэн Сяоши: «Хлоп! Запускаем флешбек прямо в сцену 📸✨»',
  'Лу Гуан: «Старые главы сжаты в канон, контекст лёгкий.»',
  'Чэн Сяоши: «Закрепляй важные секреты булавочкой 📌!»',
];

const DEFAULT_EXTRACTION_PROMPT = `Ты — модуль долгосрочной памяти ролевой игры «Memorize».
Проанализируй НОВЫЕ сообщения чата с учётом текущей памяти и верни обновлённый слепок строго в JSON.

ПРАВИЛА ДЛЯ ДЛИННЫХ ЧАТОВ:
1. Пиши на русском языке, сухо, точно и без художественной воды (1 запись = 1 конкретный факт).
2. "new_chapter": краткая выжимка ТОЛЬКО новых сообщений из блока анализа (1-3 компактных предложения).
3. Распредели самые важные актуальные факты по 4 рубрикам (объединяй дубликаты, обновляй изменившиеся статусы и удаляй проходные мелочи, суммарно не более 18-20 пунктов):
   - "events": ключевые произошедшие события и повороты.
   - "relations": чувства, динамика близости/доверия, ссоры, флирт, договорённости между персонажами.
   - "secrets": признания, тайны, личные травмы/диагнозы, обещания, важные предметы и детали.
   - "scene": где сейчас находятся персонажи, время/обстановка и что происходит в моменте (1-3 пункта).
4. "core_canon": если передан список старых глав для уплотнения ("chapters_to_compress"), объедини их со старым "core_canon" в один плотный абзац (4-6 предложений) без потери канона. Иначе оставь "core_canon" как есть.
5. Верни ТОЛЬКО валидный JSON строго по схеме:

{
  "core_canon": "Сжатая основа прошлых арок сюжета (если есть)",
  "new_chapter": "Краткий итог новых проанализированных сообщений (1-3 предложения)",
  "events": ["Ключевое событие"],
  "relations": ["Статус отношений и чувств"],
  "secrets": ["Секрет, признание, деталь или обещание"],
  "scene": ["Текущая локация и ситуация"]
}`;

const DEFAULT_INJECTION_TEMPLATE = `[ДОЛГОСРОЧНАЯ ПАМЯТЬ ИСТОРИИ — учитывай эти события и факты из прошлых сцен]
{{canon_block}}
{{chapters_block}}
{{facts_block}}
[Конец блока памяти. Не противоречь указанным фактам.]`;

const DEFAULT_SETTINGS = {
  enabled: true,
  showChibi: true,
  mascotMode: 'duo', // 'duo' | 'lg' | 'cxs'
  autoExtract: true,
  everyNMessages: 16,
  scanWindow: 20,
  injectionPosition: 1, // 1 = IN_CHAT (@ depth)
  injectionDepth: 2,
  injectionRole: 0, // 0 = SYSTEM
  useCustomApi: false,
  customApiUrl: 'https://openrouter.ai/api/v1',
  customApiModel: '',
  customTemperature: 0.25,
  customMaxTokens: 1600,
  extractionPrompt: DEFAULT_EXTRACTION_PROMPT,
  injectionTemplate: DEFAULT_INJECTION_TEMPLATE,
  widgetPos: null,
};

let activeView = 'facts'; // 'facts' | 'chronicle'
let activeCategory = 'all'; // 'all' | 'events' | 'relations' | 'secrets' | 'scene'
let searchQuery = '';
let quickAddOpen = false;
let quickAddCat = 'events';
let editingFactId = null;
let showPromptPreview = false;
let isExtracting = false;
let bubbleTimer = null;
let modelFetchTimer = null;
let modelDropdownOpen = true;
let cachedModels = loadCachedModels();

function getST() {
  return window.SillyTavern?.getContext?.() || null;
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function uid(prefix = 'f') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function estimateTokens(text = '') {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 3.2));
}

function getApiKey() {
  return localStorage.getItem(LOCAL_API_KEY_STORAGE) || '';
}

function setApiKey(val) {
  if (!val) localStorage.removeItem(LOCAL_API_KEY_STORAGE);
  else localStorage.setItem(LOCAL_API_KEY_STORAGE, val.trim());
}

function loadCachedModels() {
  try {
    const raw = localStorage.getItem(LOCAL_MODELS_CACHE);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveCachedModels(list) {
  cachedModels = Array.isArray(list) ? list : [];
  try {
    localStorage.setItem(LOCAL_MODELS_CACHE, JSON.stringify(cachedModels.slice(0, 800)));
  } catch (_) {}
}

function normalizeBaseUrl(url = '') {
  return String(url)
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '');
}

function getSettings() {
  const ctx = getST();
  if (!ctx) return { ...DEFAULT_SETTINGS };
  if (!ctx.extensionSettings[MODULE_NAME]) {
    ctx.extensionSettings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
  }
  const s = ctx.extensionSettings[MODULE_NAME];
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (s[k] === undefined) s[k] = v;
  }
  return s;
}

function saveSettings() {
  getST()?.saveSettingsDebounced?.();
}

function inferFactCategory(text = '') {
  const t = String(text).toLowerCase();
  if (/признал|тайна|секрет|скрывал|диагноз|прл|шрам|травм|обеща|клятв|паспорт|прокол|ключ|подарок|письм|боится|страх|улик/i.test(t)) {
    return 'secrets';
  }
  if (/отношен|чувств|влюблен|любов|флирт|поцелу|обнял|ревн|довер|ссор|разрыв|близост|нежност|переписывал|видеосвяз|скуча|касани/i.test(t)) {
    return 'relations';
  }
  if (/сейчас|находятся|текущ|цель|направля|остановил|сидят в|в комнате|в общежит|обстановк/i.test(t)) {
    return 'scene';
  }
  return 'events';
}

function normalizeCategory(cat, fallbackText = '') {
  if (cat === 'clues') return 'secrets';
  if (cat && CATEGORIES[cat]) return cat;
  return inferFactCategory(fallbackText);
}

function highlightMatch(text = '', query = '') {
  const safe = escapeHtml(text);
  const q = String(query || '').trim();
  if (!q) return safe;
  const escapedQ = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(`(${escapedQ})`, 'gi'), '<span class="mem-hl">$1</span>');
}

/* === Хранилище памяти чата (с мягкой миграцией старых версий и авто-рубриками) === */
function getChatStore() {
  const ctx = getST();
  if (!ctx || !ctx.chatMetadata) {
    return {
      coreCanon: '',
      chapters: [],
      facts: [],
      activeFlashback: null,
      lastProcessedIndex: 0,
      previousSnapshot: null,
    };
  }
  if (!ctx.chatMetadata[MODULE_NAME]) {
    ctx.chatMetadata[MODULE_NAME] = {
      coreCanon: '',
      chapters: [],
      facts: [],
      activeFlashback: null,
      lastProcessedIndex: 0,
      previousSnapshot: null,
    };
  }
  const store = ctx.chatMetadata[MODULE_NAME];

  if (typeof store.coreCanon !== 'string') {
    store.coreCanon = typeof store.summary === 'string' ? store.summary : '';
    delete store.summary;
  }
  if (!Array.isArray(store.chapters)) store.chapters = [];
  if (!Array.isArray(store.facts)) store.facts = [];
  if (store.activeFlashback === undefined) store.activeFlashback = null;
  if (typeof store.lastProcessedIndex !== 'number') store.lastProcessedIndex = 0;

  // Авто-восстановление категорий для фактов из прошлых версий
  for (const f of store.facts) {
    if (f && typeof f === 'object') {
      f.category = normalizeCategory(f.category, f.text);
    }
  }

  return store;
}

async function saveChatStore() {
  const ctx = getST();
  updateInjection();
  updateWidgetBadge();
  if (ctx?.saveMetadata) {
    await ctx.saveMetadata();
  }
}

/* === Сборка текста, память и Флешбек в промпт бота === */
function buildPromptText() {
  const settings = getSettings();
  if (!settings.enabled) return '';

  const store = getChatStore();
  const canon = (store.coreCanon || '').trim();
  const activeChapters = store.chapters.filter((c) => c.text?.trim());
  const activeFacts = store.facts.filter((f) => f.enabled !== false && f.text?.trim());

  if (!canon && activeChapters.length === 0 && activeFacts.length === 0) return '';

  const canonBlock = canon ? `Основа прошлых событий:\n${canon}` : '';

  const chaptersBlock =
    activeChapters.length > 0
      ? `Хроника последних сцен:\n` +
        activeChapters.map((c) => `• [${c.range || 'Сцена'}] ${c.text.trim()}`).join('\n')
      : '';

  const grouped = [];
  for (const catKey of CATEGORY_KEYS) {
    const items = activeFacts.filter((f) => normalizeCategory(f.category, f.text) === catKey);
    if (items.length > 0) {
      grouped.push(`${CATEGORIES[catKey].full}:\n` + items.map((f) => `- ${f.text.trim()}`).join('\n'));
    }
  }
  const factsBlock = grouped.join('\n\n');

  return (settings.injectionTemplate || DEFAULT_INJECTION_TEMPLATE)
    .replace('{{canon_block}}', canonBlock)
    .replace('{{chapters_block}}', chaptersBlock)
    .replace('{{facts_block}}', factsBlock)
    .replace('{{summary_block}}', canonBlock)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildFlashbackPrompt() {
  const settings = getSettings();
  if (!settings.enabled) return '';
  const store = getChatStore();
  const fb = store.activeFlashback;
  if (!fb || !fb.text?.trim()) return '';

  return `[ФОКУС ПАМЯТИ — ФЛЕШБЕК ПЕРСОНАЖА]
В своём СЛЕДУЮЩЕМ ответе персонаж ({{char}}) должен живо и естественно вспомнить этот момент или факт из прошлого:
«${fb.text.trim()}»
Органично вплети это воспоминание в текущую сцену — через внезапную ассоциацию, взгляд, деталь, внутреннюю мысль, эмоцию или прямую реплику, сохраняя характер {{char}} и не ломая ход ролевой.`;
}

function updateInjection() {
  const ctx = getST();
  if (!ctx?.setExtensionPrompt) return;

  const settings = getSettings();
  const text = buildPromptText();
  const pos = Number(settings.injectionPosition) ?? 1;
  const depth = Number(settings.injectionDepth) ?? 2;
  const role = Number(settings.injectionRole) ?? 0;

  if (!settings.enabled || !text) {
    ctx.setExtensionPrompt(PROMPT_KEY, '', pos, depth, false, role);
  } else {
    ctx.setExtensionPrompt(PROMPT_KEY, text, pos, depth, false, role);
  }

  // Инжект активного флешбека прямо перед генерацией (Depth = 0)
  const fbText = buildFlashbackPrompt();
  ctx.setExtensionPrompt(FLASHBACK_PROMPT_KEY, fbText || '', 1, 0, false, 0);
}

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

/* === Свой API и авто-подгрузка скролл-списка моделей === */
async function callCustomLLM(promptText) {
  const s = getSettings();
  const baseUrl = normalizeBaseUrl(s.customApiUrl);
  const apiKey = getApiKey();
  const model = (s.customApiModel || '').trim();

  if (!baseUrl) throw new Error('Укажите API Base URL');
  if (!apiKey) throw new Error('Укажите API Key');
  if (!model) throw new Error('Выберите модель из списка в настройках');

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: Number(s.customTemperature) ?? 0.25,
      max_tokens: Number(s.customMaxTokens) || 1500,
      messages: [
        { role: 'system', content: 'Отвечай строго валидным JSON без лишнего текста.' },
        { role: 'user', content: promptText },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${errBody.slice(0, 100)}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function fetchModelsAutomatically(silent = false) {
  const statusEl = document.getElementById('mem_cfg_api_status');
  const s = getSettings();
  const baseUrl = normalizeBaseUrl(s.customApiUrl);
  const apiKey = getApiKey();

  if (!baseUrl || !apiKey) {
    if (!silent && statusEl) statusEl.textContent = 'Введите API URL и ключ — список моделей появится сам.';
    renderModelPickerList();
    return;
  }

  if (statusEl) statusEl.textContent = '⏳ Загружаем список моделей...';

  try {
    const res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const rawList = Array.isArray(json?.data)
      ? json.data.map((m) => (typeof m === 'string' ? m : m?.id)).filter(Boolean)
      : Array.isArray(json?.models)
      ? json.models.map((m) => (typeof m === 'string' ? m : m?.id || m?.name)).filter(Boolean)
      : [];

    const sorted = Array.from(new Set(rawList)).sort((a, b) => a.localeCompare(b));
    saveCachedModels(sorted);

    // Если модель ещё не выбрана — сразу выбираем первую подходящую
    if (!s.customApiModel && sorted.length > 0) {
      s.customApiModel = sorted[0];
      saveSettings();
    }

    modelDropdownOpen = true;
    renderModelPickerList();

    if (statusEl) {
      statusEl.textContent = sorted.length
        ? `✅ Подключено · Доступно моделей: ${sorted.length}`
        : '✅ Ключ принят (список пуст — введите модель в поиск ниже)';
    }
  } catch (err) {
    renderModelPickerList();
    if (statusEl) statusEl.textContent = `❌ Не удалось загрузить модели (${err.message})`;
  }
}

function scheduleAutoModelFetch() {
  clearTimeout(modelFetchTimer);
  modelFetchTimer = setTimeout(() => fetchModelsAutomatically(true), 550);
}

function renderModelPickerList() {
  const host = document.getElementById('mem_model_picker_host');
  if (!host) return;

  const s = getSettings();
  const searchInput = document.getElementById('mem_model_search_input');
  const query = (searchInput?.value || '').trim().toLowerCase();

  const currentLabel = s.customApiModel || 'Нажмите, чтобы выбрать модель...';
  const filtered = query
    ? cachedModels.filter((id) => id.toLowerCase().includes(query))
    : cachedModels;

  // Если контейнера ещё нет — создаём каркас, чтобы не сбивать фокус при вводе поиска
  if (!document.getElementById('mem_selected_model_bar')) {
    host.innerHTML = `
      <div class="mem-model-picker">
        <div id="mem_selected_model_bar" class="mem-selected-model-bar" title="Нажмите, чтобы свернуть/развернуть список">
          <span id="mem_selected_model_text"></span>
          <span id="mem_selected_model_arrow" style="opacity:0.75;font-size:11px;">▾</span>
        </div>
        <div id="mem_model_dropdown" class="mem-model-dropdown">
          <input id="mem_model_search_input" class="text_pole" type="text" placeholder="🔍 Быстрый поиск или своё имя модели..." style="margin:0;font-size:12px;padding:5px 8px;" />
          <div id="mem_model_scroll_list" class="mem-model-list"></div>
        </div>
      </div>
    `;

    document.getElementById('mem_selected_model_bar').addEventListener('click', () => {
      modelDropdownOpen = !modelDropdownOpen;
      renderModelPickerList();
    });

    document.getElementById('mem_model_search_input').addEventListener('input', () => {
      renderModelPickerList();
    });
  }

  const textEl = document.getElementById('mem_selected_model_text');
  const arrowEl = document.getElementById('mem_selected_model_arrow');
  const dropdownEl = document.getElementById('mem_model_dropdown');
  const listEl = document.getElementById('mem_model_scroll_list');

  if (textEl) textEl.textContent = `🤖 ${currentLabel}`;
  if (arrowEl) arrowEl.textContent = modelDropdownOpen ? '▴' : '▾';
  if (dropdownEl) dropdownEl.style.display = modelDropdownOpen ? 'flex' : 'none';
  if (!listEl) return;

  const rawTyped = (document.getElementById('mem_model_search_input')?.value || '').trim();
  const optionsHtml = [];

  if (rawTyped && !cachedModels.includes(rawTyped)) {
    optionsHtml.push(`
      <div class="mem-model-option" data-model="${escapeHtml(rawTyped)}">
        <span>✨ Использовать: <b>${escapeHtml(rawTyped)}</b></span>
        <span>↵</span>
      </div>
    `);
  }

  for (const id of filtered) {
    const isSel = id === s.customApiModel;
    optionsHtml.push(`
      <div class="mem-model-option ${isSel ? 'selected' : ''}" data-model="${escapeHtml(id)}">
        <span>${escapeHtml(id)}</span>
        <span>${isSel ? '✓' : ''}</span>
      </div>
    `);
  }

  if (optionsHtml.length === 0) {
    listEl.innerHTML = `<div style="padding:8px;font-size:11.5px;opacity:0.7;text-align:center;">Список пока пуст — введите URL и API Key выше</div>`;
    return;
  }

  listEl.innerHTML = optionsHtml.join('');
  listEl.querySelectorAll('.mem-model-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      const picked = opt.dataset.model;
      if (!picked) return;
      getSettings().customApiModel = picked;
      saveSettings();
      renderModelPickerList();
    });
  });
}

/* === Разбор ответа LLM и многоуровневое сжатие для больших чатов === */
function parseMemoryOutput(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      const categorized = [];

      for (const catKey of CATEGORY_KEYS) {
        if (Array.isArray(parsed[catKey])) {
          for (const item of parsed[catKey]) {
            const t = String(item || '').trim();
            if (t) categorized.push({ category: catKey, text: t });
          }
        }
      }
      if (Array.isArray(parsed.clues)) {
        for (const item of parsed.clues) {
          const t = String(item || '').trim();
          if (t) categorized.push({ category: 'secrets', text: t });
        }
      }
      if (categorized.length === 0 && Array.isArray(parsed.facts)) {
        for (const item of parsed.facts) {
          const t = String(item || '').trim();
          if (t) categorized.push({ category: inferFactCategory(t), text: t });
        }
      }

      return {
        core_canon:
          typeof parsed.core_canon === 'string'
            ? parsed.core_canon.trim()
            : typeof parsed.summary === 'string'
            ? parsed.summary.trim()
            : '',
        new_chapter: typeof parsed.new_chapter === 'string' ? parsed.new_chapter.trim() : '',
        facts: categorized,
      };
    } catch (_) {}
  }

  const lines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-•*]\s+/.test(l))
    .map((l) => l.replace(/^[-•*]\s+/, '').trim());

  if (lines.length > 0) {
    return {
      core_canon: '',
      new_chapter: '',
      facts: lines.map((t) => ({ category: inferFactCategory(t), text: t })),
    };
  }
  return null;
}

async function runExtraction(manual = false) {
  const ctx = getST();
  if (!ctx || isExtracting) return;

  const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
  const validMessages = chat
    .map((m, idx) => ({ m, idx }))
    .filter(({ m }) => m && !m.is_system && typeof m.mes === 'string' && m.mes.trim());

  if (validMessages.length === 0) {
    if (manual) showBubble('Пока нет сообщений для памяти ✨');
    return;
  }

  const settings = getSettings();
  const store = getChatStore();

  let slice = validMessages.filter(({ idx }) => idx >= store.lastProcessedIndex);
  let isRescanTail = false;
  if (slice.length === 0) {
    if (!manual) return;
    isRescanTail = true;
    const count = Math.max(4, Number(settings.scanWindow) || 20);
    slice = validMessages.slice(-count);
  } else if (slice.length > 35) {
    slice = slice.slice(-35);
  }

  const fromMsg = slice[0].idx + 1;
  const toMsg = slice[slice.length - 1].idx + 1;
  const rangeLabel = `#${fromMsg}–${toMsg}`;

  const formattedChat = slice
    .map(({ m }) => `${m.name || (m.is_user ? 'User' : 'Char')}: ${m.mes.trim()}`)
    .join('\n\n');

  let chaptersToCompress = [];
  let chaptersToKeep = [...store.chapters];
  if (store.chapters.length >= MAX_RECENT_CHAPTERS && !isRescanTail) {
    const cutCount = store.chapters.length - (MAX_RECENT_CHAPTERS - 2);
    chaptersToCompress = store.chapters.slice(0, cutCount);
    chaptersToKeep = store.chapters.slice(cutCount);
  }

  const groupedCurrent = {};
  for (const catKey of CATEGORY_KEYS) {
    groupedCurrent[catKey] = store.facts
      .filter((f) => f.enabled !== false && normalizeCategory(f.category, f.text) === catKey)
      .map((f) => f.text);
  }

  const payloadContext = {
    core_canon: store.coreCanon || '',
    chapters_to_compress: chaptersToCompress.map((c) => `[${c.range}] ${c.text}`),
    recent_chapters: chaptersToKeep.map((c) => `[${c.range}] ${c.text}`),
    ...groupedCurrent,
  };

  const fullPrompt = `${settings.extractionPrompt || DEFAULT_EXTRACTION_PROMPT}

ТЕКУЩАЯ ПАМЯТЬ ЧАТА:
${JSON.stringify(payloadContext, null, 2)}

НОВЫЕ СООБЩЕНИЯ ЧАТА (${rangeLabel}):
${formattedChat}`;

  try {
    isExtracting = true;
    setSyncingState(true);
    showBubble('Синхронизируем память... ✨', 6000);

    let rawResult = '';
    if (settings.useCustomApi) {
      rawResult = await callCustomLLM(fullPrompt);
    } else {
      if (typeof ctx.generateRaw === 'function') {
        try {
          rawResult = await ctx.generateRaw({
            prompt: fullPrompt,
            systemPrompt: 'Отвечай строго валидным JSON без лишнего текста.',
          });
        } catch (_) {
          rawResult = '';
        }
      }
      if (!rawResult && typeof ctx.generateQuietPrompt === 'function') {
        rawResult = await ctx.generateQuietPrompt({ quietPrompt: fullPrompt });
      }
    }

    const parsed = parseMemoryOutput(rawResult);
    if (!parsed) {
      showBubble('Не удалось разобрать JSON ответа 😿');
      return;
    }

    store.previousSnapshot = JSON.stringify({
      coreCanon: store.coreCanon,
      chapters: store.chapters,
      facts: store.facts,
      lastProcessedIndex: store.lastProcessedIndex,
    });

    if (parsed.core_canon) {
      store.coreCanon = parsed.core_canon;
    } else if (chaptersToCompress.length > 0) {
      const joinedOld = chaptersToCompress.map((c) => c.text).join(' ');
      store.coreCanon = [store.coreCanon, joinedOld].filter(Boolean).join(' ');
    }

    if (parsed.new_chapter) {
      if (isRescanTail && chaptersToKeep.length > 0 && chaptersToKeep[chaptersToKeep.length - 1].range === rangeLabel) {
        chaptersToKeep[chaptersToKeep.length - 1].text = parsed.new_chapter;
      } else {
        chaptersToKeep.push({
          id: uid('ch'),
          range: rangeLabel,
          text: parsed.new_chapter,
        });
      }
    }
    store.chapters = chaptersToKeep;

    const lockedFacts = store.facts.filter((f) => f.locked);
    const seen = new Set(lockedFacts.map((f) => f.text.trim().toLowerCase()));
    const nextFacts = [...lockedFacts];

    for (const entry of parsed.facts.slice(0, MAX_AUTO_FACTS)) {
      const clean = String(entry?.text || '').trim();
      if (!clean || seen.has(clean.toLowerCase())) continue;
      seen.add(clean.toLowerCase());
      nextFacts.push({
        id: uid('f'),
        category: normalizeCategory(entry.category, clean),
        text: clean,
        enabled: true,
        locked: false,
      });
    }

    store.facts = nextFacts;
    store.lastProcessedIndex = chat.length;
    await saveChatStore();
    renderModalContent();
    showBubble(`Память обновлена (${store.facts.length}) ✨`, 3000);
  } catch (err) {
    console.error('[Memorize] Extraction error:', err);
    showBubble(`Ошибка API: ${err.message || 'проверьте настройки'}`);
  } finally {
    isExtracting = false;
    setSyncingState(false);
  }
}

async function rollbackSnapshot() {
  const store = getChatStore();
  if (!store.previousSnapshot) {
    showBubble('Откатывать пока нечего ⏳');
    return;
  }
  try {
    const prev = JSON.parse(store.previousSnapshot);
    store.coreCanon = prev.coreCanon ?? prev.summary ?? '';
    store.chapters = Array.isArray(prev.chapters) ? prev.chapters : [];
    store.facts = Array.isArray(prev.facts) ? prev.facts : [];
    store.lastProcessedIndex = prev.lastProcessedIndex || 0;
    store.previousSnapshot = null;
    await saveChatStore();
    renderModalContent();
    showBubble('Лу Гуан вернул прошлый слепок ⏳');
  } catch (e) {
    console.error('[Memorize] Rollback error:', e);
  }
}

/* === Кавайные Моти-Чибики (в формате пухлого стикера-фамильяра) === */
function getLuGuangMochiGroup() {
  return `
    <!-- Пушистые кошачьи ушки Лу Гуана -->
    <path d="M18 27 C14 13, 23 9, 32 18 Z" fill="#f3f7ff" stroke="#241e32" stroke-width="2.7" stroke-linejoin="round"/>
    <path d="M20.5 23.5 C18.8 16, 23.5 14, 28.5 19 Z" fill="#ffb6cd"/>
    <path d="M62 27 C66 13, 57 9, 48 18 Z" fill="#f3f7ff" stroke="#241e32" stroke-width="2.7" stroke-linejoin="round"/>
    <path d="M59.5 23.5 C61.2 16, 56.5 14, 51.5 19 Z" fill="#ffb6cd"/>

    <!-- Маленькие круглые ножки -->
    <ellipse cx="32" cy="70" rx="5.2" ry="3.5" fill="#d7e4ff" stroke="#241e32" stroke-width="2.5"/>
    <ellipse cx="48" cy="70" rx="5.2" ry="3.5" fill="#d7e4ff" stroke="#241e32" stroke-width="2.5"/>

    <!-- Пухлое моти-тельце с полосатым животиком и часами -->
    <path d="M24.5 50 C22.5 63, 28 70, 40 70 C52 70, 57.5 63, 55.5 50 Z" fill="#eef4ff" stroke="#241e32" stroke-width="2.6" stroke-linejoin="round"/>
    <ellipse cx="40" cy="59.5" rx="9.5" ry="7.8" fill="#c7dcff"/>
    <circle cx="40" cy="59.5" r="4.2" fill="#ffe184" stroke="#241e32" stroke-width="2"/>
    <path d="M40 57.5 V59.6 L41.5 60.6" stroke="#5c4018" stroke-width="1.4" stroke-linecap="round" fill="none"/>

    <!-- Круглые лапки -->
    <ellipse cx="26" cy="57.5" rx="4.5" ry="3.4" transform="rotate(20 26 57.5)" fill="#fff7f4" stroke="#241e32" stroke-width="2.4"/>
    <ellipse cx="54" cy="57.5" rx="4.5" ry="3.4" transform="rotate(-20 54 57.5)" fill="#fff7f4" stroke="#241e32" stroke-width="2.4"/>

    <!-- Широкая пухлая моти-щёчкастая голова -->
    <ellipse cx="40" cy="36.5" rx="24" ry="19" fill="#fff4ee" stroke="#241e32" stroke-width="2.7"/>

    <!-- Мягкая округлая серебристая чёлка-облачко -->
    <path d="M16 35 C15.5 19, 26.5 15.5, 40 15.5 C53.5 15.5, 64.5 19, 64 35 C61 29.5, 57 28.5, 53.5 32 C49.5 26, 44 26, 40 32 C36 26, 30.5 26, 26.5 32 C23 28.5, 19 29.5, 16 35 Z" fill="#f0f5ff" stroke="#241e32" stroke-width="2.5" stroke-linejoin="round"/>

    <!-- Розовые румяные щёчки -->
    <ellipse cx="23.2" cy="44" rx="4.8" ry="2.7" fill="#ff9ebb" opacity="0.82"/>
    <ellipse cx="56.8" cy="44" rx="4.8" ry="2.7" fill="#ff9ebb" opacity="0.82"/>

    <!-- Большие блестящие глаза-бусинки -->
    <ellipse cx="29.5" cy="40" rx="4.5" ry="5" fill="#24233a"/>
    <ellipse cx="50.5" cy="40" rx="4.5" ry="5" fill="#24233a"/>
    <ellipse class="mem-eye-glow" cx="29.5" cy="41.6" rx="3.2" ry="2.6" fill="#82afff"/>
    <ellipse class="mem-eye-glow" cx="50.5" cy="41.6" rx="3.2" ry="2.6" fill="#82afff"/>
    <circle cx="27.8" cy="38" r="1.8" fill="#ffffff"/>
    <circle cx="31.3" cy="42.4" r="0.85" fill="#ffffff"/>
    <circle cx="48.8" cy="38" r="1.8" fill="#ffffff"/>
    <circle cx="52.3" cy="42.4" r="0.85" fill="#ffffff"/>

    <!-- Милый кошачий ротик ω -->
    <path d="M37 44 Q38.5 45.8 40 44.1 Q41.5 45.8 43 44" fill="none" stroke="#241e32" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
  `;
}

function getChengXiaoshiMochiGroup() {
  return `
    <!-- Мягкие висячие щенячьи ушки Чэн Сяоши -->
    <path d="M21 22 C10.5 20, 8.5 32, 15.5 36.5 C18.8 38, 21 31, 22 25 Z" fill="#634239" stroke="#241e32" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M59 22 C69.5 20, 71.5 32, 64.5 36.5 C61.2 38, 59 31, 58 25 Z" fill="#634239" stroke="#241e32" stroke-width="2.6" stroke-linejoin="round"/>

    <!-- Маленькие ножки -->
    <ellipse cx="32" cy="70" rx="5.2" ry="3.5" fill="#3d3852" stroke="#241e32" stroke-width="2.5"/>
    <ellipse cx="48" cy="70" rx="5.2" ry="3.5" fill="#3d3852" stroke="#241e32" stroke-width="2.5"/>

    <!-- Пухлое моти-тельце в худи с мини-камерой -->
    <path d="M24.5 50 C22.5 63, 28 70, 40 70 C52 70, 57.5 63, 55.5 50 Z" fill="#3b374f" stroke="#241e32" stroke-width="2.6" stroke-linejoin="round"/>
    <ellipse cx="40" cy="59.5" rx="9.2" ry="7.6" fill="#fff6f0"/>
    <rect x="34.2" y="55.2" width="11.6" height="8.2" rx="2.6" fill="#526080" stroke="#241e32" stroke-width="1.9"/>
    <circle cx="40" cy="59.3" r="2.3" fill="#9bc2ff"/>

    <!-- Круглые лапки -->
    <ellipse cx="26" cy="57.5" rx="4.5" ry="3.4" transform="rotate(20 26 57.5)" fill="#fff2e8" stroke="#241e32" stroke-width="2.4"/>
    <ellipse cx="54" cy="57.5" rx="4.5" ry="3.4" transform="rotate(-20 54 57.5)" fill="#fff2e8" stroke="#241e32" stroke-width="2.4"/>

    <!-- Широкая пухлая моти-голова -->
    <ellipse cx="40" cy="36.5" rx="24" ry="19" fill="#fff1e6" stroke="#241e32" stroke-width="2.7"/>

    <!-- Задорный хохолок-завиток и каштановая мягкая чёлка -->
    <path d="M39 15.5 C37 8.5, 45.5 7.5, 44.5 14" fill="none" stroke="#241e32" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M16 35 C15.5 19, 26.5 15.5, 40 15.5 C53.5 15.5, 64.5 19, 64 35 C61 29, 56.5 28.5, 53 32 C49.5 26, 44 26.5, 40 32.2 C36 26.5, 30.5 26, 27 32 C23.5 28.5, 19 29, 16 35 Z" fill="#5e3e36" stroke="#241e32" stroke-width="2.5" stroke-linejoin="round"/>

    <!-- Румяные розовые щёчки -->
    <ellipse cx="23.2" cy="44" rx="4.8" ry="2.7" fill="#ff94b2" opacity="0.86"/>
    <ellipse cx="56.8" cy="44" rx="4.8" ry="2.7" fill="#ff94b2" opacity="0.86"/>

    <!-- Сияющие тёпло-янтарные глазки -->
    <ellipse cx="29.5" cy="40" rx="4.6" ry="5.1" fill="#261b22"/>
    <ellipse cx="50.5" cy="40" rx="4.6" ry="5.1" fill="#261b22"/>
    <ellipse class="mem-eye-glow" cx="29.5" cy="41.7" rx="3.3" ry="2.7" fill="#f3a24c"/>
    <ellipse class="mem-eye-glow" cx="50.5" cy="41.7" rx="3.3" ry="2.7" fill="#f3a24c"/>
    <circle cx="27.7" cy="37.9" r="1.85" fill="#ffffff"/>
    <circle cx="31.3" cy="42.4" r="0.85" fill="#ffffff"/>
    <circle cx="48.7" cy="37.9" r="1.85" fill="#ffffff"/>
    <circle cx="52.3" cy="42.4" r="0.85" fill="#ffffff"/>

    <!-- Радостная улыбка -->
    <path d="M36.8 43.2 Q40 47.2 43.2 43.2 Z" fill="#ff8da6" stroke="#241e32" stroke-width="2" stroke-linejoin="round"/>
  `;
}

function getMascotSVG(mode = 'duo') {
  if (mode === 'lg') {
    return `<svg viewBox="8 6 64 69" xmlns="http://www.w3.org/2000/svg">${getLuGuangMochiGroup()}</svg>`;
  }
  if (mode === 'cxs') {
    return `<svg viewBox="8 6 64 69" xmlns="http://www.w3.org/2000/svg">${getChengXiaoshiMochiGroup()}</svg>`;
  }
  return `
    <svg viewBox="6 5 120 71" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0, 1) rotate(-3 40 45)">${getLuGuangMochiGroup()}</g>
      <g transform="translate(46, 1) rotate(3 40 45)">${getChengXiaoshiMochiGroup()}</g>
    </svg>
  `;
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
          <div id="mem-mini-mascot-tap" style="width:34px;height:34px;cursor:pointer;flex-shrink:0;" title="Погладить маскота">${getMascotSVG('lg')}</div>
          <div class="mem-header-title">
            <strong>Память чата</strong>
            <div id="mem-prompt-status" class="mem-prompt-pill"></div>
          </div>
        </div>
        <div id="mem-close-modal" class="mem-close-x" title="Закрыть">✕</div>
      </div>

      <div class="mem-nav-row">
        <div class="mem-segmented">
          <div id="mem-seg-facts" class="mem-seg-item active">Факты</div>
          <div id="mem-seg-chronicle" class="mem-seg-item">Хроника</div>
        </div>
        <div class="mem-actions-inline">
          <div id="mem-run-extract" class="mem-chip accent" title="Сжать новые сообщения сейчас">✨ Сжать</div>
          <div id="mem-rollback-btn" class="mem-chip" title="Откат Лу Гуана к прошлому снимку">⏪</div>
          <div id="mem-clear-all" class="mem-chip" title="Очистить память этого чата">🗑</div>
        </div>
      </div>

      <div class="mem-top-controls">
        <div class="mem-search-row">
          <div class="mem-search-box">
            <span class="mem-search-icon">🔍</span>
            <input id="mem-search-input" type="text" placeholder="Найти момент для флешбека..." />
            <span id="mem-search-clear" class="mem-search-clear" style="display:none;" title="Очистить поиск">✕</span>
          </div>
          <div id="mem-toggle-add" class="mem-toggle-add-btn" title="Добавить факт вручную">+</div>
        </div>
        <div id="mem-cat-strip" class="mem-cat-strip"></div>
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
    if (!confirm('Очистить память только для текущего чата?')) return;
    const store = getChatStore();
    store.previousSnapshot = JSON.stringify(store);
    store.coreCanon = '';
    store.chapters = [];
    store.facts = [];
    store.activeFlashback = null;
    store.lastProcessedIndex = 0;
    await saveChatStore();
    renderModalContent();
  });

  document.getElementById('mem-seg-facts').addEventListener('click', () => {
    activeView = 'facts';
    renderModalContent();
  });

  document.getElementById('mem-seg-chronicle').addEventListener('click', () => {
    activeView = 'chronicle';
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
    quickAddOpen = !quickAddOpen;
    if (quickAddOpen && activeCategory !== 'all') {
      quickAddCat = activeCategory;
    }
    renderModalContent();
    if (quickAddOpen) {
      setTimeout(() => document.getElementById('mem-quick-fact-input')?.focus(), 40);
    }
  });
}

function openModal() {
  createModal();
  renderModalContent();
  document.getElementById('memorize-modal-backdrop')?.classList.add('open');
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

  // Статус инжекта в промпт
  const statusEl = document.getElementById('mem-prompt-status');
  if (statusEl) {
    if (settings.enabled && promptText) {
      statusEl.innerHTML = `<span class="mem-dot"></span><span>В промпте бота · ~${tokens} ток. (глубина ${settings.injectionDepth})</span>`;
    } else if (!settings.enabled) {
      statusEl.innerHTML = `<span class="mem-dot off"></span><span>Память выключена в настройках</span>`;
    } else {
      statusEl.innerHTML = `<span class="mem-dot off"></span><span>Пока пусто — нажмите «✨ Сжать»</span>`;
    }
  }

  const segFacts = document.getElementById('mem-seg-facts');
  const segChron = document.getElementById('mem-seg-chronicle');
  if (segFacts) {
    segFacts.textContent = `Факты (${store.facts.length})`;
    segFacts.classList.toggle('active', activeView === 'facts');
  }
  if (segChron) {
    segChron.textContent = `Хроника (${store.chapters.length + (store.coreCanon?.trim() ? 1 : 0)})`;
    segChron.classList.toggle('active', activeView === 'chronicle');
  }

  const addToggleBtn = document.getElementById('mem-toggle-add');
  if (addToggleBtn) {
    addToggleBtn.classList.toggle('open', quickAddOpen);
    addToggleBtn.style.display = activeView === 'facts' ? 'inline-flex' : 'none';
  }

  // Вкладки категорий: Все · События · Отношения · Секреты · Сцена
  const catStrip = document.getElementById('mem-cat-strip');
  if (catStrip) {
    if (activeView !== 'facts') {
      catStrip.style.display = 'none';
    } else {
      catStrip.style.display = 'flex';
      const pills = [
        { key: 'all', label: 'Все', count: store.facts.length },
        ...CATEGORY_KEYS.map((k) => ({
          key: k,
          label: `${CATEGORIES[k].icon} ${CATEGORIES[k].label}`,
          count: store.facts.filter((f) => normalizeCategory(f.category, f.text) === k).length,
        })),
      ];

      catStrip.innerHTML = pills
        .map(
          (p) => `
          <div class="mem-cat-pill ${activeCategory === p.key ? 'active' : ''}" data-cat="${p.key}">
            <span>${escapeHtml(p.label)}</span>
            <span class="mem-cat-count">${p.count}</span>
          </div>`
        )
        .join('');

      catStrip.querySelectorAll('.mem-cat-pill').forEach((pill) => {
        pill.addEventListener('click', () => {
          activeCategory = pill.dataset.cat || 'all';
          if (activeCategory !== 'all') quickAddCat = activeCategory;
          renderModalContent();
        });
      });
    }
  }

  const body = document.getElementById('mem-sheet-body');
  if (!body) return;

  if (activeView === 'facts') {
    const filtered = store.facts.filter((f) => {
      const catOk = activeCategory === 'all' || normalizeCategory(f.category, f.text) === activeCategory;
      const searchOk = !qLower || String(f.text || '').toLowerCase().includes(qLower);
      return catOk && searchOk;
    });

    const quickAddHtml = quickAddOpen
      ? `
      <div class="mem-quick-add">
        <span id="mem-quick-cat-btn" class="mem-quick-cat-cycle" title="Сменить рубрику факта">
          ${CATEGORIES[quickAddCat]?.icon || '⏳'} ${CATEGORIES[quickAddCat]?.label || 'События'}
        </span>
        <input id="mem-quick-fact-input" type="text" placeholder="Новый важный факт..." />
        <div id="mem-quick-fact-btn" class="mem-quick-add-btn">＋</div>
      </div>`
      : '';

    const rowsHtml =
      filtered.length === 0
        ? `<div class="mem-empty-hint">${
            qLower
              ? 'По этому запросу фактов не нашлось 🔍'
              : 'В этой вкладке пока пусто.<br>Нажмите <b>«✨ Сжать»</b> вверху или <b>«+»</b>, чтобы добавить факт.'
          }</div>`
        : `<div class="mem-subhint">💡 Нажми на текст факта — и персонаж вспомнит этот момент (Флешбек)</div>
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
                <span class="mem-cat-badge" title="${escapeHtml(catMeta.full)} (нажми, чтобы сменить рубрику)">${
                catMeta.icon
              }</span>
                ${
                  isEditing
                    ? `<textarea rows="1" class="mem-fact-edit">${escapeHtml(f.text)}</textarea>`
                    : `<div class="mem-fact-text-view" title="Нажми, чтобы вызвать флешбек у персонажа">${highlightMatch(
                        f.text,
                        searchQuery
                      )}</div>`
                }
                <div class="mem-row-tools">
                  <span class="mem-mini-act act-edit" title="Редактировать текст">✎</span>
                  <span class="mem-mini-act act-pin ${f.locked ? 'pinned' : ''}" title="Закрепить от перезаписи">${
                f.locked ? '📌' : '📍'
              }</span>
                  <span class="mem-mini-act act-mute" title="Вкл/выкл в общем промпте">${
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
      store.facts.unshift({
        id: uid('f'),
        category: quickAddCat || 'events',
        text: val,
        enabled: true,
        locked: true,
      });
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
      if (editTa) {
        autoResizeTextarea(editTa);
        editTa.focus();
        editTa.addEventListener('input', () => autoResizeTextarea(editTa));
        const commitEdit = async () => {
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
            editTa.blur();
          }
        });
      }

      row.querySelector('.act-edit')?.addEventListener('click', () => {
        editingFactId = editingFactId === fact.id ? null : fact.id;
        renderModalContent();
      });

      row.querySelector('.act-pin')?.addEventListener('click', async () => {
        fact.locked = !fact.locked;
        await saveChatStore();
        renderModalContent();
      });

      row.querySelector('.act-mute')?.addEventListener('click', async () => {
        fact.enabled = fact.enabled === false;
        await saveChatStore();
        renderModalContent();
      });

      row.querySelector('.act-del')?.addEventListener('click', async () => {
        if (store.activeFlashback?.id === fact.id) store.activeFlashback = null;
        store.facts = store.facts.filter((x) => x.id !== id);
        await saveChatStore();
        renderModalContent();
      });
    });
    return;
  }

  // Вкладка «Хроника»
  const visibleChapters = store.chapters
    .map((ch, idx) => ({ ch, idx }))
    .filter(({ ch }) => !qLower || String(ch.text || '').toLowerCase().includes(qLower));

  const chaptersHtml =
    visibleChapters.length === 0
      ? `<div class="mem-empty-hint" style="padding:12px;">${
          qLower ? 'Глав по этому запросу не найдено 🔍' : 'Главы появятся автоматически по мере продвижения ролевой ✨'
        }</div>`
      : visibleChapters
          .map(({ ch, idx }) => {
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
  autoResizeTextarea(canonInput);
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
    autoResizeTextarea(ta);
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

/* === Настройки расширения в меню Extensions === */
function mountSettingsPanel() {
  if (document.getElementById('memorize-settings-panel')) return;
  const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
  if (!host) return;

  const s = getSettings();
  const wrapper = document.createElement('div');
  wrapper.id = 'memorize-settings-panel';
  wrapper.className = 'inline-drawer';
  wrapper.innerHTML = `
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>🐾 Memorize: Лу Гуан и Чэн Сяоши</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content" style="display:flex;flex-direction:column;gap:8px;padding-top:8px;">
      <label class="checkbox_label">
        <input id="mem_cfg_enabled" type="checkbox" ${s.enabled ? 'checked' : ''} />
        <span>Включить память чата (инжект в промпт)</span>
      </label>
      <label class="checkbox_label">
        <input id="mem_cfg_chibi" type="checkbox" ${s.showChibi ? 'checked' : ''} />
        <span>Показывать моти-маскота на экране</span>
      </label>
      <div>
        <small>Вид маскота:</small>
        <select id="mem_cfg_mascot_mode" class="text_pole">
          <option value="duo" ${s.mascotMode === 'duo' ? 'selected' : ''}>🐱🐶 Дуэт (Лу Гуан + Чэн Сяоши)</option>
          <option value="lg" ${s.mascotMode === 'lg' ? 'selected' : ''}>🐱 Только котик Лу Гуан (компактный)</option>
          <option value="cxs" ${s.mascotMode === 'cxs' ? 'selected' : ''}>🐶 Только щенок Чэн Сяоши (компактный)</option>
        </select>
      </div>
      <label class="checkbox_label">
        <input id="mem_cfg_auto" type="checkbox" ${s.autoExtract ? 'checked' : ''} />
        <span>Авто-выжимка каждые N сообщений</span>
      </label>
      <div style="display:flex;gap:8px;">
        <div style="flex:1;">
          <small>Интервал (сообщ.):</small>
          <input id="mem_cfg_interval" class="text_pole" type="number" min="4" max="100" value="${Number(s.everyNMessages) || 16}" />
        </div>
        <div style="flex:1;">
          <small>Глубина (Depth):</small>
          <input id="mem_cfg_depth" class="text_pole" type="number" min="0" max="50" value="${Number(s.injectionDepth) ?? 2}" />
        </div>
      </div>

      <hr style="opacity:0.2;margin:4px 0;" />

      <label class="checkbox_label">
        <input id="mem_cfg_use_custom_api" type="checkbox" ${s.useCustomApi ? 'checked' : ''} />
        <span><b>🔑 Свой API с ключом</b> (авто-список моделей)</span>
      </label>

      <div id="mem_custom_api_block" style="display:${s.useCustomApi ? 'flex' : 'none'};flex-direction:column;gap:6px;padding:8px;border:1px solid rgba(155,184,255,0.22);border-radius:10px;">
        <div>
          <small>API Base URL:</small>
          <input id="mem_cfg_api_url" class="text_pole" type="text" placeholder="https://elysiumai.net/v1" value="${escapeHtml(s.customApiUrl)}" />
        </div>
        <div>
          <small>API Key (хранится только локально в браузере):</small>
          <input id="mem_cfg_api_key" class="text_pole" type="password" placeholder="sk-..." value="${escapeHtml(getApiKey())}" />
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:2px;">
          <small>Выберите модель (скролл):</small>
          <span id="mem_cfg_refresh_models" style="font-size:11.5px;cursor:pointer;color:#9bb8ff;">🔄 Обновить</span>
        </div>
        <div id="mem_model_picker_host"></div>
        <small id="mem_cfg_api_status" style="opacity:0.85;"></small>
      </div>

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
        <button id="mem_cfg_open_modal" class="menu_button" type="button">🐾 Открыть память чата</button>
        <button id="mem_cfg_reset_pos" class="menu_button" type="button">Сбросить позицию маскота</button>
      </div>
    </div>
  `;

  host.appendChild(wrapper);
  renderModelPickerList();

  // Автозагрузка списка моделей сразу при открытии, если URL и ключ уже введены
  if (s.useCustomApi && s.customApiUrl && getApiKey()) {
    fetchModelsAutomatically(true);
  }

  document.getElementById('mem_cfg_enabled').addEventListener('change', (e) => {
    getSettings().enabled = e.target.checked;
    saveSettings();
    updateInjection();
    updateWidgetBadge();
  });

  document.getElementById('mem_cfg_chibi').addEventListener('change', (e) => {
    getSettings().showChibi = e.target.checked;
    saveSettings();
    updateWidgetBadge();
  });

  document.getElementById('mem_cfg_mascot_mode').addEventListener('change', (e) => {
    getSettings().mascotMode = e.target.value;
    saveSettings();
    renderWidgetMascot();
  });

  document.getElementById('mem_cfg_auto').addEventListener('change', (e) => {
    getSettings().autoExtract = e.target.checked;
    saveSettings();
  });

  document.getElementById('mem_cfg_interval').addEventListener('change', (e) => {
    getSettings().everyNMessages = Math.max(4, Number(e.target.value) || 16);
    saveSettings();
  });

  document.getElementById('mem_cfg_depth').addEventListener('change', (e) => {
    getSettings().injectionDepth = Math.max(0, Number(e.target.value) || 0);
    saveSettings();
    updateInjection();
  });

  document.getElementById('mem_cfg_use_custom_api').addEventListener('change', (e) => {
    getSettings().useCustomApi = e.target.checked;
    saveSettings();
    document.getElementById('mem_custom_api_block').style.display = e.target.checked ? 'flex' : 'none';
    if (e.target.checked) fetchModelsAutomatically(false);
  });

  document.getElementById('mem_cfg_api_url').addEventListener('input', (e) => {
    getSettings().customApiUrl = e.target.value.trim();
    saveSettings();
    scheduleAutoModelFetch();
  });

  document.getElementById('mem_cfg_api_key').addEventListener('input', (e) => {
    setApiKey(e.target.value);
    scheduleAutoModelFetch();
  });

  document.getElementById('mem_cfg_refresh_models').addEventListener('click', () => {
    fetchModelsAutomatically(false);
  });

  document.getElementById('mem_cfg_open_modal').addEventListener('click', openModal);

  document.getElementById('mem_cfg_reset_pos').addEventListener('click', () => {
    getSettings().widgetPos = null;
    saveSettings();
    const w = document.getElementById('memorize-chibi-widget');
    if (w) {
      w.style.left = 'auto';
      w.style.top = 'auto';
      w.style.right = '12px';
      w.style.bottom = '110px';
    }
  });
}

/* === Жизненный цикл и гарантированный инжект перед каждым ответом === */
function bindEvents() {
  const ctx = getST();
  if (!ctx?.eventSource || !ctx?.event_types) return;
  const ev = ctx.event_types;

  const refreshState = () => {
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
      const store = getChatStore();
      if (store.activeFlashback?.text) {
        store.activeFlashback.firedCount = (store.activeFlashback.firedCount || 0) + 1;
        await saveChatStore();
      } else {
        updateInjection();
      }

      const settings = getSettings();
      if (!settings.enabled || !settings.autoExtract) return;

      const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
      const unsummarized = chat.length - (store.lastProcessedIndex || 0);

      if (unsummarized >= (Number(settings.everyNMessages) || 16)) {
        await runExtraction(false);
      }
    });
  }
}

function initExtension() {
  createWidget();
  createModal();
  mountSettingsPanel();
  bindEvents();
  updateInjection();
  updateWidgetBadge();
}

jQuery(() => {
  const ctx = getST();
  if (ctx?.eventSource && ctx?.event_types?.APP_READY) {
    ctx.eventSource.on(ctx.event_types.APP_READY, () => setTimeout(initExtension, 150));
  } else {
    setTimeout(initExtension, 500);
  }
});
