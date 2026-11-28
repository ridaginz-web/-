export const MODULE_NAME = 'memorize_time_studio';
const PROMPT_KEY = 'memorize_time_studio_prompt';
const FLASHBACK_PROMPT_KEY = 'memorize_time_studio_flashback';
const LOCAL_API_KEY_STORAGE = 'memorize_studio_secret_api_key';
const LOCAL_MODELS_CACHE = 'memorize_studio_models_cache';

const MAX_RECENT_CHAPTERS = 4;
const MAX_AUTO_FACTS = 20;
const MAX_TOTAL_FACTS = 34;

export const FLASHBACK_MODES = {
  thought: {
    icon: '💭',
    label: 'Мысль',
    hint: 'Вскользь во взгляде, жесте или внутренней мысли (без слов вслух)',
  },
  dialogue: {
    icon: '💬',
    label: 'Вслух',
    hint: 'Персонаж сам естественно упоминает это в разговоре',
  },
  trigger: {
    icon: '⚡',
    label: 'Триггер',
    hint: 'Острая эмоциональная реакция, дежавю или яркая вспышка прошлого',
  },
};

export const CATEGORIES = {
  events: { icon: '⏳', label: 'События', full: '⏳ События' },
  relations: { icon: '💞', label: 'Отношения', full: '💞 Отношения' },
  secrets: { icon: '🗝', label: 'Секреты', full: '🗝 Секреты и детали' },
  scene: { icon: '📍', label: 'Сцена', full: '📍 Текущая сцена' },
};
export const CATEGORY_KEYS = Object.keys(CATEGORIES);

export const QUOTES = [
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
  schemaVersion: 4,
  widgetPos: null,
};

let isExtracting = false;
let cachedModels = loadCachedModels();

let uiHooks = {
  showBubble: () => {},
  setSyncingState: () => {},
  renderModalContent: () => {},
  updateWidgetBadge: () => {},
};

export function registerUiHooks(hooks = {}) {
  uiHooks = { ...uiHooks, ...hooks };
}

export function getCachedModels() {
  return cachedModels;
}

export function getST() {
  return window.SillyTavern?.getContext?.() || null;
}

export function toFiniteNumber(val, fallback) {
  if (val === '' || val === null || val === undefined || typeof val === 'boolean') {
    return fallback;
  }
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function uid(prefix = 'f') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function estimateTokens(text = '') {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 3.2));
}

export function getApiKey() {
  return localStorage.getItem(LOCAL_API_KEY_STORAGE) || '';
}

export function setApiKey(val) {
  if (!val) localStorage.removeItem(LOCAL_API_KEY_STORAGE);
  else localStorage.setItem(LOCAL_API_KEY_STORAGE, val.trim());
}

export function loadCachedModels() {
  try {
    const raw = localStorage.getItem(LOCAL_MODELS_CACHE);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export function saveCachedModels(list) {
  cachedModels = Array.isArray(list) ? list : [];
  try {
    localStorage.setItem(LOCAL_MODELS_CACHE, JSON.stringify(cachedModels.slice(0, 800)));
  } catch (_) {}
}

export function normalizeBaseUrl(url = '') {
  return String(url)
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '');
}

export function getSettings() {
  const ctx = getST();
  if (!ctx) return { ...DEFAULT_SETTINGS };
  if (!ctx.extensionSettings[MODULE_NAME]) {
    ctx.extensionSettings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
  }
  const s = ctx.extensionSettings[MODULE_NAME];
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (s[k] === undefined) s[k] = v;
  }
  // Мягкое авто-обновление шаблонов из ранних версий (не затирает ручные правки v4)
  if ((toFiniteNumber(s.schemaVersion, 0)) < 4) {
    if (!s.extractionPrompt || !s.extractionPrompt.includes('core_canon')) {
      s.extractionPrompt = DEFAULT_EXTRACTION_PROMPT;
    }
    if (!s.injectionTemplate || s.injectionTemplate.includes('{{summary_block}}')) {
      s.injectionTemplate = DEFAULT_INJECTION_TEMPLATE;
    }
    s.schemaVersion = 4;
    ctx.saveSettingsDebounced?.();
  }
  return s;
}

export function saveSettings() {
  getST()?.saveSettingsDebounced?.();
}

