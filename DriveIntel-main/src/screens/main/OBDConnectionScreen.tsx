import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  StatusBar, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Device } from 'react-native-ble-plx';
import { useTheme } from '../../context/ThemeContext';
import { darkColors } from '../../theme/colors';
import OBDService from '../../services/OBDService';
import { getUserId, logMaintenanceService } from '../../services/api';
import { useOBD } from '../../context/OBDContext';

interface Props { navigation: any; }

// ── ELM327 Dynamic Simulator Scenarios ───────────────────────
// Each scenario is a tick function: (tick: number) => LiveData.
// Called every 2s by OBDService.startDynamicSim — data updates live.
// tick===0 fields (dtcs, odometer_km) fire once at scenario start.
// setupFn seeds backend data (maintenance history) before the sim starts.

type LiveData = Parameters<typeof OBDService.simulateLiveData>[0];

type SimScenario = {
  label:    string;
  sub:      string;
  pages:    string;
  dynFn:    (tick: number) => LiveData;
  setupFn?: (vehicleId: string) => Promise<void>;
};

// Small Gaussian-like noise: base ± base*pct
const j = (base: number, pct = 0.03) => base + (Math.random() * 2 - 1) * Math.abs(base) * pct;

// Seeds a realistic maintenance history for the DTC scenario (87,650 km).
// Produces mix of overdue, urgent, and upcoming services.
const seedDTCMaintenance = async (vehicleId: string): Promise<void> => {
  const history = [
    { service: 'Oil Change',         doneKm: 85000 },
    { service: 'Tire Rotation',      doneKm: 80000 },
    { service: 'Air Filter',         doneKm: 80000 },
    { service: 'Brake Inspection',   doneKm: 80000 },
    { service: 'Spark Plugs',        doneKm: 48000 },
    { service: 'Battery Check',      doneKm: 48000 },
    { service: 'Coolant Flush',      doneKm: 50000 },
    { service: 'Transmission Fluid', doneKm: 60000 },
    // Timing Belt / Chain and Major Service intentionally un-seeded → OVERDUE at 87,650 km
  ];
  await Promise.all(
    history.map(h => logMaintenanceService(vehicleId, h.service, h.doneKm, 0, 'simulation').catch(() => {}))
  );
};

