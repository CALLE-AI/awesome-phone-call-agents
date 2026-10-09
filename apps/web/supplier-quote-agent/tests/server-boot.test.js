// The real provider is built per call by invoke.js, so src/server.js also builds it once at
// startup: a misconfiguration stops the server before the owner approves anything, and the
// message names the variable, never its value. Spawned as a child process on an ephemeral
// loopback port; it exits before listening, so nothing is ever contacted.
const { spawn } = require('child_process');
const path = require('path');

function boot(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
      env: { PATH: process.env.PATH, PORT: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`server did not exit within 5s (stdout: ${stdout})`));
    }, 5000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe('server startup with the real provider selected', () => {
  test.each([
    ['a base URL on another host', { CALLE_BASE_URL: 'https://attacker.example' }, /CALLE_BASE_URL is not an approved CALL-E origin/, 'attacker'],
    ['a sample number in the allowlist', { CALLE_ALLOWED_DESTINATIONS: '+44 20 7946 0958' }, /entry #1 \(\+•••••58\) is a number reserved for fiction/, '7946'],
    ['a key with a newline in it', { CALLE_API_KEY: 'sk_FAKE_A\nsk_FAKE_B' }, /CALLE_API_KEY contains whitespace/, 'sk_FAKE']
  ])('refuses to start with %s, naming the variable but not its value', async (_label, env, message, secret) => {
    const { code, stdout, stderr } = await boot({ CALL_PROVIDER: 'calle', ...env });
    expect(code).toBe(1);
    expect(stderr).toMatch(/^Refusing to start: /);
    expect(stderr).toMatch(message);
    expect(stderr + stdout).not.toContain(secret);
    expect(stdout).not.toMatch(/listening/);
  });
});
