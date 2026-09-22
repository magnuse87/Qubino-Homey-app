'use strict';

const QubinoDevice = require('../../lib/QubinoDevice');
const { CAPABILITIES, COMMAND_CLASSES } = require('../../lib/constants');

/**
 * 3-Phase Smart Meter (ZMNHXD)
 * Manual: https://qubino.com/manuals/3-Phase_Smart_Meter.pdf
 * TODO: maintenance action for reset meter
 */
class ZMNHXD extends QubinoDevice {

  /**
   * Method that registers custom setting parsers.
   */
  registerSettings() {
    super.registerSettings();
  }

  /**
   * Method that handles migration of capabilities.
   * @returns {Promise<void>}
   */
  async migrateCapabilities() {
    await super.migrateCapabilities();

    if (this.hasCapability(CAPABILITIES.ONOFF)) {
      this.removeCapability(CAPABILITIES.ONOFF).catch(err => this.error(`Error removing ${CAPABILITIES.ONOFF} capability`, err));
      this.log('removed capability', CAPABILITIES.ONOFF);
    }
    if (this.hasCapability(CAPABILITIES.METER_POWER)) {
      this.removeCapability(CAPABILITIES.METER_POWER).catch(err => this.error(`Error removing ${CAPABILITIES.METER_POWER} capability`, err));
      this.log('removed capability', CAPABILITIES.METER_POWER);
    }

    // Loop all current capabilities and add if necessary
    const currentCapabilities = [
      CAPABILITIES.MEASURE_VOLTAGE,
      CAPABILITIES.MEASURE_CURRENT,
      CAPABILITIES.METER_POWER_IMPORT,
      CAPABILITIES.METER_POWER_EXPORT,
      CAPABILITIES.POWER_REACTIVE,
      CAPABILITIES.POWER_TOTAL_REACTIVE,
      CAPABILITIES.POWER_TOTAL_APPARENT,
      CAPABILITIES.POWER_FACTOR,
    ];
    const currentCapabilities0 = [
      CAPABILITIES.METER_POWER_IMPORT,
      CAPABILITIES.METER_POWER_EXPORT,
      CAPABILITIES.POWER_REACTIVE,
      CAPABILITIES.POWER_TOTAL_REACTIVE,
      CAPABILITIES.POWER_TOTAL_APPARENT,
      CAPABILITIES.POWER_FACTOR,
    ];
    const currentCapabilities1 = [
      CAPABILITIES.MEASURE_VOLTAGE,
      CAPABILITIES.MEASURE_CURRENT,
      CAPABILITIES.POWER_REACTIVE,
      CAPABILITIES.POWER_FACTOR,
    ];

    if (!this._isRootNode()) {
      this.log('migrate capabilities for multi channel nodes');
      if (this.multiChannelNodeObject() === 1) {
        for (const i in currentCapabilities0) {
          const currentCapability = currentCapabilities0[i];
          if (!this.hasCapability(currentCapability)) {
            await this.addCapability(currentCapability).catch(err => this.error(`Error adding ${currentCapability} capability`, err));
          }
        }
      } else {
        for (const i in currentCapabilities1) {
          const currentCapability = currentCapabilities1[i];
          if (!this.hasCapability(currentCapability)) {
            await this.addCapability(currentCapability).catch(err => this.error(`Error adding ${currentCapability} capability`, err));
          }
        }
      }
    } else {
      this.log('migrate capabilities for root nodes');
      for (const i in currentCapabilities) {
        const currentCapability = currentCapabilities[i];
        if (this.hasCapability(currentCapability)) {
          await this.removeCapability(currentCapability).catch(err => this.error(`Error removing ${currentCapability} capability`, err));
        }
      }
    }
  }

  /**
   * Method that will register capabilities of the device based on its configuration.
   * @private
   */
  async registerCapabilities() {
    if (!this._isRootNode() && !this.hasCapability(CAPABILITIES.METER_RESET_MAINTENANCE_ACTION)) {
      await this.addCapability(CAPABILITIES.METER_RESET_MAINTENANCE_ACTION).catch(err => this.error(`Error adding ${CAPABILITIES.METER_RESET_MAINTENANCE_ACTION} capability`, err));
      this.log('added capability', CAPABILITIES.METER_RESET_MAINTENANCE_ACTION);
    }
    // Periodically force a GET for every meter capability, using the user configurable
    // 'meterPollingInterval' setting (in seconds). This works around Homey's Z-Wave stack
    // sometimes marking the node unreachable and not updating capability values on its own
    // once a report gets lost, see support article about the 3-Phase Smart Meter losing reports.
    const meterPollOpts = { getOpts: { pollInterval: 'meterPollingInterval', pollMultiplication: 1000 } };

    if (this.hasCapability(CAPABILITIES.MEASURE_VOLTAGE)) this.registerCapability(CAPABILITIES.MEASURE_VOLTAGE, COMMAND_CLASSES.METER, meterPollOpts);
    if (this.hasCapability(CAPABILITIES.MEASURE_CURRENT)) this.registerCapability(CAPABILITIES.MEASURE_CURRENT, COMMAND_CLASSES.METER, meterPollOpts);
    if (this.hasCapability(CAPABILITIES.MEASURE_POWER)) this.registerCapability(CAPABILITIES.MEASURE_POWER, COMMAND_CLASSES.METER, meterPollOpts);
    if (this.hasCapability(CAPABILITIES.METER_POWER_IMPORT)) this.registerCapability(CAPABILITIES.METER_POWER_IMPORT, COMMAND_CLASSES.METER, meterPollOpts);
    if (this.hasCapability(CAPABILITIES.METER_POWER_EXPORT)) this.registerCapability(CAPABILITIES.METER_POWER_EXPORT, COMMAND_CLASSES.METER, meterPollOpts);
    if (this.hasCapability(CAPABILITIES.POWER_REACTIVE)) this.registerCapability(CAPABILITIES.POWER_REACTIVE, COMMAND_CLASSES.METER, meterPollOpts);
    if (this.hasCapability(CAPABILITIES.POWER_TOTAL_REACTIVE)) this.registerCapability(CAPABILITIES.POWER_TOTAL_REACTIVE, COMMAND_CLASSES.METER, meterPollOpts);
    if (this.hasCapability(CAPABILITIES.POWER_TOTAL_APPARENT)) this.registerCapability(CAPABILITIES.POWER_TOTAL_APPARENT, COMMAND_CLASSES.METER, meterPollOpts);
    if (this.hasCapability(CAPABILITIES.POWER_FACTOR)) this.registerCapability(CAPABILITIES.POWER_FACTOR, COMMAND_CLASSES.METER, meterPollOpts);
  }

  /**
   * Method that determines if current node is root node.
   * @returns {boolean}
   * @private
   */
  _isRootNode() {
    return Object.prototype.hasOwnProperty.call(this.node, 'MultiChannelNodes') && Object.keys(this.node.MultiChannelNodes).length > 0;
  }
}

module.exports = ZMNHXD;
