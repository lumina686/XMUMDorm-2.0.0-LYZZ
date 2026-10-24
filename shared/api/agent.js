import { API_BASE_URL } from './config';
import { getInjectedBaseUrl } from './platform';
import { getToken } from './request';

async function requestAgent(path, { body, signal, method = 'GET' } = {}) {
  const response = await fetch(`${getInjectedBaseUrl() ?? API_BASE_URL}/api/agent${path}`, {
    method, signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (getToken() || '') },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.message || '校园助手请求失败，请稍后重试');
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return response;
}

async function json(path, options) {
  const response = await requestAgent(path, options);
  const data = await response.json();
  if (data.status !== 0) throw new Error(data.message || '校园助手响应异常');
  return data.data;
}

export const listAgentConversations = (signal) => json('/conversations', { signal });
export const createAgentConversation = (signal) => json('/conversations', { method: 'POST', body: {}, signal });
export const getAgentConversation = (id, signal) => json('/conversations/' + encodeURIComponent(id), { signal });
export const deleteAgentConversation = (id, signal) => json('/conversations/' + encodeURIComponent(id), { method: 'DELETE', signal });
export const restoreAgentConversation = (id, signal) => json('/conversations/' + encodeURIComponent(id) + '/restore', { method: 'POST', body: {}, signal });

/** Stateful frame decoder: survives split UTF-8, CRLF and heartbeat comments. */
export function createAgentEventParser(onEvent) {
  let buffer = '';
  const emit = frame => {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (data) onEvent(JSON.parse(data));
  };
  return {
    push(text, final = false) {
      buffer += text;
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        emit(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
      if (final && buffer.trim()) { emit(buffer); buffer = ''; }
    },
  };
}

export async function streamAgentChat(body, onEvent, { signal } = {}) {
  const response = await requestAgent('/chat', { method: 'POST', body, signal });
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
    throw new Error('无法读取回答，请刷新会话查看结果');
  }
  let terminal = false;
  const parser = createAgentEventParser(event => {
    if (['done', 'interrupt', 'limit', 'error'].includes(event.type)) terminal = true;
    onEvent(event);
  });
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode(), true);
    if (!terminal) throw new Error('连接已中断，请刷新会话查看结果；不要重复发送');
  } finally {
    try { await reader.cancel(); } catch { /* connection already closed */ }
    reader.releaseLock();
  }
}
