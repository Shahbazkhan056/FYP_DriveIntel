/**
 * HybridService — Hybrid vehicle auto-detection and dual-mode OBD monitoring.
 *
 * Implements 4-step detection (PID 0x1C / 0x65 / 0x5B / behaviour test),
 * Toyota Mode 22 and Honda Mode 21 enhanced PIDs, the mode state machine,
 * and all sanitization rules from the DriveIntel hybrid spec.
 */

export type HybridBrand = 'toyota' | 'honda' | 'generic' | 'none';

export type HybridMode =
  | 'PARKED_OFF'
  | 'READY_EV'
  | 'READY_ENGINE'
  | 'TRANSITION'
  | 'REGEN_BRAKING'
  | 'CHARGING_ICE'
  | 'HV_BATTERY_LOW';

export interface DetectionResult {
  isHybrid:   boolean;
  brand:      HybridBrand;
  confidence: number;
}

export interface HybridData {
  mode:              HybridMode;
  // HV battery
  hvBatteryPct:      number;
  hvBatteryVoltage:  number;
  hvBatteryCurrent:  number;
  hvBatteryTemp:     number;
  // Motor / drivetrain (Toyota only)
  motorSpeed:        number;
  mg1Speed:          number;
  mg2Speed:          number;
  driveMotorTorque:  number;
  hybridSystemPower: number;
  regenPower:        number;
  // Common sensor fields (same names as standard OBD for compatibility)
  speed:        number;
  rpm:          number;
  engineTemp:   number;
  throttle:     number;
  engineLoad:   number;
  fuelLevelPct: number;
  fuelRate:     number;
  intakeTemp:   number;
  maf:          number;
  fuelPressure: number;
  voltage:      number;
  ambientTemp:  number;
  // Status
  staleCache:     boolean;
  hvBatteryAlert: string;
  rawValues:      Record<string, number>;
}

type SendFn = (cmd: string) => Promise<string>;

// ── Response helpers ──────────────────────────────────────────

function isNoData(r: string): boolean {
  const u = r.toUpperCase().replace(/\s/g, '');
  return (
    u.includes('NODATA') || u.includes('ERROR') ||
    u.includes('UNABLE') || u.includes('STOPPED') ||
    u.trim() === '>'
  );
}

function cleanLines(r: string): string[] {
  return r
    .replace(/>/g, '')
    .split('\n')
    .map(l => l.replace(/\s/g, '').toUpperCase())
    .filter(l => l.length > 0);
}

function safe(hex: string | undefined): number {
  return hex ? parseInt(hex, 16) : 0;
}

// ── Mode 01 parser ────────────────────────────────────────────

export function parseMode01(pid: string, response: string): number {
  if (isNoData(response)) return -1;
  const line = cleanLines(response).find(l => l.startsWith('41'));
  if (!line || line.length < 6) return -1;
  const b = line.match(/.{1,2}/g) ?? [];
  const A = safe(b[2]), B = safe(b[3]), C = safe(b[4]), D = safe(b[5]);
  switch (pid.toUpperCase()) {
    case '0C': return ((A * 256) + B) / 4;
    case '0D': return A;
    case '05': return A - 40;
    case '04': return (A * 100) / 255;
    case '11': return (A * 100) / 255;
    case '0F': return A - 40;
    case '10': return ((A * 256) + B) / 100;
    case '0A': return A * 3;
    case '42': return ((A * 256) + B) / 1000;
    case '5E': return ((A * 256) + B) * 0.05;
    case '1F': return (A * 256) + B;
    case '33': return A;
    case '2F': return (A * 100) / 255;
    case '5B': return (A * 100) / 255;
    case '5C': return A - 40;
    case '46': return A - 40;
    case '1C': return A;
    case '65': return A;
    case 'A6': return ((A * 16777216) + (B * 65536) + (C * 256) + D) / 10;
    default:   return -1;
  }
}

