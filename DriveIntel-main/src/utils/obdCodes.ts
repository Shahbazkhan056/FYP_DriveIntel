export const OBD_COMMANDS = {
    ENGINE_RPM: '010C',
    VEHICLE_SPEED: '010D',
    ENGINE_COOLANT_TEMP: '0105',
    THROTTLE_POSITION: '0111',
    FUEL_LEVEL: '012F',
    BATTERY_VOLTAGE: '0142',
    MAF_RATE: '0110',
    O2_SENSOR: '0114',
  };

export interface DTCDetail {
  description: string;
  possible_causes: string;
}

export const DTC_DETAILS: Record<string, DTCDetail> = {
  P0100: { description: 'Mass Air Flow Sensor Circuit Malfunction',          possible_causes: 'Dirty or faulty MAF sensor, air intake leak, wiring damage' },
  P0101: { description: 'MAF Sensor Circuit Range/Performance',              possible_causes: 'Contaminated MAF sensor, air intake restriction, vacuum leak' },
  P0102: { description: 'MAF Sensor Circuit Low Input',                      possible_causes: 'Open circuit in MAF wiring, faulty MAF sensor, poor ground' },
  P0105: { description: 'Manifold Absolute Pressure Circuit',                possible_causes: 'Faulty MAP sensor, vacuum line leak, wiring fault' },
  P0110: { description: 'Intake Air Temperature Circuit',                    possible_causes: 'Faulty IAT sensor, open/short in wiring, poor connector contact' },
  P0115: { description: 'Engine Coolant Temperature Circuit',                possible_causes: 'Faulty ECT sensor, damaged wiring, low coolant level' },
  P0120: { description: 'Throttle Position Sensor Circuit',                  possible_causes: 'Faulty TPS, wiring open/short, throttle body carbon build-up' },
  P0121: { description: 'Throttle Position Sensor Range',                    possible_causes: 'Worn TPS, throttle body deposits, TPS not calibrated' },
  P0130: { description: 'O2 Sensor Circuit Bank 1 Sensor 1',                 possible_causes: 'Faulty upstream O2 sensor, exhaust leak before sensor, wiring fault' },
  P0131: { description: 'O2 Sensor Low Voltage Bank 1 Sensor 1',             possible_causes: 'Lean fuel mixture, exhaust leak, failing O2 sensor' },
  P0171: { description: 'System Too Lean Bank 1',                            possible_causes: 'Vacuum leak, faulty MAF sensor, clogged fuel injectors, low fuel pressure' },
  P0172: { description: 'System Too Rich Bank 1',                            possible_causes: 'Faulty fuel pressure regulator, leaking injector, faulty MAF or O2 sensor' },
  P0200: { description: 'Injector Circuit Malfunction',                      possible_causes: 'Faulty injector, open/short in injector wiring, PCM driver failure' },
  P0201: { description: 'Injector Circuit Cylinder 1',                       possible_causes: 'Faulty cylinder 1 injector, wiring open/short to injector 1' },
  P0300: { description: 'Random/Multiple Cylinder Misfire Detected',         possible_causes: 'Worn spark plugs, faulty ignition coils, low compression, fuel delivery issue' },
  P0301: { description: 'Cylinder 1 Misfire Detected',                       possible_causes: 'Faulty spark plug or coil on cylinder 1, low compression, clogged injector' },
  P0302: { description: 'Cylinder 2 Misfire Detected',                       possible_causes: 'Faulty spark plug or coil on cylinder 2, low compression, clogged injector' },
  P0303: { description: 'Cylinder 3 Misfire Detected',                       possible_causes: 'Faulty spark plug or coil on cylinder 3, low compression, clogged injector' },
  P0304: { description: 'Cylinder 4 Misfire Detected',                       possible_causes: 'Faulty spark plug or coil on cylinder 4, low compression, clogged injector' },
  P0325: { description: 'Knock Sensor 1 Circuit',                            possible_causes: 'Faulty knock sensor, damaged wiring, incorrect fuel grade' },
  P0335: { description: 'Crankshaft Position Sensor Circuit',                possible_causes: 'Faulty CKP sensor, damaged reluctor ring, wiring fault' },
  P0340: { description: 'Camshaft Position Sensor Circuit',                  possible_causes: 'Faulty CMP sensor, timing chain/belt wear, wiring fault' },
  P0400: { description: 'EGR Flow Malfunction',                              possible_causes: 'Stuck or clogged EGR valve, blocked EGR passage, faulty EGR solenoid' },
  P0401: { description: 'EGR Flow Insufficient',                             possible_causes: 'Heavily clogged EGR valve or passages, faulty DPFE sensor, blocked EGR tube' },
  P0420: { description: 'Catalyst System Efficiency Below Threshold Bank 1', possible_causes: 'Degraded catalytic converter, faulty downstream O2 sensor, exhaust leak' },
  P0430: { description: 'Catalyst System Efficiency Below Threshold Bank 2', possible_causes: 'Degraded Bank 2 catalytic converter, faulty downstream O2 sensor' },
  P0440: { description: 'EVAP System Malfunction',                           possible_causes: 'Loose fuel cap, damaged EVAP hose, faulty purge solenoid or vent valve' },
  P0442: { description: 'EVAP System Small Leak',                            possible_causes: 'Small crack in EVAP hose, faulty fuel cap, loose connections' },
  P0500: { description: 'Vehicle Speed Sensor Malfunction',                  possible_causes: 'Faulty VSS, damaged wiring, worn reluctor ring on output shaft' },
  P0505: { description: 'Idle Control System Malfunction',                   possible_causes: 'Faulty idle air control valve, dirty throttle body, vacuum leak' },
  P0600: { description: 'Serial Communication Link Malfunction',             possible_causes: 'CAN bus fault, damaged wiring between modules, faulty ECU' },
  P0700: { description: 'Transmission Control System Malfunction',           possible_causes: 'TCM fault codes present, low transmission fluid, electrical fault in TCM circuit' },
  P0715: { description: 'Input Turbine Speed Sensor Circuit',                possible_causes: 'Faulty input speed sensor, wiring fault, metal debris on sensor' },
  P0720: { description: 'Output Speed Sensor Circuit',                       possible_causes: 'Faulty output speed sensor, wiring damage, reluctor wheel damage' },
  P0740: { description: 'TCC Solenoid Circuit Malfunction',                  possible_causes: 'Faulty TCC solenoid, dirty transmission fluid, wiring fault' },
  B0001: { description: 'Driver Frontal Stage 1 Air Bag Deployment Control', possible_causes: 'Faulty front impact sensor, wiring damage, prior collision' },
  B0051: { description: 'Driver Squib Circuit Resistance High',              possible_causes: 'Faulty clock spring, airbag module fault, wiring issue in steering column' },
  U0001: { description: 'High Speed CAN Communication Bus',                  possible_causes: 'CAN bus short circuit, damaged wiring, faulty module pulling bus down' },
  U0100: { description: 'Lost Communication With ECM/PCM',                   possible_causes: 'Dead ECM/PCM, blown fuse, CAN bus fault, wiring failure' },
  U0101: { description: 'Lost Communication With TCM',                       possible_causes: 'Dead TCM, blown fuse, CAN bus wiring fault' },
  U0121: { description: 'Lost Communication With ABS Control Module',        possible_causes: 'Faulty ABS module, blown fuse, CAN bus wiring issue' },
  U0155: { description: 'Lost Communication With Instrument Panel',          possible_causes: 'Faulty instrument cluster, CAN bus wiring fault, blown fuse' },
  C0031: { description: 'Left Front Wheel Speed Sensor Circuit',             possible_causes: 'Faulty left front ABS wheel speed sensor, damaged tone ring, wiring fault' },
  C0034: { description: 'Right Front Wheel Speed Sensor Circuit',            possible_causes: 'Faulty right front ABS sensor, damaged tone ring, wiring fault' },
  C0035: { description: 'Left Front Wheel Speed Sensor Circuit Range',       possible_causes: 'Intermittent sensor connection, air gap out of spec, partial tone ring damage' },
  C0040: { description: 'ABS Pump Motor Circuit',                            possible_causes: 'Faulty ABS pump motor, blown fuse, wiring fault in ABS module' },
  C0044: { description: 'ABS Solenoid Relay Circuit',                        possible_causes: 'Faulty ABS relay, wiring fault, ABS module failure' },
  C0110: { description: 'ABS/ESC Module Internal Fault',                     possible_causes: 'ABS/ESC module fault, hydraulic unit fault, power supply issue' },
};

export const DTC_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  Object.entries(DTC_DETAILS).map(([code, d]) => [code, d.description])
);
  