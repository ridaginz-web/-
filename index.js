const MODULE_NAME = 'memorize_time_studio';
const PROMPT_KEY = 'memorize_time_studio_prompt';
const LOCAL_API_KEY_STORAGE = 'memorize_studio_secret_api_key';

const CATEGORIES = {
  events: { label: '⏳ События', short: 'События' },
  relations: { label: '💞 Отношения', short: 'Отношения' },
  clues: { label: '🗝️ Детали и улики', short: 'Детали' },
  scene: { label: '📍 Текущая сцена', short: 'Сцена' },
};

const QUOTES = {
  lg: [
    'Лу Гуан: «Три правила: никаких домыслов — фиксируем только проверенные факты.»',
    'Лу Гуан: «Таймлайн стабилен. Все ключевые узлы записаны в альбом.»',
    'Лу Гуан: «Не перегружай контекст водой, оставь только суть.»',
    'Лу Гуан: «Если нейросеть ошибётся в выжимке — я откачу снимок назад.»',
  ],
  cxs: [
    'Чэн Сяоши: «Хлопнем по ладоням — и ныряем в последние сообщения! 📸»',
    'Чэн Сяоши: «Ого, вот эту деталь точно надо сохранить на плёнку!»',
    'Чэн Сяоши: «Лу Гуан следит за хронологией, а я — чтобы ничьи чувства не забыли!»',
    'Чэн Сяоши: «Фотоателье „Время“ на связи! Сделать свежий снимок памяти?»',
  ],
};

const DEFAULT_EXTRACTION_PROMPT = `Ты — архивный модуль памяти «Memorize» (Фотоателье «Время» Лу Гуана и Чэн Сяоши).
Проанализируй новые сообщения ролевой игры и обнови текущую базу памяти чата.

ПРАВИЛА:
1. Пиши на русском языке, максимально сжато, сухо и конкретно (1 запись = 1 короткий факт без художественной воды).
2. Объединяй новые события с уже известными фактами: обновляй изменившиеся статусы, убирай потерявшие актуальность мелочи и дубликаты.
3. Не выдумывай того, чего не было в тексте.
4. Верни ТОЛЬКО валидный JSON строго по схеме ниже (без пояснений вокруг JSON):

{
  "summary": "Связная краткая выжимка всего сюжета на текущий момент (3-5 предложений)",
  "events": ["Ключевое событие 1", "Ключевое событие 2"],
  "relations": ["Статус отношений, доверия, чувств или обещаний между персонажами"],
  "clues": ["Важные предметы, секреты, травмы, правила мира, улики"],
  "scene": ["Где сейчас находятся персонажи, время/обстановка и текущая цель"]
}`;

const DEFAULT_INJECTION_TEMPLATE = `[Архив памяти «Фотоателье Время» — ключевые факты истории]
{{summary_block}}
{{facts_block}}
[Учитывай эти факты как достоверную память прошлых сцен, не противоречь им.]`;

const DEFAULT_SETTINGS = {
  enabled: true,
  showChibi: true,
  autoExtract: true,
  everyNMessages: 10,
  scanWindow: 16,
  injectionPosition: 1,
  injectionDepth: 2,
  injectionRole: 0,
  useCustomApi: false,
  customApiUrl: 'https://openrouter.ai/api/v1',
  customApiModel: 'deepseek/deepseek-chat',
  customTemperature: 0.3,
  customMaxTokens: 1400,
  extractionPrompt: DEFAULT_EXTRACTION_PROMPT,
  injectionTemplate: DEFAULT_INJECTION_TEMPLATE,
  widgetPos: null,
};

let activeTab = 'all';
let isExtracting = false;
let bubbleTimer = null;

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

