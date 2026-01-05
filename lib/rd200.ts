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
 * V1: ~20 bytes with float value
 * V2/V3: ~30+ bytes with additional fields (pulse counters, detailed uptime)
 * @param data Buffer containing status response
 * @param deviceName Optional device name from BLE advertisement for more reliable detection
 * @returns FirmwareVersion enum value
 */
export function detectFirmwareVersion(data: Buffer, deviceName?: string): FirmwareVersion {
  // PRIORITY 1: Device Name Parsing (most reliable)
  // V3.0.1 devices have 'RE' or 'RU' in their names
  if (deviceName) {
    if (deviceName.includes('RE') || deviceName.includes('RU')) {
      return FirmwareVersion.V3;
    }
  }
  
  // PRIORITY 2: Packet Length + Header Bytes
  // V3.0.1 Live-Data packets are 32 bytes with specific header
  if (data.length === 32 && data[0] === 0xAA && data[1] === 0x02) {
    return FirmwareVersion.V3; // V3 Live-Data Header
  }
  
  // Existing logic as fallback for status responses
  if (data.length >= 15 && data[15] === 0x06) {
    return FirmwareVersion.V2;
  }
  if (data.length >= 15 && data[14] === 0x07) {
    return FirmwareVersion.V3;
  }
  
  // V1 is specifically 20 bytes
  if (data.length === 20) {
    return FirmwareVersion.V1;
  }
  
  // V2/V3 are 30+ bytes
  if (data.length >= 30) {
    return FirmwareVersion.V2;
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
    // V1: float at position 2, multiply by 37
    return data.readFloatLE(2) * 37;
  } else if (version === FirmwareVersion.V2) {
    // V2: uint16 at position 0-1 (radon current)
    return data.readUInt16LE(0);
  } else if (version === FirmwareVersion.V3) {
    // V3.0.1: uint16 at position 14-15 (radon current) - CRITICAL FIX!
    return data.readUInt16LE(14);
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
 * V1: Limited device info from BLE advertisement name (manufacturer:model:serial)
 * V2/V3: Additional device info embedded in the data packet
 * @param data Buffer containing status response
 * @param version FirmwareVersion enum value
 * @returns Object with serial and model information
 */
export function parseDeviceInfo(data: Buffer, version: FirmwareVersion): { serial: string, model: string } {
  let serial = 'unknown';
  let model = 'unknown';

  if (version === FirmwareVersion.V3) {
    // V3: Serial at 2-13, Model at 16-22 (corrected positions)
    try {
      serial = readString(data, 2, 12).replace(/\0/g, '');
      model = readString(data, 16, 7).replace(/\0/g, ''); // Position corrected
    } catch (e) {
      // Fall back to unknown if parsing fails
      serial = 'unknown';
      model = 'unknown';
    }
  } else if (version === FirmwareVersion.V2) {
    // V2: Parse from data packet
    // Serial: typically stored as ASCII string in the packet
    // Model: typically stored as ASCII string in the packet
    // Note: exact positions may vary based on actual packet structure
    // These are approximate positions based on typical BLE packet format
    try {
      serial = readString(data, 10, 12).replace(/\0/g, '');
      model = readString(data, 22, 8).replace(/\0/g, '');
    } catch (e) {
      // Fall back to unknown if parsing fails
      serial = 'unknown';
      model = 'unknown';
    }
  }

  return { serial, model };
}

/**
 * Parse extended fields available in V2/V3 firmware
 * @param data Buffer containing status response
 * @returns Object with V2/V3 extended field values
 */
export interface V2V3ExtendedData {
  radon24hAvg?: number;      // uint16, Bq/m³
  radon1MonthAvg?: number;   // uint16, Bq/m³
  peakRadon?: number;        // uint16, Bq/m³
  uptimeHours?: number;      // uint16, hours
  pulseCounterCurrent?: number; // uint32, counts
  pulse10minInterval?: number;  // uint32, counts/10min
  uptimeMinutes?: number;    // uint8, minutes
  uptimeSeconds?: number;    // uint8, seconds
  firmwareVersion?: string;  // string or version info
}

/**
 * Parse extended V2/V3 fields from the data buffer
 * @param data Buffer containing the status response (V2/V3 format)
 * @returns Object containing parsed extended fields
 */
export function parseExtendedV2V3Fields(data: Buffer): V2V3ExtendedData {
  const result: V2V3ExtendedData = {};

  try {
    // Expected V2/V3 packet structure (approximate positions):
    // Offset 0-1: Radon Current (uint16 LE)
    // Offset 2-3: Radon 24h Average (uint16 LE)
    // Offset 4-5: Radon 1-Month Average (uint16 LE)
    // Offset 6-7: Peak Radon (uint16 LE)
    // Offset 8-9: Uptime Hours (uint16 LE)
    // Offset 10-13: Pulse Counter Current (uint32 LE)
    // Offset 14-17: Pulse 10min Interval (uint32 LE)
    // Offset 18: Uptime Minutes (uint8)
    // Offset 19: Uptime Seconds (uint8)
    // Offset 20+: Firmware Version (string/version bytes)

    if (data.length >= 2) result.radon24hAvg = data.readUInt16LE(2);
    if (data.length >= 4) result.radon1MonthAvg = data.readUInt16LE(4);
    if (data.length >= 6) result.peakRadon = data.readUInt16LE(6);
    if (data.length >= 8) result.uptimeHours = data.readUInt16LE(8);
    if (data.length >= 14) result.pulseCounterCurrent = data.readUInt32LE(10);
    if (data.length >= 18) result.pulse10minInterval = data.readUInt32LE(14);
    if (data.length >= 19) result.uptimeMinutes = data.readUInt8(18);
    if (data.length >= 20) result.uptimeSeconds = data.readUInt8(19);
    
    // Firmware version - attempt to parse as ASCII string
    if (data.length >= 24) {
      result.firmwareVersion = readString(data, 20, 4).replace(/\0/g, '');
    }
  } catch (error) {
    // If parsing fails, return what we could parse
    console.error('Error parsing extended V2/V3 fields:', error);
  }

  return result;
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