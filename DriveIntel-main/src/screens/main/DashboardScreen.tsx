import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  SafeAreaView, StatusBar, ActivityIndicator, Animated,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '../../context/ThemeContext';
import { darkColors, darkColors as colors } from '../../theme/colors';
import TopBar from '../../components/common/TopBar';
import { getOBDLatest, getDTCCodes, getUserId } from '../../services/api';
import { useOBD, LiveData } from '../../context/OBDContext';
import AIService from '../../services/ai.service';
import NotificationService from '../../services/NotificationService';

interface Props { navigation: any; }

// ═══════════════════════════════════════════════════════════════
// PID ANALYSIS ENGINE
// Mirrors the thresholds from obd_config.py / HEALTH_THRESHOLDS
// ═══════════════════════════════════════════════════════════════
interface PIDAlert { pid: string; label: string; value: string; severity: 'warning' | 'critical'; advice: string; }

function analysePIDs(d: LiveData): { score: number; alerts: PIDAlert[]; componentHealth: ComponentStatus[] } {
  const alerts: PIDAlert[] = [];
  let score = 100;

  // ── Engine Coolant Temp (°C) ──────────────────────────────
  if (d.engineTemp > 110) {
    alerts.push({ pid: 'ENGINE_TEMP', label: 'Engine Overheating', value: `${d.engineTemp}°C`, severity: 'critical', advice: 'Pull over and let engine cool. Check coolant level.' });
    score -= 30;
  } else if (d.engineTemp > 100) {
    alerts.push({ pid: 'ENGINE_TEMP', label: 'High Engine Temp', value: `${d.engineTemp}°C`, severity: 'warning', advice: 'Engine running hot. Monitor coolant & reduce load.' });
    score -= 15;
  }

  // ── Fuel Level (%) ────────────────────────────────────────
  if (d.fuelLevel < 10) {
    alerts.push({ pid: 'FUEL_LEVEL', label: 'Critically Low Fuel', value: `${d.fuelLevel}%`, severity: 'critical', advice: 'Refuel immediately to avoid engine damage.' });
    score -= 20;
  } else if (d.fuelLevel < 20) {
    alerts.push({ pid: 'FUEL_LEVEL', label: 'Low Fuel', value: `${d.fuelLevel}%`, severity: 'warning', advice: 'Refuel soon.' });
    score -= 10;
  }

  // ── Battery Voltage (V) ───────────────────────────────────
  if (d.voltage < 10.5) {
    alerts.push({ pid: 'VOLTAGE', label: 'Critical Battery Voltage', value: `${d.voltage}V`, severity: 'critical', advice: 'Battery failing. Visit workshop immediately.' });
    score -= 25;
  } else if (d.voltage < 11.5) {
    alerts.push({ pid: 'VOLTAGE', label: 'Low Battery Voltage', value: `${d.voltage}V`, severity: 'warning', advice: 'Battery charge low. Check alternator.' });
    score -= 10;
  }

  // ── Engine Load (%) ───────────────────────────────────────
  if (d.engineLoad > 95) {
    alerts.push({ pid: 'ENGINE_LOAD', label: 'Engine Overload', value: `${d.engineLoad}%`, severity: 'critical', advice: 'Reduce throttle. Engine working at maximum capacity.' });
    score -= 10;
  } else if (d.engineLoad > 80) {
    alerts.push({ pid: 'ENGINE_LOAD', label: 'High Engine Load', value: `${d.engineLoad}%`, severity: 'warning', advice: 'High load sustained. Check for mechanical drag.' });
    score -= 5;
  }

  // ── RPM ───────────────────────────────────────────────────
  if (d.rpm > 7000) {
    alerts.push({ pid: 'RPM', label: 'RPM in Red Zone', value: `${d.rpm} RPM`, severity: 'critical', advice: 'Shift up immediately to protect engine.' });
    score -= 10;
  } else if (d.rpm > 6000) {
    alerts.push({ pid: 'RPM', label: 'High RPM', value: `${d.rpm} RPM`, severity: 'warning', advice: 'Consider upshifting to reduce engine stress.' });
    score -= 5;
  }

  // ── MAF (g/s) – abnormal range suggests air leak / MAF fault
  if (d.maf > 0 && (d.maf < 2 && d.rpm > 1000)) {
    alerts.push({ pid: 'MAF', label: 'Low MAF Reading', value: `${d.maf} g/s`, severity: 'warning', advice: 'Possible air intake leak or dirty MAF sensor.' });
    score -= 5;
  }

  // ── Intake Temp (°C) ─────────────────────────────────────
  if (d.intakeTemp > 50) {
    alerts.push({ pid: 'INTAKE_TEMP', label: 'High Intake Temp', value: `${d.intakeTemp}°C`, severity: 'warning', advice: 'Air intake very hot. Check air filter & ducting.' });
    score -= 5;
  }

  score = Math.max(0, Math.min(100, score));

  // ── Derive component health from alerts ───────────────────
  const hasCritical = (...pids: string[]) => alerts.some(a => pids.includes(a.pid) && a.severity === 'critical');
  const hasWarning  = (...pids: string[]) => alerts.some(a => pids.includes(a.pid));

  const componentHealth: ComponentStatus[] = [
    {
      id: 'engine',
      name: 'Engine',
      icon: '🔧',
      status: hasCritical('ENGINE_TEMP', 'RPM', 'ENGINE_LOAD', 'MAF') ? 'critical'
            : hasWarning('ENGINE_TEMP', 'RPM', 'ENGINE_LOAD', 'MAF', 'INTAKE_TEMP') ? 'warning'
            : 'healthy',
      detail: `${d.engineTemp}°C · ${d.rpm} RPM`,
    },
    {
      id: 'fuel',
      name: 'Fuel System',
      icon: '⛽',
      status: hasCritical('FUEL_LEVEL') ? 'critical' : hasWarning('FUEL_LEVEL', 'MAF') ? 'warning' : 'healthy',
      detail: `${d.fuelLevel}% · ${d.fuelPressure} kPa`,
    },
    {
      id: 'electrical',
      name: 'Electrical',
      icon: '🔋',
      status: hasCritical('VOLTAGE') ? 'critical' : hasWarning('VOLTAGE') ? 'warning' : 'healthy',
      detail: `${d.voltage} V`,
    },
    {
      id: 'air',
      name: 'Air System',
      icon: '💨',
      status: hasWarning('INTAKE_TEMP', 'MAF') ? 'warning' : 'healthy',
      detail: `${d.intakeTemp}°C · ${d.maf} g/s`,
    },
  ];

  return { score, alerts, componentHealth };
}

