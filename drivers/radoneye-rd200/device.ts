import Homey, { BleAdvertisement, BlePeripheral } from 'homey';
import * as rd200 from '../../lib/rd200.ts';
import {
  DATA_UUID_V1,
  parseRadonValueV1,
  SERVICE_UUID_V1,
  TRIGGER_DATA_V1,
  TRIGGER_UID_V1,
} from '../../lib/rd200-v1.ts';
import {
  COMMAND_STATUS_V2,
  COMMAND_UUID_V2,
  parseExtendedV2V3Fields,
  parseRadonValueV2V3,
  SERVICE_UUID_V2,
  STATUS_UUID_V2,
  parseDeviceInfoV2V3,
} from '../../lib/rd200-v2.ts';

module.exports = class Rd200Device extends Homey.Device {
  private static SYNC_INTERVAL: number = 1000 * 60 * 5; // 5 minutes
  private static ENABLE_TEMP_RAW_LOGS: boolean = false;

  private advertisement?: BleAdvertisement;
  private onSyncInterval?: ReturnType<typeof setTimeout>;
  private operationInProgress: boolean = false;
  private firmwareVersion: rd200.FirmwareVersion = rd200.FirmwareVersion.V1;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('Rd200Device has been initialized');
    this.onSyncInterval = setInterval(
      () => {
        this.onSync().catch((err: Error) => {
          this.error(`onSync failed: ${err.message}`);
        });
      },
      Rd200Device.SYNC_INTERVAL,
    );
    this.onSync().catch((err: Error) => {
      this.error(`Initial onSync failed: ${err.message}`);
    });
  }

  async onSync(): Promise<void> {
    if (this.operationInProgress) {
      this.log('Operation already in progress, skipping this interval.');
      return;
    }
    this.log('Starting sync operation...');

    this.operationInProgress = true;

    this.advertisement = await this.findAdvertisement();
    let peripheral: BlePeripheral | undefined;
    let syncSucceeded = false;
    try {
      peripheral = await this.connectToDevice();
      if (!peripheral) {
        this.error('Failed to connect to the device, will retry at next interval.');
        return;
      }

      let result: number | null = null;

      // Try v2/v3 firmware first
      try {
        const data = await this.readV2StatusViaNotification(peripheral);
        if (data) {
          if (Rd200Device.ENABLE_TEMP_RAW_LOGS) {
            this.log(`TEMP RAW V2/V3 payload (${data.length} bytes): ${data.toString('hex')}`);
          }

          // Detect exact firmware version (v2 vs v3)
          const detectedVersion = rd200.detectFirmwareVersion(data);
          if (detectedVersion !== rd200.FirmwareVersion.V1) {
            this.firmwareVersion = detectedVersion;
            this.log(`Firmware version detected: v${detectedVersion}`);

            result = parseRadonValueV2V3(data, this.firmwareVersion === rd200.FirmwareVersion.V3);

            // Parse and log device info
            const deviceInfo = parseDeviceInfoV2V3(data, this.firmwareVersion === rd200.FirmwareVersion.V3);
            this.log(`Device: ${deviceInfo.model}, Serial: ${deviceInfo.serial}`);

            // Parse extended V2/V3 fields for validation and logging
            const extendedData = parseExtendedV2V3Fields(data);
            this.log(`Radon - Current: ${result} Bq/m3, Day Avg: ${extendedData.dayAvgRadon}, Month Avg: ${extendedData.monthAvgRadon}, Peak: ${extendedData.peakRadon}`);
            this.log(`Uptime: ${extendedData.uptimeHours}h ${extendedData.uptimeMinutes}m ${extendedData.uptimeSeconds}s`);

            if (extendedData.particleCountCurrent !== undefined) {
              this.log(`Particle Counter - Current: ${extendedData.particleCountCurrent}, Previous: ${extendedData.particleCountPrevious}`);
            }

            if (extendedData.firmwareVersion) {
              this.log(`Firmware Version: ${extendedData.firmwareVersion}`);
            }
          }
        }
      } catch (v2Error) {
        this.log(`V2/V3 firmware not detected, trying V1: ${v2Error instanceof Error ? v2Error.message : String(v2Error)}`);
      }

      // If v2/v3 didn't work, try v1 firmware
      if (result === null) {
        try {
          await peripheral.write(SERVICE_UUID_V1, TRIGGER_UID_V1, Buffer.from(TRIGGER_DATA_V1));

          const data = await peripheral.read(SERVICE_UUID_V1, DATA_UUID_V1);
          if (!data) {
            this.error('No data received from device, will retry at next interval.');
            return;
          }
          if (data.length !== 20) {
            this.error('Received data is invalid, will retry at next interval.');
            return;
          }

          if (Rd200Device.ENABLE_TEMP_RAW_LOGS) {
            this.log(`TEMP RAW V1 payload (${data.length} bytes): ${data.toString('hex')}`);
          }

          this.firmwareVersion = rd200.FirmwareVersion.V1;
          this.log('Firmware version detected: v1');
          result = parseRadonValueV1(data);
        } catch (v1Error) {
          this.error(`Failed to read from both V1 and V2/V3 firmware: ${v1Error instanceof Error ? v1Error.message : String(v1Error)}`);
          return;
        }
      }

      if (result !== null) {
        await this.setCapabilityValue('measure_radon', result);
        this.log('Sync operation completed successfully.');
        syncSucceeded = true;
        // Mark device as available on successful sync
        await this.setAvailable().catch((err) => {
          this.error(`Error marking device available: ${err.message}`);
        });
      } else {
        this.error('Failed to read radon value from device.');
      }
    } catch (error) {
      this.error(`Error during onSync operation: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (peripheral) {
        try {
          this.disconnectFromDevice(peripheral);
        } catch (disconnectError) {
          // Handle disconnect errors (e.g., peripheral already disconnected)
          const errorMsg = disconnectError instanceof Error ? disconnectError.message : String(disconnectError);
          this.log(`Error during disconnect: ${errorMsg}`);

          // Only mark as unavailable if sync actually failed
          if (!syncSucceeded && errorMsg.includes('Peripheral Not Found')) {
            this.error('Device disconnected unexpectedly, marking as offline.');
            const unavailablePromise = this.setUnavailable('Device disconnected or not found. Will retry on next sync.');
            unavailablePromise.catch((err: Error) => { // eslint-disable-line @typescript-eslint/no-floating-promises
              this.error(`Error marking device unavailable: ${err.message}`);
            });
          }
        }
      }
      this.operationInProgress = false;
    }
  }

  // Little endian
  private static fromByteArrayLE(bytes: number[]): number {
    let result = 0;
    for (let i = 0; i < bytes.length; i++) {
      result |= (bytes[i] & 0xFF) << (8 * i);
    }
    return result;
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('Rd200Device has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    this.log('Rd200Device settings where changed');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log('Rd200Device was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    const { onSyncInterval } = this;
    clearInterval(onSyncInterval); // Clear the onSync interval to stop further execution
    this.log('Rd200Device has been deleted');
  }

  private async findAdvertisement(): Promise<BleAdvertisement | undefined> {
    const { id } = this.getData();
    try {
      return await this.homey.ble.find(id);
    } catch (error) {
      this.error(`Failed to find device advertisement: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private async connectToDevice(): Promise<BlePeripheral | undefined> {
    if (!this.advertisement) {
      this.advertisement = await this.findAdvertisement();
      if (!this.advertisement) {
        this.error('Device advertisement not found');
        return undefined;
      }
      this.log('Device advertisement found');
    }

    try {
      this.log('Connecting to the device...');
      const peripheral: BlePeripheral = await this.advertisement.connect();
      await peripheral.assertConnected();
      this.log('Discovering services and characteristics...');
      const services = await peripheral.discoverAllServicesAndCharacteristics();
      this.log(`Discovered ${services.length} service(s): ${services.map((s) => s.uuid).join(', ')}`);
      this.log('Peripheral connected');

      return peripheral;
    } catch (error) {
      this.error(`Failed to connect to device: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private disconnectFromDevice(peripheral: BlePeripheral): void {
    if (!peripheral) return;
    this.log('Disconnecting from the device...');
    // Note: peripheral.disconnect() may throw if peripheral is already disconnected.
    // This error will be caught in the onSync finally block.
    peripheral.disconnect();
  }

  private normalizeUuid(uuid: string): string {
    return uuid.replace(/-/g, '').toLowerCase();
  }

  private async getCharacteristicByUuid(
    peripheral: BlePeripheral,
    serviceUuid: string,
    characteristicUuid: string,
  ) {
    const normalizedServiceUuid = this.normalizeUuid(serviceUuid);
    const normalizedCharacteristicUuid = this.normalizeUuid(characteristicUuid);

    const service = peripheral.services.find((candidate) => this.normalizeUuid(candidate.uuid) === normalizedServiceUuid);

    if (!service) {
      throw new Error(
        `No service found with UUID ${serviceUuid}. Available: ${peripheral.services.map((s) => s.uuid).join(', ')}`,
      );
    }

    const characteristic = service.characteristics.find((candidate) => this.normalizeUuid(candidate.uuid) === normalizedCharacteristicUuid);

    if (!characteristic) {
      throw new Error(
        `No characteristic found with UUID ${characteristicUuid} on service ${service.uuid}. Available: ${service.characteristics.map((c) => c.uuid).join(', ')}`,
      );
    }

    return characteristic;
  }

  private async readV2StatusViaNotification(peripheral: BlePeripheral): Promise<Buffer> {
    const statusCharacteristic = await this.getCharacteristicByUuid(peripheral, SERVICE_UUID_V2, STATUS_UUID_V2);
    const commandCharacteristic = await this.getCharacteristicByUuid(peripheral, SERVICE_UUID_V2, COMMAND_UUID_V2);

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let resolveData: (data: Buffer) => void;
    let rejectData: (err: Error) => void;

    const dataPromise = new Promise<Buffer>((resolve, reject) => {
      resolveData = resolve;
      rejectData = reject;
    });

    try {
      // Await subscription so it is fully established before writing the command.
      await statusCharacteristic.subscribeToNotifications(
        (data: Buffer) => {
          if (data.length > 0 && data[0] === COMMAND_STATUS_V2) {
            resolveData(data);
          }
        },
      );

      timeoutHandle = setTimeout(() => {
        rejectData(new Error('Timed out waiting for V2/V3 status notification.'));
      }, 5000);

      await commandCharacteristic.write(Buffer.from([COMMAND_STATUS_V2]));
      return await dataPromise;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      try {
        await statusCharacteristic.unsubscribeFromNotifications();
      } catch (error) {
        this.log(`Failed to unsubscribe status notifications: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async retryOperation(operation: () => Promise<void>, retries: number = 3, delay: number = 2000): Promise<void> {
    for (let i = 0; i < retries; i++) {
      if (!this.operationInProgress) {
        this.operationInProgress = true;
        try {
          await operation();
          return;
        } catch (error) {
          this.error(`Error during operation attempt ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          this.operationInProgress = false;
        }
      } else {
        this.log(`Operation in progress, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    this.error('Operation failed after maximum retry attempts.');
  }

};
