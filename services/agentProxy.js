const jwt = require('jsonwebtoken');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

/** Private transport: only explicit allowlisted routes supply an upstream path. */
function createAgentProxy({
  baseUrl = process.env.CAMPUS_AGENT_URL || 'http://127.0.0.1:8001',
  secret = process.env.CAMPUS_AGENT_SHARED_SECRET || '',
  fetchImpl = globalThis.fetch,
  timeoutMs = 120000,
} = {}) {
  return async function forward(req, res, path, { stream = false } = {}) {
    if (secret.length < 32 || typeof fetchImpl !== 'function') {
      return res.status(503).json({ status: -1, message: '校园助手尚未配置，请先启动本地 Agent 服务' });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onClose = () => { if (!res.writableFinished) controller.abort(); };
    res.on('close', onClose);
    try {
      const origin = new URL(baseUrl);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
          || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Invalid origin');
      const assertion = jwt.sign({}, secret, {
        algorithm: 'HS256', issuer: 'xmumdorm', audience: 'campus-copilot',
        subject: String(req.user.id), expiresIn: 60,
      });
      const upstream = await fetchImpl(new URL('/internal/xmumdorm' + path, origin), {
        method: req.method,
        headers: { 'Content-Type': 'application/json', 'X-Campus-Assertion': assertion },
        ...(req.method === 'POST' ? { body: JSON.stringify(req.body) } : {}),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok) {
        const data = await upstream.json().catch(() => ({}));
        const bridgeFailure = upstream.status === 401 || upstream.status === 403;
        const message = bridgeFailure ? '校园助手连接验证失败，请检查本地启动配置'
          : typeof data.detail === 'string' ? data.detail : '校园助手请求失败，请刷新后重试';
        return res.status(bridgeFailure ? 502 : upstream.status).json({ status: -1, message });
      }
      if (!stream) {
        return res.json({ status: 0, data: await upstream.json() });
      }
      if (!upstream.headers.get('content-type')?.includes('text/event-stream') || !upstream.body) {
        throw new Error('Invalid stream');
      }
      res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (_error) {
      // Do not expose connection details, assertion tokens, or upstream driver errors.
      if (!res.headersSent && !res.destroyed) {
        res.status(503).json({ status: -1, message: '校园助手暂时无法连接，请启动服务后刷新会话' });
      } else if (!res.destroyed) {
        res.end('data: ' + JSON.stringify({ type: 'error', message: '连接已中断，请刷新会话查看结果' }) + '\n\n');
      }
    } finally {
      clearTimeout(timeout);
      res.off('close', onClose);
    }
  };
}

module.exports = { createAgentProxy };