// ── Default component status when no BLE data ─────────────────
interface ComponentStatus {
  id: string; name: string; icon: string;
  status: 'healthy' | 'warning' | 'critical'; detail: string;
}

const DEFAULT_COMPONENTS: ComponentStatus[] = [
  { id: 'engine', name: 'Engine', icon: '🔧', status: 'healthy', detail: '-- °C' },
  { id: 'fuel',   name: 'Fuel System', icon: '⛽', status: 'healthy', detail: '--%' },
  { id: 'electrical', name: 'Electrical', icon: '🔋', status: 'healthy', detail: '-- V' },
  { id: 'air',    name: 'Air System', icon: '💨', status: 'healthy', detail: '--' },
];

const STATUS_CFG = {
  healthy:  { color: colors.healthy, bg: '#00E67618', label: 'Healthy' },
  warning:  { color: colors.warning, bg: '#FFA72618', label: 'Warning' },
  critical: { color: colors.critical, bg: '#FF525218', label: 'Critical' },
};

// ═══════════════════════════════════════════════════════════════
// CIRCULAR GAUGE
// ═══════════════════════════════════════════════════════════════
const CircularGauge = React.memo(({ value, maxValue, label, unit, color, size = 118 }: {
  value: number; maxValue: number; label: string; unit: string; color: string; size?: number;
}) => {
  const sw = 9;
  const r = (size - sw * 2) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(Math.max(value / maxValue, 0), 1);
  const offset = circ * (1 - pct);
  const cx = size / 2;
  return (
    <View style={{ alignItems: 'center', width: size + 8 }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={cx} cy={cx} r={r} stroke="#1E2D45" strokeWidth={sw} fill="transparent" />
          <Circle cx={cx} cy={cx} r={r} stroke={color} strokeWidth={sw}
            fill="transparent" strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round" rotation="-90" origin={`${cx},${cx}`} />
        </Svg>
        <View style={[gS.center, { width: size, height: size }]}>
          <Text style={[gS.val, { color }]}>{value}</Text>
          <Text style={gS.unit}>{unit}</Text>
        </View>
      </View>
      <Text style={gS.label}>{label}</Text>
    </View>
  );
});
const gS = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  val: { fontSize: 17, fontWeight: '800' },
  unit: { fontSize: 9, color: '#8899AA', marginTop: 1 },
  label: { fontSize: 10, color: '#8899AA', marginTop: 5, textAlign: 'center' },
});