// ── Mode 22 parser (Toyota enhanced — command 22XXYY, response 62XXYY AA BB …)
export function parseMode22(pid4: string, response: string): number {
  if (isNoData(response)) return -1;
  const prefix = '62' + pid4.toUpperCase().padStart(4, '0');
  const line = cleanLines(response).find(l => l.startsWith(prefix) || l.startsWith('62'));
  if (!line || line.length < prefix.length + 2) return -1;
  const hex = line.slice(line.startsWith(prefix) ? prefix.length : 6);
  const b = (hex.match(/.{1,2}/g) ?? []).map(h => parseInt(h, 16));
  const A = b[0] ?? 0, B = b[1] ?? 0;
  switch (pid4.toUpperCase()) {
    case '2161': return ((A * 256) + B) * 0.1;
    case '2162': return ((A * 256) + B) * 0.1 - 3276.8;
    case '2163': return (A * 100) / 255;
    case '2164': return A - 40;
    case '2165': return (A * 256) + B;
    case '2166': return ((A * 256) + B) - 32768;
    case '2167': return ((A * 256) + B) - 32768;
    case '2168': return ((A * 256) + B) * 0.1;
    case '21A0': return ((A * 256) + B) - 32768;
    case '21A1': return (A * 256) + B;
    default:     return -1;
  }
}

// ── Mode 21 parser (Honda enhanced — command 21XX, response 61XX AA BB …)
export function parseMode21(pid2: string, response: string): number {
  if (isNoData(response)) return -1;
  const prefix = '61' + pid2.toUpperCase().padStart(2, '0');
  const line = cleanLines(response).find(l => l.startsWith(prefix) || l.startsWith('61'));
  if (!line || line.length < prefix.length + 2) return -1;
  const hex = line.slice(line.startsWith(prefix) ? prefix.length : 4);
  const b = (hex.match(/.{1,2}/g) ?? []).map(h => parseInt(h, 16));
  const A = b[0] ?? 0, B = b[1] ?? 0;
  switch (pid2.toUpperCase()) {
    case '01': return ((A * 256) + B) * 0.5;
    case '02': return ((A * 256) + B) * 0.1 - 128;
    case '03': return A;
    case '04': return A - 40;
    case '05': return A;
    default:   return -1;
  }
}

// ── Mode state machine ────────────────────────────────────────

export function determineMode(
  rpm:          number,
  speed:        number,
  hvBatteryPct: number,
  throttle:     number,
  prevMode:     HybridMode,
): HybridMode {
  if (rpm === 0 && speed === 0) {
    return hvBatteryPct < 20 ? 'HV_BATTERY_LOW' : 'PARKED_OFF';
  }
  if (rpm > 0 && rpm < 500)                           return 'TRANSITION';
  if (rpm >= 500 && speed === 0 && hvBatteryPct < 60) return 'CHARGING_ICE';
  if (rpm >= 500)                                      return 'READY_ENGINE';
  // rpm === 0, speed > 0
  if (throttle === 0 && speed > 5)  return 'REGEN_BRAKING';
  if (hvBatteryPct < 20)            return 'HV_BATTERY_LOW';
  return 'READY_EV';
}

// ── Sanitization (Rules 1–5) ──────────────────────────────────

export function sanitize(
  rpm:          number,
  speed:        number,
  engineTemp:   number,
  throttle:     number,
  engineLoad:   number,
  hvBatteryPct: number,
  mode:         HybridMode,
): { rpm: number; speed: number; engineLoad: number; staleCache: boolean; hvBatteryAlert: string } {
  let outSpeed = speed, outLoad = engineLoad;
  let staleCache = false, hvBatteryAlert = '';

  // Rule 1: ELM327 cache bug — rpm=0, speed>0, cold engine
  if (rpm === 0 && speed > 0 && engineTemp < 40) {
    outSpeed = 0;
    staleCache = true;
  }

  // Rule 3: Regen — engineLoad is always 0
  if (mode === 'REGEN_BRAKING') outLoad = 0;

  // Rule 5: HV battery alerts
  if (hvBatteryPct < 10)      hvBatteryAlert = 'CRITICAL — Engine starting now';
  else if (hvBatteryPct < 20) hvBatteryAlert = 'Engine will start soon';

  return { rpm, speed: outSpeed, engineLoad: outLoad, staleCache, hvBatteryAlert };
}

// ── Utility ───────────────────────────────────────────────────

function fb(val: number, prev: number | undefined, def = 0): number {
  return val >= 0 ? val : (prev ?? def);
}

