import Homey from 'homey';

// All RadonEye RD200 generations advertise with this name prefix.
const RADONEYE_NAME_PREFIX = 'FR:';

module.exports = class Rd200Driver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('Rd200Driver has been initialized');
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    // Discover all nearby BLE devices and filter by the known RadonEye name
    // prefix. V2/V3 firmware does not include the GATT service UUID in its
    // advertisement packet, so filtering by service UUID misses them.
    const advertisements = await this.homey.ble.discover([]).catch(() => []);

    this.log(`BLE scan found ${advertisements.length} total devices`);

    const matched = advertisements.filter(advertisement => {
      const name = advertisement.localName ?? '';
      return name.startsWith(RADONEYE_NAME_PREFIX);
    });

    this.log(`Discovered ${matched.length} RadonEye device(s)`);

    return matched.map(advertisement => ({
      name: advertisement.localName ?? advertisement.uuid,
      data: {
        id: advertisement.uuid,
      },
      store: {
        peripheralUuid: advertisement.uuid,
      },
    }));
  }

};