// ═══════════════════════════════════════════════════════════════
// HEALTH SCORE CIRCLE (animated arc)
// ═══════════════════════════════════════════════════════════════
const HealthScoreCircle = ({ score }: { score: number }) => {
  const size = 82; const sw = 8;
  const r = (size - sw * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const cx = size / 2;
  const c = score >= 80 ? colors.healthy : score >= 50 ? colors.warning : colors.critical;
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={cx} cy={cx} r={r} stroke="#1E2D45" strokeWidth={sw} fill="transparent" />
          <Circle cx={cx} cy={cx} r={r} stroke={c} strokeWidth={sw}
            fill="transparent" strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round" rotation="-90" origin={`${cx},${cx}`} />
        </Svg>
        <View style={[styles.circleCenter, { width: size, height: size }]}>
          <Text style={[styles.healthVal, { color: c }]}>{score}</Text>
          <Text style={styles.healthPct}>%</Text>
        </View>
      </View>
      <Text style={styles.metricLabel}>Health Score</Text>
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════
// ALERT CARD
// ═══════════════════════════════════════════════════════════════
const AlertCard = ({ alert, onDismiss }: { alert: PIDAlert; onDismiss: () => void }) => {
  const cfg = alert.severity === 'critical'
    ? { color: colors.critical, bg: '#FF525212', border: '#FF525240', icon: '🚨' }
    : { color: colors.warning,  bg: '#FFA72612', border: '#FFA72640', icon: '⚠️' };
  return (
    <View style={[styles.alertCard, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
      <Text style={styles.alertIcon}>{cfg.icon}</Text>
      <View style={{ flex: 1 }}>
        <View style={styles.alertTitleRow}>
          <Text style={[styles.alertTitle, { color: cfg.color }]}>{alert.label}</Text>
          <Text style={[styles.alertValue, { color: cfg.color }]}>{alert.value}</Text>
        </View>
        <Text style={styles.alertAdvice}>{alert.advice}</Text>
      </View>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.alertDismiss}>✕</Text>
      </TouchableOpacity>
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════
// COMPONENT HEALTH ROW
// ═══════════════════════════════════════════════════════════════
const ComponentRow = React.memo(({ item }: { item: ComponentStatus }) => {
  const cfg = STATUS_CFG[item.status];
  return (
    <View style={styles.compRow}>
      <View style={[styles.compIconBox, { backgroundColor: cfg.bg }]}>
        <Text style={styles.compIcon}>{item.icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.compName}>{item.name}</Text>
        <Text style={styles.compDetail}>{item.detail}</Text>
      </View>
      <View style={[styles.compBadge, { backgroundColor: cfg.bg }]}>
        <Text style={[styles.compBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
      </View>
    </View>
  );
});

// ═══════════════════════════════════════════════════════════════
// HYBRID CARD — mode-aware panel for hybrid vehicles
// ═══════════════════════════════════════════════════════════════
import { HybridMode } from '../../services/HybridService';

const HYBRID_CFG: Record<HybridMode, { badge: string; bg: string; border: string; accent: string }> = {
  PARKED_OFF:     { badge: '⏸  Parked',               bg: '#1A2540', border: '#243350', accent: '#8899BB' },
  READY_EV:       { badge: '⚡  EV Mode',              bg: '#00E67608', border: '#00E67650', accent: '#00E676' },
  READY_ENGINE:   { badge: '🔥  Engine Mode',          bg: '#FFA72608', border: '#FFA72650', accent: '#FFA726' },
  TRANSITION:     { badge: '🔄  Transitioning...',     bg: '#40C4FF08', border: '#40C4FF50', accent: '#40C4FF' },
  REGEN_BRAKING:  { badge: '♻️  Regen Braking',        bg: '#00E5CC08', border: '#00E5CC50', accent: '#00E5CC' },
  CHARGING_ICE:   { badge: '🔌  Charging Battery',     bg: '#FFA72608', border: '#FFA72650', accent: '#FFA726' },
  HV_BATTERY_LOW: { badge: '⚠️  HV Battery Low',       bg: '#FF525208', border: '#FF525250', accent: '#FF5252' },
};

interface HybridCardProps {
  mode:              HybridMode;
  brand:             string;
  hvBatteryPct:      number;
  hvBatteryVoltage:  number;
  hvBatteryCurrent:  number;
  fuelLevelPct:      number;
  motorSpeed:        number;
  mg2Speed:          number;
  regenPower:        number;
  hybridSystemPower: number;
  rpm:               number;
  speed:             number;
  engineTemp:        number;
  engineLoad:        number;
  fuelRate:          number;
  ambientTemp:       number;
  hvBatteryAlert:    string;
}

const HVBar = ({ pct, accent }: { pct: number; accent: string }) => (
  <View style={{ height: 5, backgroundColor: '#1E2D45', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
    <View style={{ height: 5, borderRadius: 3, backgroundColor: pct < 20 ? colors.critical : pct < 40 ? colors.warning : accent, width: `${Math.min(pct, 100)}%` }} />
  </View>
);

const HybridCard: React.FC<HybridCardProps> = ({
  mode, brand, hvBatteryPct, hvBatteryVoltage, hvBatteryCurrent,
  fuelLevelPct, motorSpeed, mg2Speed, regenPower, hybridSystemPower,
  rpm, speed, engineTemp, engineLoad, fuelRate, ambientTemp, hvBatteryAlert,
}) => {
  const cfg = HYBRID_CFG[mode] ?? HYBRID_CFG.PARKED_OFF;
  const brandLabel = brand === 'toyota' ? 'Toyota Hybrid' : brand === 'honda' ? 'Honda IMA' : 'Hybrid';
  const displayMotor = mg2Speed !== 0 ? mg2Speed : motorSpeed;

  return (
    <View style={[hS.card, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>

      {/* ── Mode Badge row ── */}
      <View style={hS.topRow}>
        <View style={[hS.badge, { borderColor: cfg.accent + '60' }]}>
          <Text style={[hS.badgeText, { color: cfg.accent }]}>{cfg.badge}</Text>
        </View>
        <Text style={hS.brandLabel}>{brandLabel}</Text>
        {hybridSystemPower !== 0 && (
          <Text style={[hS.powerText, { color: hybridSystemPower > 0 ? colors.healthy : colors.warning }]}>
            {hybridSystemPower > 0 ? '+' : ''}{hybridSystemPower} W
          </Text>
        )}
      </View>

      {/* ── Dual fuel row: HV battery + petrol tank ── */}
      <View style={hS.fuelRow}>
        {/* HV Battery */}
        <View style={hS.fuelCell}>
          <View style={hS.fuelHeader}>
            <Text style={hS.fuelIcon}>🔋</Text>
            <Text style={hS.fuelLabel}>HV Battery</Text>
            <Text style={[hS.fuelValue, { color: hvBatteryPct < 20 ? colors.critical : hvBatteryPct < 40 ? colors.warning : cfg.accent }]}>
              {hvBatteryPct}%
            </Text>
          </View>
          <HVBar pct={hvBatteryPct} accent={cfg.accent} />
          {hvBatteryVoltage > 0 && (
            <Text style={hS.fuelSub}>{hvBatteryVoltage.toFixed(0)} V  {hvBatteryCurrent !== 0 ? `· ${hvBatteryCurrent > 0 ? '+' : ''}${hvBatteryCurrent.toFixed(0)} A` : ''}</Text>
          )}
        </View>
        {/* Petrol Tank */}
        <View style={hS.fuelCell}>
          <View style={hS.fuelHeader}>
            <Text style={hS.fuelIcon}>⛽</Text>
            <Text style={hS.fuelLabel}>Petrol Tank</Text>
            <Text style={[hS.fuelValue, { color: fuelLevelPct < 10 ? colors.critical : fuelLevelPct < 20 ? colors.warning : '#8899BB' }]}>
              {fuelLevelPct}%
            </Text>
          </View>
          <View style={{ height: 5, backgroundColor: '#1E2D45', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
            <View style={{ height: 5, borderRadius: 3, width: `${Math.min(fuelLevelPct, 100)}%`, backgroundColor: fuelLevelPct < 10 ? colors.critical : fuelLevelPct < 20 ? colors.warning : '#4A5568' }} />
          </View>
          {fuelRate > 0 && <Text style={hS.fuelSub}>{fuelRate.toFixed(1)} L/h</Text>}
        </View>
      </View>

      {/* ── HV alert ── */}
      {hvBatteryAlert !== '' && (
        <View style={hS.alertRow}>
          <Text style={[hS.alertText, { color: hvBatteryPct < 10 ? colors.critical : colors.warning }]}>
            {hvBatteryPct < 10 ? '🚨' : '⚠️'} {hvBatteryAlert}
          </Text>
        </View>
      )}

      {/* ── Mode-specific metrics ── */}
      {mode === 'TRANSITION' ? (
        <View style={hS.metricsRow}>
          <ActivityIndicator size="small" color={cfg.accent} />
          <Text style={[hS.metricText, { color: cfg.accent, marginLeft: 8 }]}>Engine transition in progress…</Text>
        </View>
      ) : mode === 'REGEN_BRAKING' ? (
        <View style={hS.metricsRow}>
          <View style={hS.metricCell}>
            <Text style={[hS.metricVal, { color: cfg.accent }]}>{speed} <Text style={hS.metricUnit}>km/h</Text></Text>
            <Text style={hS.metricLbl}>Speed</Text>
          </View>
          <View style={hS.metricCell}>
            <Text style={[hS.metricVal, { color: cfg.accent }]}>{regenPower} <Text style={hS.metricUnit}>W</Text></Text>
            <Text style={hS.metricLbl}>Regen Power</Text>
          </View>
          {ambientTemp !== 0 && (
            <View style={hS.metricCell}>
              <Text style={hS.metricVal}>{ambientTemp}°<Text style={hS.metricUnit}>C</Text></Text>
              <Text style={hS.metricLbl}>Ambient</Text>
            </View>
          )}
        </View>
      ) : mode === 'READY_EV' || mode === 'HV_BATTERY_LOW' ? (
        <View style={hS.metricsRow}>
          <View style={hS.metricCell}>
            <Text style={[hS.metricVal, { color: cfg.accent }]}>{speed} <Text style={hS.metricUnit}>km/h</Text></Text>
            <Text style={hS.metricLbl}>Speed</Text>
          </View>
          {displayMotor !== 0 && (
            <View style={hS.metricCell}>
              <Text style={[hS.metricVal, { color: cfg.accent }]}>{displayMotor.toLocaleString()} <Text style={hS.metricUnit}>RPM</Text></Text>
              <Text style={hS.metricLbl}>Motor</Text>
            </View>
          )}
          {ambientTemp !== 0 && (
            <View style={hS.metricCell}>
              <Text style={hS.metricVal}>{ambientTemp}°<Text style={hS.metricUnit}>C</Text></Text>
              <Text style={hS.metricLbl}>Ambient</Text>
            </View>
          )}
        </View>
      ) : (mode === 'READY_ENGINE' || mode === 'CHARGING_ICE') ? (
        <View style={hS.metricsRow}>
          <View style={hS.metricCell}>
            <Text style={[hS.metricVal, { color: cfg.accent }]}>{rpm.toLocaleString()} <Text style={hS.metricUnit}>RPM</Text></Text>
            <Text style={hS.metricLbl}>Engine RPM</Text>
          </View>
          <View style={hS.metricCell}>
            <Text style={[hS.metricVal, { color: engineTemp > 100 ? colors.critical : engineTemp > 90 ? colors.warning : '#8899BB' }]}>
              {engineTemp}°<Text style={hS.metricUnit}>C</Text>
            </Text>
            <Text style={hS.metricLbl}>Coolant</Text>
          </View>
          <View style={hS.metricCell}>
            <Text style={[hS.metricVal, { color: engineLoad > 80 ? colors.warning : '#8899BB' }]}>
              {engineLoad}<Text style={hS.metricUnit}>%</Text>
            </Text>
            <Text style={hS.metricLbl}>Engine Load</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
};

const hS = StyleSheet.create({
  card:        { borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1 },
  topRow:      { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  badge:       { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  badgeText:   { fontSize: 12, fontWeight: '800' },
  brandLabel:  { fontSize: 11, color: '#4A5568', flex: 1 },
  powerText:   { fontSize: 12, fontWeight: '700' },
  fuelRow:     { flexDirection: 'row', gap: 10, marginBottom: 10 },
  fuelCell:    { flex: 1, backgroundColor: '#0D1525', borderRadius: 10, padding: 10 },
  fuelHeader:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  fuelIcon:    { fontSize: 14 },
  fuelLabel:   { fontSize: 11, color: '#8899BB', flex: 1 },
  fuelValue:   { fontSize: 13, fontWeight: '800' },
  fuelSub:     { fontSize: 10, color: '#4A5568', marginTop: 4 },
  alertRow:    { backgroundColor: '#FF525210', borderRadius: 8, padding: 8, marginBottom: 8 },
  alertText:   { fontSize: 12, fontWeight: '700' },
  metricsRow:  { flexDirection: 'row', gap: 8, alignItems: 'center' },
  metricCell:  { flex: 1, backgroundColor: '#0D1525', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  metricVal:   { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  metricUnit:  { fontSize: 10, fontWeight: '400', color: '#8899BB' },
  metricText:  { fontSize: 12, fontWeight: '600' },
  metricLbl:   { fontSize: 10, color: '#8899BB', marginTop: 3 },
});

// Static styles used only by the sub-components above (always dark-theme accents).
// DashboardScreen shadows this with a dynamic useMemo version below.
const styles = StyleSheet.create({
  circleCenter:  { position: 'absolute', top: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  healthVal:     { fontSize: 17, fontWeight: '800' },
  healthPct:     { fontSize: 10, color: colors.textSecondary },
  metricLabel:   { fontSize: 11, color: colors.textSecondary, marginTop: 9, textAlign: 'center' },
  alertCard:     { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, gap: 10 },
  alertIcon:     { fontSize: 20, marginTop: 1 },
  alertTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  alertTitle:    { fontSize: 13, fontWeight: '700', flex: 1 },
  alertValue:    { fontSize: 13, fontWeight: '800', marginLeft: 8 },
  alertAdvice:   { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  alertDismiss:  { fontSize: 14, color: colors.textMuted, paddingLeft: 6 },
  compRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1A2540', gap: 10 },
  compIconBox:   { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  compIcon:      { fontSize: 17 },
  compName:      { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  compDetail:    { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  compBadge:     { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  compBadgeText: { fontSize: 11, fontWeight: '700' },
});

// ═══════════════════════════════════════════════════════════════
// DASHBOARD SCREEN
// ═══════════════════════════════════════════════════════════════
const DashboardScreen: React.FC<Props> = ({ navigation }) => {
  const { colors: themeColors } = useTheme();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const { isConnected, vehicleId, vin, liveData } = useOBD();
  const effectiveVehicleId = vehicleId || getUserId();

  const [apiData, setApiData]           = useState<any>(null);
  const [dtcAlerts, setDtcAlerts]       = useState<string[]>([]);
  const [dismissedPIDs, setDismissed]   = useState<Set<string>>(new Set());
  const [loading, setLoading]           = useState(true);
  const [aiHealth, setAiHealth]         = useState<{ score: number; status: string } | null>(null);
  const pollRef           = useRef<any>(null);
  const liveDataRef       = useRef<LiveData | null>(null);
  const lastAIRunRef      = useRef<number>(0);
  const notifiedPIDsRef   = useRef<Set<string>>(new Set());

  // Keep ref in sync so the poll interval always sees the latest value
  // without the interval needing liveData in its dependency array.
  liveDataRef.current = liveData;

  // Derived from live BLE analysis — memoised so it does not rerun on
  // unrelated state changes (e.g. aiHealth, dtcAlerts updates).
  const analysis = useMemo(() => liveData ? analysePIDs(liveData) : null, [liveData]);
  const componentHealth = analysis?.componentHealth ?? DEFAULT_COMPONENTS;
  // PID-based score is the primary source — it's immediate and directly reflects sensor readings.
  // AI score is shown only as a supplementary badge, not as the main gauge value,
  // because the ONNX anomaly model calibrates to driving conditions and flags idle/parked as abnormal.
  const healthScore = analysis?.score ?? (apiData?.healthScore ?? 100);
  const activeAlerts = (analysis?.alerts ?? []).filter(a => !dismissedPIDs.has(a.pid));

  // Combined sensor values — prefer live BLE, fall back to API snapshot
  const speed      = liveData?.speed       ?? apiData?.speed       ?? 0;
  const rpm        = liveData?.rpm         ?? apiData?.rpm         ?? 0;
  const engineTemp = liveData?.engineTemp  ?? apiData?.engineTemp  ?? 0;
  const throttle   = liveData?.throttle    ?? apiData?.throttle    ?? 0;
  const fuelLevel  = liveData?.fuelLevel   ?? apiData?.fuelLevel   ?? 0;
  const voltage    = liveData?.voltage     ?? apiData?.voltage     ?? 12.0;
  const engineLoad = liveData?.engineLoad  ?? apiData?.engineLoad  ?? 0;
  const intakeTemp = liveData?.intakeTemp  ?? 0;
  const maf        = liveData?.maf         ?? 0;
  const fuelPres   = liveData?.fuelPressure ?? 0;
  const rpmK       = parseFloat((rpm / 1000).toFixed(1));

  useEffect(() => {
    loadInitial();
    // API fallback poll when BLE not active.
    // Uses liveDataRef (not liveData) to avoid the stale-closure trap —
    // the interval callback always reads the current connection state.
    pollRef.current = setInterval(() => {
      if (!liveDataRef.current) loadOBDLatest();
    }, 5000);
    return () => { clearInterval(pollRef.current); };
  }, [effectiveVehicleId]);

  // Run AI sensor health check at most once every 10 s while BLE is live.
  // ONNX inference is CPU-intensive; running it every 2 s (the BLE poll rate)
  // caused sustained JS-thread lag. The AI badge is supplementary — 10 s refresh
  // is imperceptible to users and gives the JS thread room to breathe.
  useEffect(() => {
    if (!liveData) return;
    const now = Date.now();
    if (now - lastAIRunRef.current < 10_000) return;
    lastAIRunRef.current = now;

    (async () => {
      try {
        const sensors = AIService.mapOBDToSensors({
          rpm:         liveData.rpm,
          engine_temp: liveData.engineTemp,
          maf:         liveData.maf,
          throttle:    liveData.throttle,
          voltage:     liveData.voltage,
          intake_temp: liveData.intakeTemp,
          speed:       liveData.speed,
        });
        const result = await AIService.runInference({
          session_id: `dash-${Date.now()}`,
          dtcs:       [],
          sensors,
          mileage_km: 80_000,
          location:   { lat: 0, lng: 0 },
        });
        setAiHealth({ score: result.health.score, status: result.health.status });
      } catch { /* non-blocking */ }
    })();
  }, [liveData]);

  // Fire popup notifications for new critical PID alerts.
  // Clear the notified set when BLE disconnects so the same alert fires again on reconnect.
  useEffect(() => {
    if (!isConnected) { notifiedPIDsRef.current.clear(); return; }
    const criticalAlerts = (analysis?.alerts ?? []).filter(
      a => a.severity === 'critical' && !notifiedPIDsRef.current.has(a.pid),
    );
    for (const a of criticalAlerts) {
      notifiedPIDsRef.current.add(a.pid);
      NotificationService.notifyFault(a.pid, `${a.label} — ${a.advice}`, 'HIGH');
    }
  }, [analysis, isConnected]);

  const loadInitial = async () => {
    await Promise.all([loadOBDLatest(), loadDTCAlerts()]);
    setLoading(false);
  };

  const loadOBDLatest = async () => {
    try { setApiData(await getOBDLatest(effectiveVehicleId)); } catch { /* keep prev */ }
  };

  const loadDTCAlerts = async () => {
    try {
      const res = await getDTCCodes(effectiveVehicleId);
      if (res.details?.length) setDtcAlerts(res.details.map((d: any) => d.code));
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <TopBar />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Connecting to vehicle...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const connected     = isConnected || apiData?.obdStatus === 'connected';
  const healthyCnt    = componentHealth.filter(c => c.status === 'healthy').length;
  const warningCnt    = componentHealth.filter(c => c.status === 'warning').length;
  const criticalCnt   = componentHealth.filter(c => c.status === 'critical').length;

  // Hybrid-specific derived values
  const isHybrid      = liveData?.isHybrid ?? false;
  const hybridMode    = liveData?.hybridMode;
  // HV_BATTERY_LOW forces engine ON — exclude it from "motor-only" EV display
  const isEVMode      = hybridMode === 'READY_EV' || hybridMode === 'REGEN_BRAKING';
  const isTransition  = hybridMode === 'TRANSITION';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bgPrimary} />
      <TopBar />

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>

        {/* ── OBD Status Banner ─────────────────────────────── */}
        <TouchableOpacity
          style={[styles.obdBanner, { borderColor: connected ? colors.healthy : '#FF525240' }]}
          onPress={() => navigation.navigate('OBDConnection')}
          activeOpacity={0.8}>
          <View style={[styles.obdPulse, { backgroundColor: connected ? colors.healthy : colors.critical }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.obdStatusText, { color: connected ? colors.healthy : colors.critical }]}>
              {connected
                ? liveData ? 'ELM327 Live  ·  Polling every 2s' : 'OBD-II Connected'
                : 'OBD-II Disconnected'}
            </Text>
            {liveData && (
              <Text style={styles.obdMetaText}>
                {vin ? `VIN: ${vin}` : `ID: ${effectiveVehicleId.slice(0, 12)}...`}  ·  CAN Bus active
              </Text>
            )}
            {!connected && (
              <Text style={styles.obdMetaText}>Tap to connect ELM327 adapter →</Text>
            )}
          </View>
          {liveData && (
            <View style={styles.livePill}>
              <Text style={styles.livePillText}>● LIVE</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* ── Hybrid Status Card (hybrid vehicles only) ─────── */}
        {isHybrid && liveData && hybridMode && (
          <HybridCard
            mode={hybridMode}
            brand={liveData.hybridBrand ?? 'generic'}
            hvBatteryPct={liveData.hvBatteryPct ?? 0}
            hvBatteryVoltage={liveData.hvBatteryVoltage ?? 0}
            hvBatteryCurrent={liveData.hvBatteryCurrent ?? 0}
            fuelLevelPct={fuelLevel}
            motorSpeed={liveData.motorSpeed ?? 0}
            mg2Speed={liveData.mg2Speed ?? 0}
            regenPower={liveData.regenPower ?? 0}
            hybridSystemPower={liveData.hybridSystemPower ?? 0}
            rpm={rpm}
            speed={speed}
            engineTemp={engineTemp}
            engineLoad={engineLoad}
            fuelRate={liveData.fuelRate ?? 0}
            ambientTemp={liveData.ambientTemp ?? 0}
            hvBatteryAlert={liveData.hvBatteryAlert ?? ''}
          />
        )}

        {/* ── Active PID Alerts ──────────────────────────────── */}
        {activeAlerts.length > 0 && (
          <View style={styles.alertsSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>
                {activeAlerts.some(a => a.severity === 'critical') ? '🚨' : '⚠️'} Active Alerts
              </Text>
              <TouchableOpacity onPress={() => setDismissed(new Set(activeAlerts.map(a => a.pid)))}>
                <Text style={styles.dismissAll}>Dismiss all</Text>
              </TouchableOpacity>
            </View>
            {activeAlerts.map(a => (
              <AlertCard
                key={a.pid}
                alert={a}
                onDismiss={() => setDismissed(prev => new Set([...prev, a.pid]))}
              />
            ))}
          </View>
        )}

        {/* ── DTC Code Alerts (from backend) ────────────────── */}
        {dtcAlerts.length > 0 && (
          <TouchableOpacity
            style={styles.dtcAlertBanner}
            onPress={() => navigation.navigate('Diagnostics')}
            activeOpacity={0.85}>
            <Text style={styles.dtcAlertIcon}>🔴</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.dtcAlertTitle}>{dtcAlerts.length} Fault Code{dtcAlerts.length > 1 ? 's' : ''} Active</Text>
              <Text style={styles.dtcAlertCodes}>{dtcAlerts.slice(0, 4).join('  ·  ')}{dtcAlerts.length > 4 ? '  +more' : ''}</Text>
            </View>
            <Text style={styles.dtcAlertArrow}>›</Text>
          </TouchableOpacity>
        )}

        {/* ── Vehicle Status Card ────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Vehicle Status</Text>
            {aiHealth && (
              <View style={styles.aiBadge}>
                <Text style={styles.aiBadgeText}>🤖 AI {aiHealth.status}</Text>
              </View>
            )}
          </View>
          <View style={styles.statusRow}>
            <HealthScoreCircle score={healthScore} />

            {/* Fuel */}
            <View style={styles.statusMetric}>
              <View style={[styles.metricCircle, {
                borderColor: fuelLevel < 10 ? colors.critical : fuelLevel < 20 ? colors.warning : colors.border,
              }]}>
                <Text style={styles.metricEmoji}>⛽</Text>
                <View style={[styles.metricBadge, {
                  backgroundColor: fuelLevel < 10 ? colors.critical : fuelLevel < 20 ? colors.warning : colors.primary,
                }]}>
                  <Text style={styles.metricBadgeText}>{fuelLevel}%</Text>
                </View>
              </View>
              <Text style={styles.metricLabel}>Fuel</Text>
            </View>

            {/* Voltage */}
            <View style={styles.statusMetric}>
              <View style={[styles.metricCircle, {
                borderColor: voltage < 10.5 ? colors.critical : voltage < 11.5 ? colors.warning : colors.border,
              }]}>
                <Text style={styles.metricEmoji}>🔋</Text>
                <View style={[styles.metricBadge, {
                  backgroundColor: voltage < 10.5 ? colors.critical : voltage < 11.5 ? colors.warning : colors.primary,
                }]}>
                  <Text style={styles.metricBadgeText}>{voltage}V</Text>
                </View>
              </View>
              <Text style={styles.metricLabel}>Battery</Text>
            </View>

            {/* Engine Load */}
            <View style={styles.statusMetric}>
              <View style={[styles.metricCircle, {
                borderColor: engineLoad > 95 ? colors.critical : engineLoad > 80 ? colors.warning : colors.border,
              }]}>
                <Text style={styles.metricEmoji}>⚙️</Text>
                <View style={[styles.metricBadge, {
                  backgroundColor: engineLoad > 95 ? colors.critical : engineLoad > 80 ? colors.warning : colors.primary,
                }]}>
                  <Text style={styles.metricBadgeText}>{engineLoad}%</Text>
                </View>
              </View>
              <Text style={styles.metricLabel}>Load</Text>
            </View>
          </View>

          {/* Overall health summary pill */}
          <View style={[styles.healthSummaryPill, {
            borderColor: criticalCnt > 0 ? colors.critical : warningCnt > 0 ? colors.warning : colors.primary,
            backgroundColor: criticalCnt > 0 ? '#FF525210' : warningCnt > 0 ? '#FFA72610' : '#00E5CC10',
          }]}>
            <Text style={[styles.healthSummaryText, {
              color: criticalCnt > 0 ? colors.critical : warningCnt > 0 ? colors.warning : colors.primary,
            }]}>
              {criticalCnt > 0
                ? `🚨 ${criticalCnt} Critical Issue${criticalCnt > 1 ? 's' : ''} Detected`
                : warningCnt > 0
                  ? `⚠️ ${warningCnt} Warning${warningCnt > 1 ? 's' : ''} — Attention Required`
                  : '✅ All Systems Operating Normally'}
            </Text>
          </View>
        </View>

        {/* ── Live Sensor Gauges ─────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Live Sensor Data</Text>
            {liveData && (
              <View style={styles.liveBadge}>
                <Text style={styles.liveBadgeText}>● LIVE</Text>
              </View>
            )}
          </View>
          <View style={styles.gaugesGrid}>
            <CircularGauge value={speed} maxValue={220} label="Speed" unit="km/h" color={colors.gaugeSpeed} />
            {/* EV mode: show motor speed instead of engine RPM */}
            {isEVMode
              ? <CircularGauge
                  value={Math.round((liveData?.mg2Speed ?? liveData?.motorSpeed ?? 0) / 1000 * 10) / 10}
                  maxValue={15} label="Motor" unit="×1000" color="#00E676" />
              : isTransition
                ? <CircularGauge value={rpmK} maxValue={8} label="RPM" unit="×1000" color="#40C4FF" />
                : <CircularGauge value={rpmK} maxValue={8} label="Engine RPM" unit="×1000" color={colors.gaugeRPM} />
            }
            <CircularGauge value={engineTemp} maxValue={130} label="Coolant Temp" unit="°C"   color={engineTemp > 100 ? colors.critical : engineTemp > 90 ? colors.warning : colors.gaugeTemp} />
            <CircularGauge value={throttle}   maxValue={100} label="Throttle"    unit="%"     color={colors.gaugeThrottle} />
          </View>
        </View>

        {/* ── Extended PID Metrics (BLE only) ───────────────── */}
        {liveData && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Extended Telemetry</Text>
            <View style={styles.pidGrid}>
              <View style={styles.pidCell}>
                <Text style={[styles.pidVal, { color: engineLoad > 80 ? colors.warning : colors.primary }]}>
                  {engineLoad}%
                </Text>
                <Text style={styles.pidLbl}>Engine Load</Text>
              </View>
              <View style={styles.pidCell}>
                <Text style={[styles.pidVal, { color: intakeTemp > 50 ? colors.warning : colors.primary }]}>
                  {intakeTemp}°C
                </Text>
                <Text style={styles.pidLbl}>Intake Temp</Text>
              </View>
              <View style={styles.pidCell}>
                <Text style={styles.pidVal}>{maf} g/s</Text>
                <Text style={styles.pidLbl}>MAF Flow</Text>
              </View>
              <View style={styles.pidCell}>
                <Text style={styles.pidVal}>{fuelPres} kPa</Text>
                <Text style={styles.pidLbl}>Fuel Pressure</Text>
              </View>
            </View>

            {/* Mini bar charts for load and throttle */}
            <View style={{ marginTop: 14, gap: 8 }}>
              {[
                { label: 'Engine Load', value: engineLoad, max: 100, color: engineLoad > 80 ? colors.critical : colors.primary },
                { label: 'Throttle',    value: throttle,   max: 100, color: colors.gaugeThrottle },
                { label: 'Fuel Level',  value: fuelLevel,  max: 100, color: fuelLevel < 20 ? colors.warning : colors.healthy },
              ].map(bar => (
                <View key={bar.label} style={styles.barRow}>
                  <Text style={styles.barLabel}>{bar.label}</Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, {
                      width: `${Math.min(bar.value, 100)}%`,
                      backgroundColor: bar.color,
                    }]} />
                  </View>
                  <Text style={[styles.barValue, { color: bar.color }]}>{bar.value}%</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Component Health ───────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Component Health</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Diagnostics')}>
              <Text style={styles.viewAll}>View DTCs</Text>
            </TouchableOpacity>
          </View>

          {componentHealth.map(item => <ComponentRow key={item.id} item={item} />)}

          <View style={styles.summaryRow}>
            {[
              { label: 'Healthy',  count: healthyCnt,  color: colors.healthy },
              { label: 'Warning',  count: warningCnt,  color: colors.warning },
              { label: 'Critical', count: criticalCnt, color: colors.critical },
            ].map(s => (
              <View key={s.label} style={styles.summaryItem}>
                <Text style={[styles.summaryCount, { color: s.color }]}>{s.count}</Text>
                <Text style={styles.summaryLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════
const createStyles = (colors: typeof darkColors) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgPrimary },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { fontSize: 14, color: colors.textSecondary },

  // OBD Banner
  obdBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, gap: 10 },
  obdPulse: { width: 10, height: 10, borderRadius: 5 },
  obdStatusText: { fontSize: 13, fontWeight: '700' },
  obdMetaText: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  livePill: { backgroundColor: '#00E67620', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: colors.healthy },
  livePillText: { fontSize: 10, fontWeight: '800', color: colors.healthy },

  // Alerts
  alertsSection: { marginBottom: 12 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  dismissAll: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  alertCard: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, gap: 10 },
  alertIcon: { fontSize: 20, marginTop: 1 },
  alertTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  alertTitle: { fontSize: 13, fontWeight: '700', flex: 1 },
  alertValue: { fontSize: 13, fontWeight: '800', marginLeft: 8 },
  alertAdvice: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  alertDismiss: { fontSize: 14, color: colors.textMuted, paddingLeft: 6 },

  // DTC banner
  dtcAlertBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FF525210', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#FF525440', gap: 10 },
  dtcAlertIcon: { fontSize: 18 },
  dtcAlertTitle: { fontSize: 13, fontWeight: '700', color: colors.critical },
  dtcAlertCodes: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  dtcAlertArrow: { fontSize: 22, color: colors.critical },

  // Cards
  card: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  aiBadge: { backgroundColor: colors.primary + '18', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: colors.primary + '50' },
  aiBadgeText: { fontSize: 11, fontWeight: '700', color: colors.primary },
  liveBadge: { backgroundColor: '#00E67618', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: colors.healthy },
  liveBadgeText: { fontSize: 10, fontWeight: '800', color: colors.healthy },
  viewAll: { fontSize: 12, color: colors.primary, fontWeight: '600' },

  // Vehicle Status
  statusRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start', marginBottom: 14 },
  statusMetric: { alignItems: 'center' },
  metricCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#111827', borderWidth: 5, alignItems: 'center', justifyContent: 'center' },
  metricEmoji: { fontSize: 24 },
  metricBadge: { position: 'absolute', bottom: -5, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  metricBadgeText: { fontSize: 9, fontWeight: '800', color: '#0A0E1A' },
  metricLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 9, textAlign: 'center' },
  circleCenter: { position: 'absolute', top: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  healthVal: { fontSize: 17, fontWeight: '800' },
  healthPct: { fontSize: 10, color: colors.textSecondary },
  healthSummaryPill: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  healthSummaryText: { fontSize: 13, fontWeight: '700' },

  // Gauges
  gaugesGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', rowGap: 14 },

  // Extended PID grid
  pidGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pidCell: { flex: 1, minWidth: '44%', backgroundColor: colors.bgSecondary, borderRadius: 10, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  pidVal: { fontSize: 18, fontWeight: '800', color: colors.primary },
  pidLbl: { fontSize: 10, color: colors.textSecondary, marginTop: 3 },

  // Progress bars
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { fontSize: 11, color: colors.textSecondary, width: 80 },
  barTrack: { flex: 1, height: 6, backgroundColor: '#1E2D45', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  barValue: { fontSize: 11, fontWeight: '700', width: 36, textAlign: 'right' },

  // Component health
  compRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1A2540', gap: 10 },
  compIconBox: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  compIcon: { fontSize: 17 },
  compName: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  compDetail: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  compBadge: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  compBadgeText: { fontSize: 11, fontWeight: '700' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#0D1525', borderRadius: 10, paddingVertical: 12, marginTop: 10 },
  summaryItem: { alignItems: 'center' },
  summaryCount: { fontSize: 20, fontWeight: '800' },
  summaryLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },

});

export default DashboardScreen;
