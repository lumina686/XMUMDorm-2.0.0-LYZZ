jest.mock('../../shared/api/config', () => ({ API_BASE_URL: '' }));
jest.mock('../../shared/api/request', () => ({ getToken: () => 'fixture-token' }));
const { createAgentEventParser, streamAgentChat } = require('../../shared/api/agent');

test('parses split CRLF, comments and final frames', () => {
  const events = [];
  const parser = createAgentEventParser(event => events.push(event));
  parser.push(': keep-alive\r\n\r\ndata: {"type":"token","text":"你');
  parser.push('好"}\r');
  parser.push('\n\r\ndata: {"type":"done"}', true);
  expect(events).toEqual([{ type: 'token', text: '你好' }, { type: 'done' }]);
});

test('stream decoder preserves split UTF-8 and accepts interrupted approvals', async () => {
  const bytes = new TextEncoder().encode('data: {"type":"token","text":"中文🌿"}\n\ndata: {"type":"interrupt","checkpoint_id":"cp"}\n\n');
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
    start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); },
  }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const events = [];
  await streamAgentChat({ message: 'hello' }, event => events.push(event));
  expect(events[0].text).toBe('中文🌿');
  expect(events[1].checkpoint_id).toBe('cp');
});

test('unexpected EOF is not success and never repeats the POST', async () => {
  const mock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('data: {"type":"token","text":"partial"}\n\n', {
    headers: { 'Content-Type': 'text/event-stream' },
  }));
  await expect(streamAgentChat({ message: 'hello' }, () => {})).rejects.toThrow('不要重复发送');
  expect(mock).toHaveBeenCalledTimes(1);
});

test('keeps auth failure flags and forwards abort signals', async () => {
  const mock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: -1, message: '停用', accountDeactivated: true }), {
    status: 403, headers: { 'Content-Type': 'application/json' },
  }));
  const controller = new AbortController();
  await expect(streamAgentChat({ message: 'hello' }, () => {}, { signal: controller.signal }))
    .rejects.toMatchObject({ status: 403, body: { accountDeactivated: true } });
  expect(mock.mock.calls[0][1].signal).toBe(controller.signal);
});

test('uses a host-provided streaming fetch without changing the Web default', async () => {
  const fallback = jest.spyOn(globalThis, 'fetch');
  const hostFetch = jest.fn().mockResolvedValue(new Response('data: {"type":"done"}\n\n', {
    headers: { 'Content-Type': 'text/event-stream' },
  }));
  const controller = new AbortController();
  await streamAgentChat({ conversation_id: 'one', message: 'hello' }, () => {}, { signal: controller.signal, fetchImpl: hostFetch });
  expect(fallback).not.toHaveBeenCalled();
  expect(hostFetch).toHaveBeenCalledTimes(1);
  expect(hostFetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal, headers: { Authorization: 'Bearer fixture-token' } });
});
