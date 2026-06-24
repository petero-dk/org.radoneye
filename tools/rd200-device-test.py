#!/usr/bin/env python3

import argparse
import asyncio
import json
import subprocess
import sys
from pathlib import Path

try:
    from bleak import BleakClient
except ImportError:
    print('Missing dependency: bleak. Install with: pip install bleak')
    sys.exit(1)


ROOT = Path(__file__).resolve().parent.parent
PARSER_SCRIPT = ROOT / 'tools' / 'rd200-parse.js'

SERVICE_UUID_V1 = '000015231212efde1523785feabcd123'
TRIGGER_UID_V1 = '000015241212efde1523785feabcd123'
DATA_UUID_V1 = '000015251212efde1523785feabcd123'
TRIGGER_DATA_V1 = bytes([0x50])

SERVICE_UUID_V2 = '00001523-0000-1000-8000-00805f9b34fb'
COMMAND_UUID_V2 = '00001524-0000-1000-8000-00805f9b34fb'
STATUS_UUID_V2 = '00001525-0000-1000-8000-00805f9b34fb'
COMMAND_STATUS_V2 = bytes([0x40])


def run_parser(mode: str, payload: bytes, device_name: str | None) -> dict:
    command = [
        'node',
        str(PARSER_SCRIPT),
        '--mode', mode,
        '--hex', payload.hex(),
    ]

    if device_name:
        command.extend(['--deviceName', device_name])

    result = subprocess.run(command, cwd=str(ROOT), capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f'Parser failed: {result.stderr.strip() or result.stdout.strip()}')

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f'Invalid parser JSON output: {result.stdout}') from exc


def run_build() -> None:
    result = subprocess.run(['pnpm', 'build'], cwd=str(ROOT), capture_output=True, text=True)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f'pnpm build failed: {message}')


async def test_device(mac: str, name_hint: str | None) -> int:
    print(f'Connecting to device {mac} ...')

    async with BleakClient(mac, timeout=20.0) as client:
        if not client.is_connected:
            print('Failed to connect.')
            return 1

        print('Connected.')

        try:
            print('Trying V2/V3 read...')
            parsed = None
            raw_v2 = b''

            async def read_v2_status_notification(timeout_seconds: float = 5.0) -> bytes:
                loop = asyncio.get_running_loop()
                future: asyncio.Future[bytes] = loop.create_future()

                def callback(_: object, data: bytearray) -> None:
                    if future.done():
                        return
                    if len(data) > 0 and data[0] == 0x40:
                        future.set_result(bytes(data))

                await client.start_notify(STATUS_UUID_V2, callback)
                try:
                    await client.write_gatt_char(COMMAND_UUID_V2, COMMAND_STATUS_V2, response=False)
                    return await asyncio.wait_for(future, timeout_seconds)
                finally:
                    await client.stop_notify(STATUS_UUID_V2)

            for attempt in range(1, 4):
                raw_v2 = await read_v2_status_notification()
                parsed = run_parser('v2v3', raw_v2, name_hint)

                if parsed.get('radon', 0) > 0 or parsed.get('firmwareVersion') in (2, 3):
                    break

                print(f'V2/V3 attempt {attempt} returned empty/unknown values, retrying...')

            if parsed is not None:
                parsed['rawHex'] = raw_v2.hex()
                parsed['rawLength'] = len(raw_v2)
                print('V2/V3 read successful:')
                print(json.dumps(parsed, indent=2))

                if parsed.get('firmwareVersion') in (2, 3):
                    return 0

                print('V2/V3 response looks like non-v2 payload, trying V1 fallback...')
        except Exception as v2_error:
            print(f'V2/V3 read failed: {v2_error}')

        try:
            print('Trying V1 read...')
            await client.write_gatt_char(TRIGGER_UID_V1, TRIGGER_DATA_V1, response=True)
            await asyncio.sleep(0.3)
            v1_data = await client.read_gatt_char(DATA_UUID_V1)
            parsed = run_parser('v1', bytes(v1_data), name_hint)
            parsed['rawLength'] = len(v1_data)
            parsed['rawHex'] = bytes(v1_data).hex()
            print('V1 read successful:')
            print(json.dumps(parsed, indent=2))
            return 0
        except Exception as v1_error:
            print(f'V1 read failed: {v1_error}')
            return 2


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Read RD200 data from a BLE device by MAC and parse using local libraries.'
    )
    parser.add_argument('mac', help='Bluetooth MAC address, e.g. AA:BB:CC:DD:EE:FF')
    parser.add_argument('--device-name', dest='device_name', default=None, help='Optional BLE device name hint')
    parser.add_argument('--skip-build', action='store_true', help='Skip running pnpm build before test')
    args = parser.parse_args()

    if not args.skip_build:
        print('Running pnpm build to refresh parser output...')
        try:
            run_build()
        except Exception as build_error:
            print(build_error)
            return 1

    if not PARSER_SCRIPT.exists():
        print(f'Parser script not found at {PARSER_SCRIPT}')
        return 1

    try:
        return asyncio.run(test_device(args.mac, args.device_name))
    except KeyboardInterrupt:
        print('Cancelled by user.')
        return 130


if __name__ == '__main__':
    raise SystemExit(main())
