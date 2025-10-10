// V1 Firmware UUIDs and constants
export const SERVICE_UUID_V1 = "000015231212efde1523785feabcd123";
export const TRIGGER_UID_V1 = "000015241212efde1523785feabcd123";
export const DATA_UUID_V1 = "000015251212efde1523785feabcd123";
export const TRIGGER_DATA_V1: number[] = [0x50];

// V2/V3 Firmware UUIDs and constants
export const SERVICE_UUID_V2 = "00001523-0000-1000-8000-00805f9b34fb";
export const COMMAND_UUID_V2 = "00001524-0000-1000-8000-00805f9b34fb";
export const STATUS_UUID_V2 = "00001525-0000-1000-8000-00805f9b34fb";
export const COMMAND_STATUS_V2 = 0x40;

// Legacy exports for backward compatibility
export const SERVICE_UUID = SERVICE_UUID_V1;
export const TRIGGER_UID = TRIGGER_UID_V1;
export const DATA_UUID = DATA_UUID_V1;
export const TRIGGER_DATA = TRIGGER_DATA_V1;

export const RADONEYE_BLUETOOTH_COMPANY_ID = "f24be3";

export const RD200 = "R20"; // RadonEye First Generation BLE

export enum FirmwareVersion {
  V1 = 1,
  V2 = 2,
  V3 = 3,
  UNKNOWN = 0
}

/**
 * Detect firmware version from status data
 * @param data Buffer containing status response
 * @returns FirmwareVersion enum value
 */
export function detectFirmwareVersion(data: Buffer): FirmwareVersion {
  if (data.length >= 15 && data[15] === 0x06) {
    return FirmwareVersion.V2;
  } else if (data.length >= 15 && data[14] === 0x07) {
    return FirmwareVersion.V3;
  }
  // V1 firmware returns 20-byte data with float at position 2
  return FirmwareVersion.V1;
}

/**
 * Parse radon value from data based on firmware version
 * @param data Buffer containing the data response
 * @param version FirmwareVersion enum value
 * @returns Radon value in Bq/m³
 */
export function parseRadonValue(data: Buffer, version: FirmwareVersion): number {
  if (version === FirmwareVersion.V1) {
    // V1: float at position 2, multiply by 37
    return data.readFloatLE(2) * 37;
  } else if (version === FirmwareVersion.V2 || version === FirmwareVersion.V3) {
    // V2/V3: short at position 33
    return data.readUInt16LE(33);
  }
  throw new Error(`Unsupported firmware version: ${version}`);
}

/**
 * Helper function to read string from buffer with specific encoding
 * @param data Buffer to read from
 * @param offset Starting position
 * @param length Number of bytes to read
 * @returns String value
 */
function readString(data: Buffer, offset: number, length: number): string {
  return data.toString('ascii', offset, offset + length);
}

/**
 * Parse device information from status data
 * @param data Buffer containing status response
 * @param version FirmwareVersion enum value
 * @returns Object with serial and model information
 */
export function parseDeviceInfo(data: Buffer, version: FirmwareVersion): { serial: string, model: string } {
  let serial = 'unknown';
  let model = 'unknown';

  if (version === FirmwareVersion.V2) {
    const serialPart1 = readString(data, 8, 3);
    const serialPart2 = readString(data, 2, 6);
    const serialPart3 = readString(data, 11, 4);
    serial = serialPart1 + serialPart2 + serialPart3;
    model = readString(data, 16, 6);
  } else if (version === FirmwareVersion.V3) {
    serial = readString(data, 2, 12);
    model = readString(data, 15, 7);
  }

  return { serial, model };
}



/*

private String getSerial(BluetoothDiscoveryDevice device) {
    String name = device.getName();
    String[] parts = name.split(":");
    if (parts.length == 3) {
        return parts[2];
    } else {
        return "";
    }
}

private String getManufacturer(BluetoothDiscoveryDevice device) {
    String name = device.getName();
    String[] parts = name.split(":");
    if (parts.length == 3) {
        return parts[0];
    } else {
        return "";
    }
}

private String getModel(BluetoothDiscoveryDevice device) {
    String name = device.getName();
    String[] parts = name.split(":");
    if (parts.length == 3) {
        return parts[1];
    } else {
        return "";
    }
}

*/