export function inferFactCategory(text = '') {
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

export function normalizeCategory(cat, fallbackText = '') {
  if (cat === 'clues') return 'secrets';
  if (cat && CATEGORIES[cat]) return cat;
  return inferFactCategory(fallbackText);
}

export function highlightMatch(text = '', query = '') {
  const raw = String(text ?? '');
  const q = String(query || '').trim();
  if (!q) return escapeHtml(raw);
  const escapedRegex = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedRegex, 'gi');
  let result = '';
  let lastIdx = 0;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    result += escapeHtml(raw.slice(lastIdx, match.index));
    result += `<span class="mem-hl">${escapeHtml(match[0])}</span>`;
    lastIdx = match.index + match[0].length;
    if (regex.lastIndex === match.index) regex.lastIndex++;
  }
  result += escapeHtml(raw.slice(lastIdx));
  return result;
}

/* === Хранилище памяти чата (с мягкой миграцией старых версий и авто-рубриками) === */
export function getChatStore() {
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

export async function saveChatStore() {
  const ctx = getST();
  updateInjection();
  uiHooks.updateWidgetBadge();
  if (ctx?.saveMetadata) {
    await ctx.saveMetadata();
  }
}

/* === Сборка текста, память и Флешбек в промпт бота === */
export function buildPromptText() {
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

export function buildFlashbackPrompt() {
  const settings = getSettings();
  if (!settings.enabled) return '';
  const store = getChatStore();
  const fb = store.activeFlashback;
  if (!fb || !fb.text?.trim()) return '';

  const mode = FLASHBACK_MODES[fb.mode] ? fb.mode : 'thought';
  const modeInstruction =
    mode === 'dialogue'
      ? 'Пусть {{char}} естественно и уместно затронет или упомянет это воспоминание ВСЛУХ в своей прямой речи (намеком, вопросом или к слову в диалоге).'
      : mode === 'trigger'
      ? 'Пусть деталь текущей сцены сработает как эмоциональный ТРИГГЕР / дежавю: {{char}} ярко и остро переживает вспышку этого момента (смена интонации, пауза, взгляд, сильная внутренняя эмоция), влияющую на поведение в сцене.'
      : 'Пусть {{char}} вспомнит это МОЛЧА И ТОНКО — через внутреннюю мысль, мимолётную ассоциацию, взгляд или жест, НЕ проговаривая факт напрямую вслух без повода.';

  return `[ФОКУС ПАМЯТИ — ФЛЕШБЕК ПЕРСОНАЖА (${FLASHBACK_MODES[mode].label.toUpperCase()})]
В своём СЛЕДУЮЩЕМ ответе персонаж ({{char}}) должен вспомнить этот момент или факт из прошлого:
«${fb.text.trim()}»
${modeInstruction}
Сохраняй характер {{char}} и не ломай ход ролевой.`;
}

export function updateInjection() {
  const ctx = getST();
  if (!ctx?.setExtensionPrompt) return;

  const settings = getSettings();
  const text = buildPromptText();
  const pos = toFiniteNumber(settings.injectionPosition, 1);
  const depth = Math.max(0, toFiniteNumber(settings.injectionDepth, 2));
  const role = toFiniteNumber(settings.injectionRole, 0);

  if (!settings.enabled || !text) {
    ctx.setExtensionPrompt(PROMPT_KEY, '', pos, depth, false, role);
  } else {
    ctx.setExtensionPrompt(PROMPT_KEY, text, pos, depth, false, role);
  }

  // Инжект активного флешбека прямо перед генерацией (Depth = 0)
  const fbText = buildFlashbackPrompt();
  ctx.setExtensionPrompt(FLASHBACK_PROMPT_KEY, fbText || '', 1, 0, false, 0);
}

export async function callCustomLLM(promptText) {
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
      temperature: Math.min(2, Math.max(0, toFiniteNumber(s.customTemperature, 0.25))),
      max_tokens: Math.max(128, toFiniteNumber(s.customMaxTokens, 1600)),
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

export function stripReasoningBlocks(text = '') {
  return String(text)
    .replace(/<(?:think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/(?:think|thinking|reasoning)>/gi, '')
    .replace(/^[\s\S]*?<\/(?:think|thinking|reasoning)>/i, '')
    .trim();
}

export function extractJsonObject(str = '') {
  const fencedMatch = str.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    const inner = fencedMatch[1].trim();
    const fb = inner.indexOf('{');
    const lb = inner.lastIndexOf('}');
    if (fb !== -1 && lb > fb) {
      try {
        return JSON.parse(inner.slice(fb, lb + 1));
      } catch (_) {}
    }
  }

  const cleaned = str.replace(/```json/gi, '').replace(/```/g, '').trim();
  const lastBrace = cleaned.lastIndexOf('}');
  if (lastBrace === -1) return null;

  let searchFrom = 0;
  while (searchFrom < lastBrace) {
    const openIdx = cleaned.indexOf('{', searchFrom);
    if (openIdx === -1 || openIdx >= lastBrace) break;
    try {
      return JSON.parse(cleaned.slice(openIdx, lastBrace + 1));
    } catch (_) {
      searchFrom = openIdx + 1;
    }
  }
  return null;
}

export function createSnapshot(store) {
  return JSON.stringify({
    coreCanon: store.coreCanon || '',
    chapters: Array.isArray(store.chapters) ? store.chapters : [],
    facts: Array.isArray(store.facts) ? store.facts : [],
    activeFlashback: store.activeFlashback || null,
    lastProcessedIndex: store.lastProcessedIndex || 0,
  });
}

export function parseMemoryOutput(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const withoutThink = stripReasoningBlocks(rawText);
  const parsed = extractJsonObject(withoutThink);

  if (parsed && typeof parsed === 'object') {
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
  }

  const cleaned = withoutThink.replace(/```json/gi, '').replace(/```/g, '').trim();
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

export async function runExtraction(manual = false) {
  const ctx = getST();
  if (!ctx || isExtracting) return;

  const startChatId = typeof ctx.getCurrentChatId === 'function' ? ctx.getCurrentChatId() : null;
  const startMetadataRef = ctx.chatMetadata;

  const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
  const validMessages = chat
    .map((m, idx) => ({ m, idx }))
    .filter(({ m }) => m && !m.is_system && typeof m.mes === 'string' && m.mes.trim());

  if (validMessages.length === 0) {
    if (manual) uiHooks.showBubble('Пока нет сообщений для памяти ✨');
    return;
  }

  const settings = getSettings();
  const store = getChatStore();
  if (store.lastProcessedIndex > chat.length) {
    store.lastProcessedIndex = chat.length;
  }

  let slice = validMessages.filter(({ idx }) => idx >= store.lastProcessedIndex);
  let isRescanTail = false;
  let hasMoreChunks = false;
  if (slice.length === 0) {
    if (!manual) return;
    isRescanTail = true;
    const count = Math.max(4, toFiniteNumber(settings.scanWindow, 20));
    slice = validMessages.slice(-count);
  } else if (slice.length > 35) {
    slice = slice.slice(0, 35);
    hasMoreChunks = true;
  }

  const fromMsg = slice[0].idx + 1;
  const toMsg = slice[slice.length - 1].idx + 1;
  const rangeLabel = `#${fromMsg}–${toMsg}`;

  const formattedChat = slice
    .map(({ m }) => {
      const rawMes = stripReasoningBlocks(m.mes);
      const expandedMes =
        typeof ctx.substituteParams === 'function' ? ctx.substituteParams(rawMes) : rawMes;
      return `${m.name || (m.is_user ? 'User' : 'Char')}: ${expandedMes.trim()}`;
    })
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
    uiHooks.setSyncingState(true);
    uiHooks.showBubble('Синхронизируем память... ✨', 6000);

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

    const latestCtx = getST();
    const currentChatId =
      typeof latestCtx?.getCurrentChatId === 'function' ? latestCtx.getCurrentChatId() : null;
    if (
      !latestCtx ||
      currentChatId !== startChatId ||
      (startMetadataRef && latestCtx.chatMetadata !== startMetadataRef)
    ) {
      console.info('[Memorize] Чат был переключён во время выжимки — отменяем запись в чужой чат.');
      return;
    }

    const parsed = parseMemoryOutput(rawResult);
    if (!parsed) {
      uiHooks.showBubble('Не удалось разобрать JSON ответа 😿');
      return;
    }

    store.previousSnapshot = createSnapshot(store);

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

    const prevOldUnlocked = store.facts.filter((f) => !f.locked);
    const nextFacts = mergeExtractedFacts(store.facts, parsed.facts.slice(0, MAX_AUTO_FACTS));
    const newCount = nextFacts.filter((f) => f.isNew).length;

    store.facts = nextFacts;
    // Если активный флешбек ссылался на обновлённый факт, синхронизируем текст
    if (store.activeFlashback?.id) {
      const matched = store.facts.find((f) => f.id === store.activeFlashback.id);
      if (matched) store.activeFlashback.text = matched.text;
    }

    const latestChat = Array.isArray(latestCtx.chat) ? latestCtx.chat : chat;
    store.lastProcessedIndex = hasMoreChunks ? slice[slice.length - 1].idx + 1 : latestChat.length;
    await saveChatStore();
    uiHooks.renderModalContent();
    const newSuffix = newCount > 0 && prevOldUnlocked.length > 0 ? ` · +${newCount} новых` : '';
    uiHooks.showBubble(
      hasMoreChunks
        ? `Память обновлена (${store.facts.length}${newSuffix}) · нажмите «✨ Сжать» дальше`
        : `Память обновлена (${store.facts.length}${newSuffix}) ✨`,
      3600
    );
  } catch (err) {
    console.error('[Memorize] Extraction error:', err);
    uiHooks.showBubble(`Ошибка API: ${err.message || 'проверьте настройки'}`);
  } finally {
    isExtracting = false;
    uiHooks.setSyncingState(false);
  }
}

export function normalizeFactKey(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSigWords(norm = '') {
  return norm.split(' ').filter((w) => w.length >= 4);
}

export function areFactsSimilar(a = '', b = '') {
  const ka = normalizeFactKey(a);
  const kb = normalizeFactKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const shorter = ka.length <= kb.length ? ka : kb;
  const longer = ka.length <= kb.length ? kb : ka;
  if (shorter.length >= 18 && longer.includes(shorter)) return true;

  const wa = extractSigWords(ka);
  const wb = extractSigWords(kb);
  const minLen = Math.min(wa.length, wb.length);
  if (minLen >= 3) {
    const setB = new Set(wb);
    const shared = wa.filter((w) => setB.has(w)).length;
    if (shared / minLen >= 0.72) return true;
  }
  return false;
}

export function mergeExtractedFacts(existingFacts = [], extractedEntries = []) {
  const lockedFacts = existingFacts
    .filter((f) => f && f.locked && f.text?.trim())
    .map((f) => ({ ...f, isNew: false }));
  const oldUnlocked = existingFacts.filter((f) => f && !f.locked && f.text?.trim());

  const oldExactKeys = new Set(existingFacts.map((f) => normalizeFactKey(f.text)));
  const result = [...lockedFacts];
  const hasSimilarIn = (list, text) => list.some((item) => areFactsSimilar(item.text, text));

  const freshExtracted = [];
  for (const entry of extractedEntries) {
    const clean = String(entry?.text || '').trim();
    if (!clean) continue;
    if (hasSimilarIn(result, clean) || hasSimilarIn(freshExtracted, clean)) continue;

    const matchedOld = oldUnlocked.find((old) => areFactsSimilar(old.text, clean));
    const exactExisted = oldExactKeys.has(normalizeFactKey(clean));

    freshExtracted.push({
      id: matchedOld?.id || uid('f'),
      category: normalizeCategory(entry.category, clean),
      text: clean,
      enabled: matchedOld ? matchedOld.enabled !== false : true,
      locked: false,
      isNew: !exactExisted,
    });
  }

  result.push(...freshExtracted);

  const hasNewScene = freshExtracted.some((f) => f.category === 'scene');
  const newEventsCount = freshExtracted.filter((f) => f.category === 'events').length;
  let preservedProtected = 0;
  let preservedEvents = 0;
  let preservedScene = 0;

  for (const old of oldUnlocked) {
    if (result.length >= MAX_TOTAL_FACTS) break;
    if (hasSimilarIn(result, old.text)) continue;

    const cat = normalizeCategory(old.category, old.text);
    if (cat === 'secrets' || cat === 'relations') {
      if (preservedProtected < 14) {
        result.push({ ...old, category: cat, isNew: false });
        preservedProtected++;
      }
    } else if (cat === 'events' && newEventsCount < 3 && preservedEvents < 4) {
      result.push({ ...old, category: cat, isNew: false });
      preservedEvents++;
    } else if (cat === 'scene' && !hasNewScene && preservedScene < 2) {
      result.push({ ...old, category: cat, isNew: false });
      preservedScene++;
    }
  }

  return result.slice(0, MAX_TOTAL_FACTS);
}

export function exportMemoryPack() {
  const store = getChatStore();
  return JSON.stringify(
    {
      memorizePackVersion: 1,
      exportedAt: new Date().toISOString(),
      coreCanon: store.coreCanon || '',
      chapters: Array.isArray(store.chapters) ? store.chapters : [],
      facts: Array.isArray(store.facts)
        ? store.facts.map((f) => ({
            id: f.id || uid('f'),
            category: normalizeCategory(f.category, f.text),
            text: String(f.text || '').trim(),
            enabled: f.enabled !== false,
            locked: Boolean(f.locked),
          }))
        : [],
      activeFlashback: store.activeFlashback || null,
    },
    null,
    2
  );
}

export async function importMemoryPack(rawJson, mode = 'replace') {
  const parsed = typeof rawJson === 'string' ? extractJsonObject(rawJson) : rawJson;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Некорректный JSON слепка памяти');
  }
  if (!Array.isArray(parsed.facts) && typeof parsed.coreCanon !== 'string' && !Array.isArray(parsed.chapters)) {
    throw new Error('В данных нет слепка памяти Memorize');
  }

  const store = getChatStore();
  store.previousSnapshot = createSnapshot(store);

  const incomingFacts = (Array.isArray(parsed.facts) ? parsed.facts : [])
    .filter((f) => f && String(f.text || '').trim())
    .map((f) => ({
      id: f.id || uid('f'),
      category: normalizeCategory(f.category, f.text),
      text: String(f.text).trim(),
      enabled: f.enabled !== false,
      locked: Boolean(f.locked),
      isNew: true,
    }));

  const incomingChapters = (Array.isArray(parsed.chapters) ? parsed.chapters : [])
    .filter((c) => c && String(c.text || '').trim())
    .map((c) => ({
      id: c.id || uid('ch'),
      range: String(c.range || 'Прошлый чат'),
      text: String(c.text).trim(),
    }));

  if (mode === 'merge') {
    if (parsed.coreCanon?.trim()) {
      store.coreCanon = [store.coreCanon, parsed.coreCanon.trim()].filter(Boolean).join('\n\n');
    }
    const existingKeys = new Set(store.facts.map((f) => normalizeFactKey(f.text)));
    for (const f of incomingFacts) {
      if (!existingKeys.has(normalizeFactKey(f.text))) {
        store.facts.push(f);
        existingKeys.add(normalizeFactKey(f.text));
      }
    }
    store.chapters = [...store.chapters, ...incomingChapters].slice(-MAX_RECENT_CHAPTERS);
  } else {
    store.coreCanon = typeof parsed.coreCanon === 'string' ? parsed.coreCanon.trim() : '';
    store.chapters = incomingChapters.slice(-MAX_RECENT_CHAPTERS);
    store.facts = incomingFacts;
    store.activeFlashback = parsed.activeFlashback || null;
  }

  const chatLen = Array.isArray(getST()?.chat) ? getST().chat.length : 0;
  store.lastProcessedIndex = Math.min(store.lastProcessedIndex || 0, chatLen);
  await saveChatStore();
  uiHooks.renderModalContent();
  return { facts: store.facts.length, chapters: store.chapters.length };
}

export async function rollbackSnapshot() {
  const store = getChatStore();
  if (!store.previousSnapshot) {
    uiHooks.showBubble('Откатывать пока нечего ⏳');
    return;
  }
  try {
    const prev = JSON.parse(store.previousSnapshot);
    store.coreCanon = prev.coreCanon ?? prev.summary ?? '';
    store.chapters = Array.isArray(prev.chapters) ? prev.chapters : [];
    store.facts = Array.isArray(prev.facts) ? prev.facts : [];
    store.activeFlashback = prev.activeFlashback ?? null;
    store.lastProcessedIndex = prev.lastProcessedIndex || 0;
    store.previousSnapshot = null;
    await saveChatStore();
    uiHooks.renderModalContent();
    uiHooks.showBubble('Лу Гуан вернул прошлый слепок ⏳');
  } catch (e) {
    console.error('[Memorize] Rollback error:', e);
  }
}
