import {
  DATA_UUID_V1,
  parseRadonValueV1,
  SERVICE_UUID_V1,
  TRIGGER_DATA_V1,
  TRIGGER_UID_V1,
} from './rd200-v1.ts';
import {
  COMMAND_STATUS_V2,
  COMMAND_UUID_V2,
  parseDeviceInfoV2V3,
  parseExtendedV2V3Fields,
  parseRadonValueV2V3,
  SERVICE_UUID_V2,
  STATUS_UUID_V2,
  V2V3ExtendedData,
} from './rd200-v2.ts';

export {
  DATA_UUID_V1,
  SERVICE_UUID_V1,
  TRIGGER_DATA_V1,
  TRIGGER_UID_V1,
  COMMAND_STATUS_V2,
  COMMAND_UUID_V2,
  SERVICE_UUID_V2,
  STATUS_UUID_V2,
  parseExtendedV2V3Fields,
  V2V3ExtendedData,
};

// Legacy exports for backward compatibility
export const SERVICE_UUID = SERVICE_UUID_V1;
export const TRIGGER_UID = TRIGGER_UID_V1;
export const DATA_UUID = DATA_UUID_V1;
export const TRIGGER_DATA = TRIGGER_DATA_V1;

export const RADONEYE_BLUETOOTH_COMPANY_ID = 'f24be3';

export const RD200 = 'R20'; // RadonEye First Generation BLE

export enum FirmwareVersion {
  V1 = 1,
  V2 = 2,
  V3 = 3,
  UNKNOWN = 0
}

/**
 * Detect firmware version from status data
 * V1: ~20 bytes with float value
 * V2/V3: ~30+ bytes with additional fields (pulse counters, detailed uptime)
 * @param data Buffer containing status response
 * @param deviceName Optional device name from BLE advertisement for more reliable detection
 * @returns FirmwareVersion enum value
 */
export function detectFirmwareVersion(data: Buffer, deviceName?: string): FirmwareVersion {
  // PRIORITY 1: Full status response marker bytes.
  if (data.length >= 16 && data[0] === 0x40 && data[15] === 0x06) {
    return FirmwareVersion.V2;
  }
  if (data.length >= 15 && data[0] === 0x40 && data[14] === 0x07) {
    return FirmwareVersion.V3;
  }

  // PRIORITY 2: Device name hint as fallback.
  if (deviceName) {
    if (deviceName.includes('RE') || deviceName.includes('RU')) {
      return FirmwareVersion.V3;
    }
  }

  // V1 is specifically 20 bytes
  if (data.length === 20) {
    return FirmwareVersion.V1;
  }

  // Default to V1
  return FirmwareVersion.V1;
}

/**
 * Parse radon value from data based on firmware version
 * V1: float at position 2, multiply by 37 to get Bq/m³
 * V2: uint16 at position 0-1 (little-endian) containing radon current in Bq/m³
 * V3: uint16 at position 14-15 (little-endian) containing radon current in Bq/m³
 * @param data Buffer containing the data response
 * @param version FirmwareVersion enum value
 * @returns Radon value in Bq/m³
 */
export function parseRadonValue(data: Buffer, version: FirmwareVersion): number {
  if (version === FirmwareVersion.V1) {
    return parseRadonValueV1(data);
  }
  if (version === FirmwareVersion.V2) {
    return parseRadonValueV2V3(data, false);
  }
  if (version === FirmwareVersion.V3) {
    return parseRadonValueV2V3(data, true);
  }
  throw new Error(`Unsupported firmware version: ${version}`);
}

/**
 * Parse device information from status data
 * V1: Limited device info from BLE advertisement name (manufacturer:model:serial)
 * V2/V3: Additional device info embedded in the data packet
 * @param data Buffer containing status response
 * @param version FirmwareVersion enum value
 * @returns Object with serial and model information
 */
export function parseDeviceInfo(data: Buffer, version: FirmwareVersion): { serial: string, model: string } {
  if (version === FirmwareVersion.V2) {
    return parseDeviceInfoV2V3(data, false);
  }
  if (version === FirmwareVersion.V3) {
    return parseDeviceInfoV2V3(data, true);
  }
  return { serial: 'unknown', model: 'unknown' };
}