const BLANK: HybridData = {
  mode: 'PARKED_OFF',
  hvBatteryPct: 0, hvBatteryVoltage: 0, hvBatteryCurrent: 0, hvBatteryTemp: 0,
  motorSpeed: 0, mg1Speed: 0, mg2Speed: 0, driveMotorTorque: 0,
  hybridSystemPower: 0, regenPower: 0,
  speed: 0, rpm: 0, engineTemp: 0, throttle: 0, engineLoad: 0,
  fuelLevelPct: 0, fuelRate: 0, intakeTemp: 0, maf: 0, fuelPressure: 0,
  voltage: 12, ambientTemp: 25,
  staleCache: false, hvBatteryAlert: '', rawValues: {},
};

// ── Main service class ────────────────────────────────────────

class HybridServiceClass {
  private detection:          DetectionResult = { isHybrid: false, brand: 'none', confidence: 0 };
  private mode22 = false;
  private mode21 = false;
  private stableMode: HybridMode      = 'PARKED_OFF';
  private currentMode: HybridMode     = 'PARKED_OFF';
  private transitionStart              = 0;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;

  getDetection()  { return this.detection; }
  getMode()       { return this.currentMode; }

  // ── 4-step hybrid auto-detection ─────────────────────────────

  async detectHybrid(send: SendFn): Promise<DetectionResult> {
    let evidence = 0, confidence = 0;
    let brand: HybridBrand = 'generic';

    // Step 1 — OBD Standards (PID 0x1C)
    try {
      const r = await send('011C\r');
      const std = parseMode01('1C', r);
      console.debug('[Hybrid] 0x1C standard:', std);
      if (std === 6 || std === 7) { evidence += 20; confidence += 20; }
      if (std === 7) brand = 'toyota';
    } catch {}

    // Step 2 — Auxiliary I/O bit 4 = hybrid battery present (PID 0x65)
    try {
      const r = await send('0165\r');
      const aux = parseMode01('65', r);
      console.debug('[Hybrid] 0x65 aux:', aux);
      if (aux >= 0 && (aux & 0x10)) { evidence += 30; confidence += 30; }
    } catch {}

    // Step 3 — HV Battery Pack Remaining Life (PID 0x5B)
    try {
      const r = await send('015B\r');
      const pct = parseMode01('5B', r);
      console.debug('[Hybrid] 0x5B HV battery:', pct);
      if (pct >= 0) { evidence += 30; confidence += 30; }
    } catch {}

    // Step 4 — Behaviour test: speed > 0 AND rpm == 0 → EV mode confirmed
    try {
      const rr = await send('010C\r');
      const sr = await send('010D\r');
      const rpm = parseMode01('0C', rr);
      const spd = parseMode01('0D', sr);
      console.debug('[Hybrid] Behaviour — RPM:', rpm, 'Speed:', spd);
      if (rpm === 0 && spd > 0) { evidence += 20; confidence += 20; }
    } catch {}

    const isHybrid = evidence >= 30;

    // Probe enhanced PIDs (only if hybrid confirmed — non-hybrid ECUs can freeze on Mode 22)
    if (isHybrid) {
      try {
        const r = await send('222163\r');  // Toyota Mode 22 — HV SoC
        if (!isNoData(r)) {
          this.mode22 = true;
          brand = 'toyota';
          confidence = Math.min(100, confidence + 10);
          console.log('[Hybrid] Mode 22 Toyota confirmed');
        }
      } catch {}

      if (!this.mode22) {
        try {
          const r = await send('2103\r');  // Honda Mode 21 — IMA SoC
          if (!isNoData(r)) {
            this.mode21 = true;
            brand = 'honda';
            confidence = Math.min(100, confidence + 10);
            console.log('[Hybrid] Mode 21 Honda confirmed');
          }
        } catch {}
      }
    }

    this.detection = { isHybrid, brand: isHybrid ? brand : 'none', confidence };
    console.log('[Hybrid] Detection result:', this.detection);
    return this.detection;
  }

  // ── Smart fetch: probes RPM then delegates to EV or Engine fetcher ──

