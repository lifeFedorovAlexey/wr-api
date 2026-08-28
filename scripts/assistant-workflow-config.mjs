const DEFAULT_SYSTEM_PROMPT = 'Ты выбираешь наиболее полезный устойчивый совет из предоставленного массива. Не создавай новые советы и не переписывай существующие.';
const DEFAULT_USER_PROMPT = 'Выбери один наиболее полезный устойчивый совет для указанной линии и статистического среза. Не переписывай совет и не создавай новый. Верни только JSON {"tipIndex":0}, где tipIndex — индекс в массиве. Если массив пуст, верни {"tipIndex":null}.\n\nЧемпион: {{championName}} ({{championSlug}})\nЛиния: {{lane}}\nРанг: {{rank}}\nПроверенные советы: {{stableTips}}\nСтатистика: {{stats}}';

function finite(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function text(value, fallback, max) {
  return typeof value === 'string' && value.trim() ? value.slice(0, max) : fallback;
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).slice(0, 500) : [];
}

export function parseWorkflowConfig(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { value = {}; }
  }
  value = record(value);
  const nodes = Array.isArray(value.graph?.nodes) ? value.graph.nodes : [];
  const nodeParams = (type) => nodes.find((node) => node && node.type === type && node.params && typeof node.params === 'object')?.params || {};
  const input = { ...record(value.input), ...nodeParams('input') };
  const sync = { ...record(value.sync), ...nodeParams('sync') };
  const ollama = { ...record(value.ollama), ...nodeParams('ollama') };
  const prompt = nodeParams('prompt');
  const assistant = { ...record(value.assistant), ...nodeParams('generate') };
  if (prompt.systemPrompt !== undefined) assistant.systemPrompt = prompt.systemPrompt;
  if (prompt.userPromptTemplate !== undefined) assistant.userPromptTemplate = prompt.userPromptTemplate;
  return {
    input: {
      scope: input.scope === 'selected' ? 'selected' : 'all',
      champions: list(input.champions),
      lanes: list(input.lanes),
      ranks: list(input.ranks),
    },
    ollama: {
      model: text(ollama.model, 'gpt-oss:20b', 120),
      temperature: finite(ollama.temperature, 0.45, 0, 2),
      topP: finite(ollama.topP, 0.85, 0, 1),
      numPredict: Math.round(finite(ollama.numPredict, 400, 32, 4096)),
      think: Boolean(ollama.think),
    },
    assistant: {
      systemPrompt: text(assistant.systemPrompt, DEFAULT_SYSTEM_PROMPT, 4000),
      userPromptTemplate: text(assistant.userPromptTemplate, DEFAULT_USER_PROMPT, 12000),
      retries: Math.round(finite(assistant.retries, 4, 1, 8)),
    },
    sync: { enabled: sync.enabled !== false, mode: sync.mode === 'preview' ? 'preview' : 'wr-api' },
  };
}

export function renderPrompt(template, values) {
  const serialized = {
    championName: values.championName || '',
    championSlug: values.championSlug || '',
    lane: values.lane || '',
    rank: values.rank || '',
    stableTips: JSON.stringify(values.stableTips || []),
    stats: JSON.stringify(values.stats || {}),
  };
  return String(template).replace(/\{\{(championName|championSlug|lane|rank|stableTips|stats)\}\}/g, (_, key) => serialized[key]);
}
