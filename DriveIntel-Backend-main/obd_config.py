# ============================================================
# DriveIntel - OBD-II ELM327 Configuration
# Complete PID definitions, DTC codes, CAN Bus setup
# ============================================================

# ── ELM327 AT Commands ───────────────────────────────────────
ELM327_INIT_COMMANDS = [
    "ATZ",      # Reset ELM327
    "ATE0",     # Echo OFF
    "ATL0",     # Linefeeds OFF
    "ATS0",     # Spaces OFF
    "ATH0",     # Headers OFF
    "ATSP0",    # Auto protocol selection
    "ATAT1",    # Adaptive timing ON
    "ATST32",   # Set timeout
]

# ── CAN Bus Protocols ────────────────────────────────────────
CAN_PROTOCOLS = {
    "0": "Auto",
    "1": "SAE J1850 PWM (41.6 kbaud)",
    "2": "SAE J1850 VPW (10.4 kbaud)",
    "3": "ISO 9141-2 (5 baud init)",
    "4": "ISO 14230-4 KWP (5 baud init)",
    "5": "ISO 14230-4 KWP (fast init)",
    "6": "ISO 15765-4 CAN (11bit 500kbaud)",  # Most modern cars
    "7": "ISO 15765-4 CAN (29bit 500kbaud)",
    "8": "ISO 15765-4 CAN (11bit 250kbaud)",
    "9": "ISO 15765-4 CAN (29bit 250kbaud)",
    "A": "SAE J1939 CAN (29bit 250kbaud)",
}

# ── Mode 01 - Live Telemetry PIDs ────────────────────────────
LIVE_DATA_PIDS = {
    # Engine
    "0C": {
        "name": "Engine RPM",
        "unit": "RPM",
        "formula": lambda a, b: ((a * 256) + b) / 4,
        "min": 0,
        "max": 8000,
        "bytes": 2
    },
    "0D": {
        "name": "Vehicle Speed",
        "unit": "km/h",
        "formula": lambda a, b=0: a,
        "min": 0,
        "max": 255,
        "bytes": 1
    },
    "05": {
        "name": "Engine Coolant Temperature",
        "unit": "°C",
        "formula": lambda a, b=0: a - 40,
        "min": -40,
        "max": 215,
        "bytes": 1
    },
    "0F": {
        "name": "Intake Air Temperature",
        "unit": "°C",
        "formula": lambda a, b=0: a - 40,
        "min": -40,
        "max": 215,
        "bytes": 1
    },
    "11": {
        "name": "Throttle Position",
        "unit": "%",
        "formula": lambda a, b=0: (a * 100) / 255,
        "min": 0,
        "max": 100,
        "bytes": 1
    },
    "2F": {
        "name": "Fuel Tank Level",
        "unit": "%",
        "formula": lambda a, b=0: (a * 100) / 255,
        "min": 0,
        "max": 100,
        "bytes": 1
    },
    "04": {
        "name": "Engine Load",
        "unit": "%",
        "formula": lambda a, b=0: (a * 100) / 255,
        "min": 0,
        "max": 100,
        "bytes": 1
    },
    "0A": {
        "name": "Fuel Pressure",
        "unit": "kPa",
        "formula": lambda a, b=0: a * 3,
        "min": 0,
        "max": 765,
        "bytes": 1
    },
    "0B": {
        "name": "Intake Manifold Pressure",
        "unit": "kPa",
        "formula": lambda a, b=0: a,
        "min": 0,
        "max": 255,
        "bytes": 1
    },
    "10": {
        "name": "MAF Air Flow Rate",
        "unit": "g/s",
        "formula": lambda a, b: ((a * 256) + b) / 100,
        "min": 0,
        "max": 655,
        "bytes": 2
    },
    "5C": {
        "name": "Engine Oil Temperature",
        "unit": "°C",
        "formula": lambda a, b=0: a - 40,
        "min": -40,
        "max": 210,
        "bytes": 1
    },
    "42": {
        "name": "Control Module Voltage",
        "unit": "V",
        "formula": lambda a, b: ((a * 256) + b) / 1000,
        "min": 0,
        "max": 65,
        "bytes": 2
    },
    "5E": {
        "name": "Fuel Flow Rate",
        "unit": "L/h",
        "formula": lambda a, b: ((a * 256) + b) * 0.05,
        "min": 0,
        "max": 3276,
        "bytes": 2
    },
    "1F": {
        "name": "Run Time Since Engine Start",
        "unit": "seconds",
        "formula": lambda a, b: (a * 256) + b,
        "min": 0,
        "max": 65535,
        "bytes": 2
    },
    "46": {
        "name": "Ambient Air Temperature",
        "unit": "°C",
        "formula": lambda a, b=0: a - 40,
        "min": -40,
        "max": 215,
        "bytes": 1
    },
    "33": {
        "name": "Barometric Pressure",
        "unit": "kPa",
        "formula": lambda a, b=0: a,
        "min": 0,
        "max": 255,
        "bytes": 1
    },
}

