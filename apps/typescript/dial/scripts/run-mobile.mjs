/**
 * Installs and launches the Dial Android app on a connected device.
 *
 * Assumes `npx expo run:android` has already produced a debug APK. Re-running
 * the full Gradle build to change one line of JavaScript would be absurd -- the
 * debug build loads its JavaScript from Metro at runtime, so installing once
 * and restarting Metro is the whole loop.
 *
 *   node scripts/run-mobile.mjs
 *
 * Waits for a device, so it can be started before the phone is plugged in.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SDK = process.env.ANDROID_HOME ?? `${process.env.LOCALAPPDATA}\\Android\\Sdk`;
const ADB = path.join(SDK, 'platform-tools', 'adb.exe');
const APK = path.resolve('apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk');
const PACKAGE = 'com.dial.app';
const API_PORT = 4000;

function adb(args, opts = {}) {
  return spawnSync(ADB, args, { encoding: 'utf8', ...opts });
}

function devices() {
  return (adb(['devices']).stdout ?? '')
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim().endsWith('\tdevice'))
    .map((l) => l.split('\t')[0]);
}

if (!existsSync(APK)) {
  console.error(`No debug APK at ${APK}\nRun: cd apps/mobile && npx expo run:android`);
  process.exit(1);
}

console.log('Waiting for a device (plug the phone in, allow USB debugging)...');
let serial = devices()[0];
const deadline = Date.now() + 10 * 60_000;
while (!serial && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2000));
  serial = devices()[0];
}
if (!serial) {
  console.error('No device appeared within ten minutes.');
  process.exit(1);
}

const model = (adb(['-s', serial, 'shell', 'getprop', 'ro.product.model']).stdout ?? '').trim();
console.log(`device: ${serial} (${model})`);

/*
 * The app's default API address is localhost, which on a phone means the phone.
 * `adb reverse` tunnels the device's localhost to this machine over USB, so no
 * build-time configuration changes and it does not matter whether the two are
 * on the same network.
 */
for (const port of [API_PORT, 8081]) {
  adb(['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
}
console.log(`forwarded: localhost:${API_PORT} (API) and localhost:8081 (Metro)`);

console.log('installing...');
const install = adb(['-s', serial, 'install', '-r', '-d', APK], { maxBuffer: 1024 * 1024 * 16 });
const installOut = `${install.stdout ?? ''}${install.stderr ?? ''}`.trim();
if (!/Success/i.test(installOut)) {
  console.error(`install failed:\n${installOut}`);
  process.exit(1);
}
console.log('installed');

console.log('starting Metro...');
const metro = spawn('npx', ['expo', 'start', '--port', '8081'], {
  cwd: path.resolve('apps/mobile'),
  stdio: 'inherit',
  shell: true,
});

// Metro needs to be serving before the app asks it for a bundle.
await new Promise((r) => setTimeout(r, 8000));
adb(['-s', serial, 'shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1']);
console.log(`launched ${PACKAGE}. Metro is running here; Ctrl+C stops it.`);

process.on('SIGINT', () => {
  metro.kill();
  process.exit(0);
});
