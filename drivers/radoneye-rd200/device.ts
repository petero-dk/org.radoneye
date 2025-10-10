import Homey, { BleAdvertisement, BlePeripheral } from 'homey';
import * as rd200 from '../../lib/rd200';

module.exports = class Rd200Device extends Homey.Device {
  private static SYNC_INTERVAL: number = 1000 * 60 * 5; // 5 minutes

  private advertisement?: BleAdvertisement;
  private onSyncInterval?: ReturnType<typeof setTimeout>;
  private operationInProgress: boolean = false;
  private firmwareVersion: rd200.FirmwareVersion = rd200.FirmwareVersion.V1;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('Rd200Device has been initialized');
    this.onSyncInterval = setInterval(() => this.onSync(), Rd200Device.SYNC_INTERVAL);
    this.onSync();
  }


  async onSync(): Promise<void> {
    if (this.operationInProgress) {
      this.log('Operation already in progress, skipping this interval.');
      return;
    }
    this.log('Starting sync operation...');

    this.operationInProgress = true;
    const { firstRun, mode } = this.getStore();


    this.advertisement = await this.findAdvertisement();
    let peripheral: BlePeripheral | undefined;
    try {
      peripheral = await this.connectToDevice();
      if (!peripheral) {
        this.error('Failed to connect to the device, will retry at next interval.');
        return;
      }

      let result: number;

      if (this.firmwareVersion === rd200.FirmwareVersion.V1) {
        // V1 firmware: write trigger, read data
        await peripheral.write(rd200.SERVICE_UUID_V1, rd200.TRIGGER_UID_V1, Buffer.from(rd200.TRIGGER_DATA_V1));

        const data = await peripheral.read(rd200.SERVICE_UUID_V1, rd200.DATA_UUID_V1);
        if (!data) {
          this.error('No data received from device, will retry at next interval.');
          return;
        }
        if (data.length != 20) {
          this.error('Received data is invalid, will retry at next interval.');
          return;
        }

        result = rd200.parseRadonValue(data, rd200.FirmwareVersion.V1);
      } else {
        // V2/V3 firmware: write command, read status
        await peripheral.write(rd200.SERVICE_UUID_V2, rd200.COMMAND_UUID_V2, Buffer.from([rd200.COMMAND_STATUS_V2]));

        const data = await peripheral.read(rd200.SERVICE_UUID_V2, rd200.STATUS_UUID_V2);
        if (!data) {
          this.error('No data received from device, will retry at next interval.');
          return;
        }

        // Detect exact firmware version (v2 vs v3)
        const detectedVersion = rd200.detectFirmwareVersion(data);
        if (detectedVersion !== rd200.FirmwareVersion.V1) {
          this.firmwareVersion = detectedVersion;
          this.log(`Firmware version detected: v${detectedVersion}`);
        }

        result = rd200.parseRadonValue(data, this.firmwareVersion);
        
        // Optionally parse and log device info
        const deviceInfo = rd200.parseDeviceInfo(data, this.firmwareVersion);
        this.log(`Device: ${deviceInfo.model}, Serial: ${deviceInfo.serial}`);
      }

      await this.setCapabilityValue('measure_radon', result);
      this.log('Sync operation completed successfully.');
    } catch (error) {
      this.error(`Error during onSync operation: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (peripheral) {
        this.disconnectFromDevice(peripheral);
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
    this.log("Rd200Device settings where changed");
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
      this.log('Peripheral connected');
      
      // Detect firmware version by checking which service is available
      const services = await peripheral.discoverAllServicesAndCharacteristics();
      const hasV2Service = services.some(s => s.uuid === rd200.SERVICE_UUID_V2);
      const hasV1Service = services.some(s => s.uuid === rd200.SERVICE_UUID_V1);
      
      if (hasV2Service) {
        this.log('Detected v2/v3 firmware');
        this.firmwareVersion = rd200.FirmwareVersion.V2; // Will be refined to V3 after reading data
      } else if (hasV1Service) {
        this.log('Detected v1 firmware');
        this.firmwareVersion = rd200.FirmwareVersion.V1;
      } else {
        this.error('Unknown firmware version - no matching service UUID found');
      }
      
      return peripheral;
    } catch (error) {
      this.error(`Failed to connect to device: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private disconnectFromDevice(peripheral: BlePeripheral): void {
    if (!peripheral) return;
    try {
      this.log('Disconnecting from the device...');
      peripheral.disconnect();
    } catch (error) {
      this.error(`Error disconnecting from the device: ${error instanceof Error ? error.message : String(error)}`);
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
