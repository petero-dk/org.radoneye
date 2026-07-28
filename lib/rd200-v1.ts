export const SERVICE_UUID_V1 = '000015231212efde1523785feabcd123';
export const TRIGGER_UID_V1 = '000015241212efde1523785feabcd123';
export const DATA_UUID_V1 = '000015251212efde1523785feabcd123';
export const TRIGGER_DATA_V1: number[] = [0x50];

/**
 * V1: float at position 2, multiply by 37 to get Bq/m³
 */
export function parseRadonValueV1(data: Buffer): number {
  return data.readFloatLE(2) * 37;
}