  async fetchData(send: SendFn, prev: Partial<HybridData> = {}): Promise<HybridData> {
    let probeRpm = 0;
    try {
      const r = await send('010C\r');
      const v = parseMode01('0C', r);
      if (v >= 0) probeRpm = v;
    } catch {}

    // Rule 4: Transition zone (0 < RPM < 500) — hold last stable values
    if (probeRpm > 0 && probeRpm < 500) {
      if (!this.transitionTimer) {
        this.transitionStart = Date.now();
        this.transitionTimer = setTimeout(() => { this.transitionTimer = null; }, 1500);
      }
      // Show last stable mode for first 1.5 s, then TRANSITION spinner
      const elapsed = Date.now() - this.transitionStart;
      const displayMode: HybridMode = elapsed >= 1500 ? 'TRANSITION' : this.stableMode;
      const held: HybridData = { ...BLANK, ...prev } as HybridData;
      return { ...held, mode: displayMode, rpm: Math.round(probeRpm), rawValues: { probe_rpm: probeRpm } };
    }

    // Stable RPM — clear transition state
    if (this.transitionTimer) { clearTimeout(this.transitionTimer); this.transitionTimer = null; }

    if (probeRpm === 0) return this._fetchEVData(send, prev);
    return this._fetchEngineData(send, probeRpm, prev);
  }

  // ── EV mode PID fetch ─────────────────────────────────────────

  private async _fetchEVData(send: SendFn, prev: Partial<HybridData>): Promise<HybridData> {
    const s01 = async (pid: string) => {
      try { return parseMode01(pid, await send(`01${pid}\r`)); } catch { return -1; }
    };

    const [speed, fuelLevel, voltage, ambientTemp, hvStd] = await Promise.all([
      s01('0D'), s01('2F'), s01('42'), s01('46'), s01('5B'),
    ]);

    let hvPct = -1, hvV = -1, hvI = -1, hvT = -1;
    let motorSpd = -1, mg1 = -1, mg2 = -1, torque = -1, power = -1, regen = -1;

    if (this.mode22) {
      [hvV, hvI, hvPct, hvT, motorSpd, mg1, mg2, torque, power, regen] = await Promise.all([
        this._s22(send, '2161'), this._s22(send, '2162'), this._s22(send, '2163'),
        this._s22(send, '2164'), this._s22(send, '2165'), this._s22(send, '2166'),
        this._s22(send, '2167'), this._s22(send, '2168'), this._s22(send, '21A0'),
        this._s22(send, '21A1'),
      ]);
    } else if (this.mode21) {
      [hvV, hvI, hvPct, hvT, motorSpd] = await Promise.all([
        this._s21(send, '01'), this._s21(send, '02'), this._s21(send, '03'),
        this._s21(send, '04'), this._s21(send, '05'),
      ]);
    }

    // Fallback to standard PID 0x5B if enhanced unavailable
    if (hvPct < 0 && hvStd >= 0) hvPct = hvStd;

    const spd  = fb(speed, prev.speed, 0);
    const hv   = fb(hvPct, prev.hvBatteryPct, 50);
    const mode = determineMode(0, spd, hv, 0, this.stableMode);
    const san  = sanitize(0, spd, prev.engineTemp ?? 20, 0, 0, hv, mode);
    this._commitMode(mode);

    const rawValues: Record<string, number> = {
      speed, fuelLevel, voltage, ambientTemp, hvStd, hvPct, hvV, hvI, hvT, motorSpd, mg1, mg2, power, regen,
    };

    return {
      mode:              this.currentMode,
      hvBatteryPct:      fb(hvPct,    prev.hvBatteryPct,      0),
      hvBatteryVoltage:  fb(hvV,      prev.hvBatteryVoltage,  0),
      hvBatteryCurrent:  fb(hvI,      prev.hvBatteryCurrent,  0),
      hvBatteryTemp:     fb(hvT,      prev.hvBatteryTemp,     0),
      motorSpeed:        fb(motorSpd, prev.motorSpeed,         0),
      mg1Speed:          fb(mg1,      prev.mg1Speed,           0),
      mg2Speed:          fb(mg2,      prev.mg2Speed,           0),
      driveMotorTorque:  fb(torque,   prev.driveMotorTorque,   0),
      hybridSystemPower: fb(power,    prev.hybridSystemPower,  0),
      regenPower:        fb(regen,    prev.regenPower,         0),
      speed:             san.speed,
      rpm:               0,
      engineTemp:        prev.engineTemp  ?? 0,
      throttle:          0,
      engineLoad:        0,
      fuelLevelPct:      fb(fuelLevel, prev.fuelLevelPct, 0),
      fuelRate:          0,
      intakeTemp:        prev.intakeTemp  ?? 0,
      maf:               0,
      fuelPressure:      0,
      voltage:           fb(voltage,    prev.voltage,    12),
      ambientTemp:       fb(ambientTemp, prev.ambientTemp, 25),
      staleCache:        san.staleCache,
      hvBatteryAlert:    san.hvBatteryAlert,
      rawValues,
    };
  }

