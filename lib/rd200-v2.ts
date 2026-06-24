export const SERVICE_UUID_V2 = "00001523-0000-1000-8000-00805f9b34fb";
export const COMMAND_UUID_V2 = "00001524-0000-1000-8000-00805f9b34fb";
export const STATUS_UUID_V2 = "00001525-0000-1000-8000-00805f9b34fb";
export const COMMAND_STATUS_V2 = 0x40;

/**
 * Parse V2/V3 radon value from status packet.
 * Full status (0x40): current radon is uint16 at offset 0x21 (33).
 */
export function parseRadonValueV2V3(data: Buffer, isV3: boolean): number {
  void isV3;
  return data.readUInt16LE(33);
}

function readString(data: Buffer, offset: number, length: number): string {
  return data.toString('ascii', offset, offset + length);
}

export interface V2V3ExtendedData {
  dayAvgRadon?: number;
  monthAvgRadon?: number;
  peakRadon?: number;
  uptimeTotalMinutes?: number;
  uptimeHours?: number;
  uptimeMinutes?: number;
  uptimeSeconds?: number;
  firmwareVersion?: string;
  displayUnit?: 'pci/l' | 'bq/m3';
  alarmEnabled?: boolean;
  alarmLevelBqM3?: number;
  alarmInterval10Min?: number;
  particleCountCurrent?: number;
  particleCountPrevious?: number;
  historyDataPoints?: number;
}

/**
 * Parse device info from V2/V3 status data.
 */
export function parseDeviceInfoV2V3(data: Buffer, isV3: boolean): { serial: string, model: string } {
  let serial = 'unknown';
  let model = 'unknown';

  try {
    if (isV3) {
      serial = readString(data, 2, 12).replace(/\0/g, '');
      model = readString(data, 15, 7).replace(/\0/g, '');
    } else {
      const serialPart1 = readString(data, 8, 3);   // series
      const serialPart2 = readString(data, 2, 6);   // date YYMMDD
      const serialPart3 = readString(data, 11, 4);  // index
      serial = `${serialPart1}${serialPart2}${serialPart3}`.replace(/\0/g, '');
      model = readString(data, 16, 6).replace(/\0/g, '');
    }
  } catch (e) {
    serial = 'unknown';
    model = 'unknown';
  }

  return { serial, model };
}

/**
 * Parse extended V2/V3 fields from status data.
 */
export function parseExtendedV2V3Fields(data: Buffer): V2V3ExtendedData {
  const result: V2V3ExtendedData = {};

  try {
    // Full status response starts with command code 0x40.
    if (data.length > 0 && data[0] !== 0x40) {
      return result;
    }

    if (data.length >= 28) result.firmwareVersion = readString(data, 22, 6).replace(/\0/g, '');
    if (data.length >= 29) result.displayUnit = data.readUInt8(28) ? 'bq/m3' : 'pci/l';
    if (data.length >= 30) result.alarmEnabled = data.readUInt8(29) !== 0;
    if (data.length >= 32) result.alarmLevelBqM3 = data.readUInt16LE(30);
    if (data.length >= 33) result.alarmInterval10Min = data.readUInt8(32);

    if (data.length >= 35) result.dayAvgRadon = data.readUInt16LE(35);
    if (data.length >= 37) result.monthAvgRadon = data.readUInt16LE(37);
    if (data.length >= 41) result.particleCountCurrent = data.readUInt16LE(39);
    if (data.length >= 43) result.particleCountPrevious = data.readUInt16LE(41);

    if (data.length >= 45) {
      const uptimeTotalMinutes = data.readUInt16LE(43);
      result.uptimeTotalMinutes = uptimeTotalMinutes;
      result.uptimeHours = Math.floor(uptimeTotalMinutes / 60);
      result.uptimeMinutes = uptimeTotalMinutes % 60;
      result.uptimeSeconds = 0;
    }

    if (data.length >= 53) result.peakRadon = data.readUInt16LE(51);
    if (data.length >= 59) result.historyDataPoints = data.readUInt16LE(57);
  } catch (error) {
    console.error('Error parsing extended V2/V3 fields:', error);
  }

  return result;
}
