import * as React from 'react';
import { AppState, FlatList, type AppStateStatus } from 'react-native';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderApp } from './helpers/renderApp';
import { AgentScreen } from '@/features/agent/AgentScreen';
import { AgentEntry } from '@/features/square/AgentEntry';
import { agentApi, type AgentDetail } from '@/features/agent/api';

const mockPush = jest.fn();
const mockAuthFailure = jest.fn(async () => ({ kind: 'unknown' }));
let mockSession = { isSignedIn: true, identifier: 'test-one', handleAuthFailure: mockAuthFailure };
let mockFocus: (() => void | (() => void)) | null = null;
let mockBlur: (() => void) | null = null;
jest.mock('expo-router', () => {
  // Jest factories cannot close over an imported React binding.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    useRouter: () => ({ push: mockPush, canGoBack: () => false, replace: jest.fn(), back: jest.fn() }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      R.useEffect(() => { mockFocus = callback; const close = callback(); mockBlur = close ?? null; return close; }, [callback]);
    },
  };
});
jest.mock('@/features/auth/session', () => ({ useSession: () => mockSession }));
jest.mock('@/features/agent/api', () => ({ agentApi: { list: jest.fn(), create: jest.fn(), get: jest.fn(), stream: jest.fn(), remove: jest.fn(), restore: jest.fn() } }));
const api = jest.mocked(agentApi);
let rows: Map<string, AgentDetail>;
let removed: Map<string, AgentDetail>;
let serial: number;
const listeners = new Set<(state: AppStateStatus) => void>();

beforeEach(() => {
  serial = 0; listeners.clear(); mockPush.mockReset(); mockAuthFailure.mockClear();
  mockSession = { isSignedIn: true, identifier: 'test-one', handleAuthFailure: mockAuthFailure };
  mockFocus = null; mockBlur = null;
  rows = new Map([['main', { id: 'main', title: '原有会话', created_at: 0, messages: [
    { role: 'user', text: '原来的问题' }, { role: 'assistant', text: '原来的回答' },
  ], running: false, pending: [], exhausted: false }]]);
  removed = new Map();
  Object.values(api).forEach(fn => fn.mockReset());
  api.list.mockImplementation(async () => [...rows.values()].reverse());
  api.create.mockImplementation(async () => {
    const row: AgentDetail = { id: `new-${++serial}`, title: '新会话', created_at: 100, messages: [], running: false, pending: [], exhausted: false };
    rows.set(row.id, row); return row;
  });
  api.get.mockImplementation(async id => {
    const row = rows.get(id); if (!row) throw { status: 404 }; return { ...row, messages: [...row.messages] };
  });
  api.stream.mockImplementation(async (id, message, onEvent) => {
    const row = rows.get(id)!; row.title = message;
    row.messages.push({ role: 'user', text: message }, { role: 'assistant', text: `回答：${message}` });
    onEvent({ type: 'token', text: `回答：${message}` }); onEvent({ type: 'done' });
  });
  api.remove.mockImplementation(async id => { removed.set(id, rows.get(id)!); rows.delete(id); });
  api.restore.mockImplementation(async id => { rows.set(id, removed.get(id)!); removed.delete(id); });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    listeners.add(callback); return { remove: () => listeners.delete(callback) };
  });
});

test('square entry opens the standalone assistant route', async () => {
  const view = await renderApp(<AgentEntry />);
  await fireEvent.press(view.getByTestId('square-agent-entry'));
  expect(mockPush).toHaveBeenCalledWith('/agent');
});
test('starts empty without creating blank records and keeps the input visually blank', async () => {
  const view = await renderApp(<AgentScreen />);
  expect(view.getByTestId('agent-empty')).toBeTruthy();
  expect(view.getByLabelText('输入你的问题').props.placeholder).toBeUndefined();
  expect(api.create).not.toHaveBeenCalled(); expect(api.list).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('我明天几点上课？'));
  expect(view.getByDisplayValue('我明天几点上课？')).toBeTruthy();
  expect(api.stream).not.toHaveBeenCalled();
});
test('first send creates once and follow-up uses the same conversation', async () => {
  const view = await renderApp(<AgentScreen />);
  await fireEvent.changeText(view.getByLabelText('输入你的问题'), '你好');
  await fireEvent.press(view.getByLabelText('发送'));
  await waitFor(() => expect(view.getByText('回答：你好')).toBeTruthy());
  await waitFor(() => expect(view.getByLabelText('输入你的问题').props.editable).toBe(true));
  await fireEvent.changeText(view.getByLabelText('输入你的问题'), '下次放假');
  await fireEvent.press(view.getByLabelText('发送'));
  await waitFor(() => expect(view.getByText('回答：下次放假')).toBeTruthy());
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(api.stream.mock.calls.map(call => call[0])).toEqual(['new-1', 'new-1']);
});
test('creation failure keeps the question and never auto-retries a POST', async () => {
  api.create.mockRejectedValue({ status: 503 });
  const view = await renderApp(<AgentScreen />);
  await fireEvent.changeText(view.getByLabelText('输入你的问题'), '不要丢失');
  await fireEvent.press(view.getByLabelText('发送'));
  await waitFor(() => expect(view.getByText('校园助手暂时无法连接。')).toBeTruthy());
  expect(view.getByDisplayValue('不要丢失')).toBeTruthy();
  expect(api.create).toHaveBeenCalledTimes(1); expect(api.stream).not.toHaveBeenCalled();
});

