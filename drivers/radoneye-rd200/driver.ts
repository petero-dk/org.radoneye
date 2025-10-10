import Homey from 'homey';
import { SERVICE_UUID_V1, SERVICE_UUID_V2 } from '../../lib/rd200';

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
    // Discover devices with both v1 and v2/v3 service UUIDs
    const advertisementsV1 = await this.homey.ble.discover([SERVICE_UUID_V1]).catch(() => []);
    const advertisementsV2 = await this.homey.ble.discover([SERVICE_UUID_V2]).catch(() => []);
    
    // Combine and deduplicate by UUID
    const allAdvertisements = [...advertisementsV1, ...advertisementsV2];
    const uniqueAdvertisements = allAdvertisements.filter((advertisement, index, self) => 
      index === self.findIndex(a => a.uuid === advertisement.uuid)
    );
    
    this.log('Discovered devices:', uniqueAdvertisements);
    return uniqueAdvertisements
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