# ── Mode 03 - Read DTC Codes ─────────────────────────────────
DTC_READ_COMMAND = "03"

# ── Mode 04 - Clear DTC Codes ────────────────────────────────
DTC_CLEAR_COMMAND = "04"

# ── Mode 07 - Pending DTCs ───────────────────────────────────
DTC_PENDING_COMMAND = "07"

# ── DTC Code Definitions ─────────────────────────────────────
DTC_CODES = {
    # Powertrain (P) Codes
    "P0100": {
        "desc": "Mass Air Flow Sensor Circuit Malfunction",
        "severity": "warning", "system": "Engine",
        "possible_causes": "Dirty or faulty MAF sensor, air intake leak, wiring damage",
        "repair_steps": [
            "Inspect air filter — replace if clogged",
            "Clean MAF sensor with MAF-safe cleaner spray",
            "Check air intake hose for cracks or disconnection",
            "Inspect MAF sensor wiring harness for damage or corrosion",
            "If fault persists, replace MAF sensor",
        ],
    },
    "P0101": {
        "desc": "MAF Sensor Circuit Range/Performance",
        "severity": "warning", "system": "Engine",
        "possible_causes": "Contaminated MAF sensor, air intake restriction, vacuum leak",
        "repair_steps": [
            "Clean MAF sensor with MAF-safe cleaner",
            "Check for vacuum leaks between MAF and throttle body",
            "Inspect air filter — replace if dirty",
            "Verify no blockages in air intake",
            "Replace MAF sensor if cleaning does not resolve fault",
        ],
    },
    "P0102": {
        "desc": "MAF Sensor Circuit Low Input",
        "severity": "warning", "system": "Engine",
        "possible_causes": "Open circuit in MAF wiring, faulty MAF sensor, poor ground",
        "repair_steps": [
            "Inspect MAF sensor connector for corrosion or loose pins",
            "Check MAF sensor ground and 5V reference wires with multimeter",
            "Repair any broken wiring in the MAF circuit",
            "Replace MAF sensor if wiring checks pass",
        ],
    },
    "P0105": {
        "desc": "Manifold Absolute Pressure Circuit",
        "severity": "warning", "system": "Engine",
        "possible_causes": "Faulty MAP sensor, vacuum line leak, wiring fault",
        "repair_steps": [
            "Inspect vacuum line to MAP sensor — look for cracks or disconnection",
            "Check MAP sensor connector and wiring harness",
            "Test MAP sensor output voltage with multimeter (should be 1–4.5V at key-on)",
            "Replace MAP sensor if voltage is out of range",
        ],
    },
    "P0110": {
        "desc": "Intake Air Temperature Circuit",
        "severity": "warning", "system": "Engine",
        "possible_causes": "Faulty IAT sensor, open/short in wiring, poor connector contact",
        "repair_steps": [
            "Locate IAT sensor (usually on air intake tube or inside MAF)",
            "Inspect connector for corrosion or bent pins",
            "Measure IAT sensor resistance — compare to manufacturer spec",
            "Replace IAT sensor if resistance is out of spec",
        ],
    },
    "P0115": {
        "desc": "Engine Coolant Temperature Circuit",
        "severity": "warning", "system": "Engine",
        "possible_causes": "Faulty ECT sensor, damaged wiring, low coolant level",
        "repair_steps": [
            "Check coolant level — top up if low and inspect for leaks",
            "Locate ECT sensor (usually near thermostat housing)",
            "Inspect wiring and connector for damage",
            "Test ECT sensor resistance at operating temperature",
            "Replace ECT sensor if reading is incorrect",
        ],
    },
    "P0120": {
        "desc": "Throttle Position Sensor Circuit",
        "severity": "warning", "system": "Engine",
        "possible_causes": "Faulty TPS, wiring open/short, throttle body carbon build-up",
        "repair_steps": [
            "Inspect TPS connector and wiring harness for damage",
            "Clean throttle body with throttle body cleaner",
            "Test TPS voltage sweep with multimeter (should be smooth 0.5–4.5V)",
            "Replace TPS if voltage jumps or is out of range",
        ],
    },
    "P0121": {
        "desc": "Throttle Position Sensor Range",
        "severity": "warning", "system": "Engine",
        "possible_causes": "Worn TPS, throttle body deposits, TPS not calibrated",
        "repair_steps": [
            "Clean throttle body thoroughly",
            "Perform TPS relearn procedure via scan tool if available",
            "Check TPS voltage — should rise smoothly from idle to WOT",
            "Replace TPS if voltage is erratic or cannot be recalibrated",
        ],
    },
    "P0130": {
        "desc": "O2 Sensor Circuit Bank 1 Sensor 1",
        "severity": "warning", "system": "Emissions",
        "possible_causes": "Faulty upstream O2 sensor, exhaust leak before sensor, wiring fault",
        "repair_steps": [
            "Check for exhaust leaks upstream of the O2 sensor",
            "Inspect O2 sensor wiring harness for heat damage or shorts",
            "Use scan tool to monitor O2 sensor voltage — should switch 0.1–0.9V",
            "Replace Bank 1 Sensor 1 (upstream) O2 sensor if voltage is flat",
        ],
    },
    "P0131": {
        "desc": "O2 Sensor Low Voltage Bank 1 Sensor 1",
        "severity": "warning", "system": "Emissions",
        "possible_causes": "Lean fuel mixture, exhaust leak, failing O2 sensor",
        "repair_steps": [
            "Check for vacuum leaks causing lean condition",
            "Inspect fuel injectors for blockage",
            "Check for exhaust manifold cracks or leaks near sensor",
            "Replace Bank 1 Sensor 1 O2 sensor",
        ],
    },
    "P0171": {
        "desc": "System Too Lean Bank 1",
        "severity": "critical", "system": "Fuel",
        "possible_causes": "Vacuum leak, faulty MAF sensor, clogged fuel injectors, low fuel pressure",
        "repair_steps": [
            "Check for vacuum leaks — spray carburetor cleaner around intake while idling",
            "Clean or replace MAF sensor",
            "Check fuel pressure with gauge (should be 35–65 psi at idle)",
            "Clean fuel injectors or have them professionally cleaned",
            "Inspect fuel pump if pressure is low",
        ],
    },
    "P0172": {
        "desc": "System Too Rich Bank 1",
        "severity": "critical", "system": "Fuel",
        "possible_causes": "Faulty fuel pressure regulator, leaking injector, faulty MAF or O2 sensor",
        "repair_steps": [
            "Check fuel pressure — high pressure indicates failing regulator",
            "Inspect fuel injectors for leaking (check for raw fuel smell or oily spark plugs)",
            "Test MAF sensor output",
            "Check coolant temp sensor — a cold reading causes over-fuelling",
            "Replace faulty component identified in testing",
        ],
    },
    "P0200": {
        "desc": "Injector Circuit Malfunction",
        "severity": "critical", "system": "Fuel",
        "possible_causes": "Faulty injector, open/short in injector wiring, PCM driver failure",
        "repair_steps": [
            "Check injector wiring harness for damage, shorts, or disconnection",
            "Test each injector resistance with multimeter (typically 12–17Ω)",
            "Use noid light to check injector pulse signal from PCM",
            "Replace faulty injector if resistance is out of spec",
            "If all injectors pulse incorrectly, suspect PCM — consult specialist",
        ],
    },
    "P0201": {
        "desc": "Injector Circuit Cyl 1",
        "severity": "critical", "system": "Fuel",
        "possible_causes": "Faulty cylinder 1 injector, wiring open/short to injector 1",
        "repair_steps": [
            "Locate cylinder 1 injector and inspect connector/wiring",
            "Test injector resistance (12–17Ω typical)",
            "Use noid light to verify PCM pulse on cylinder 1 injector circuit",
            "Replace cylinder 1 injector if resistance is out of spec",
        ],
    },
    "P0300": {
        "desc": "Random/Multiple Cylinder Misfire",
        "severity": "critical", "system": "Engine",
        "possible_causes": "Worn spark plugs, faulty ignition coils, low compression, fuel delivery issue",
        "repair_steps": [
            "Check and replace spark plugs — inspect for fouling, erosion, or cracks",
            "Test ignition coil output with coil tester or swap coils to identify faulty one",
            "Check fuel pressure and injector pulse",
            "Perform compression test on all cylinders",
            "If compression low, inspect valve train and head gasket",
        ],
    },
    "P0301": {
        "desc": "Cylinder 1 Misfire Detected",
        "severity": "critical", "system": "Engine",
        "possible_causes": "Faulty spark plug or coil on cylinder 1, low compression, clogged injector",
        "repair_steps": [
            "Replace spark plug on cylinder 1",
            "Swap ignition coil from cylinder 1 to another cylinder — if misfire moves, replace coil",
            "Test cylinder 1 injector with noid light and resistance test",
            "Perform compression test on cylinder 1",
        ],
    },
    "P0302": {
        "desc": "Cylinder 2 Misfire Detected",
        "severity": "critical", "system": "Engine",
        "possible_causes": "Faulty spark plug or coil on cylinder 2, low compression, clogged injector",
        "repair_steps": [
            "Replace spark plug on cylinder 2",
            "Swap ignition coil from cylinder 2 to another — if misfire moves, replace coil",
            "Test cylinder 2 injector",
            "Perform compression test on cylinder 2",
        ],
    },
    "P0303": {
        "desc": "Cylinder 3 Misfire Detected",
        "severity": "critical", "system": "Engine",
        "possible_causes": "Faulty spark plug or coil on cylinder 3, low compression, clogged injector",
        "repair_steps": [
            "Replace spark plug on cylinder 3",
            "Swap ignition coil from cylinder 3 to another — if misfire moves, replace coil",
            "Test cylinder 3 injector",
            "Perform compression test on cylinder 3",
        ],
    },
    "P0304": {
        "desc": "Cylinder 4 Misfire Detected",
        "severity": "critical", "system": "Engine",
        "possible_causes": "Faulty spark plug or coil on cylinder 4, low compression, clogged injector",
        "repair_steps": [
            "Replace spark plug on cylinder 4",
            "Swap ignition coil from cylinder 4 to another — if misfire moves, replace coil",
            "Test cylinder 4 injector",
            "Perform compression test on cylinder 4",
        ],
    },
    "P0325": {
        "desc": "Knock Sensor 1 Circuit",
        "severity": "warning", "system": "Engine",
        "possible_causes": "Faulty knock sensor, damaged wiring, incorrect fuel grade",
        "repair_steps": [
            "Check that correct fuel octane rating is being used",
            "Inspect knock sensor wiring harness for damage or loose connections",
            "Test knock sensor resistance (typically 400–600 kΩ)",
            "Replace knock sensor if resistance is out of spec",
        ],
    },
    "P0335": {
        "desc": "Crankshaft Position Sensor Circuit",
        "severity": "critical", "system": "Engine",
        "possible_causes": "Faulty CKP sensor, damaged reluctor ring, wiring fault",
        "repair_steps": [
            "Locate crankshaft position sensor (usually near crankshaft pulley or flywheel)",
            "Inspect sensor connector and wiring for damage",
            "Check reluctor ring (tone wheel) for missing or damaged teeth",
            "Test CKP sensor output with oscilloscope or scan tool",
            "Replace CKP sensor if no signal or erratic signal",
        ],
    },
    "P0340": {
        "desc": "Camshaft Position Sensor Circuit",
        "severity": "critical", "system": "Engine",
        "possible_causes": "Faulty CMP sensor, timing chain/belt wear, wiring fault",
        "repair_steps": [
            "Locate camshaft position sensor (usually on cylinder head near cam gear)",
            "Inspect connector and wiring for damage",
            "Test CMP sensor signal with scan tool",
            "Check timing chain/belt for stretch or wear",
            "Replace CMP sensor if signal is absent or erratic",
        ],
    },
    "P0400": {
        "desc": "EGR Flow Malfunction",
        "severity": "warning", "system": "Emissions",
        "possible_causes": "Stuck or clogged EGR valve, blocked EGR passage, faulty EGR solenoid",
        "repair_steps": [
            "Locate EGR valve and inspect for carbon build-up",
            "Clean EGR valve with EGR cleaner spray",
            "Check EGR vacuum line or electrical connector",
            "Test EGR solenoid operation (should click when energised)",
            "Replace EGR valve if cleaning does not restore flow",
        ],
    },
    "P0401": {
        "desc": "EGR Flow Insufficient",
        "severity": "warning", "system": "Emissions",
        "possible_causes": "Heavily clogged EGR valve or passages, faulty DPFE sensor, blocked EGR tube",
        "repair_steps": [
            "Remove and thoroughly clean EGR valve and passages",
            "Inspect DPFE (differential pressure) sensor if equipped — clean or replace",
            "Check EGR tube from exhaust manifold for blockage",
            "Replace EGR valve if passages are too restricted to clean",
        ],
    },
    "P0420": {
        "desc": "Catalyst System Efficiency Below Threshold Bank 1",
        "severity": "warning", "system": "Emissions",
        "possible_causes": "Degraded catalytic converter, faulty downstream O2 sensor, exhaust leak",
        "repair_steps": [
            "Check for exhaust leaks before and after the catalytic converter",
            "Test downstream (post-cat) O2 sensor — it should show steady mid-range voltage",
            "Use scan tool to compare upstream vs downstream O2 switching",
            "If O2 sensors are good, catalytic converter is likely degraded — replace cat",
        ],
    },
    "P0430": {
        "desc": "Catalyst System Efficiency Bank 2",
        "severity": "warning", "system": "Emissions",
        "possible_causes": "Degraded Bank 2 catalytic converter, faulty downstream O2 sensor",
        "repair_steps": [
            "Check exhaust leaks on Bank 2 side",
            "Test Bank 2 downstream O2 sensor",
            "Compare Bank 2 upstream vs downstream O2 data on scan tool",
            "Replace Bank 2 catalytic converter if sensor tests pass",
        ],
    },
    "P0440": {
        "desc": "EVAP System Malfunction",
        "severity": "warning", "system": "Emissions",
        "possible_causes": "Loose fuel cap, damaged EVAP hose, faulty purge solenoid or vent valve",
        "repair_steps": [
            "Check fuel cap — tighten or replace if damaged or missing seal",
            "Inspect EVAP hoses from fuel tank to charcoal canister for cracks",
            "Test purge control solenoid — should click when powered",
            "Test vent valve operation",
            "Perform EVAP system smoke test to locate any leaks",
        ],
    },
    "P0442": {
        "desc": "EVAP System Small Leak",
        "severity": "warning", "system": "Emissions",
        "possible_causes": "Small crack in EVAP hose, faulty fuel cap, loose connections",
        "repair_steps": [
            "Replace fuel cap first — most common cause of small EVAP leak",
            "Inspect all EVAP hoses and connections for hairline cracks",
            "Perform smoke test to pinpoint leak location",
            "Repair or replace any cracked hoses or connectors found",
        ],
    },
    "P0500": {
        "desc": "Vehicle Speed Sensor Malfunction",
        "severity": "warning", "system": "Transmission",
        "possible_causes": "Faulty VSS, damaged wiring, worn reluctor ring on output shaft",
        "repair_steps": [
            "Locate vehicle speed sensor (typically on transmission output shaft or diff)",
            "Inspect sensor connector and wiring for damage",
            "Test VSS output signal with multimeter while rotating wheel",
            "Inspect reluctor ring for missing teeth",
            "Replace VSS if signal is absent",
        ],
    },
    "P0505": {
        "desc": "Idle Control System Malfunction",
        "severity": "warning", "system": "Engine",
        "possible_causes": "Faulty idle air control (IAC) valve, dirty throttle body, vacuum leak",
        "repair_steps": [
            "Clean throttle body and IAC valve passage",
            "Remove and clean IAC valve with throttle body cleaner",
            "Check for vacuum leaks near intake manifold",
            "Perform idle relearn procedure after cleaning",
            "Replace IAC valve if cleaning does not stabilise idle",
        ],
    },
    "P0600": {
        "desc": "Serial Communication Link Malfunction",
        "severity": "critical", "system": "Electronics",
        "possible_causes": "CAN bus fault, damaged wiring between modules, faulty ECU",
        "repair_steps": [
            "Inspect main wiring harness for damage, chafing, or rodent damage",
            "Check all module connectors for corrosion and proper seating",
            "Use scan tool to identify which modules are unresponsive",
            "Test CAN bus wiring resistance (should be ~60Ω between CAN Hi and CAN Lo)",
            "Consult specialist — may require ECU or module replacement",
        ],
    },
    "P0700": {
        "desc": "Transmission Control System Malfunction",
        "severity": "critical", "system": "Transmission",
        "possible_causes": "TCM fault codes present, low transmission fluid, electrical fault in TCM circuit",
        "repair_steps": [
            "Read all stored codes — P0700 is a flag; secondary TCM codes give root cause",
            "Check transmission fluid level and condition — replace if dark or burnt",
            "Inspect TCM wiring harness and connector",
            "Address any specific transmission solenoid or sensor codes",
            "Consult transmission specialist if secondary codes point to internal fault",
        ],
    },
    "P0715": {
        "desc": "Input Turbine Speed Sensor Circuit",
        "severity": "warning", "system": "Transmission",
        "possible_causes": "Faulty input speed sensor, wiring fault, metal debris on sensor",
        "repair_steps": [
            "Locate input turbine speed sensor on transmission",
            "Remove sensor and inspect for metal debris — clean tip with rag",
            "Check sensor air gap (typically 0.5–1.5mm)",
            "Test sensor resistance (typically 200–1000Ω)",
            "Replace sensor if resistance is out of spec",
        ],
    },
    "P0720": {
        "desc": "Output Speed Sensor Circuit",
        "severity": "warning", "system": "Transmission",
        "possible_causes": "Faulty output speed sensor, wiring damage, reluctor wheel damage",
        "repair_steps": [
            "Locate output speed sensor on transmission tail housing",
            "Inspect sensor connector and wiring for damage",
            "Test sensor resistance and compare to spec",
            "Check reluctor wheel for missing or damaged teeth",
            "Replace output speed sensor if faulty",
        ],
    },
    "P0740": {
        "desc": "TCC Solenoid Circuit Malfunction",
        "severity": "warning", "system": "Transmission",
        "possible_causes": "Faulty TCC solenoid, dirty transmission fluid, wiring fault",
        "repair_steps": [
            "Check transmission fluid — change if overdue or contaminated",
            "Locate TCC solenoid (inside transmission valve body)",
            "Test TCC solenoid resistance (typically 10–30Ω)",
            "Check solenoid wiring harness connector",
            "Replace TCC solenoid if resistance is out of spec",
        ],
    },

    # Body (B) Codes
    "B0001": {
        "desc": "Frontal Crash Sensor",
        "severity": "critical", "system": "Safety",
        "possible_causes": "Faulty front impact sensor, wiring damage, prior collision",
        "repair_steps": [
            "Do NOT clear this code without proper airbag system inspection",
            "Have vehicle inspected at authorised workshop for collision damage",
            "Inspect front impact sensor wiring harness for damage",
            "Replace front crash sensor if wiring is intact and no collision occurred",
            "Recalibrate airbag system after sensor replacement",
        ],
    },
    "B0051": {
        "desc": "Airbag Driver Circuit",
        "severity": "critical", "system": "Safety",
        "possible_causes": "Faulty clock spring, airbag module fault, wiring issue in steering column",
        "repair_steps": [
            "Do NOT clear airbag codes without specialist inspection",
            "Check clock spring (spiral cable) for continuity — common cause of steering-wheel airbag faults",
            "Inspect steering column wiring harness",
            "Replace clock spring if open circuit is found",
            "Have airbag module tested by specialist",
        ],
    },
    "B1000": {
        "desc": "ECU Malfunction",
        "severity": "critical", "system": "Electronics",
        "possible_causes": "Internal ECU fault, power supply fault, water ingress",
        "repair_steps": [
            "Check ECU power supply and ground connections",
            "Inspect ECU connectors for corrosion or water damage",
            "Perform ECU reset and check if fault returns",
            "Have ECU tested by specialist — replacement or reflash may be required",
        ],
    },
    "B1317": {
        "desc": "Battery Voltage High",
        "severity": "warning", "system": "Electrical",
        "possible_causes": "Faulty voltage regulator in alternator, overcharging condition",
        "repair_steps": [
            "Measure battery voltage at idle (should be 13.5–14.8V)",
            "If above 15V, alternator voltage regulator is likely faulty",
            "Test alternator output with multimeter",
            "Replace alternator or voltage regulator if overcharging confirmed",
        ],
    },
    "B1318": {
        "desc": "Battery Voltage Low",
        "severity": "warning", "system": "Electrical",
        "possible_causes": "Weak battery, faulty alternator, parasitic drain",
        "repair_steps": [
            "Test battery load capacity with battery tester (replace if below spec)",
            "Test alternator output — should be 13.5–14.8V at idle",
            "Check for parasitic drain with ammeter (should be under 50mA with ignition off)",
            "Replace battery if more than 3 years old or failing load test",
            "Replace alternator if not charging sufficiently",
        ],
    },

    # Chassis (C) Codes
    "C0035": {
        "desc": "Left Front Wheel Speed Sensor",
        "severity": "critical", "system": "Brakes",
        "possible_causes": "Faulty left front ABS wheel speed sensor, damaged tone ring, wiring fault",
        "repair_steps": [
            "Inspect left front wheel speed sensor and its wiring for damage",
            "Check tone ring (reluctor ring) on the wheel hub for missing teeth or corrosion",
            "Clean sensor tip and tone ring",
            "Test sensor resistance (typically 1000–2500Ω for passive sensors)",
            "Replace wheel speed sensor if faulty",
        ],
    },
    "C0036": {
        "desc": "Right Front Wheel Speed Sensor",
        "severity": "critical", "system": "Brakes",
        "possible_causes": "Faulty right front ABS sensor, damaged tone ring, wiring fault",
        "repair_steps": [
            "Inspect right front wheel speed sensor and its wiring",
            "Check tone ring for damage",
            "Test sensor resistance",
            "Replace right front wheel speed sensor if faulty",
        ],
    },
    "C0040": {
        "desc": "Right Front Wheel Speed Sensor Circuit Range",
        "severity": "warning", "system": "Brakes",
        "possible_causes": "Intermittent sensor connection, air gap out of spec, partial tone ring damage",
        "repair_steps": [
            "Inspect sensor mounting — check air gap (should be 0.2–1.5mm)",
            "Clean sensor and tone ring of metal debris",
            "Inspect wiring harness for chafing near wheel",
            "Replace sensor if gap cannot be corrected or signal is erratic",
        ],
    },
    "C0110": {
        "desc": "ABS Motor Circuit",
        "severity": "critical", "system": "Brakes",
        "possible_causes": "Faulty ABS pump motor, blown fuse, wiring fault in ABS module",
        "repair_steps": [
            "Check ABS fuse and relay in fuse box",
            "Inspect ABS pump motor wiring harness for damage",
            "Test ABS pump motor with direct 12V supply to confirm operation",
            "Replace ABS hydraulic unit/pump if motor is confirmed faulty",
            "Have ABS module inspected if pump tests OK",
        ],
    },
    "C0121": {
        "desc": "ABS Valve Relay Circuit",
        "severity": "critical", "system": "Brakes",
        "possible_causes": "Faulty ABS relay, wiring fault, ABS module failure",
        "repair_steps": [
            "Check and replace ABS relay",
            "Inspect wiring between relay and ABS module",
            "Test relay socket for correct voltage",
            "Have ABS module tested if relay and wiring check out",
        ],
    },
    "C0200": {
        "desc": "Electronic Brake Control",
        "severity": "critical", "system": "Brakes",
        "possible_causes": "ABS/ESC module fault, hydraulic unit fault, power supply issue",
        "repair_steps": [
            "Check all ABS/ESC related fuses and relays",
            "Scan for additional ABS module sub-codes",
            "Inspect hydraulic control unit for leaks or damage",
            "Have ABS/ESC module tested and recalibrated by specialist",
        ],
    },

    # Network (U) Codes
    "U0001": {
        "desc": "High Speed CAN Bus Communication Fault",
        "severity": "critical", "system": "Network",
        "possible_causes": "CAN bus short circuit, damaged wiring, faulty module pulling bus down",
        "repair_steps": [
            "Disconnect modules one at a time to identify which module is causing the bus fault",
            "Measure CAN bus resistance — should be ~60Ω between CAN Hi/Lo at OBD port",
            "Inspect wiring harness for shorts or physical damage",
            "Repair damaged wiring",
            "Replace faulty module after identification",
        ],
    },
    "U0100": {
        "desc": "Lost Communication with ECM/PCM",
        "severity": "critical", "system": "Network",
        "possible_causes": "Dead ECM/PCM, blown fuse, CAN bus fault, wiring failure",
        "repair_steps": [
            "Check ECM/PCM main fuse and relay",
            "Verify ECM/PCM power and ground connections",
            "Check CAN bus wiring between OBD port and ECM",
            "Attempt ECM/PCM reset (battery disconnect for 10 min)",
            "Have ECM/PCM tested or reflashed by specialist",
        ],
    },
    "U0101": {
        "desc": "Lost Communication with TCM",
        "severity": "critical", "system": "Network",
        "possible_causes": "Dead TCM, blown fuse, CAN bus wiring fault",
        "repair_steps": [
            "Check TCM fuse and relay",
            "Verify TCM power and ground at connector",
            "Inspect CAN wiring to TCM for damage",
            "Have TCM tested or replaced by specialist",
        ],
    },
    "U0121": {
        "desc": "Lost Communication with ABS Control Module",
        "severity": "critical", "system": "Network",
        "possible_causes": "Faulty ABS module, blown fuse, CAN bus wiring issue",
        "repair_steps": [
            "Check ABS module fuse and relay",
            "Verify power and ground at ABS module connector",
            "Inspect CAN wiring to ABS module",
            "Have ABS module tested — replacement requires recalibration",
        ],
    },
    "U0155": {
        "desc": "Lost Communication with Instrument Panel Cluster",
        "severity": "warning", "system": "Network",
        "possible_causes": "Faulty instrument cluster, CAN bus wiring fault, blown fuse",
        "repair_steps": [
            "Check instrument cluster fuse",
            "Inspect cluster connector and CAN bus wiring",
            "Test CAN bus at OBD port",
            "Have instrument cluster tested or replaced if wiring is intact",
        ],
    },
}