  // ── Engine mode PID fetch ─────────────────────────────────────

  private async _fetchEngineData(
    send:     SendFn,
    knownRpm: number,
    prev:     Partial<HybridData>,
  ): Promise<HybridData> {
    const s01 = async (pid: string) => {
      try { return parseMode01(pid, await send(`01${pid}\r`)); } catch { return -1; }
    };

    const [speed, engineTemp, throttle, fuelLevel, engineLoad,
           intakeTemp, maf, fuelPressure, voltage, fuelRate,
           hvStd, ambientTemp] = await Promise.all([
      s01('0D'), s01('05'), s01('11'), s01('2F'), s01('04'),
      s01('0F'), s01('10'), s01('0A'), s01('42'), s01('5E'),
      s01('5B'), s01('46'),
    ]);

    // HV battery monitoring during engine mode
    let hvPct = hvStd;
    if (this.mode22) {
      const v = await this._s22(send, '2163');
      if (v >= 0) hvPct = v;
    } else if (this.mode21) {
      const v = await this._s21(send, '03');
      if (v >= 0) hvPct = v;
    }

    const spd  = fb(speed, prev.speed, 0);
    const hv   = fb(hvPct, prev.hvBatteryPct, 50);
    const thr  = fb(throttle, prev.throttle, 0);
    const eT   = fb(engineTemp, prev.engineTemp, 0);
    const eL   = fb(engineLoad, prev.engineLoad, 0);
    const mode = determineMode(knownRpm, spd, hv, thr, this.stableMode);
    const san  = sanitize(knownRpm, spd, eT, thr, eL, hv, mode);
    this._commitMode(mode);

    const rawValues: Record<string, number> = {
      probe_rpm: knownRpm, speed, engineTemp, throttle, fuelLevel,
      engineLoad, maf, hvPct, fuelRate,
    };

    return {
      mode:              this.currentMode,
      hvBatteryPct:      hv,
      hvBatteryVoltage:  prev.hvBatteryVoltage  ?? 0,
      hvBatteryCurrent:  prev.hvBatteryCurrent  ?? 0,
      hvBatteryTemp:     prev.hvBatteryTemp     ?? 0,
      motorSpeed:        0,
      mg1Speed:          0,
      mg2Speed:          0,
      driveMotorTorque:  0,
      hybridSystemPower: 0,
      regenPower:        0,
      speed:             san.speed,
      rpm:               Math.round(knownRpm),
      engineTemp:        eT,
      throttle:          thr,
      engineLoad:        san.engineLoad,
      fuelLevelPct:      fb(fuelLevel,    prev.fuelLevelPct,  0),
      fuelRate:          fb(fuelRate,     0,                  0),
      intakeTemp:        fb(intakeTemp,   prev.intakeTemp,    0),
      maf:               fb(maf,          prev.maf,           0),
      fuelPressure:      fb(fuelPressure, prev.fuelPressure,  0),
      voltage:           fb(voltage,      prev.voltage,       12),
      ambientTemp:       fb(ambientTemp,  prev.ambientTemp,   25),
      staleCache:        san.staleCache,
      hvBatteryAlert:    san.hvBatteryAlert,
      rawValues,
    };
  }

  // ── Enhanced PID helpers ──────────────────────────────────────

  private async _s22(send: SendFn, pid: string): Promise<number> {
    try { return parseMode22(pid, await send(`22${pid}\r`)); } catch { return -1; }
  }

  private async _s21(send: SendFn, pid: string): Promise<number> {
    try { return parseMode21(pid, await send(`21${pid}\r`)); } catch { return -1; }
  }

  // ── Mode commit (preserves stable mode for fallback) ─────────

  private _commitMode(mode: HybridMode) {
    this.currentMode = mode;
    if (mode !== 'TRANSITION') this.stableMode = mode;
  }
}

export const HybridService = new HybridServiceClass();
export default HybridService;