test('scrolling up keeps the reading position when the reply finishes, then follows again at the bottom', async () => {
  const follow = jest.spyOn(FlatList.prototype, 'scrollToEnd').mockImplementation(() => {});
  let finish: (() => void) | undefined;
  api.stream.mockImplementationOnce(async (id, question, onEvent) => {
    rows.get(id)!.messages = [{ role: 'user', text: question }, { role: 'assistant', text: '较长的回答' }];
    onEvent({ type: 'token', text: '较长的回答' });
    await new Promise<void>(resolve => { finish = resolve; });
    onEvent({ type: 'done' });
  });
  try {
    const view = await renderApp(<AgentScreen />);
    await fireEvent.changeText(view.getByLabelText('输入你的问题'), '长对话');
    await fireEvent.press(view.getByLabelText('发送'));
    await waitFor(() => expect(api.stream).toHaveBeenCalledTimes(1));
    const list = () => view.getByTestId('agent-messages');
    const scroll = async (top: number, height = 1000) => fireEvent.scroll(list(), { nativeEvent: {
      contentOffset: { x: 0, y: top }, contentSize: { width: 400, height }, layoutMeasurement: { width: 400, height: 400 },
    } });
    await scroll(600);
    await fireEvent(list(), 'contentSizeChange', 400, 1000);
    expect(follow).toHaveBeenCalled(); follow.mockClear();
    await scroll(594);
    await fireEvent(list(), 'contentSizeChange', 400, 1200);
    expect(follow).not.toHaveBeenCalled();
    await act(async () => { finish?.(); });
    await waitFor(() => expect(view.getByLabelText('输入你的问题').props.editable).toBe(true));
    await fireEvent(list(), 'contentSizeChange', 400, 1200);
    expect(follow).not.toHaveBeenCalled();
    await scroll(800, 1200);
    await fireEvent(list(), 'contentSizeChange', 400, 1300);
    expect(follow).toHaveBeenCalled();
  } finally { follow.mockRestore(); }
});
test('history opens, deletes current conversation and restores its complete messages', async () => {
  const view = await renderApp(<AgentScreen />);
  await fireEvent.press(view.getByTestId('agent-history-open'));
  await waitFor(() => expect(view.getByTestId('agent-open-main')).toBeTruthy());
  await fireEvent.press(view.getByTestId('agent-open-main'));
  await waitFor(() => expect(view.getByText('原来的回答')).toBeTruthy());
  await fireEvent.press(view.getByTestId('agent-history-open'));
  await waitFor(() => expect(view.getByTestId('agent-delete-main')).toBeTruthy());
  await fireEvent.press(view.getByTestId('agent-delete-main'));
  await waitFor(() => expect(view.getByText('已删除会话')).toBeTruthy());
  expect(view.queryByTestId('agent-open-main')).toBeNull();
  await fireEvent.press(view.getByText('撤销'));
  await waitFor(() => expect(view.getByTestId('agent-open-main')).toBeTruthy());
  await fireEvent.press(view.getByTestId('agent-open-main'));
  await waitFor(() => expect(view.getByText('原来的回答')).toBeTruthy());
  expect(api.remove).toHaveBeenCalledWith('main', expect.any(AbortSignal));
  expect(api.restore).toHaveBeenCalledWith('main', expect.any(AbortSignal));
});
test('a running conversation rejected by delete remains visible', async () => {
  api.remove.mockRejectedValue({ status: 409 });
  const view = await renderApp(<AgentScreen />);
  await fireEvent.press(view.getByTestId('agent-history-open'));
  await waitFor(() => expect(view.getByTestId('agent-delete-main')).toBeTruthy());
  await fireEvent.press(view.getByTestId('agent-delete-main'));
  await waitFor(() => expect(view.getByText('正在回答，完成后再操作。')).toBeTruthy());
  expect(view.getByTestId('agent-open-main')).toBeTruthy();
  expect(view.queryByText('已删除会话')).toBeNull();
});
test('leaving and returning resets selection and discards late create responses', async () => {
  let resolve: ((row: { id: string; title: string; created_at: number }) => void) | undefined;
  api.create.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = await renderApp(<AgentScreen />);
  await fireEvent.changeText(view.getByLabelText('输入你的问题'), '旧账号问题');
  await fireEvent.press(view.getByLabelText('发送'));
  await act(async () => { mockBlur?.(); mockFocus?.(); });
  await act(async () => { resolve?.({ id: 'old', title: 'Old', created_at: 1 }); });
  expect(api.stream).not.toHaveBeenCalled();
  expect(view.getByTestId('agent-empty')).toBeTruthy();
  expect(view.queryByText('旧账号问题')).toBeNull();
});
test('an interrupted connection reads the saved answer without repeating the question', async () => {
  api.stream.mockImplementationOnce(async (id, question) => {
    rows.get(id)!.messages = [{ role: 'user', text: question }, { role: 'assistant', text: '已保存的回答' }];
    throw new Error('Disconnected');
  });
  const view = await renderApp(<AgentScreen />);
  await fireEvent.changeText(view.getByLabelText('输入你的问题'), '查询一次');
  await fireEvent.press(view.getByLabelText('发送'));
  await waitFor(() => expect(view.getByText('已保存的回答')).toBeTruthy());
  expect(api.stream).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('输入你的问题').props.value).toBe('');
});
test('background cancels receiving; foreground recovers with GET, never another chat POST', async () => {
  api.stream.mockImplementationOnce(async (id, question, _event, signal) => {
    rows.get(id)!.messages = [{ role: 'user', text: question }]; rows.get(id)!.running = true;
    await new Promise<void>((_done, reject) => signal?.addEventListener('abort', () => reject(new Error('Aborted'))));
  });
  const view = await renderApp(<AgentScreen />);
  await fireEvent.changeText(view.getByLabelText('输入你的问题'), '后台处理');
  await fireEvent.press(view.getByLabelText('发送'));
  await waitFor(() => expect(api.stream).toHaveBeenCalledTimes(1));
  await act(async () => { listeners.forEach(callback => callback('background')); });
  expect(api.stream.mock.calls[0][3]?.aborted).toBe(true);
  rows.get('new-1')!.messages.push({ role: 'assistant', text: '后台已完成' }); rows.get('new-1')!.running = false;
  await act(async () => { listeners.forEach(callback => callback('active')); });
  await waitFor(() => expect(view.getByText('后台已完成')).toBeTruthy());
  expect(api.stream).toHaveBeenCalledTimes(1);
});
test('a failed model response keeps its error after recovering the saved question', async () => {
  api.stream.mockImplementationOnce(async (id, question) => {
    rows.get(id)!.messages = [{ role: 'user', text: question }];
    throw new Error('Model unavailable');
  });
  const view = await renderApp(<AgentScreen />);
  await fireEvent.changeText(view.getByLabelText('输入你的问题'), '失败的回答');
  await fireEvent.press(view.getByLabelText('发送'));
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  await waitFor(() => expect(view.getByLabelText('输入你的问题').props.editable).toBe(true));
  expect(view.getByText('无法读取，请重新读取。')).toBeTruthy();
  expect(api.stream).toHaveBeenCalledTimes(1);
});
test('session change unmounts private messages and authentication failures use the existing session flow', async () => {
  api.list.mockRejectedValue({ status: 401 });
  let redraw: () => void = () => {};
  function Harness() {
    const [, force] = React.useReducer(value => value + 1, 0);
    React.useEffect(() => { redraw = force; }, []);
    return <AgentScreen />;
  }
  const view = await renderApp(<Harness />);
  await fireEvent.press(view.getByTestId('agent-history-open'));
  await waitFor(() => expect(mockAuthFailure).toHaveBeenCalledWith({ status: 401 }));
  mockSession = { ...mockSession, isSignedIn: false, identifier: 'different' };
  await act(async () => { redraw(); });
  expect(view.queryByTestId('agent-history')).toBeNull();
  expect(view.getByTestId('agent-auth-gate')).toBeTruthy();
});
