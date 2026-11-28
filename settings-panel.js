import {
  escapeHtml,
  getApiKey,
  getCachedModels,
  getSettings,
  normalizeBaseUrl,
  saveCachedModels,
  saveSettings,
  setApiKey,
  toFiniteNumber,
  updateInjection,
} from './memory-core.js';

let modelFetchTimer = null;
let modelDropdownOpen = true;


export async function fetchModelsAutomatically(silent = false) {
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

export function renderModelPickerList() {
  const cachedModels = getCachedModels();
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

/* === Настройки расширения в меню Extensions === */
export function mountSettingsPanel({ openModal, renderWidgetMascot, updateWidgetBadge }) {
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
          <input id="mem_cfg_interval" class="text_pole" type="number" min="4" max="100" value="${Math.max(4, toFiniteNumber(s.everyNMessages, 16))}" />
        </div>
        <div style="flex:1;">
          <small>Глубина (Depth):</small>
          <input id="mem_cfg_depth" class="text_pole" type="number" min="0" max="50" value="${Math.max(0, toFiniteNumber(s.injectionDepth, 2))}" />
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
          <input id="mem_cfg_api_url" class="text_pole" type="text" placeholder="https://openrouter.ai/api/v1" value="${escapeHtml(s.customApiUrl)}" />
        </div>
        <div>
          <small>API Key (хранится только локально в браузере):</small>
          <input id="mem_cfg_api_key" class="text_pole" type="password" autocomplete="off" placeholder="sk-..." />
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
  const apiKeyInputEl = document.getElementById('mem_cfg_api_key');
  if (apiKeyInputEl) apiKeyInputEl.value = getApiKey();
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
    const val = Math.max(4, toFiniteNumber(e.target.value, 16));
    getSettings().everyNMessages = val;
    e.target.value = String(val);
    saveSettings();
  });

  document.getElementById('mem_cfg_depth').addEventListener('change', (e) => {
    const val = Math.max(0, toFiniteNumber(e.target.value, 2));
    getSettings().injectionDepth = val;
    e.target.value = String(val);
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
