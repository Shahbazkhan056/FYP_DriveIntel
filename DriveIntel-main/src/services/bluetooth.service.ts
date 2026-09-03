// Bluetooth Service - ELM327 / HC-05 OBD-II Communication
import BleManager from 'react-native-ble-manager';
import { OBD_COMMANDS } from '../utils/obdCodes';

class BluetoothService {
  private deviceId: string | null = null;

  async init(): Promise<void> {
    await BleManager.start({ showAlert: false });
  }

  async scan(): Promise<void> {
    await BleManager.scan([], 10, true);
  }

  async connect(deviceId: string): Promise<void> {
    await BleManager.connect(deviceId);
    this.deviceId = deviceId;
  }

  async disconnect(): Promise<void> {
    if (this.deviceId) {
      await BleManager.disconnect(this.deviceId);
      this.deviceId = null;
    }
  }

  async sendCommand(command: string): Promise<string> {
    // TODO: Write AT command to OBD-II characteristic and read response
    return '';
  }

  async getSensorData() {
    const [speedRaw, rpmRaw, tempRaw, throttleRaw] = await Promise.all([
      this.sendCommand(OBD_COMMANDS.VEHICLE_SPEED),
      this.sendCommand(OBD_COMMANDS.ENGINE_RPM),
      this.sendCommand(OBD_COMMANDS.ENGINE_COOLANT_TEMP),
      this.sendCommand(OBD_COMMANDS.THROTTLE_POSITION),
    ]);

    return {
      speed: parseInt(speedRaw, 16) || 0,
      rpm: (parseInt(rpmRaw.slice(0, 2), 16) * 256 + parseInt(rpmRaw.slice(2), 16)) / 4 || 0,
      engineTemp: parseInt(tempRaw, 16) - 40 || 0,
      throttle: (parseInt(throttleRaw, 16) * 100) / 255 || 0,
      timestamp: Date.now(),
    };
  }

  isConnected(): boolean {
    return this.deviceId !== null;
  }
}

export default new BluetoothService();