function uid() {
  return 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function getApiKey() {
  return localStorage.getItem(LOCAL_API_KEY_STORAGE) || '';
}

function setApiKey(val) {
  if (!val) localStorage.removeItem(LOCAL_API_KEY_STORAGE);
  else localStorage.setItem(LOCAL_API_KEY_STORAGE, val.trim());
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

function getChatStore() {
  const ctx = getST();
  if (!ctx || !ctx.chatMetadata) {
    return { summary: '', facts: [], lastProcessedIndex: 0, previousSnapshot: null };
  }
  if (!ctx.chatMetadata[MODULE_NAME]) {
    ctx.chatMetadata[MODULE_NAME] = {
      summary: '',
      facts: [],
      lastProcessedIndex: 0,
      previousSnapshot: null,
    };
  }
  const store = ctx.chatMetadata[MODULE_NAME];
  if (!Array.isArray(store.facts)) store.facts = [];
  if (typeof store.summary !== 'string') store.summary = '';
  if (typeof store.lastProcessedIndex !== 'number') store.lastProcessedIndex = 0;
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

/* === Вызов своего OpenAI-совместимого API === */
async function callCustomLLM(promptText) {
  const s = getSettings();
  const baseUrl = normalizeBaseUrl(s.customApiUrl);
  const apiKey = getApiKey();
  const model = (s.customApiModel || '').trim();

  if (!baseUrl) throw new Error('Не указан URL своего API');
  if (!apiKey) throw new Error('Не указан API ключ');
  if (!model) throw new Error('Не указана модель API');

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: Number(s.customTemperature) ?? 0.3,
      max_tokens: Number(s.customMaxTokens) || 1400,
      messages: [
        { role: 'system', content: 'Отвечай строго валидным JSON без лишних комментариев.' },
        { role: 'user', content: promptText },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${errBody.slice(0, 120)}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function testAndLoadModels() {
  const statusEl = document.getElementById('mem_cfg_api_status');
  const datalist = document.getElementById('mem_models_datalist');
  const s = getSettings();
  const baseUrl = normalizeBaseUrl(s.customApiUrl);
  const apiKey = getApiKey();

  if (statusEl) statusEl.textContent = '⏳ Проверяем соединение...';

  try {
    if (!baseUrl || !apiKey) {
      throw new Error('Заполните API URL и API Key');
    }
    const res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const list = Array.isArray(json?.data) ? json.data.map((m) => m.id).filter(Boolean) : [];

    if (datalist && list.length > 0) {
      datalist.innerHTML = list.map((id) => `<option value="${escapeHtml(id)}"></option>`).join('');
    }
    if (statusEl) {
      statusEl.textContent = list.length
        ? `✅ Ключ активен! Доступно моделей: ${list.length}`
        : '✅ Соединение успешно (введите имя модели вручную)';
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = `❌ Ошибка: ${err.message}`;
  }
}

/* === Инжект памяти в промпт === */
function buildPromptText() {
  const settings = getSettings();
  if (!settings.enabled) return '';

  const store = getChatStore();
  const activeFacts = store.facts.filter((f) => f.enabled !== false && f.text?.trim());
  const hasSummary = Boolean(store.summary?.trim());

  if (!hasSummary && activeFacts.length === 0) return '';

  const summaryBlock = hasSummary ? `Краткая сводка: ${store.summary.trim()}` : '';

  const grouped = [];
  for (const [catKey, catMeta] of Object.entries(CATEGORIES)) {
    const items = activeFacts.filter((f) => f.category === catKey);
    if (items.length > 0) {
      grouped.push(`${catMeta.label}:\n` + items.map((i) => `- ${i.text.trim()}`).join('\n'));
    }
  }
  const factsBlock = grouped.join('\n\n');

  return (settings.injectionTemplate || DEFAULT_INJECTION_TEMPLATE)
    .replace('{{summary_block}}', summaryBlock)
    .replace('{{facts_block}}', factsBlock)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function updateInjection() {
  const ctx = getST();
  if (!ctx?.setExtensionPrompt) return;

  const settings = getSettings();
  const text = buildPromptText();

  if (!settings.enabled || !text) {
    ctx.setExtensionPrompt(PROMPT_KEY, '', settings.injectionPosition, settings.injectionDepth, false, settings.injectionRole);
    return;
  }

  ctx.setExtensionPrompt(
    PROMPT_KEY,
    text,
    Number(settings.injectionPosition) || 1,
    Number(settings.injectionDepth) || 2,
    false,
    Number(settings.injectionRole) || 0
  );
}

/* === Парсинг и генерация выжимки === */
function parseMemoryOutput(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
        events: Array.isArray(parsed.events) ? parsed.events : [],
        relations: Array.isArray(parsed.relations) ? parsed.relations : [],
        clues: Array.isArray(parsed.clues) ? parsed.clues : [],
        scene: Array.isArray(parsed.scene) ? parsed.scene : [],
      };
    } catch (_) {}
  }

  const fallback = { summary: '', events: [], relations: [], clues: [], scene: [] };
  let currentCat = 'events';
  for (const rawLine of cleaned.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/событи|хронолог/i.test(line)) { currentCat = 'events'; continue; }
    if (/отношен|динам/i.test(line)) { currentCat = 'relations'; continue; }
    if (/детал|улик|предмет/i.test(line)) { currentCat = 'clues'; continue; }
    if (/сцен|локац/i.test(line)) { currentCat = 'scene'; continue; }
    if (/сводк|summary/i.test(line) && !line.startsWith('-')) {
      fallback.summary = line.replace(/^.*?:\s*/, '');
      continue;
    }
    if (/^[-•*]\s+/.test(line)) {
      fallback[currentCat].push(line.replace(/^[-•*]\s+/, '').trim());
    }
  }
  return fallback;
}

async function runExtraction(manual = false) {
  const ctx = getST();
  if (!ctx || isExtracting) return;

  const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
  const validMessages = chat
    .map((m, idx) => ({ m, idx }))
    .filter(({ m }) => m && !m.is_system && typeof m.mes === 'string' && m.mes.trim());

  if (validMessages.length === 0) {
    if (manual) showBubble('Лу Гуан: «В чате пока нет сообщений для снимка.»');
    return;
  }

  const settings = getSettings();
  const store = getChatStore();

  let slice = validMessages.filter(({ idx }) => idx >= store.lastProcessedIndex);
  if (slice.length === 0 || manual) {
    const count = Math.max(4, Number(settings.scanWindow) || 16);
    slice = validMessages.slice(-count);
  }

  const formattedChat = slice
    .map(({ m }) => `${m.name || (m.is_user ? 'User' : 'Char')}: ${m.mes.trim()}`)
    .join('\n\n');

  const existingMemory = {
    summary: store.summary || '',
    events: store.facts.filter((f) => f.category === 'events' && f.enabled !== false).map((f) => f.text),
    relations: store.facts.filter((f) => f.category === 'relations' && f.enabled !== false).map((f) => f.text),
    clues: store.facts.filter((f) => f.category === 'clues' && f.enabled !== false).map((f) => f.text),
    scene: store.facts.filter((f) => f.category === 'scene' && f.enabled !== false).map((f) => f.text),
  };

  const fullQuietPrompt = `${settings.extractionPrompt || DEFAULT_EXTRACTION_PROMPT}

ТЕКУЩАЯ ПАМЯТЬ ЧАТА:
${JSON.stringify(existingMemory, null, 2)}

НОВЫЕ СООБЩЕНИЯ ДЛЯ АНАЛИЗА:
${formattedChat}`;

  try {
    isExtracting = true;
    setSyncingState(true);
    showBubble('Чэн Сяоши и Лу Гуан: *Хлопок!* «Прыгаем в снимок памяти...» ✨');

    let rawResult = '';
    if (settings.useCustomApi) {
      rawResult = await callCustomLLM(fullQuietPrompt);
    } else {
      if (typeof ctx.generateRaw === 'function') {
        try {
          rawResult = await ctx.generateRaw({
            prompt: fullQuietPrompt,
            systemPrompt: 'Отвечай строго валидным JSON без лишнего текста.',
          });
        } catch (_) {
          rawResult = '';
        }
      }
      if (!rawResult && typeof ctx.generateQuietPrompt === 'function') {
        rawResult = await ctx.generateQuietPrompt({ quietPrompt: fullQuietPrompt });
      }
    }

    const parsed = parseMemoryOutput(rawResult);
    if (!parsed) {
      showBubble('Лу Гуан: «Не удалось разобрать ответ модели. Попробуй ещё раз.»');
      return;
    }

    store.previousSnapshot = JSON.stringify({
      summary: store.summary,
      facts: store.facts,
      lastProcessedIndex: store.lastProcessedIndex,
    });

    if (parsed.summary) store.summary = parsed.summary;

    const lockedFacts = store.facts.filter((f) => f.locked);
    const lockedSet = new Set(lockedFacts.map((f) => f.text.trim().toLowerCase()));
    const nextFacts = [...lockedFacts];

    for (const catKey of Object.keys(CATEGORIES)) {
      const incoming = Array.isArray(parsed[catKey]) ? parsed[catKey] : [];
      for (const item of incoming) {
        const cleanText = String(item || '').trim();
        if (!cleanText) continue;
        if (lockedSet.has(cleanText.toLowerCase())) continue;
        lockedSet.add(cleanText.toLowerCase());
        nextFacts.push({
          id: uid(),
          category: catKey,
          text: cleanText,
          enabled: true,
          locked: false,
        });
      }
    }

    store.facts = nextFacts;
    store.lastProcessedIndex = chat.length;
    await saveChatStore();
    renderModalContent();
    showBubble(`Чэн Сяоши: «Снимок проявлен! Фактов в альбоме: ${store.facts.length} 📸»`);
  } catch (err) {
    console.error('[Memorize] Extraction error:', err);
    showBubble(`Лу Гуан: «Ошибка API: ${err.message || 'проверь настройки ключа'}»`);
  } finally {
    isExtracting = false;
    setSyncingState(false);
  }
}

async function rollbackSnapshot() {
  const store = getChatStore();
  if (!store.previousSnapshot) {
    showBubble('Лу Гуан: «Точка возврата пуста — откатывать пока нечего.»');
    return;
  }
  try {
    const prev = JSON.parse(store.previousSnapshot);
    store.summary = prev.summary || '';
    store.facts = Array.isArray(prev.facts) ? prev.facts : [];
    store.lastProcessedIndex = prev.lastProcessedIndex || 0;
    store.previousSnapshot = null;
    await saveChatStore();
    renderModalContent();
    showBubble('Лу Гуан: «Время отмотано назад. Предыдущий снимок восстановлен ⏳»');
  } catch (e) {
    console.error('[Memorize] Rollback error:', e);
  }
}

/* === Чиби SVG === */
function getLuGuangSVG() {
  return `
  <svg viewBox="0 0 64 74" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="32" cy="69" rx="16" ry="4" fill="rgba(0,0,0,0.35)"/>
    <path d="M18 46 Q32 42 46 46 L49 66 Q32 69 15 66 Z" fill="#dce6f7" stroke="#2c3a57" stroke-width="2"/>
    <path d="M27 45 L32 56 L37 45 Z" fill="#23304c"/>
    <circle cx="38" cy="57" r="4.5" fill="#f4c96b" stroke="#7a5a1e" stroke-width="1.3"/>
    <circle cx="32" cy="29" r="16" fill="#ffe9dc" stroke="#2c3a57" stroke-width="2"/>
    <path d="M14 28 Q14 10 32 10 Q50 10 50 28 Q47 19 42 22 L38 16 L33 23 L27 16 L22 23 Q17 19 14 28 Z" fill="#eef3ff" stroke="#5b6f99" stroke-width="1.8"/>
    <ellipse class="mem-eye-glow" cx="25.5" cy="31" rx="2.6" ry="3" fill="#5e7bb8"/>
    <ellipse class="mem-eye-glow" cx="38.5" cy="31" rx="2.6" ry="3" fill="#5e7bb8"/>
    <circle cx="24.8" cy="29.8" r="0.9" fill="#fff"/>
    <circle cx="37.8" cy="29.8" r="0.9" fill="#fff"/>
    <path d="M22 26.5 L28.5 27.2" stroke="#5b6f99" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M42 26.5 L35.5 27.2" stroke="#5b6f99" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M29.5 38 Q32 39 34.5 38" stroke="#8a5a50" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </svg>`;
}

function getChengXiaoshiSVG() {
  return `
  <svg viewBox="0 0 64 74" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="32" cy="69" rx="16" ry="4" fill="rgba(0,0,0,0.35)"/>
    <path d="M17 46 Q32 42 47 46 L50 66 Q32 69 14 66 Z" fill="#2a3142" stroke="#181d29" stroke-width="2"/>
    <path d="M24 45 Q32 50 40 45 L38 66 L26 66 Z" fill="#f2f5fc"/>
    <rect x="25" y="53" width="14" height="9" rx="2.2" fill="#3a4359" stroke="#f4c96b" stroke-width="1.3"/>
    <circle cx="32" cy="57.5" r="2.7" fill="#7eb6ff"/>
    <circle cx="32" cy="29" r="16" fill="#ffe6d4" stroke="#2b2420" stroke-width="2"/>
    <path d="M31 10 Q35 3 40 7 Q36 9 36 11" fill="none" stroke="#3b2a26" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M13 29 Q13 10 32 10 Q51 10 51 29 L46 21 L41 25 L35 17 L29 25 L23 18 L18 25 Z" fill="#46312c" stroke="#241815" stroke-width="1.8"/>
    <ellipse class="mem-eye-glow" cx="25.5" cy="31" rx="2.8" ry="3.4" fill="#b86b2b"/>
    <ellipse class="mem-eye-glow" cx="38.5" cy="31" rx="2.8" ry="3.4" fill="#b86b2b"/>
    <circle cx="24.7" cy="29.6" r="1.1" fill="#fff"/>
    <circle cx="37.7" cy="29.6" r="1.1" fill="#fff"/>
    <circle cx="20.5" cy="35" r="2.4" fill="rgba(255,130,130,0.35)"/>
    <circle cx="43.5" cy="35" r="2.4" fill="rgba(255,130,130,0.35)"/>
    <path d="M28 37.2 Q32 41.2 36 37.2" stroke="#8a4b3c" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  </svg>`;
}

/* === Виджет и Модальное окно === */
function showBubble(text, ms = 4200) {
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

function updateWidgetBadge() {
  const store = getChatStore();
  const activeCount = store.facts.filter((f) => f.enabled !== false).length;
  const badge = document.getElementById('memorize-fact-count');
  if (badge) badge.textContent = String(activeCount);

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
    <div id="memorize-stage" class="mem-chibi-stage" title="Перетащи виджет или нажми на персонажей">
      <div class="mem-chibi-char lg" data-char="lg" title="Лу Гуан">${getLuGuangSVG()}</div>
      <div class="mem-chibi-char cxs" data-char="cxs" title="Чэн Сяоши">${getChengXiaoshiSVG()}</div>
    </div>
    <div class="mem-widget-bar">
      <button id="mem-open-book-btn" class="mem-pill-btn" type="button">
        📸 Альбом <span id="memorize-fact-count" class="mem-badge-count">0</span>
      </button>
      <button id="mem-quick-snap-btn" class="mem-pill-btn" type="button" title="Сделать снимок памяти">👏</button>
    </div>
  `;

  document.body.appendChild(widget);

  const stage = document.getElementById('memorize-stage');
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;

  stage.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = false;
    const rect = widget.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    origLeft = rect.left;
    origTop = rect.top;
    stage.setPointerCapture?.(e.pointerId);
  });

  stage.addEventListener('pointermove', (e) => {
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

  stage.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    stage.releasePointerCapture?.(e.pointerId);

    if (moved) {
      const rect = widget.getBoundingClientRect();
      getSettings().widgetPos = { left: Math.round(rect.left), top: Math.round(rect.top) };
      saveSettings();
      return;
    }

    const charEl = e.target.closest('.mem-chibi-char');
    if (charEl) {
      const who = charEl.dataset.char === 'lg' ? 'lg' : 'cxs';
      const list = QUOTES[who];
      showBubble(list[Math.floor(Math.random() * list.length)]);
    }
  });

  document.getElementById('mem-open-book-btn').addEventListener('click', openModal);
  document.getElementById('mem-quick-snap-btn').addEventListener('click', () => runExtraction(true));

  updateWidgetBadge();
}

function createModal() {
  if (document.getElementById('memorize-modal-backdrop')) return;

  const backdrop = document.createElement('div');
  backdrop.id = 'memorize-modal-backdrop';
  backdrop.innerHTML = `
    <div class="mem-modal" role="dialog" aria-modal="true">
      <div class="mem-modal-header">
        <div class="mem-modal-title">
          <strong>📸 Фотоателье «Время» — Память фактов</strong>
          <span>Лу Гуан и Чэн Сяоши хранят выжимку текущего чата</span>
        </div>
        <button id="mem-close-modal" class="mem-btn" type="button">✕</button>
      </div>

      <div class="mem-toolbar">
        <button id="mem-run-extract" class="mem-btn primary" type="button">👏 Сделать снимок памяти</button>
        <button id="mem-rollback-btn" class="mem-btn" type="button">⏪ Откат Лу Гуана</button>
        <button id="mem-clear-all" class="mem-btn" type="button">🗑️ Очистить чат</button>
      </div>

      <div id="mem-tabs-bar" class="mem-tabs"></div>

      <div class="mem-modal-body">
        <div class="mem-summary-box">
          <label for="mem-summary-input">📖 Сжатая сводка сюжета (Summarize)</label>
          <textarea id="mem-summary-input" placeholder="Здесь появится краткая выжимка происходящего в чате..."></textarea>
        </div>

        <div class="mem-add-row">
          <select id="mem-new-cat">
            ${Object.entries(CATEGORIES)
              .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
              .join('')}
          </select>
          <input id="mem-new-text" type="text" placeholder="Добавить новый факт вручную..." />
          <button id="mem-add-fact-btn" class="mem-btn" type="button">＋ Добавить</button>
        </div>

        <div id="mem-facts-container" class="mem-facts-grid"></div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.getElementById('mem-close-modal').addEventListener('click', closeModal);
  document.getElementById('mem-run-extract').addEventListener('click', () => runExtraction(true));
  document.getElementById('mem-rollback-btn').addEventListener('click', rollbackSnapshot);

  document.getElementById('mem-clear-all').addEventListener('click', async () => {
    if (!confirm('Очистить все карточки фактов и сводку для текущего чата?')) return;
    const store = getChatStore();
    store.previousSnapshot = JSON.stringify(store);
    store.summary = '';
    store.facts = [];
    store.lastProcessedIndex = 0;
    await saveChatStore();
    renderModalContent();
  });

  document.getElementById('mem-summary-input').addEventListener('change', async (e) => {
    getChatStore().summary = e.target.value;
    await saveChatStore();
  });

  document.getElementById('mem-add-fact-btn').addEventListener('click', addManualFact);
  document.getElementById('mem-new-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addManualFact();
  });
}

async function addManualFact() {
  const input = document.getElementById('mem-new-text');
  const catSelect = document.getElementById('mem-new-cat');
  const text = input?.value?.trim();
  if (!text) return;

  const store = getChatStore();
  store.facts.unshift({
    id: uid(),
    category: catSelect.value || 'events',
    text,
    enabled: true,
    locked: true,
  });
  input.value = '';
  await saveChatStore();
  renderModalContent();
}

function openModal() {
  createModal();
  renderModalContent();
  document.getElementById('memorize-modal-backdrop')?.classList.add('open');
}

function closeModal() {
  document.getElementById('memorize-modal-backdrop')?.classList.remove('open');
}

function renderModalContent() {
  const backdrop = document.getElementById('memorize-modal-backdrop');
  if (!backdrop) return;

  const store = getChatStore();
  const summaryEl = document.getElementById('mem-summary-input');
  if (summaryEl) summaryEl.value = store.summary || '';

  const tabsBar = document.getElementById('mem-tabs-bar');
  const tabs = [
    { key: 'all', label: `Все (${store.facts.length})` },
    ...Object.entries(CATEGORIES).map(([k, v]) => ({
      key: k,
      label: `${v.short} (${store.facts.filter((f) => f.category === k).length})`,
    })),
  ];

  tabsBar.innerHTML = tabs
    .map(
      (t) =>
        `<button type="button" class="mem-tab ${activeTab === t.key ? 'active' : ''}" data-tab="${t.key}">${escapeHtml(t.label)}</button>`
    )
    .join('');

  tabsBar.querySelectorAll('.mem-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      renderModalContent();
    });
  });

  const container = document.getElementById('mem-facts-container');
  const filtered = activeTab === 'all' ? store.facts : store.facts.filter((f) => f.category === activeTab);

  if (filtered.length === 0) {
    container.innerHTML = `<div class="mem-empty">Пока нет снимков в этой категории. Нажми «👏 Сделать снимок памяти» или добавь факт вручную!</div>`;
    return;
  }

  container.innerHTML = filtered
    .map((f) => {
      const catLabel = CATEGORIES[f.category]?.label || '⏳ События';
      return `
      <div class="mem-fact-card ${f.enabled === false ? 'disabled' : ''} ${f.locked ? 'locked' : ''}" data-id="${escapeHtml(f.id)}">
        <div class="mem-fact-top">
          <span>${escapeHtml(catLabel)}</span>
          <div class="mem-fact-actions">
            <button type="button" class="mem-icon-btn act-lock" title="Закрепить факт">${f.locked ? '🔒' : '🔓'}</button>
            <button type="button" class="mem-icon-btn act-toggle" title="Вкл/выкл в промпте">${f.enabled === false ? '🙈' : '👁️'}</button>
            <button type="button" class="mem-icon-btn act-del" title="Удалить">✕</button>
          </div>
        </div>
        <textarea class="mem-fact-text">${escapeHtml(f.text)}</textarea>
      </div>`;
    })
    .join('');

  container.querySelectorAll('.mem-fact-card').forEach((card) => {
    const id = card.dataset.id;
    const fact = store.facts.find((x) => x.id === id);
    if (!fact) return;

    card.querySelector('.act-lock').addEventListener('click', async () => {
      fact.locked = !fact.locked;
      await saveChatStore();
      renderModalContent();
    });

    card.querySelector('.act-toggle').addEventListener('click', async () => {
      fact.enabled = fact.enabled === false;
      await saveChatStore();
      renderModalContent();
    });

    card.querySelector('.act-del').addEventListener('click', async () => {
      store.facts = store.facts.filter((x) => x.id !== id);
      await saveChatStore();
      renderModalContent();
    });

    card.querySelector('.mem-fact-text').addEventListener('change', async (e) => {
      fact.text = e.target.value.trim();
      await saveChatStore();
    });
  });
}

