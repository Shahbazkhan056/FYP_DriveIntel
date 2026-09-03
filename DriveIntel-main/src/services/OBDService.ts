/**
 * OBDService — ELM327 BLE Communication Layer
 *
 * Architecture:
 *   ELM327 (BLE) → react-native-ble-plx → OBDServiceClass
 *     → saveOBDData (backend)
 *     → dataCallback (OBDContext → all screens)
 *
 * Key design decisions for real hardware:
 *  - Commands are SERIALIZED (queue), never parallel — ELM327 cannot
 *    handle concurrent requests on a single RFCOMM-style BLE channel.
 *  - Response buffer accumulates BLE packets until '>' prompt is seen.
 *  - Per-command timeout rejects cleanly so the queue can advance.
 *  - Disconnect is detected via BLE state change and surfaced via callback.
 *  - Scan includes name-less devices (ELM327 clones often have blank names).
 */

import { BleManager, Device, State } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { saveOBDData, saveDTC } from './api';
import Base64 from 'base-64';
import HybridService, { DetectionResult, HybridData } from './HybridService';

// ── ELM327 BLE UUIDs (most common clone chips) ───────────────
// Primary (OBDII BLE dongles — FFF0 service)
const SVC_UUID   = '0000fff0-0000-1000-8000-00805f9b34fb';
const WRITE_UUID = '0000fff2-0000-1000-8000-00805f9b34fb';
const NOTIFY_UUID= '0000fff1-0000-1000-8000-00805f9b34fb';

// ── OBD Mode 01 PIDs ─────────────────────────────────────────
const PIDS = {
  RPM:           '010C\r',
  SPEED:         '010D\r',
  ENGINE_TEMP:   '0105\r',
  THROTTLE:      '0111\r',
  FUEL_LEVEL:    '012F\r',
  ENGINE_LOAD:   '0104\r',
  INTAKE_TEMP:   '010F\r',
  MAF:           '0110\r',
  FUEL_PRESSURE: '010A\r',
  VOLTAGE:       '0142\r',
  ODOMETER:      '01A6\r',  // Mode 01 PID 0xA6 — Total odometer (km), not universally supported
  DTC_READ:      '03\r',
  DTC_CLEAR:     '04\r',
  VIN_READ:      '0902\r',  // Mode 09 PID 02 — Vehicle Identification Number
};

// ── ELM327 Initialisation Sequence ───────────────────────────
const INIT_CMDS = [
  'ATZ\r',      // Reset — wait for ELM327 banner
  'ATE0\r',     // Echo OFF
  'ATL0\r',     // Linefeeds OFF
  'ATS0\r',     // Spaces OFF
  'ATH0\r',     // Headers OFF
  'ATSP0\r',    // Auto protocol (tries CAN first)
  'ATAT2\r',    // Adaptive timing — maximum aggressiveness (was AT1)
  'ATSTFF\r',   // Set ELM327 ECU response timeout to max (~1020 ms) — prevents
                // spurious NO DATA on slow ECUs when adaptive timing hasn't learned yet
];

type DataCallback             = (data: any) => void;
type DisconnectCallback       = () => void;
type VinCallback              = (vin: string) => void;
type OdometerCallback         = (km: number) => void;
type HybridDetectionCallback  = (result: DetectionResult) => void;

// ── Command Queue Item ────────────────────────────────────────
interface QueueItem {
  command: string;
  resolve: (r: string) => void;
  reject:  (e: Error)  => void;
  timer:   ReturnType<typeof setTimeout>;
}

class OBDServiceClass {
  private manager:    BleManager;
  private device:     Device | null = null;
  private connected:  boolean = false;
  private vehicleId:  string  = '';

  // Response buffer — accumulates BLE notify packets until '>' seen
  private rxBuffer:   string  = '';
  // Serialised command queue — only one command in-flight at a time
  private cmdQueue:   QueueItem[] = [];
  private sending:    boolean = false;

  private pollingInterval: ReturnType<typeof setTimeout> | null = null;
  private _pollingActive  = false;
  private dataCallback:            DataCallback            | null = null;
  private disconnectCallback:      DisconnectCallback      | null = null;
  private vinCallback:             VinCallback             | null = null;
  private odometerCallback:        OdometerCallback        | null = null;
  private hybridDetectionCallback: HybridDetectionCallback | null = null;