const SIM_SCENARIOS: Record<string, SimScenario> = {

  // ── ICE Dynamic Scenarios ─────────────────────────────────

  'Cold Start Warm-Up': {
    label: '🥶 Cold Start Warm-Up',
    sub:   'RPM 1200→800 • Temp 35°C→90°C over 50s • idle noise',
    pages: '📊 Dashboard  •  🔩 Maintenance',
    dynFn: (tick) => {
      const w = Math.min(1, tick / 25); // warm-up progress: 0→1 over 25 ticks (50s)
      return {
        rpm:           j(1200 - w * 400 + Math.sin(tick * 0.8) * 15, 0.02),
        speed:         0,
        engine_temp:   35 + w * 55,
        throttle:      j(3 - w * 1.5, 0.05),
        fuel_level:    76,
        engine_load:   j(22 - w * 6),
        voltage:       j(13.4 + w * 0.4, 0.01),
        maf:           j(5.5 - w * 1.0),
        fuel_pressure: j(295),
        intake_temp:   28,
        odometer_km:   tick === 0 ? 23450 : undefined,
      };
    },
  },

  'City Drive': {
    label: '🏙 City Drive',
    sub:   '14-tick stop-and-go cycle • speed 0→45 km/h • fuel −0.1% per tick',
    pages: '📊 Dashboard',
    dynFn: (tick) => {
      const phase = tick % 14;
      let speed = 0, rpm = 820, throttle = 1, load = 12, maf = 4.2;
      if (phase < 4)       { speed = phase * 11; rpm = 1600 + phase * 230; throttle = 36; load = 44; maf = 7 + phase * 0.8; }
      else if (phase < 8)  { speed = 43 + Math.sin(phase) * 4; rpm = 2200 + Math.sin(phase * 0.7) * 120; throttle = 22; load = 30; maf = 9; }
      else if (phase < 11) { speed = Math.max(0, 43 - (phase - 8) * 15); rpm = Math.max(820, 2200 - (phase - 8) * 460); throttle = 2; load = 8; maf = 4.5; }
      return {
        rpm:           j(rpm, 0.02),
        speed,
        engine_temp:   j(90, 0.01),
        throttle,
        fuel_level:    Math.max(50, 65 - tick * 0.1),
        engine_load:   j(load, 0.04),
        voltage:       j(14.1, 0.01),
        maf:           j(maf, 0.04),
        fuel_pressure: j(345, 0.02),
        intake_temp:   32,
      };
    },
  },

  'Highway Cruise': {
    label: '🛣 Highway Cruise',
    sub:   'Speed 100-115 km/h • RPM 2900-3100 • fuel slowly decreasing',
    pages: '📊 Dashboard',
    dynFn: (tick) => ({
      rpm:           j(3000 + Math.sin(tick * 0.4) * 120),
      speed:         j(108 + Math.sin(tick * 0.3) * 8),
      engine_temp:   j(93, 0.01),
      throttle:      j(26 + Math.sin(tick * 0.5) * 3),
      fuel_level:    Math.max(40, 70 - tick * 0.15),
      engine_load:   j(48 + Math.sin(tick * 0.4) * 4),
      voltage:       j(14.1, 0.01),
      maf:           j(14 + Math.sin(tick * 0.3) * 1.5),
      fuel_pressure: j(355, 0.02),
      intake_temp:   j(38, 0.02),
    }),
  },

  'Engine Faults (P0300+P0171+P0420)': {
    label: '⚠️ Engine Faults Active',
    sub:   'P0300 Misfire • P0171 Lean • P0420 Catalyst — tap Diagnostics → Scan',
    pages: '📊 Dashboard  •  🔍 Diagnostics  •  📍 Workshop  •  🔩 Maintenance',
    setupFn: seedDTCMaintenance,
    dynFn: (tick) => ({
      rpm:           720 + Math.sin(tick * 2.1) * 110 + (Math.random() - 0.5) * 75,
      speed:         0,
      engine_temp:   j(92, 0.01),
      throttle:      j(2.5),
      fuel_level:    j(45, 0.01),
      engine_load:   j(17 + Math.sin(tick * 0.8) * 4),
      voltage:       j(13.1, 0.02),
      maf:           j(4.8 + Math.sin(tick * 0.7) * 0.5),
      fuel_pressure: j(275, 0.03),
      intake_temp:   31,
      dtcs:          tick === 0 ? ['P0300', 'P0171', 'P0420'] : undefined,
      odometer_km:   tick === 0 ? 87650 : undefined,
    }),
  },

  'Engine Overheating': {
    label: '🌡 Engine Overheating',
    sub:   'Temp rising 95°C→112°C • Low fuel 22%→10% • Watch alerts',
    pages: '📊 Dashboard',
    dynFn: (tick) => ({
      rpm:           j(850, 0.02),
      speed:         0,
      engine_temp:   Math.min(112, 95 + tick * 0.7),
      throttle:      j(4),
      fuel_level:    Math.max(10, 22 - tick * 0.2),
      engine_load:   j(20),
      voltage:       j(11.9 - tick * 0.01, 0.02),
      maf:           j(4.5),
      fuel_pressure: j(290),
      intake_temp:   j(34),
      odometer_km:   tick === 0 ? 87650 : undefined,
    }),
  },

  'Battery Drain': {
    label: '🔋 Battery Drain',
    sub:   'Voltage dropping 12.2V→10.8V — alternator fault sim',
    pages: '📊 Dashboard',
    dynFn: (tick) => ({
      rpm:           j(810),
      speed:         0,
      engine_temp:   j(88, 0.01),
      throttle:      j(2),
      fuel_level:    85,
      engine_load:   j(18),
      voltage:       Math.max(10.8, 12.2 - tick * 0.08),
      maf:           j(4.4),
      fuel_pressure: j(298),
      intake_temp:   29,
      odometer_km:   tick === 0 ? 12300 : undefined,
    }),
  },

  // ── Hybrid Dynamic Scenarios ──────────────────────────────

  'Hybrid: EV Mode (Toyota)': {
    label: '⚡ Hybrid EV Mode (Toyota)',
    sub:   'Engine OFF • Motor 2500 RPM • HV discharging 65%→55%',
    pages: '📊 Dashboard (hybrid panels)  •  🔩 Maintenance',
    dynFn: (tick) => ({
      rpm:           0,
      speed:         j(28 + Math.sin(tick * 0.5) * 6),
      engine_temp:   j(85, 0.01),
      throttle:      j(2),
      fuel_level:    60,
      engine_load:   j(5),
      voltage:       j(12.0, 0.01),
      maf:           0,
      fuel_pressure: 300,
      intake_temp:   28,
      is_hybrid:     true,
      hybrid_brand:  'toyota' as const,
      hybrid_mode:   'READY_EV',
      hv_battery_pct:      Math.max(55, 65 - tick * 0.4),
      hv_battery_voltage:  j(201.6 - tick * 0.08, 0.005),
      hv_battery_current:  j(-42 - Math.sin(tick * 0.5) * 8, 0.05),
      hv_battery_temp:     j(32, 0.02),
      motor_speed:         j(2500 + Math.sin(tick * 0.5) * 300),
      hybrid_system_power: j(15 + Math.sin(tick * 0.5) * 3),
      regen_power:         0,
      odometer_km:         tick === 0 ? 18900 : undefined,
    }),
  },

  'Hybrid: ICE Charging (Toyota)': {
    label: '🔌 Hybrid ICE Charging (Toyota)',
    sub:   'Engine ON • HV battery charging 28%→40%',
    pages: '📊 Dashboard (hybrid panels)',
    dynFn: (tick) => ({
      rpm:           j(1200 + Math.sin(tick * 0.4) * 80),
      speed:         0,
      engine_temp:   j(90, 0.01),
      throttle:      j(5),
      fuel_level:    j(65, 0.005),
      engine_load:   j(22),
      voltage:       j(14.2, 0.01),
      maf:           j(4.5),
      fuel_pressure: j(300),
      intake_temp:   28,
      is_hybrid:     true,
      hybrid_brand:  'toyota' as const,
      hybrid_mode:   'CHARGING_ICE',
      hv_battery_pct:      Math.min(40, 28 + tick * 0.5),
      hv_battery_voltage:  j(198 + tick * 0.15, 0.005),
      hv_battery_current:  j(38.5 + Math.sin(tick * 0.6) * 5, 0.04),
      hv_battery_temp:     j(35 + tick * 0.05, 0.02),
      motor_speed:         0,
      hybrid_system_power: j(-8, 0.1),
      regen_power:         0,
      odometer_km:         tick === 0 ? 29400 : undefined,
    }),
  },

  'Hybrid: Regen Braking (Toyota)': {
    label: '♻️ Hybrid Regen Braking (Toyota)',
    sub:   '12-tick cycle: decel 50→0 km/h (regen) → accel 0→50 km/h',
    pages: '📊 Dashboard (hybrid panels)',
    dynFn: (tick) => {
      const phase = tick % 12;
      const decel = phase < 6;
      const speed    = decel ? Math.max(0, 50 - phase * 9)    : Math.min(50, (phase - 6) * 9);
      const regen    = decel ? Math.max(0, 30 - phase * 2)    : 0;
      const motorRpm = decel ? Math.max(0, 1800 - phase * 280): (phase - 6) * 400;
      return {
        rpm:           0,
        speed,
        engine_temp:   j(90, 0.01),
        throttle:      decel ? 0 : j(15, 0.1),
        fuel_level:    j(58, 0.005),
        engine_load:   decel ? 0 : j(20),
        voltage:       j(14.1, 0.01),
        maf:           0,
        fuel_pressure: 300,
        intake_temp:   28,
        is_hybrid:     true,
        hybrid_brand:  'toyota' as const,
        hybrid_mode:   decel ? 'REGEN_BRAKING' : 'READY_EV',
        hv_battery_pct:      Math.min(85, 72 + tick * 0.3),
        hv_battery_voltage:  j(204.8 + tick * 0.03, 0.005),
        hv_battery_current:  decel ? j(85 - phase * 8, 0.05) : j(-20, 0.05),
        hv_battery_temp:     j(33, 0.02),
        motor_speed:         j(motorRpm, 0.05),
        hybrid_system_power: decel ? j(-regen, 0.05) : j(10, 0.1),
        regen_power:         j(regen, 0.1),
        odometer_km:         tick === 0 ? 41600 : undefined,
      };
    },
  },

  'Hybrid: Critical HV Battery (Toyota)': {
    label: '🚨 Hybrid Critical HV Battery',
    sub:   'HV 12% CRITICAL • Engine forced ON • Alert banner active',
    pages: '📊 Dashboard (hybrid panels + alert)',
    dynFn: (tick) => ({
      rpm:           j(1200 + Math.sin(tick * 0.5) * 100),
      speed:         0,
      engine_temp:   j(88, 0.01),
      throttle:      j(5),
      fuel_level:    j(65, 0.01),
      engine_load:   j(35),
      voltage:       j(11.8, 0.02),
      maf:           j(4.5),
      fuel_pressure: j(300),
      intake_temp:   28,
      is_hybrid:     true,
      hybrid_brand:  'toyota' as const,
      hybrid_mode:   'HV_BATTERY_LOW',
      hv_battery_pct:      12,
      hv_battery_voltage:  j(192, 0.01),
      hv_battery_current:  j(55 + Math.sin(tick * 0.8) * 10, 0.05),
      hv_battery_temp:     j(42 + tick * 0.05, 0.02),
      motor_speed:         0,
      hybrid_system_power: j(-12, 0.1),
      regen_power:         0,
      hv_battery_alert:    'CRITICAL — Engine starting now',
      odometer_km:         tick === 0 ? 103500 : undefined,
    }),
  },

  'Hybrid: Honda PHEV (Blended)': {
    label: '🚗 Honda PHEV City (Blended)',
    sub:   'EV+ICE blend • Speed 55-65 km/h • HV discharging 55%→45%',
    pages: '📊 Dashboard (hybrid panels)  •  🔩 Maintenance',
    dynFn: (tick) => ({
      rpm:           j(625 + Math.sin(tick * 0.3) * 100),
      speed:         j(60 + Math.sin(tick * 0.4) * 8),
      engine_temp:   j(93, 0.01),
      throttle:      j(20, 0.05),
      fuel_level:    Math.max(60, 75 - tick * 0.12),
      engine_load:   j(20),
      voltage:       j(14.2, 0.01),
      maf:           j(4.5),
      fuel_pressure: j(300),
      intake_temp:   j(32, 0.02),
      is_hybrid:     true,
      hybrid_brand:  'honda' as const,
      hybrid_mode:   'READY_ENGINE',
      hv_battery_pct:      Math.max(45, 55 - tick * 0.4),
      hv_battery_voltage:  j(345.6 - tick * 0.08, 0.005),
      hv_battery_current:  j(-28, 0.05),
      hv_battery_temp:     j(30, 0.02),
      motor_speed:         j(3200 + Math.sin(tick * 0.4) * 300),
      hybrid_system_power: j(28, 0.05),
      regen_power:         0,
      odometer_km:         tick === 0 ? 9800 : undefined,
    }),
  },
};

const OBDConnectionScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [simActive, setSimActive] = useState(false);
  const [activeScenario, setActiveScenario] = useState<string | null>(null);

  const { isConnected, vin, setConnected, setVehicleId } = useOBD();
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      OBDService.stopScan();
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    };
  }, []);

  const handleScan = async () => {
    setDevices([]);
    setScanning(true);

    await OBDService.scanForELM327(
      (device) => {
        setDevices(prev => {
          if (prev.find(d => d.id === device.id)) return prev;
          return [...prev, device];
        });
      },
      (error) => {
        setScanning(false);
        Alert.alert('Scan Error', error.toString());
      }
    );

    scanTimerRef.current = setTimeout(() => setScanning(false), 10000);
  };

  const handleConnect = async (device: Device) => {
    setSelectedDevice(device);
    setConnecting(true);
    OBDService.stopScan();

    const userId = getUserId();
    const success = await OBDService.connect(device, userId);

    if (success) {
      setConnected(true);
      setVehicleId(userId);
      OBDService.startPolling(2000);
      Alert.alert('Connected!', `Successfully connected to ${device.name}`, [
        { text: 'Go to Dashboard', onPress: () => navigation.goBack() },
      ]);
    } else {
      setSelectedDevice(null);
      Alert.alert('Connection Failed', 'Could not connect to ELM327 device. Make sure ignition is on and adapter is plugged in.');
    }
    setConnecting(false);
  };

  const handleDisconnect = async () => {
    Alert.alert('Disconnect', 'Disconnect from ELM327?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive', onPress: async () => {
          await OBDService.disconnect();
          setConnected(false);
          setVehicleId('');
          setSelectedDevice(null);
          setDevices([]);
        },
      },
    ]);
  };

  const handleSimulate = (scenarioKey: string) => {
    const scenario = SIM_SCENARIOS[scenarioKey];
    const userId = getUserId();

    // Assign vehicleId before startDynamicSim fires tick 0
    OBDService.setVehicleId(userId);

    // Seed backend data (e.g. maintenance history) if this scenario needs it
    if (scenario.setupFn) scenario.setupFn(userId).catch(() => {});

    // Start live simulation — fires tick 0 immediately, then every 2s
    OBDService.startDynamicSim(scenario.dynFn, 2000);

    // Re-apply connected state (startDynamicSim calls stopSimulator which fires disconnectCallback)
    setConnected(true);
    setVehicleId(userId);
    setSimActive(true);
    setActiveScenario(scenarioKey);

    // Peek at tick-0 data to build an accurate alert
    const t0 = scenario.dynFn(0);
    const dtcNote = t0.dtcs?.length
      ? `\n\n⚠️ ${t0.dtcs.length} DTC code(s) injected — tap Scan on Diagnostics tab.`
      : '';
    const odoNote = t0.odometer_km !== undefined
      ? `\n📍 Odometer set: ${t0.odometer_km.toLocaleString()} km — visible on Maintenance tab.`
      : '';
    const hNote = t0.is_hybrid
      ? `\n⚡ Hybrid mode: ${t0.hybrid_mode ?? 'EV'} — HV battery ${t0.hv_battery_pct ?? '?'}%.`
      : '';

    Alert.alert(
      scenario.label,
      `${scenario.sub}${hNote}${dtcNote}${odoNote}\n\nData updates every 2s — watch telemetry change live.\nPages: ${scenario.pages}`,
      [{ text: 'View Dashboard', onPress: () => navigation.goBack() }],
    );
  };

  const handleStopSimulator = () => {
    OBDService.stopSimulator();
    setConnected(false);
    setSimActive(false);
    setActiveScenario(null);
    setVehicleId('');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bgPrimary} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>OBD-II Connection</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollOuter}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* Status Card */}
        <View style={[styles.statusCard, { borderColor: isConnected ? colors.healthy : colors.critical }]}>
          <View style={[styles.statusDot, { backgroundColor: isConnected ? colors.healthy : colors.critical }]} />
          <View style={styles.statusInfo}>
            <Text style={styles.statusTitle}>
              {isConnected ? 'ELM327 Connected' : 'ELM327 Disconnected'}
            </Text>
            {selectedDevice && (
              <Text style={styles.statusSub}>{selectedDevice.name || selectedDevice.id}</Text>
            )}
            {isConnected && vin ? (
              <Text style={styles.statusVin}>VIN: {vin}</Text>
            ) : isConnected ? (
              <Text style={styles.statusSub}>Reading VIN from ECU...</Text>
            ) : null}
            {isConnected && (
              <Text style={styles.statusSub}>Polling every 2s  •  Saving to cloud</Text>
            )}
          </View>
          {isConnected && (
            <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
              <Text style={styles.disconnectBtnText}>Disconnect</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* How to Connect */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>📡 How to Connect</Text>
          <Text style={styles.infoStep}>1. Plug ELM327 adapter into OBD-II port (under dashboard)</Text>
          <Text style={styles.infoStep}>2. Turn on car ignition (engine on or ACC mode)</Text>
          <Text style={styles.infoStep}>3. Enable Bluetooth on your phone</Text>
          <Text style={styles.infoStep}>4. Tap Scan below to discover ELM327</Text>
          <Text style={styles.infoStep}>5. Tap on device name to connect</Text>
        </View>

        {/* Scan Button */}
        {!isConnected && (
          <TouchableOpacity
            style={styles.scanBtn}
            onPress={handleScan}
            disabled={scanning}
            activeOpacity={0.85}>
            {scanning
              ? <><ActivityIndicator color="#0A0E1A" size="small" /><Text style={styles.scanBtnText}>  Scanning...</Text></>
              : <Text style={styles.scanBtnText}>🔍  Scan for ELM327</Text>
            }
          </TouchableOpacity>
        )}

        {/* Device List */}
        {devices.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Found Devices ({devices.length})</Text>
            {devices.map(item => (
              <TouchableOpacity
                key={item.id}
                style={styles.deviceCard}
                onPress={() => handleConnect(item)}
                disabled={connecting}>
                <View style={styles.deviceLeft}>
                  <View style={styles.deviceIcon}>
                    <Text style={styles.deviceIconText}>📟</Text>
                  </View>
                  <View>
                    <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
                    <Text style={styles.deviceId}>{item.id}</Text>
                    <Text style={styles.deviceRssi}>Signal: {item.rssi} dBm</Text>
                  </View>
                </View>
                {connecting && selectedDevice?.id === item.id
                  ? <ActivityIndicator color={colors.primary} />
                  : <Text style={styles.connectText}>Connect →</Text>
                }
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* Empty state */}
        {!scanning && devices.length === 0 && !isConnected && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>📡</Text>
            <Text style={styles.emptyText}>No ELM327 devices found</Text>
            <Text style={styles.emptySubText}>Make sure adapter is plugged in and Bluetooth is enabled</Text>
          </View>
        )}

        {/* ELM327 Simulator — dev tool to verify parser + UI without hardware */}
        <View style={styles.simCard}>
          <Text style={styles.simTitle}>🧪 ELM327 Simulator</Text>
          <Text style={styles.simSub}>
            Live dynamic data — values update every 2s like real hardware.{'\n'}
            Dashboard, Diagnostics, Workshop, Maintenance all exercised.
          </Text>

          {Object.keys(SIM_SCENARIOS).map(key => {
            const s = SIM_SCENARIOS[key];
            const isActive = activeScenario === key && simActive;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.simScenarioBtn, isActive && styles.simScenarioBtnActive]}
                onPress={() => handleSimulate(key)}
                activeOpacity={0.8}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.simScenarioLabel}>{s.label}</Text>
                  <Text style={styles.simScenarioSub}>{s.sub}</Text>
                  <Text style={styles.simScenarioPages}>{s.pages}</Text>
                </View>
                {isActive && <Text style={styles.simActiveBadge}>● LIVE</Text>}
              </TouchableOpacity>
            );
          })}

          {simActive && (
            <TouchableOpacity style={styles.simStopBtn} onPress={handleStopSimulator}>
              <Text style={styles.simStopBtnText}>⏹ Stop Simulator</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Connected and back to dashboard */}
        {isConnected && (
          <TouchableOpacity style={styles.dashboardBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.dashboardBtnText}>← Back to Dashboard</Text>
          </TouchableOpacity>
        )}

      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: typeof darkColors) => StyleSheet.create({
  safeArea:    { flex: 1, backgroundColor: colors.bgPrimary },
  scrollOuter: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 32, color: colors.primary, lineHeight: 36 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  container: { padding: 16, paddingBottom: 40 },
  statusCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1.5, gap: 12 },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusInfo: { flex: 1 },
  statusTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  statusSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  statusVin: { fontSize: 12, color: colors.primary, marginTop: 3, fontWeight: '600', letterSpacing: 0.5 },
  disconnectBtn: { backgroundColor: '#FF525220', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.critical },
  disconnectBtnText: { fontSize: 12, color: colors.critical, fontWeight: '600' },
  infoCard: { backgroundColor: colors.bgCard, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  infoTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
  infoStep: { fontSize: 13, color: colors.textSecondary, marginBottom: 6, lineHeight: 20 },
  scanBtn: { flexDirection: 'row', backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 20, shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8 },
  scanBtnText: { color: '#0A0E1A', fontSize: 16, fontWeight: '800' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
  deviceCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border, justifyContent: 'space-between' },
  deviceLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  deviceIcon: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#00E5CC15', borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  deviceIconText: { fontSize: 20 },
  deviceName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  deviceId: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  deviceRssi: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  connectText: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 40 },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 16, fontWeight: '600', color: colors.textSecondary },
  emptySubText: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  dashboardBtn: { marginTop: 16, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  dashboardBtnText: { color: '#0A0E1A', fontSize: 15, fontWeight: '700' },
  // Simulator section
  simCard: { backgroundColor: '#0D2A26', borderRadius: 14, padding: 16, marginTop: 12, borderWidth: 1.5, borderColor: '#00E5CC40', marginBottom: 8 },
  simTitle: { fontSize: 15, fontWeight: '800', color: '#00E5CC', marginBottom: 6 },
  simSub: { fontSize: 12, color: colors.textSecondary, marginBottom: 14, lineHeight: 18 },
  simScenarioBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0A1A18', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#00E5CC30' },
  simScenarioBtnActive: { borderColor: '#00E5CC', backgroundColor: '#002622' },
  simScenarioLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
  simScenarioSub: { fontSize: 11, color: colors.textSecondary, marginBottom: 2 },
  simScenarioPages: { fontSize: 10, color: '#00E5CC99', fontStyle: 'italic' },
  simActiveBadge: { fontSize: 11, fontWeight: '800', color: '#00E5CC' },
  simStopBtn: { marginTop: 6, backgroundColor: '#FF525220', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.critical },
  simStopBtnText: { fontSize: 13, color: colors.critical, fontWeight: '700' },
});

export default OBDConnectionScreen;
