// @ts-check
// Core Packages
'use strict'
const _ = require('lodash')

const envVars = ['AWS_IOT_REGION', 'AWS_IOT_HOST', 'NODE_ENV',]
envVars.forEach(ev => {
  if (_.isUndefined(process.env[ev])) {
    throw new Error(
      `Define environment variable '${ev}' before executing this Service!`
    )
  }
});

const fs = require('fs')
const path = require('path');
const Promise = require('bluebird');

// Component Packages
const device = require('aws-iot-device-sdk').device

/**
 * Mqtt Client, capable to manage other devices by pub/sub messages
 */
class MqttClient {
  /**
   * Constructor
   *
   * @param {string} awsIoTEndPoint - AWS IoT End Point URL
   * @param {string} awsRegion - AWS Region e.g. 'us-east-1'
   */
  constructor(certFolder, awsIoTEndPoint, awsRegion, env) {
    //Subscribe for all 
    this._thingName = '+'
    this._topicPresence = `$aws/events/presence/+/${this._thingName}`;
    this._topicUpdateAccepted = `$aws/things/${this._thingName}/shadow/update/accepted`;
    this._topicDelta = `$aws/things/${this._thingName}/shadow/update/delta`;

    this._thingName = path.basename(certFolder);
    this._clientId = this._thingName;
    this._connectionParam = {
      keyPath: `${certFolder}/private.key`,
      certPath: `${certFolder}/cert.pem`,
      caPath: `${certFolder}/root-ca.crt`,
      clientId: this._thingName,
      region: awsRegion,
      protocol: 'mqtts',
      port: 8883,
      host: awsIoTEndPoint,
      debug: true,
      keepalive: 600
    }

    const certFiles = [this._connectionParam.keyPath, this._connectionParam.certPath, this._connectionParam.caPath]
    certFiles.forEach(cf => {
      if (!fs.existsSync(cf)) {
        throw new Error(
          `ERROR: Certificate file '${cf}' does not exist in folder: '${certFolder}' for thing:${this._thingName}!`
        )
      }
    });

    this._device = new device(this._connectionParam);
    this._isSubscriptionToTopicsDone = false;
  }
  // #region === Event handlers =======================================
  /**
   * Event handlers - Subscribes to lifecycle events on the first connect event.
   */
  onMqttConnection() {
    console.log(`Successfully connected to AWS-IoT thing:${this._thingName}`);

    if (this._isSubscriptionToTopicsDone)
      return

    const topics = [this._topicDelta, this._topicPresence, this._topicUpdateAccepted];
    topics.forEach(t => {
      console.log(`subscribing to topic: ${t}...`);
      this._device.subscribe(t);
    });
    this._isSubscriptionToTopicsDone = true;

    // ==== Test - update shadow
    const thingName = this._thingName //'Device_1000'
    const attributeName = 'TEST_ATTRIBUTE';
    const newState = 100
    console.log(`Setting ${attributeName} state of thing:${thingName} to mode:${newState}...`);
    this.updateDeviceShadow(thingName, attributeName, newState);
    this.getDeviceShadow(thingName);
  }

  /**
   * Event handler when mqtt client reconnects with aws-iot core
   */
  onMqttReconnection() {
    console.log('reconnecting to IoT... ')
  }

  /**
   * Event handler for receiving messages published (from IoT Core)
   */
  onMqttMessage(topic, payload) {
    const o = JSON.parse(payload.toString());
    console.log(`Received messa
    ge on topic:${topic}, payload:`, o);
  }
  // #endregion

  /**
	 * Publishes request to update a given shadow attribute for a thing
	 *
	 * @param {string} thingName - thing to change 
	 * @param {string} attributeName - Attribute to be updated
	 * @param {Object} newState - desired state of the attribute
	 * @return {Promise<Object>} Promise resolving to the desired state of the attribute
   * 
   * Link: https://docs.aws.amazon.com/iot/latest/developerguide/device-shadow-mqtt.html
	*/
  updateDeviceShadow(thingName, attributeName, newState) {
    console.log(`Attribute '${attributeName}' of thing: '${thingName}' is being set to: '${newState}'...`);
    const topic = `$aws/things/${thingName}/shadow/update`
    const payload = {
      state: {
        desired: {
        }
      }
    }
    payload.state.desired[attributeName] = newState

    const self = this;
    const publish = Promise.promisify(self._device.publish, {
      context: self._device
    });

    return publish(topic, JSON.stringify(payload), {}).bind(this).then(function () {
      console.log(`Successfully published message to topic:${topic}.`);
      return Promise.resolve(newState);
    }).catch(function (e) {
      const msg = `Failed to publish message to topic: ${topic}! Error:${e}`;
      console.log(msg, e);
      return Promise.reject(msg);
    });
  }

  /**
	 * Publishes message to get shadow of a thing. AWS IoT responds by publishing to either /get/accepted or /get/rejected.
	 *
	 * @param {string} thingName - thing to change 
	 * @return {Promise<Object>} Promise resolving to the desired state of the attribute
   * 
   * Link: https://docs.aws.amazon.com/iot/latest/developerguide/device-shadow-mqtt.html
	*/
  getDeviceShadow(thingName) {
    console.log(`Extracting shadow of thing: '${thingName}'...`);
    const topic = `$aws/things/${thingName}/shadow/get`
    const self = this;
    const publish = Promise.promisify(self._device.publish, {
      context: self._device
    });
    const o = {}
    return publish(topic, JSON.stringify(o), {}).bind(this).then(function () {
      console.log(`Successfully published message to topic:${topic}.`);
      return Promise.resolve(true);
    }).catch(function (e) {
      const msg = `Failed to publish message to topic: ${topic}! Error:${e}`;
      console.log(msg, e);
      return Promise.reject(msg);
    });
  }


  /**
   * Initializes mqtt client 
   * listens continuously to change in 'Shadow Attributes' for all 'things' and other AWS-IoT notifications
   */
  start() {
    // Create the mqttClient (AWS IoT device object).
    console.log(
      `Instantiating mqtt client object [clientId: ${this._clientId}]...`
    )
    this._device.on('connect', this.onMqttConnection.bind(this))
    this._device.on('reconnect', this.onMqttReconnection.bind(this))
    this._device.on('message', this.onMqttMessage.bind(this))

    console.log(
      `mqtt client [clientId:${this._clientId}] initialized successfully.`
    )
  }
}
// #region === for test =======================================
const unitTest = function () {
  const thingNames = ['device_00']; //'device_00', 'device_01'
  const devices = [];
  thingNames.forEach(tn => {
    const mc = new MqttClient(
      `${__dirname}/certs/${tn}`,
      process.env.AWS_IOT_HOST,
      process.env.AWS_IOT_REGION,
      process.env.NODE_ENV
    );
    mc.start();
    devices.push(mc);
  });
}
unitTest();
// #endregion


module.exports = exports = MqttClient;