  private _hybridResult:    DetectionResult | null = null;
  private _lastHybridData:  Partial<HybridData>   = {};

  // Simulator state — non-null while simulator is active
  private _simulatedDTCs:    string[] | null = null;
  private _simOdometerKm:    number   | null = null;
  private _dynInterval:      ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.manager = new BleManager();
    // Watch BLE adapter state
    this.manager.onStateChange(state => {
      if (state === State.PoweredOff) this._handleDisconnect();
    }, true);
  }

  // ── Public callbacks ─────────────────────────────────────────
  setDataCallback(cb: DataCallback | null)                        { this.dataCallback = cb; }
  setDisconnectCallback(cb: DisconnectCallback | null)            { this.disconnectCallback = cb; }
  setVinCallback(cb: VinCallback | null)                          { this.vinCallback = cb; }
  setOdometerCallback(cb: OdometerCallback | null)                { this.odometerCallback = cb; }
  setHybridDetectionCallback(cb: HybridDetectionCallback | null)  { this.hybridDetectionCallback = cb; }

  getHybridResult(): DetectionResult | null { return this._hybridResult; }

  // ── Permissions ──────────────────────────────────────────────
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    return Object.values(results).every(v => v === PermissionsAndroid.RESULTS.GRANTED);
  }

  // ── Scan ─────────────────────────────────────────────────────
  // ELM327 BLE adapters (and clones) advertise one of these two services.
  // Scanning with service UUIDs lets the OS pre-filter at the radio level,
  // so only genuine ELM327-compatible adapters appear in the callback.
  private static readonly ELM_SERVICE_UUIDS = [
    '0000fff0-0000-1000-8000-00805f9b34fb', // most common clone (FFF0)
    '0000ffe0-0000-1000-8000-00805f9b34fb', // alternate clone chip (FFE0)
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Vgate iCar Pro BLE 4.0
    'fff0', 'ffe0',                           // short-form fallback
  ];

  private static readonly ELM_NAME_KEYWORDS = [
    'ELM', 'OBD', 'VLINK', 'OBDII', 'ICAR', 'KONNWEI', 'VEEPEAK', 'CARISTA', 'BLUEDRIVER',
  ];

  async scanForELM327(
    onFound:  (d: Device) => void,
    onError:  (e: any)    => void,
  ): Promise<void> {
    const ok = await this.requestPermissions();
    if (!ok) { onError('Bluetooth permissions denied'); return; }

    // First pass: OS-level filter by ELM327 service UUIDs (most efficient).
    // Some clone adapters don't advertise service UUIDs until connected, so
    // the name-keyword check below catches those as a fallback.
    this.manager.startDeviceScan(
      OBDServiceClass.ELM_SERVICE_UUIDS,
      { allowDuplicates: false },
      (err, dev) => {
        if (err) { onError(err); return; }
        if (!dev) return;

        const name = (dev.name ?? dev.localName ?? '').toUpperCase();
        const advUUIDs = (dev.serviceUUIDs ?? []).map(u => u.toLowerCase());

        // Accept if name matches a known ELM327 brand/keyword
        const nameMatch = OBDServiceClass.ELM_NAME_KEYWORDS.some(kw => name.includes(kw));

        // Accept nameless devices only if they already advertised a known ELM service UUID
        const uuidMatch = advUUIDs.some(u =>
          u.includes('fff0') || u.includes('ffe0') || u.includes('e7810a71'),
        );

        if (nameMatch || uuidMatch) onFound(dev);
      },
    );

    setTimeout(() => this.manager.stopDeviceScan(), 12_000);
  }

  stopScan() { this.manager.stopDeviceScan(); }

  // ── Connect ──────────────────────────────────────────────────
  async connect(device: Device, vehicleId: string): Promise<boolean> {
    try {
      this.vehicleId = vehicleId;
      const connected = await device.connect({ timeout: 12_000 });
      await connected.discoverAllServicesAndCharacteristics();
      // Request larger MTU so ELM327 responses arrive in fewer (or one) BLE
      // notification packets rather than being fragmented across many 23-byte chunks.
      await connected.requestMTU(512).catch(() => {});
      this.device    = connected;
      this.connected = true;

      // Monitor for device-initiated disconnection
      this.device.onDisconnected(() => this._handleDisconnect());

      await this._setupNotifications();
      await this._initELM327();
      return true;
    } catch (e) {
      console.error('[OBD] connect error:', e);
      this.connected = false;
      return false;
    }
  }

  // ── Graceful internal disconnect ─────────────────────────────
  private _handleDisconnect() {
    this.stopPolling();
    this._clearQueue(new Error('BLE device disconnected'));
    this.rxBuffer  = '';
    this.sending   = false;
    this.connected = false;
    this.device    = null;
    if (this.disconnectCallback) this.disconnectCallback();
  }

  private _clearQueue(err: Error) {
    for (const item of this.cmdQueue) {
      clearTimeout(item.timer);
      item.reject(err);
    }
    this.cmdQueue = [];
  }

  // ── BLE Notifications ────────────────────────────────────────
  private async _setupNotifications(): Promise<void> {
    if (!this.device) return;
    this.device.monitorCharacteristicForService(
      SVC_UUID, NOTIFY_UUID,
      (err, char) => {
        if (err || !char?.value) return;
        this.rxBuffer += Base64.decode(char.value);
        // ELM327 signals end of response with '>'.
        // Slice only up to the first '>' so that any data arriving after it
        // (e.g. a second rapid response) stays in the buffer for the next command
        // rather than being silently discarded.
        if (this.rxBuffer.includes('>')) {
          const promptIdx = this.rxBuffer.indexOf('>');
          const response  = this.rxBuffer.slice(0, promptIdx).trim();
          this.rxBuffer   = this.rxBuffer.slice(promptIdx + 1).trimStart();
          const current   = this.cmdQueue[0];
          if (current) {
            clearTimeout(current.timer);
            this.cmdQueue.shift();
            this.sending = false;
            current.resolve(response);
            // Advance queue
            this._drainQueue();
          }
        }
      },
    );
  }

  // ── Command Queue ────────────────────────────────────────────
  // timeoutMs: use a longer value for init AT commands, shorter for live PIDs.
  private _sendCommand(command: string, timeoutMs = 1_500): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.cmdQueue[0]?.command === command) {
          this.cmdQueue.shift();
          this.sending = false;
          // Clear any partial / late response so the next command gets a clean buffer.
          // Without this, a late reply from the timed-out command poisons the next
          // command's response, shifting every subsequent reading by one PID.
          this.rxBuffer = '';
          this._drainQueue();
        }
        reject(new Error(`Timeout: ${command.trim()}`));
      }, timeoutMs);

      this.cmdQueue.push({ command, resolve, reject, timer });
      if (!this.sending) this._drainQueue();
    });
  }

  private _drainQueue() {
    if (this.sending || this.cmdQueue.length === 0 || !this.device) return;
    this.sending = true;
    const { command } = this.cmdQueue[0];
    const encoded = Base64.encode(command);
    // ELM327 BLE dongles use UART-over-BLE: the characteristic is Write Without Response.
    // Using writeWithResponse waits for a BLE L2CAP ACK (100–500 ms extra per command)
    // that the adapter firmware never explicitly sends, causing unnecessary round-trip lag.
    this.device
      .writeCharacteristicWithoutResponseForService(SVC_UUID, WRITE_UUID, encoded)
      .catch(err => {
        // Write failed — reject head item and advance
        const item = this.cmdQueue.shift();
        if (item) { clearTimeout(item.timer); item.reject(err); }
        this.sending = false;
        this._drainQueue();
      });
  }

  // ── ELM327 Init ──────────────────────────────────────────────
  private async _initELM327(): Promise<void> {
    for (const cmd of INIT_CMDS) {
      try {
        // ATZ (reset) can take up to 2 s on slow clone adapters; other AT commands are fast.
        await this._sendCommand(cmd, cmd === 'ATZ\r' ? 4_000 : 3_000);
        await _sleep(cmd === 'ATZ\r' ? 1_000 : 100);
      } catch {
        // Some init commands time-out on slow adapters — safe to continue
      }
    }
    // After init, read VIN then odometer from ECU
    await _sleep(200);
    this.readVIN().then(vin => {
      if (vin && this.vinCallback) this.vinCallback(vin);
    }).catch(() => {});
    // Odometer read after VIN — give ECU a moment
    await _sleep(200);
    this.readOdometer().catch(() => {});
    // Hybrid detection — fire-and-forget so polling can start immediately
    await _sleep(200);
    this._detectHybrid().catch(() => {});
  }

  // ── Hybrid Auto-Detection ─────────────────────────────────────
  private async _detectHybrid(): Promise<void> {
    try {
      const result = await HybridService.detectHybrid(
        (cmd: string) => this._sendCommand(cmd),
      );
      this._hybridResult = result;
      if (this.hybridDetectionCallback) this.hybridDetectionCallback(result);
      console.log('[OBD] Hybrid detection complete:', result);
    } catch (e) {
      console.log('[OBD] Hybrid detection failed:', e);
    }
  }

  // ── VIN Parser (Mode 09 PID 02) ──────────────────────────────
  // ELM327 returns multi-line response: each line starts with 4902
  // Format: 49(mode) 02(pid) XX(count/frame) [VIN bytes as hex]
  private _parseVIN(response: string): string {
    const lines = response
      .replace(/>/g, '')
      .split('\n')
      .map(l => l.replace(/\s/g, '').toUpperCase())
      .filter(l => l.includes('4902') && l.length > 6);

    if (lines.length === 0) return '';

    let hexData = '';
    for (const line of lines) {
      // Find '4902' in the line (may have CAN header prefix)
      const idx = line.indexOf('4902');
      if (idx === -1) continue;
      // Skip 4902 (4 chars) + count/frame byte (2 chars) = 6 chars
      hexData += line.slice(idx + 6);
    }

    // Decode hex pairs → ASCII characters
    let vin = '';
    for (let i = 0; i + 1 < hexData.length && vin.length < 17; i += 2) {
      const code = parseInt(hexData.slice(i, i + 2), 16);
      // Printable ASCII only (VIN chars: A-Z, 0-9, no I/O/Q)
      if (code >= 0x30 && code <= 0x5A) vin += String.fromCharCode(code);
    }
    return vin.length >= 5 ? vin : '';  // sanity check — real VIN is 17 chars
  }

  // ── Read VIN from ECU ─────────────────────────────────────────
  async readVIN(): Promise<string> {
    if (!this.connected || !this.device) return '';
    try {
      const response = await this._sendCommand(PIDS.VIN_READ);
      const vin = this._parseVIN(response);
      console.log('[OBD] VIN read:', vin || '(not available)');
      return vin;
    } catch (e) {
      console.log('[OBD] VIN read failed:', e);
      return '';
    }
  }

  // ── Read Odometer from ECU (Mode 01 PID 0xA6) ────────────────
  // Returns -1 if the ECU does not support PID 0xA6.
  // Returns 0+ (km) when supported, including 0 km for brand-new vehicles.
  async readOdometer(): Promise<number> {
    if (!this.connected || !this.device) return -1;
    try {
      const response = await this._sendCommand(PIDS.ODOMETER);
      // Check for actual '41 A6' response — absence means PID not supported.
      const clean = response.replace(/[\s>]/g, '').toUpperCase();
      if (!clean.includes('41A6')) {
        console.log('[OBD] Odometer PID not supported by this ECU (no 41A6 in response)');
        return -1;
      }
      const km = this._parsePID('A6', response);
      console.log('[OBD] Odometer from ECU:', km, 'km');
      if (this.odometerCallback) this.odometerCallback(Math.round(km));
      return Math.round(km);
    } catch (e) {
      console.log('[OBD] Odometer read failed:', e);
      return -1;
    }
  }

  // ── PID Response Parser ───────────────────────────────────────
  private _parsePID(pidHex: string, response: string): number {
    // Strip prompt, whitespace, echo line
    const lines = response.replace(/>/g, '').split('\n').map(l => l.replace(/\s/g, ''));
    const pidUpper = pidHex.toUpperCase();
    // Find the response line starting with '41' AND matching the expected PID byte.
    // This prevents a stale or mismatched response from being misread as another PID.
    const dataLine = lines.find(l =>
      l.startsWith('41') && l.slice(2, 4).toUpperCase() === pidUpper,
    );
    if (!dataLine || dataLine.length < 6) return 0;

    try {
      // Byte positions: 41 XX AA BB …  (XX = pid)
      const bytes = dataLine.match(/.{1,2}/g) ?? [];
      const A = parseInt(bytes[2] ?? '00', 16);
      const B = parseInt(bytes[3] ?? '00', 16);
      const C = parseInt(bytes[4] ?? '00', 16);

      const D = parseInt(bytes[5] ?? '00', 16);

      switch (pidHex) {
        case '0C': return ((A * 256) + B) / 4;                                  // RPM
        case '0D': return A;                                                      // Speed km/h
        case '05': return A - 40;                                                 // Coolant °C
        case '11': return (A * 100) / 255;                                       // Throttle %
        case '2F': return (A * 100) / 255;                                       // Fuel %
        case '04': return (A * 100) / 255;                                       // Engine Load %
        case '0F': return A - 40;                                                 // Intake Temp °C
        case '10': return ((A * 256) + B) / 100;                                 // MAF g/s
        case '0A': return A * 3;                                                  // Fuel Pressure kPa
        case '42': return ((A * 256) + B) / 1000;                               // Voltage V
        // 4-byte unsigned integer / 10 → total odometer in km
        case 'A6': return ((A * 16777216) + (B * 65536) + (C * 256) + D) / 10; // Odometer km
        default:   return 0;
      }
    } catch {
      return 0;
    }
  }

  // ── DTC Parser ────────────────────────────────────────────────
  private _parseDTCs(response: string): string[] {
    const codes: string[] = [];
    const lines = response.replace(/>/g, '').split('\n').map(l => l.replace(/\s/g, ''));
    for (const line of lines) {
      if (!line.startsWith('43')) continue;
      const data = line.slice(2);
      const pairs = data.match(/.{4}/g) ?? [];
      for (const pair of pairs) {
        // Skip null entries (0x0000 = no fault stored).
        // Previously used `hi === 0` which incorrectly dropped P0xxx codes (e.g. P0100, P0300).
        if (pair === '0000') continue;
        const hi = parseInt(pair[0], 16);
        const prefix = ['P', 'C', 'B', 'U'][Math.floor(hi / 4)] ?? 'P';
        const code   = prefix + (hi % 4).toString() + pair.slice(1);
        if (code !== 'P0000') codes.push(code);
      }
    }
    return codes;
  }

  // ── Fetch All Live PIDs ──────────────────────────────────────
  // Commands are serialised through the queue — ELM327 requirement.
  async fetchLiveData(): Promise<any> {
    if (!this.connected || !this.device) return null;

    // ── Hybrid path ───────────────────────────────────────────
    if (this._hybridResult?.isHybrid) {
      let hd: HybridData;
      try {
        hd = await HybridService.fetchData(
          (cmd: string) => this._sendCommand(cmd),
          this._lastHybridData,
        );
      } catch {
        return null;
      }
      this._lastHybridData = hd;

      const data = {
        vehicle_id:        this.vehicleId,
        // Standard fields (same keys OBDContext expects)
        rpm:               Math.round(hd.rpm),
        speed:             Math.round(hd.speed),
        engine_temp:       Math.round(hd.engineTemp),
        throttle:          Math.round(hd.throttle),
        fuel_level:        Math.round(hd.fuelLevelPct),
        engine_load:       Math.round(hd.engineLoad),
        intake_temp:       Math.round(hd.intakeTemp),
        maf:               parseFloat(hd.maf.toFixed(2)),
        fuel_pressure:     Math.round(hd.fuelPressure),
        voltage:           parseFloat(hd.voltage.toFixed(1)),
        // Hybrid-specific fields
        is_hybrid:         true,
        hybrid_brand:      this._hybridResult.brand,
        hybrid_mode:       hd.mode,
        hv_battery_pct:    Math.round(hd.hvBatteryPct),
        hv_battery_voltage:parseFloat(hd.hvBatteryVoltage.toFixed(1)),
        hv_battery_current:parseFloat(hd.hvBatteryCurrent.toFixed(1)),
        hv_battery_temp:   Math.round(hd.hvBatteryTemp),
        motor_speed:       Math.round(hd.motorSpeed),
        mg2_speed:         Math.round(hd.mg2Speed),
        hybrid_system_power: Math.round(hd.hybridSystemPower),
        regen_power:       Math.round(hd.regenPower),
        fuel_rate:         parseFloat(hd.fuelRate.toFixed(2)),
        ambient_temp:      Math.round(hd.ambientTemp),
        hv_battery_alert:  hd.hvBatteryAlert,
        stale_cache:       hd.staleCache,
      };

      if (this.dataCallback) this.dataCallback(data);
      saveOBDData(data).catch(() => {});
      return data;
    }

    // ── Standard ICE path ─────────────────────────────────────
    const send = (cmd: string, pid: string) =>
      this._sendCommand(cmd)
        .then(r => this._parsePID(pid, r))
        .catch(() => 0);

    const rpm          = await send(PIDS.RPM,           '0C');
    const speed        = await send(PIDS.SPEED,         '0D');
    const engine_temp  = await send(PIDS.ENGINE_TEMP,   '05');
    const throttle     = await send(PIDS.THROTTLE,      '11');
    const fuel_level   = await send(PIDS.FUEL_LEVEL,    '2F');
    const engine_load  = await send(PIDS.ENGINE_LOAD,   '04');
    const intake_temp  = await send(PIDS.INTAKE_TEMP,   '0F');
    const maf          = await send(PIDS.MAF,           '10');
    const fuel_pressure= await send(PIDS.FUEL_PRESSURE, '0A');
    const voltage      = await send(PIDS.VOLTAGE,       '42') || 12.0;

    const data = {
      vehicle_id:    this.vehicleId,
      rpm:           Math.round(rpm),
      speed:         Math.round(speed),
      engine_temp:   Math.round(engine_temp),
      throttle:      Math.round(throttle),
      fuel_level:    Math.round(fuel_level),
      engine_load:   Math.round(engine_load),
      intake_temp:   Math.round(intake_temp),
      maf:           parseFloat(maf.toFixed(2)),
      fuel_pressure: Math.round(fuel_pressure),
      voltage:       parseFloat(voltage.toFixed(1)),
      is_hybrid:     false,
    };

    if (this.dataCallback) this.dataCallback(data);
    saveOBDData(data).catch(() => {});
    return data;
  }

  // ── Read DTCs ─────────────────────────────────────────────────
  async readDTCCodes(): Promise<string[]> {
    // Simulator overrides real BLE scan
    if (this._simulatedDTCs !== null) {
      if (this._simulatedDTCs.length > 0) saveDTC(this.vehicleId || 'simulator', this._simulatedDTCs).catch(() => {});
      return this._simulatedDTCs;
    }
    if (!this.connected) return [];
    try {
      const response = await this._sendCommand(PIDS.DTC_READ);
      const codes    = this._parseDTCs(response);
      if (codes.length > 0) saveDTC(this.vehicleId, codes).catch(() => {});
      return codes;
    } catch {
      return [];
    }
  }

  // ── Clear DTCs ────────────────────────────────────────────────
  async clearDTCCodes(): Promise<boolean> {
    if (!this.connected) return false;
    try {
      await this._sendCommand(PIDS.DTC_CLEAR);
      return true;
    } catch {
      return false;
    }
  }

  // ── ELM327 Simulator ──────────────────────────────────────────
  // Standard ICE PIDs run through the real _parsePID() pipeline.
  // Hybrid data is passed directly (no standard PIDs exist for HV battery).
  // DTCs injected here are returned by the next readDTCCodes() call.
  // odometer_km immediately fires the odometerCallback (Maintenance screen).
  simulateELM327(raw: {
    // Standard PID hex strings — run through real parser
    rpm?:           string;
    speed?:         string;
    engine_temp?:   string;
    throttle?:      string;
    fuel_level?:    string;
    engine_load?:   string;
    intake_temp?:   string;
    maf?:           string;
    fuel_pressure?: string;
    voltage?:       string;
    // Diagnostics screen — codes returned on next Scan tap
    dtcs?:          string[];
    // Maintenance screen — fires odometerCallback immediately
    odometer_km?:   number;
    // Hybrid-specific data (set is_hybrid=true path in dataCallback)
    hybrid?: {
      brand:               'toyota' | 'honda' | 'generic';
      mode:                string;
      hv_battery_pct:      number;
      hv_battery_voltage:  number;
      hv_battery_current:  number;
      hv_battery_temp:     number;
      motor_speed:         number;
      hybrid_system_power: number;
      regen_power:         number;
      hv_battery_alert?:   string;
    };
  }): void {
    this.connected = true;

    // Inject DTCs — next readDTCCodes() call returns these without BLE
    this._simulatedDTCs = raw.dtcs ?? null;

    // Inject odometer — Maintenance screen picks this up immediately
    if (raw.odometer_km !== undefined) {
      this._simOdometerKm = raw.odometer_km;
      if (this.odometerCallback) this.odometerCallback(raw.odometer_km);
    }

    const p = (pid: string, r?: string) => r ? this._parsePID(pid, r) : 0;

    if (raw.hybrid) {
      // Mark as hybrid so OBDContext renders the hybrid dashboard panels
      this._hybridResult = { isHybrid: true, brand: raw.hybrid.brand, confidence: 95 };

      const data = {
        vehicle_id:           this.vehicleId || 'simulator',
        rpm:                  Math.round(p('0C', raw.rpm)),
        speed:                Math.round(p('0D', raw.speed)),
        engine_temp:          Math.round(p('05', raw.engine_temp)),
        throttle:             Math.round(p('11', raw.throttle)),
        fuel_level:           Math.round(p('2F', raw.fuel_level)),
        engine_load:          Math.round(p('04', raw.engine_load)),
        intake_temp:          Math.round(p('0F', raw.intake_temp)),
        maf:                  parseFloat(p('10', raw.maf).toFixed(2)),
        fuel_pressure:        Math.round(p('0A', raw.fuel_pressure)),
        voltage:              parseFloat((p('42', raw.voltage) || 12.0).toFixed(1)),
        is_hybrid:            true,
        hybrid_brand:         raw.hybrid.brand,
        hybrid_mode:          raw.hybrid.mode,
        hv_battery_pct:       raw.hybrid.hv_battery_pct,
        hv_battery_voltage:   raw.hybrid.hv_battery_voltage,
        hv_battery_current:   raw.hybrid.hv_battery_current,
        hv_battery_temp:      raw.hybrid.hv_battery_temp,
        motor_speed:          raw.hybrid.motor_speed,
        mg2_speed:            Math.round(raw.hybrid.motor_speed * 0.85),
        hybrid_system_power:  raw.hybrid.hybrid_system_power,
        regen_power:          raw.hybrid.regen_power,
        fuel_rate:            0,
        ambient_temp:         28,
        hv_battery_alert:     raw.hybrid.hv_battery_alert ?? null,
        stale_cache:          false,
      };
      if (this.dataCallback) this.dataCallback(data);
    } else {
      // Standard ICE — all values go through the real parser
      if (raw.hybrid === undefined) this._hybridResult = null;
      const data = {
        vehicle_id:    this.vehicleId || 'simulator',
        rpm:           Math.round(p('0C', raw.rpm)),
        speed:         Math.round(p('0D', raw.speed)),
        engine_temp:   Math.round(p('05', raw.engine_temp)),
        throttle:      Math.round(p('11', raw.throttle)),
        fuel_level:    Math.round(p('2F', raw.fuel_level)),
        engine_load:   Math.round(p('04', raw.engine_load)),
        intake_temp:   Math.round(p('0F', raw.intake_temp)),
        maf:           parseFloat(p('10', raw.maf).toFixed(2)),
        fuel_pressure: Math.round(p('0A', raw.fuel_pressure)),
        voltage:       parseFloat((p('42', raw.voltage) || 12.0).toFixed(1)),
        is_hybrid:     false,
      };
      if (this.dataCallback) this.dataCallback(data);
    }
  }

  stopSimulator() {
    if (this._dynInterval) {
      clearInterval(this._dynInterval);
      this._dynInterval = null;
    }
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this._simulatedDTCs = null;
    this._simOdometerKm = null;
    this._hybridResult  = null;
    this.connected = false;
    if (this.disconnectCallback) this.disconnectCallback();
  }

  // Public setter so the simulator can assign a vehicleId without a BLE connect.
  setVehicleId(id: string): void { this.vehicleId = id; }

  // Direct numeric injection — bypasses hex parser.
  // For dynamic scenarios where values are computed per-tick as numbers.
  simulateLiveData(d: {
    rpm?: number; speed?: number; engine_temp?: number; throttle?: number;
    fuel_level?: number; engine_load?: number; intake_temp?: number;
    maf?: number; fuel_pressure?: number; voltage?: number;
    is_hybrid?: boolean;
    hybrid_brand?: 'toyota' | 'honda' | 'generic';
    hybrid_mode?: string;
    hv_battery_pct?: number; hv_battery_voltage?: number;
    hv_battery_current?: number; hv_battery_temp?: number;
    motor_speed?: number; hybrid_system_power?: number; regen_power?: number;
    hv_battery_alert?: string | null;
    dtcs?: string[];
    odometer_km?: number;
  }): void {
    this.connected = true;
    if (d.dtcs !== undefined)       this._simulatedDTCs = d.dtcs;
    if (d.odometer_km !== undefined) {
      this._simOdometerKm = d.odometer_km;
      if (this.odometerCallback) this.odometerCallback(d.odometer_km);
    }

    const isHybrid = d.is_hybrid ?? false;
    this._hybridResult = isHybrid
      ? { isHybrid: true, brand: (d.hybrid_brand ?? 'toyota'), confidence: 95 }
      : null;

    const base: any = {
      vehicle_id:    this.vehicleId || 'simulator',
      rpm:           Math.round(d.rpm ?? 0),
      speed:         Math.round(d.speed ?? 0),
      engine_temp:   Math.round(d.engine_temp ?? 0),
      throttle:      Math.round(d.throttle ?? 0),
      fuel_level:    Math.round(d.fuel_level ?? 0),
      engine_load:   Math.round(d.engine_load ?? 0),
      intake_temp:   Math.round(d.intake_temp ?? 28),
      maf:           parseFloat((d.maf ?? 4.5).toFixed(2)),
      fuel_pressure: Math.round(d.fuel_pressure ?? 300),
      voltage:       parseFloat((d.voltage ?? 13.8).toFixed(1)),
      is_hybrid:     isHybrid,
    };
    if (isHybrid) {
      Object.assign(base, {
        hybrid_brand:        d.hybrid_brand ?? 'toyota',
        hybrid_mode:         d.hybrid_mode ?? 'EV',
        hv_battery_pct:      Math.round(d.hv_battery_pct ?? 60),
        hv_battery_voltage:  parseFloat((d.hv_battery_voltage ?? 270).toFixed(1)),
        hv_battery_current:  parseFloat((d.hv_battery_current ?? 0).toFixed(1)),
        hv_battery_temp:     Math.round(d.hv_battery_temp ?? 28),
        motor_speed:         Math.round(d.motor_speed ?? 0),
        mg2_speed:           Math.round((d.motor_speed ?? 0) * 0.85),
        hybrid_system_power: parseFloat((d.hybrid_system_power ?? 0).toFixed(1)),
        regen_power:         parseFloat((d.regen_power ?? 0).toFixed(1)),
        fuel_rate:           0,
        ambient_temp:        28,
        hv_battery_alert:    d.hv_battery_alert ?? null,
        stale_cache:         false,
      });
    }
    if (this.dataCallback) this.dataCallback(base);
  }

  // Interval-based dynamic sim — calls tickFn(tick) every intervalMs.
  // Each tick produces live sensor values; OBD screens update automatically.
  startDynamicSim(
    tickFn: (tick: number) => Parameters<OBDServiceClass['simulateLiveData']>[0],
    intervalMs = 2000,
  ): void {
    this.stopSimulator();   // clear any prior sim/polling first
    this.connected = true;
    let tick = 0;
    const fire = () => this.simulateLiveData(tickFn(tick++));
    fire();                  // fire tick 0 immediately (no initial delay)
    this._dynInterval = setInterval(fire, intervalMs);
  }

  // ── Polling ───────────────────────────────────────────────────
  // Recursive setTimeout instead of setInterval: the next poll only schedules
  // AFTER the current fetch fully completes, preventing queue pile-up when
  // fetching 10 PIDs takes longer than the nominal interval.
  startPolling(intervalMs = 2000) {
    this.stopPolling();
    this._pollingActive = true;
    const loop = async () => {
      if (!this._pollingActive || !this.connected) return;
      await this.fetchLiveData().catch(() => {});
      if (this._pollingActive && this.connected) {
        this.pollingInterval = setTimeout(loop, intervalMs);
      }
    };
    loop();
  }

  stopPolling() {
    this._pollingActive = false;
    if (this.pollingInterval) {
      clearTimeout(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  // ── Disconnect ────────────────────────────────────────────────
  async disconnect(): Promise<void> {
    this.stopPolling();
    if (this.device) {
      try { await this.device.cancelConnection(); } catch { /* ignore */ }
    }
    this._handleDisconnect();
  }

  getConnectionStatus() { return this.connected; }
  getVehicleId()        { return this.vehicleId; }
}

const _sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export const OBDService = new OBDServiceClass();
export default OBDService;
