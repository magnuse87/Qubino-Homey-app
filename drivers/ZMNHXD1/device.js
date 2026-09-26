'use strict';

const QubinoDevice = require('../../lib/QubinoDevice');
const { CAPABILITIES, COMMAND_CLASSES } = require('../../lib/constants');

const SETTING_GRID_TYPE = 'gridType';
const SETTING_METER_ROLE = 'meterRole';
const SETTING_METER_POLLING_INTERVAL = 'meterPollingInterval';

const GRID_TYPE = {
  TN: 'tn', // 3 phases + neutral (TN/TT 400 V), the wiring the meter is designed for
  IT_3WIRE: 'it_3wire', // 3 phases without neutral, L1/L2/L3 connected, N terminal unused
  IT_ARON: 'it_aron', // 3 phases without neutral, Qubino's official wiring: one phase on the N terminal
};

const METER_ROLE = {
  HOME: 'home', // the meter measures the whole home (Homey Energy 'cumulative' main meter)
  APPLIANCE: 'appliance', // the meter measures a single appliance or circuit (regular consumer)
};

// All meter readings of the phase sub devices (ph1 - ph3).
const PHASE_CAPABILITIES = [
  CAPABILITIES.MEASURE_VOLTAGE,
  CAPABILITIES.MEASURE_CURRENT,
  CAPABILITIES.MEASURE_POWER,
  CAPABILITIES.POWER_REACTIVE,
  CAPABILITIES.POWER_FACTOR,
];

// Every meter reading that is polled (all sub devices together).
const METER_CAPABILITIES = [
  CAPABILITIES.MEASURE_VOLTAGE,
  CAPABILITIES.MEASURE_CURRENT,
  CAPABILITIES.MEASURE_POWER,
  CAPABILITIES.METER_POWER_IMPORT,
  CAPABILITIES.METER_POWER_EXPORT,
  CAPABILITIES.POWER_REACTIVE,
  CAPABILITIES.POWER_TOTAL_REACTIVE,
  CAPABILITIES.POWER_TOTAL_APPARENT,
  CAPABILITIES.POWER_FACTOR,
];

