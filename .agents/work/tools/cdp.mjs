// 极简 CDP 驱动：开标签、导航、评估、截图，够本会话验收用。
// 自己写而不用现成库，是因为要验的正是「打开页面后真实报什么错」，
// 中间层越薄越好定位。
import WebSocket from 'ws';

export async function openPage(url, { width = 1440, height = 900 } = {}) {
  const list = await (await fetch('http://127.0.0.1:9333/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json();
  const ws = new WebSocket(list.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ') });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push({ type: 'exception', text: d.exception?.description ?? d.text });
    }
    if (m.method === 'Log.entryAdded') {
      logs.push({ type: m.params.entry.level, text: m.params.entry.text, url: m.params.entry.url });
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const tid = list.id;
  return {
    tid,
    logs,
    send,
    async goto(u, waitMs = 2500) {
      await send('Page.navigate', { url: u });
      await new Promise((r) => setTimeout(r, waitMs));
    },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(path) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      const fs = await import('node:fs/promises');
      await fs.writeFile(path, Buffer.from(r.data, 'base64'));
    },
    close() { ws.close(); },
  };
}
