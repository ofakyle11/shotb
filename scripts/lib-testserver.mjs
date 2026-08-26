/* A static server for the browser tests, on a port nobody else is using.
 *
 * Both browser harnesses used to hardcode a port (8123, 8124) and then sleep
 * 1200 ms and hope. That is two separate bugs wearing one line:
 *
 *   · Two runs at once collide. During the Phase 1 audit ~20 agents ran the
 *     suite concurrently and one reported test_set3d_browser failing. The code
 *     was fine — the second run bound nothing and talked to the first run's
 *     server, which was serving a different working directory. A test that
 *     fails when someone else is also testing is worse than no test, because
 *     it teaches you to disbelieve red.
 *   · A fixed sleep is either too long (every run pays it) or too short (a
 *     loaded machine fails). It is never right.
 *
 * So: bind port 0 and let the OS choose, read the port the server actually
 * got, and poll until it answers rather than sleeping.
 */
import { spawn } from 'child_process';

export async function startServer(root, { timeoutMs = 15000 } = {}) {
  /* stdout, not stderr: http.server announces the port with a plain print(),
     and the per-request log lines are the ones that go to stderr. */
  const server = spawn('python3', ['-m', 'http.server', '0', '--bind', '127.0.0.1'],
    { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });

  const stop = () => { try { server.kill('SIGKILL'); } catch { /* already gone */ } };
  process.on('exit', stop);

  /* "Serving HTTP on 127.0.0.1 port 45123 (http://127.0.0.1:45123/) ..." */
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('server did not announce a port')), timeoutMs);
    server.stdout.on('data', (d) => {
      buf += d.toString();
      const m = /port\s+(\d+)/.exec(buf);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    server.on('error', (e) => { clearTimeout(timer); reject(e); });
    server.on('exit', (code) => { clearTimeout(timer); reject(new Error('server exited: ' + code)); });
  });

  /* Announced is not the same as answering. Poll the real thing. */
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/index.html`, { method: 'HEAD' });
      if (res.status < 500) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) { stop(); throw new Error('server never answered on port ' + port); }
    await new Promise((r) => setTimeout(r, 50));
  }

  return { server, port, base: `http://127.0.0.1:${port}`, stop };
}
