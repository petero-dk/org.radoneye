import Homey from 'homey';
import { SERVICE_UUID } from '../../lib/rd200';

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
    const advertisements = await this.homey.ble.discover([SERVICE_UUID]);
    //const advertisements = await this.homey.ble.discover();
    this.log('Discovered devices:', advertisements);
    return advertisements
      //.filter(advertisement => advertisement.localName === 'my_device_name')
      .map(advertisement => {
        return {
          name: advertisement.localName,
          data: {
            id: advertisement.uuid,
          },
          store: {
            peripheralUuid: advertisement.uuid,
          }
        };
      });
  }

};
