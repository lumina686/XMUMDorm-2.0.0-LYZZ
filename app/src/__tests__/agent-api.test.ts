import { fetch as expoFetch } from 'expo/fetch';
import { agentApi, conversation, detail } from '@/features/agent/api';
import { agentError } from '@/features/agent/useAgent';
import { routeRequiresAuth } from '@/features/auth/gate';
import * as shared from '../../../shared/api/agent';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../../../shared/api/agent', () => ({ createAgentConversation: jest.fn(), deleteAgentConversation: jest.fn(),
  getAgentConversation: jest.fn(), listAgentConversations: jest.fn(), restoreAgentConversation: jest.fn(), streamAgentChat: jest.fn() }));
const api = jest.mocked(shared);
const row = { id: 'one', title: 'Question', created_at: 1 };

test('normalizes only valid summaries and user-visible messages', () => {
  expect(conversation(row)).toEqual(row);
  expect(detail({ ...row, running: false, messages: [{ role: 'assistant', text: '**Answer**' }] }).messages[0].text).toBe('**Answer**');
  for (const value of [{ ...row, id: '../other' }, { ...row, created_at: NaN }, null]) expect(() => conversation(value)).toThrow();
  expect(() => detail({ ...row, running: false, messages: [{ role: 'tool', text: 'internal' }] })).toThrow();
});
test('uses the existing bridge and explicit Expo streaming transport with cancellation', async () => {
  const controller = new AbortController();
  const event = jest.fn();
  await agentApi.stream('one', 'Question', event, controller.signal);
  expect(api.streamAgentChat).toHaveBeenCalledWith({ conversation_id: 'one', message: 'Question' }, event,
    { signal: controller.signal, fetchImpl: expoFetch });
});
test('read, delete and undo keep the selected record and reject mismatched responses', async () => {
  api.getAgentConversation.mockResolvedValue({ ...row, messages: [], running: false });
  expect((await agentApi.get('one')).id).toBe('one');
  await expect(agentApi.get('other')).rejects.toThrow();
  await agentApi.remove('one'); await agentApi.restore('one');
  expect(api.deleteAgentConversation).toHaveBeenCalledWith('one', undefined);
  expect(api.restoreAgentConversation).toHaveBeenCalledWith('one', undefined);
});
test('assistant requires a session and localizes transport failures without logging out bridge errors', () => {
  expect(routeRequiresAuth('/agent')).toBe(true);
  expect(agentError({ status: 502 })).toBe('screen.agent.unavailable');
  expect(agentError({ status: 401 })).toBe('screen.agent.accessFailed');
  expect(agentError({ status: 409 })).toBe('screen.agent.busy');
});