// Phase readings that are not meaningful per grid type. Without a neutral conductor the meter
// references its voltage inputs to an artificial neutral point, so every per-phase value that
// depends on the voltage (voltage itself, active/reactive power, power factor) is an artefact;
// only the sums on the Total device are correct (Blondel's theorem). With Qubino's "one phase on
// the N terminal" wiring the per-phase currents are not meaningful either (one L input is unused).
// The Total device is never affected.
const HIDDEN_PHASE_CAPABILITIES = {
  [GRID_TYPE.TN]: [],
  [GRID_TYPE.IT_3WIRE]: [
    CAPABILITIES.MEASURE_VOLTAGE,
    CAPABILITIES.MEASURE_POWER,
    CAPABILITIES.POWER_REACTIVE,
    CAPABILITIES.POWER_FACTOR,
  ],
  [GRID_TYPE.IT_ARON]: [
    CAPABILITIES.MEASURE_VOLTAGE,
    CAPABILITIES.MEASURE_CURRENT,
    CAPABILITIES.MEASURE_POWER,
    CAPABILITIES.POWER_REACTIVE,
    CAPABILITIES.POWER_FACTOR,
  ],
};

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
    const meterPollOpts = { getOpts: { pollInterval: SETTING_METER_POLLING_INTERVAL, pollMultiplication: 1000 } };

    if (this.hasCapability(CAPABILITIES.MEASURE_VOLTAGE)) this.registerCapability(CAPABILITIES.MEASURE_VOLTAGE, COMMAND_CLASSES.METER, meterPollOpts);
    if (this.hasCapability(CAPABILITIES.MEASURE_CURRENT)) this.registerCapability(CAPABILITIES.MEASURE_CURRENT, COMMAND_CLASSES.METER, meterPollOpts);
    if (this.hasCapability(CAPABILITIES.MEASURE_POWER)) this.registerCapability(CAPABILITIES.MEASURE_POWER, COMMAND_CLASSES.METER, meterPollOpts);
    if (this.hasCapability(CAPABILITIES.METER_POWER_IMPORT)) this.registerCapability(CAPABILITIES.METER_POWER_IMPORT, COMMAND_CLASSES.METER, meterPollOpts);
    if (this.hasCapability(CAPABILITIES.METER_POWER_EXPORT)) this.registerCapability(CAPABILITIES.METER_POWER_EXPORT, COMMAND_CLASSES.METER, meterPollOpts);
    if (this.hasCapability(CAPABILITIES.POWER_REACTIVE)) this.registerCapability(CAPABILITIES.POWER_REACTIVE, COMMAND_CLASSES.METER, meterPollOpts);
    if (this.hasCapability(CAPABILITIES.POWER_TOTAL_REACTIVE)) this.registerCapability(CAPABILITIES.POWER_TOTAL_REACTIVE, COMMAND_CLASSES.METER, meterPollOpts);
    if (this.hasCapability(CAPABILITIES.POWER_TOTAL_APPARENT)) this.registerCapability(CAPABILITIES.POWER_TOTAL_APPARENT, COMMAND_CLASSES.METER, meterPollOpts);
    if (this.hasCapability(CAPABILITIES.POWER_FACTOR)) this.registerCapability(CAPABILITIES.POWER_FACTOR, COMMAND_CLASSES.METER, meterPollOpts);

    // Apply the grid type (which phase readings are shown) and the Homey Energy role
    await this._applyGridType(this.getSetting(SETTING_GRID_TYPE)).catch(err => this.error('failed to apply grid type', err));
    await this._applyEnergyRole(this.getSetting(SETTING_METER_ROLE)).catch(err => this.error('failed to apply energy role', err));
  }

  /**
   * Override onSettings to apply the grid type and Homey Energy role when they change. The
   * new values are passed explicitly because getSetting() still returns the old values here.
   * @param {object} oldSettings
   * @param {object} newSettings
   * @param {string[]} changedKeys
   * @returns {Promise<*>}
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    const result = await super.onSettings({ oldSettings, newSettings, changedKeys });
    if (changedKeys.includes(SETTING_GRID_TYPE) || changedKeys.includes(SETTING_METER_POLLING_INTERVAL)) {
      // Also re-applied on a polling interval change: homey-zwavedriver only remembers ONE capability
      // per poll interval setting key, so on its own it would only re-time the last registered one.
      await this._applyGridType(newSettings[SETTING_GRID_TYPE], newSettings[SETTING_METER_POLLING_INTERVAL])
        .catch(err => this.error('failed to apply grid type', err));
    }
    if (changedKeys.includes(SETTING_METER_ROLE)) {
      await this._applyEnergyRole(newSettings[SETTING_METER_ROLE]).catch(err => this.error('failed to apply energy role', err));
    }
    return result;
  }

  /**
   * Hide or show the per-phase readings according to the grid type, and (re)apply the periodic
   * polling. Hidden capabilities are kept (so Flows and Insights referencing them keep working) but
   * removed from the device UI through capability option uiComponent = null, Insights are no longer
   * generated for them, and they are no longer polled - which keeps the Z-Wave traffic down and
   * lets the visible readings (e.g. current) use a short polling interval. Hidden capabilities
   * still update whenever the meter sends an unsolicited report.
   * On the Total device nothing is hidden; only the polling is (re)applied.
   * @param {string} gridType one of GRID_TYPE, anything else is treated as TN
   * @param {number} [pollSeconds] polling interval to apply, defaults to the current setting
   * @returns {Promise<void>}
   * @private
   */
  async _applyGridType(gridType, pollSeconds) {
    if (this._isRootNode()) return;
    const type = Object.values(GRID_TYPE).includes(gridType) ? gridType : GRID_TYPE.TN;
    const hidden = this._isPhaseNode() ? HIDDEN_PHASE_CAPABILITIES[type] : [];
    const seconds = Number(pollSeconds !== undefined ? pollSeconds : this.getSetting(SETTING_METER_POLLING_INTERVAL)) || 0;

    for (const capabilityId of METER_CAPABILITIES) {
      if (!this.hasCapability(capabilityId)) continue;
      const shouldHide = hidden.includes(capabilityId);

      // Polling: stop for hidden capabilities, (re)start with the current interval for visible ones
      if (typeof this._setPollInterval === 'function') {
        this._setPollInterval(capabilityId, COMMAND_CLASSES.METER, shouldHide ? 0 : seconds * 1000);
      }

      if (!PHASE_CAPABILITIES.includes(capabilityId)) continue;
      let options = {};
      try {
        options = this.getCapabilityOptions(capabilityId) || {};
      } catch (err) {
        // No options stored yet for this capability
      }
      const isHidden = options.uiComponent === null;
      if (isHidden === shouldHide) continue;
      await this.setCapabilityOptions(capabilityId, {
        ...options,
        uiComponent: shouldHide ? null : 'sensor',
        preventInsights: shouldHide,
      });
      this.log(`capability ${capabilityId} is now ${shouldHide ? 'hidden' : 'shown'} (grid type ${type})`);
    }
  }

  /**
   * Set the Homey Energy object of this device according to the meterRole setting. Only the
   * Total sub device carries an energy object: as home it is the cumulative main meter of the
   * home (the upstream behaviour), as appliance it is a regular consumer with meter_power
   * import/export mapped for Homey Energy. The root device and the phase devices never get
   * cumulative, otherwise Homey Energy counts the same energy several times.
   * @param {string} meterRole one of METER_ROLE, anything else is treated as home
   * @returns {Promise<void>}
   * @private
   */
  async _applyEnergyRole(meterRole) {
    if (typeof this.setEnergy !== 'function' || typeof this.getEnergy !== 'function') {
      this.log('Device.setEnergy() not available on this Homey version, energy role not applied');
      return;
    }

    let desired = {};
    if (this._isTotalNode()) {
      const role = meterRole === METER_ROLE.APPLIANCE ? METER_ROLE.APPLIANCE : METER_ROLE.HOME;
      desired = role === METER_ROLE.HOME
        ? {
          cumulative: true,
          cumulativeImportedCapability: CAPABILITIES.METER_POWER_IMPORT,
          cumulativeExportedCapability: CAPABILITIES.METER_POWER_EXPORT,
        }
        : {
          meterPowerImportedCapability: CAPABILITIES.METER_POWER_IMPORT,
          meterPowerExportedCapability: CAPABILITIES.METER_POWER_EXPORT,
        };
    }

    const current = this.getEnergy() || {};
    if (ZMNHXD._sameEnergy(current, desired)) return;
    await this.setEnergy(desired);
    this.log('energy object set to', JSON.stringify(desired));
  }

  /**
   * Compare two energy objects regardless of key order.
   * @param {object} a
   * @param {object} b
   * @returns {boolean}
   * @private
   */
  static _sameEnergy(a, b) {
    const normalize = obj => JSON.stringify(Object.keys(obj).sort().map(key => [key, obj[key]]));
    return normalize(a) === normalize(b);
  }

  /**
   * Method that determines if current node is root node.
   * @returns {boolean}
   * @private
   */
  _isRootNode() {
    return Object.prototype.hasOwnProperty.call(this.node, 'MultiChannelNodes') && Object.keys(this.node.MultiChannelNodes).length > 0;
  }

  /**
   * The Total sub device (multi channel node 1) is the only one with accumulated energy.
   * @returns {boolean}
   * @private
   */
  _isTotalNode() {
    return !this._isRootNode() && this.hasCapability(CAPABILITIES.METER_POWER_IMPORT);
  }

  /**
   * The phase sub devices (multi channel nodes 2 - 4) are the only ones reporting voltage.
   * @returns {boolean}
   * @private
   */
  _isPhaseNode() {
    return !this._isRootNode() && this.hasCapability(CAPABILITIES.MEASURE_VOLTAGE);
  }

}

module.exports = ZMNHXD;
