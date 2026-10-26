import { fetch as streamingFetch } from 'expo/fetch';
import {
  createAgentConversation, deleteAgentConversation, getAgentConversation,
  listAgentConversations, restoreAgentConversation, streamAgentChat,
} from '../../../../shared/api/agent';

export type AgentMessage = { role: 'user' | 'assistant'; text: string };
export type AgentConversation = { id: string; title: string; created_at: number };
export type AgentDetail = AgentConversation & {
  messages: AgentMessage[]; running: boolean; exhausted: boolean; pending: unknown[];
};
export type AgentEvent = { type: string; text?: string; message?: string };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid assistant response');
  return value as Record<string, unknown>;
}
export function conversation(value: unknown): AgentConversation {
  const row = record(value);
  if (typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(row.id)
    || typeof row.title !== 'string' || typeof row.created_at !== 'number' || !Number.isFinite(row.created_at)) {
    throw new Error('Invalid conversation');
  }
  return { id: row.id, title: row.title, created_at: row.created_at };
}
export function detail(value: unknown): AgentDetail {
  const row = record(value);
  if (!Array.isArray(row.messages) || typeof row.running !== 'boolean') throw new Error('Invalid conversation state');
  const messages = row.messages.map(value => {
    const message = record(value);
    if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.text !== 'string') throw new Error('Invalid message');
    return { role: message.role, text: message.text } as AgentMessage;
  });
  return { ...conversation(row), messages, running: row.running, exhausted: row.exhausted === true,
    pending: Array.isArray(row.pending) ? row.pending : [] };
}
export const agentApi = {
  async list(signal?: AbortSignal): Promise<AgentConversation[]> {
    const result = record(await listAgentConversations(signal));
    if (!Array.isArray(result.conversations)) throw new Error('Invalid history');
    return result.conversations.map(conversation);
  },
  async create(signal?: AbortSignal): Promise<AgentConversation> { return conversation(await createAgentConversation(signal)); },
  async get(id: string, signal?: AbortSignal): Promise<AgentDetail> {
    const result = detail(await getAgentConversation(id, signal));
    if (result.id !== id) throw new Error('Unexpected conversation');
    return result;
  },
  async remove(id: string, signal?: AbortSignal): Promise<void> { await deleteAgentConversation(id, signal); },
  async restore(id: string, signal?: AbortSignal): Promise<void> { await restoreAgentConversation(id, signal); },
  async stream(id: string, message: string, onEvent: (event: AgentEvent) => void, signal?: AbortSignal): Promise<void> {
    await streamAgentChat({ conversation_id: id, message }, onEvent, { signal, fetchImpl: streamingFetch });
  },
};
