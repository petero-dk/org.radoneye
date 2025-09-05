'use strict';

import Homey from 'homey';

module.exports = class RadonEyeApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('RadonEyeApp has been initialized');
  }

}