/* === Настройки расширения + блок Своего API === */
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
      <b>📸 Memorize: Лу Гуан и Чэн Сяоши</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content" style="display:flex;flex-direction:column;gap:8px;padding-top:8px;">
      <label class="checkbox_label">
        <input id="mem_cfg_enabled" type="checkbox" ${s.enabled ? 'checked' : ''} />
        <span>Включить память фактов (Memorize)</span>
      </label>
      <label class="checkbox_label">
        <input id="mem_cfg_chibi" type="checkbox" ${s.showChibi ? 'checked' : ''} />
        <span>Показывать чиби-виджет Лу Гуана и Чэн Сяоши</span>
      </label>
      <label class="checkbox_label">
        <input id="mem_cfg_auto" type="checkbox" ${s.autoExtract ? 'checked' : ''} />
        <span>Авто-выжимка каждые N сообщений</span>
      </label>
      <div>
        <small>Интервал авто-выжимки (сообщений):</small>
        <input id="mem_cfg_interval" class="text_pole" type="number" min="2" max="100" value="${Number(s.everyNMessages) || 10}" />
      </div>
      <div>
        <small>Глубина вставки в чат (Depth):</small>
        <input id="mem_cfg_depth" class="text_pole" type="number" min="0" max="50" value="${Number(s.injectionDepth) ?? 2}" />
      </div>

      <hr style="opacity:0.2;margin:4px 0;" />

      <label class="checkbox_label">
        <input id="mem_cfg_use_custom_api" type="checkbox" ${s.useCustomApi ? 'checked' : ''} />
        <span><b>🔑 Использовать свой API с ключом</b> (отдельно от ST)</span>
      </label>

      <div id="mem_custom_api_block" style="display:${s.useCustomApi ? 'flex' : 'none'};flex-direction:column;gap:6px;padding:8px;border:1px solid rgba(126,168,255,0.25);border-radius:8px;">
        <div>
          <small>API Base URL (OpenAI-совместимый):</small>
          <input id="mem_cfg_api_url" class="text_pole" type="text" placeholder="https://openrouter.ai/api/v1" value="${escapeHtml(s.customApiUrl)}" />
        </div>
        <div>
          <small>API Key (хранится только локально в браузере):</small>
          <input id="mem_cfg_api_key" class="text_pole" type="password" placeholder="sk-..." value="${escapeHtml(getApiKey())}" />
        </div>
        <div>
          <small>Модель для выжимки фактов:</small>
          <input id="mem_cfg_api_model" class="text_pole" list="mem_models_datalist" type="text" placeholder="deepseek/deepseek-chat" value="${escapeHtml(s.customApiModel)}" />
          <datalist id="mem_models_datalist"></datalist>
        </div>
        <button id="mem_cfg_test_api" class="menu_button" type="button">🔌 Проверить ключ и загрузить модели</button>
        <small id="mem_cfg_api_status" style="opacity:0.85;"></small>
      </div>

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
        <button id="mem_cfg_open_modal" class="menu_button" type="button">📸 Открыть альбом фактов</button>
        <button id="mem_cfg_reset_pos" class="menu_button" type="button">Сбросить позицию чибиков</button>
      </div>
    </div>
  `;

  host.appendChild(wrapper);

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

  document.getElementById('mem_cfg_auto').addEventListener('change', (e) => {
    getSettings().autoExtract = e.target.checked;
    saveSettings();
  });

  document.getElementById('mem_cfg_interval').addEventListener('change', (e) => {
    getSettings().everyNMessages = Math.max(2, Number(e.target.value) || 10);
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
  });

  document.getElementById('mem_cfg_api_url').addEventListener('change', (e) => {
    getSettings().customApiUrl = e.target.value.trim();
    saveSettings();
  });

  document.getElementById('mem_cfg_api_key').addEventListener('change', (e) => {
    setApiKey(e.target.value);
  });

  document.getElementById('mem_cfg_api_model').addEventListener('change', (e) => {
    getSettings().customApiModel = e.target.value.trim();
    saveSettings();
  });

  document.getElementById('mem_cfg_test_api').addEventListener('click', testAndLoadModels);
  document.getElementById('mem_cfg_open_modal').addEventListener('click', openModal);

  document.getElementById('mem_cfg_reset_pos').addEventListener('click', () => {
    getSettings().widgetPos = null;
    saveSettings();
    const w = document.getElementById('memorize-chibi-widget');
    if (w) {
      w.style.left = 'auto';
      w.style.top = 'auto';
      w.style.right = '18px';
      w.style.bottom = '90px';
    }
  });
}

function bindEvents() {
  const ctx = getST();
  if (!ctx?.eventSource || !ctx?.event_types) return;

  ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, () => {
    updateInjection();
    updateWidgetBadge();
    if (document.getElementById('memorize-modal-backdrop')?.classList.contains('open')) {
      renderModalContent();
    }
  });

  ctx.eventSource.on(ctx.event_types.MESSAGE_RECEIVED, async () => {
    const settings = getSettings();
    if (!settings.enabled || !settings.autoExtract) return;

    const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
    const store = getChatStore();
    const unsummarized = chat.length - (store.lastProcessedIndex || 0);

    if (unsummarized >= (Number(settings.everyNMessages) || 10)) {
      await runExtraction(false);
    }
  });
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