# ── Workshop Recommendation by DTC ───────────────────────────
DTC_WORKSHOP_MAPPING = {
    "Engine":       ["Engine Repair", "Diagnostics", "OBD Scan"],
    "Fuel":         ["Fuel System", "Engine Repair", "Diagnostics"],
    "Emissions":    ["Emissions Testing", "Catalytic Converter", "Diagnostics"],
    "Transmission": ["Transmission Repair", "Gearbox Service"],
    "Brakes":       ["Brake Service", "ABS Repair", "Safety Check"],
    "Electrical":   ["Auto Electrician", "Battery Service"],
    "Electronics":  ["Auto Electrician", "ECU Repair"],
    "Safety":       ["Safety Systems", "Airbag Service"],
    "Network":      ["Diagnostics", "ECU Repair", "Auto Electrician"],
}

# ── Health Score Thresholds ───────────────────────────────────
HEALTH_THRESHOLDS = {
    "engineTemp":   {"warning": 100, "critical": 110},
    "rpm":          {"warning": 6000, "critical": 7000},
    "fuelLevel":    {"warning": 20, "critical": 10},
    "voltage":      {"warning": 11.5, "critical": 10.5},
    "engineLoad":   {"warning": 80, "critical": 95},
}

def calculate_health_score(obd_data: dict) -> int:
    score = 100
    
    if obd_data.get("engineTemp", 0) > HEALTH_THRESHOLDS["engineTemp"]["critical"]:
        score -= 30
    elif obd_data.get("engineTemp", 0) > HEALTH_THRESHOLDS["engineTemp"]["warning"]:
        score -= 15

    if obd_data.get("fuelLevel", 100) < HEALTH_THRESHOLDS["fuelLevel"]["critical"]:
        score -= 20
    elif obd_data.get("fuelLevel", 100) < HEALTH_THRESHOLDS["fuelLevel"]["warning"]:
        score -= 10

    if obd_data.get("voltage", 12) < HEALTH_THRESHOLDS["voltage"]["critical"]:
        score -= 25
    elif obd_data.get("voltage", 12) < HEALTH_THRESHOLDS["voltage"]["warning"]:
        score -= 10

    dtc_count = len(obd_data.get("dtcCodes", []))
    score -= (dtc_count * 10)

    return max(0, min(100, score))

def get_dtc_info(code: str) -> dict:
    return DTC_CODES.get(code, {
        "desc": "Unknown fault code",
        "severity": "warning",
        "system": "Unknown"
    })

def get_workshop_specialties(dtc_codes: list) -> list:
    specialties = set()
    for code in dtc_codes:
        info = get_dtc_info(code)
        system = info.get("system", "")
        if system in DTC_WORKSHOP_MAPPING:
            for spec in DTC_WORKSHOP_MAPPING[system]:
                specialties.add(spec)
    return list(specialties)
