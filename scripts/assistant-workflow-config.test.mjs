import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkflowConfig, renderPrompt } from './assistant-workflow-config.mjs';

test('workflow config renders prompt variables and preserves inference settings', () => {
  const config = parseWorkflowConfig(JSON.stringify({
    ollama: { model: 'custom:model', temperature: 0.2, topP: 0.7, numPredict: 256, think: true },
    assistant: { systemPrompt: 'system', userPromptTemplate: '{{championName}}/{{rank}}/{{stats}}', retries: 2 },
  }));
  assert.equal(config.ollama.model, 'custom:model');
  assert.equal(config.ollama.think, true);
  assert.equal(config.assistant.retries, 2);
  assert.equal(renderPrompt(config.assistant.userPromptTemplate, {
    championName: 'Heimerdinger',
    championSlug: 'heimerdinger',
    lane: 'mid',
    rank: 'overall',
    stableTips: [{ text: 'Keep distance' }],
    stats: { winRate: 52.1 },
  }), 'Heimerdinger/overall/{"winRate":52.1}');
});

test('invalid workflow config falls back to safe defaults', () => {
  const config = parseWorkflowConfig('{bad json');
  assert.equal(config.ollama.model, 'gpt-oss:20b');
  assert.equal(config.assistant.retries, 4);
  assert.equal(config.ollama.think, false);
});

test('node params override legacy top-level settings for a graph snapshot', () => {
  const config = parseWorkflowConfig({
    ollama: { model: 'legacy:model' },
    assistant: { userPromptTemplate: 'legacy', retries: 1 },
    graph: { nodes: [
      { type: 'ollama', params: { model: 'gpt-oss:20b', temperature: 0.1 } },
      { type: 'prompt', params: { userPromptTemplate: 'node {{rank}}' } },
      { type: 'generate', params: { retries: 3 } },
    ] },
  });
  assert.equal(config.ollama.model, 'gpt-oss:20b');
  assert.equal(config.ollama.temperature, 0.1);
  assert.equal(config.assistant.userPromptTemplate, 'node {{rank}}');
  assert.equal(config.assistant.retries, 3);
});
