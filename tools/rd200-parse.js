#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const compiledRd200 = path.join(root, '.homeybuild', 'lib', 'rd200.js');
const compiledV1 = path.join(root, '.homeybuild', 'lib', 'rd200-v1.js');
const compiledV2 = path.join(root, '.homeybuild', 'lib', 'rd200-v2.js');

if (!fs.existsSync(compiledRd200) || !fs.existsSync(compiledV1) || !fs.existsSync(compiledV2)) {
  console.error('Missing compiled library output in .homeybuild/lib. Run "pnpm build" first.');
  process.exit(1);
}

const rd200 = require(compiledRd200);
const v1 = require(compiledV1);
const v2 = require(compiledV2);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      args[key] = value;
    }
  }
  return args;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = parseArgs(process.argv);
const mode = args.mode;
const hex = args.hex;
const deviceName = args.deviceName;

if (!mode || !hex) {
  fail('Usage: node tools/rd200-parse.js --mode <v1|v2v3> --hex <hex-payload> [--deviceName <name>]');
}

const sanitizedHex = hex.replace(/[^a-fA-F0-9]/g, '');
if (sanitizedHex.length === 0 || sanitizedHex.length % 2 !== 0) {
  fail('Invalid hex payload.');
}

const payload = Buffer.from(sanitizedHex, 'hex');

if (mode === 'v1') {
  const radon = v1.parseRadonValueV1(payload);
  console.log(JSON.stringify({ mode: 'v1', radon }));
  process.exit(0);
}

if (mode === 'v2v3') {
  const firmwareVersion = rd200.detectFirmwareVersion(payload, deviceName);
  const isV3 = firmwareVersion === rd200.FirmwareVersion.V3;
  const radon = v2.parseRadonValueV2V3(payload, isV3);
  const deviceInfo = v2.parseDeviceInfoV2V3(payload, isV3);
  const extended = v2.parseExtendedV2V3Fields(payload);

  console.log(JSON.stringify({
    mode: 'v2v3',
    firmwareVersion,
    isV3,
    radon,
    deviceInfo,
    extended,
  }));
  process.exit(0);
}

fail('Unsupported mode. Use --mode v1 or --mode v2v3.');
