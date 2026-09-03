import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { darkColors as colors } from '../../theme/colors';
import TopBar from '../../components/common/TopBar';
import { getDTCCodes, getUserId, saveDTC, clearDTCCodes } from '../../services/api';
import OBDService from '../../services/OBDService';
import AIService, { InferenceOutput } from '../../services/ai.service';
import { DTC_DETAILS } from '../../utils/obdCodes';
import { useOBD } from '../../context/OBDContext';
import NotificationService from '../../services/NotificationService';

interface Props { navigation: any; }

// ── UI severity mapping (AI labels → display config) ─────────────────────
const severityConfig: Record<string, { color: string; bg: string; icon: string; border: string }> = {
  healthy:      { color: colors.healthy,  bg: '#00E67615', icon: 'check-circle-outline',  border: colors.healthy  },
  warning:      { color: colors.warning,  bg: '#FFA72615', icon: 'alert-circle-outline',  border: colors.warning  },
  critical:     { color: colors.critical, bg: '#FF525215', icon: 'alert-octagon-outline', border: colors.critical },
  low:          { color: colors.info,     bg: '#40C4FF15', icon: 'information-outline',   border: colors.info     },
  LOW:          { color: colors.info,     bg: '#40C4FF15', icon: 'information-outline',   border: colors.info     },
  MEDIUM:       { color: colors.warning,  bg: '#FFA72615', icon: 'alert-circle-outline',  border: colors.warning  },
  HIGH:         { color: colors.critical, bg: '#FF525215', icon: 'alert-octagon-outline', border: colors.critical },
  VERY_CRITICAL:{ color: '#FF0000',       bg: '#FF000020', icon: 'alert-octagon',         border: '#FF0000'        },
};

const getSeverityCfg = (sev: string) =>
  severityConfig[sev] ?? severityConfig.warning;

// System category icon names (MaterialCommunityIcons)
const systemIcons: Record<string, string> = {
  engine: 'engine-outline', emissions: 'air-filter', fuel: 'fuel',
  ignition: 'lightning-bolt-outline', transmission: 'cog-outline',
  abs_brakes: 'car-brake-abs', suspension: 'car-cog', steering: 'steering',
  body: 'car-outline', airbag: 'shield-outline', climate: 'thermometer',
  lighting: 'lightbulb-outline', security: 'lock-outline',
  network: 'access-point', hybrid: 'ev-station', unknown: 'help-circle-outline',
};

// Health score color thresholds
const healthColor = (score: number) =>
  score >= 80 ? colors.healthy :
  score >= 60 ? '#A8E063' :
  score >= 40 ? colors.warning :
  colors.critical;

const DiagnosticsScreen: React.FC<Props> = ({ navigation }) => {
  const { colors: themeColors } = useTheme();
  const { isConnected, vehicleId, liveData } = useOBD();
  const effectiveVehicleId = vehicleId || getUserId();

  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  const [dtcData, setDtcData] = useState<any>(null);
  const [aiResult, setAiResult] = useState<InferenceOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [expandedDTC, setExpandedDTC] = useState<string | null>(null);

  useEffect(() => {
    fetchDiagnostics();
  }, [effectiveVehicleId]);

  const fetchDiagnostics = useCallback(async (): Promise<any> => {
    try {
      const res = await getDTCCodes(effectiveVehicleId);
      setDtcData(res);
      return res;
    } catch {
      const fallback = {
        details: [],
        severity: 'healthy',
        components: [
          { name: 'Engine', status: 'healthy' },
          { name: 'Transmission', status: 'healthy' },
          { name: 'Brakes', status: 'healthy' },
          { name: 'Tires', status: 'healthy' },
        ],
      };
      setDtcData(fallback);
      return fallback;
    } finally {
      setLoading(false);
    }
  }, [effectiveVehicleId]);

  // Refs so runAIDiagnostics never has to be recreated when liveData/dtcData update.
  const liveDataRef = useRef(liveData);
  liveDataRef.current = liveData;
  const dtcDataRef = useRef(dtcData);
  dtcDataRef.current = dtcData;

  // ── AI Inference ──────────────────────────────────────────────────────────
  const runAIDiagnostics = useCallback(async (rawCodes: string[], freshDetails?: any[]) => {
    setAiRunning(true);
    try {
      const backendDetails: any[] = freshDetails ?? dtcDataRef.current?.details ?? [];
      const dtcInputs = rawCodes.map(code => {
        const fromBackend = backendDetails.find((d: any) => d.code === code);
        const local = DTC_DETAILS[code.toUpperCase()];
        return {
          dtc_code:        code,
          description:     fromBackend?.description     || local?.description     || code,
          possible_causes: fromBackend?.possible_causes || local?.possible_causes || '',
        };
      });

      const ld = liveDataRef.current;
      const sensors = ld
        ? AIService.mapOBDToSensors({
            rpm:          ld.rpm,
            engine_temp:  ld.engineTemp,
            maf:          ld.maf,
            throttle:     ld.throttle,
            voltage:      ld.voltage,
            intake_temp:  ld.intakeTemp,
            speed:        ld.speed,
          })
        : {};

      const result = await AIService.runInference({
        session_id:  `scan-${Date.now()}`,
        dtcs:        dtcInputs,
        sensors,
        mileage_km:  80_000,
        location:    { lat: 0, lng: 0 },
      });

      setAiResult(result);
      const highest = result.severity_summary?.highest_severity;
      if (highest === 'VERY_CRITICAL' || highest === 'HIGH') {
        for (const dtc of result.dtc_analysis ?? []) {
          if (dtc.severity_label === 'VERY_CRITICAL' || dtc.severity_label === 'HIGH') {
            await NotificationService.notifyFault(
              dtc.dtc_code,
              dtc.description ?? '',
              dtc.severity_label as any,
            );
          }
        }
      }
    } catch (err) {
      console.warn('[AI] Inference error:', err);
    } finally {
      setAiRunning(false);
    }
  }, []);

  // ── Clear DTCs from backend + optionally from vehicle ECU ────────────────
  const handleClearDTCsFromDB = useCallback(async () => {
    setClearing(true);
    try {
      await clearDTCCodes(effectiveVehicleId);
      setDtcData({ details: [], severity: 'healthy', components: [] });
      setAiResult(null);
    } catch {
      Alert.alert('Error', 'Failed to clear fault codes. Try again.');
    } finally {
      setClearing(false);
    }
  }, [effectiveVehicleId]);

  const handleClearDTCs = useCallback(() => {
    const canClearVehicle = isConnected;
    Alert.alert(
      'Clear Fault Codes',
      canClearVehicle
        ? 'Choose what to clear:\n\n• Clear Vehicle — sends Mode 04 to your car ECU (turns off MIL lamp)\n• Clear Records — removes codes saved in this app only'
        : 'Remove the stored fault codes from this app. To also clear them from your car ECU, connect OBD first.',
      [
        { text: 'Cancel', style: 'cancel' },
        ...(canClearVehicle ? [{
          text: 'Clear Vehicle + App',
          style: 'destructive' as const,
          onPress: async () => {
            const ok = await OBDService.clearDTCCodes();
            await handleClearDTCsFromDB();
            if (!ok) Alert.alert('Note', 'App records cleared. Vehicle ECU clear may not have completed — try again while connected.');
          },
        }] : []),
        {
          text: canClearVehicle ? 'Clear App Only' : 'Clear Records',
          onPress: handleClearDTCsFromDB,
        },
      ],
    );
  }, [isConnected, handleClearDTCsFromDB]);

  // Sort once per AI result change, not on every render.
  const sortedSensors = useMemo(
    () => aiResult
      ? Object.entries(aiResult.sensor_analysis).sort(([, a], [, b]) => b.anomaly_score - a.anomaly_score)
      : [],
    [aiResult],
  );

  // ── Scan handler ──────────────────────────────────────────────────────────
  const handleScan = async () => {
    if (!isConnected) {
      Alert.alert(
        'OBD Not Connected',
        'Connect to ELM327 adapter first to scan for fault codes.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Connect OBD', onPress: () => navigation.navigate('OBDConnection') },
        ]
      );
      return;
    }
    setScanning(true);
    try {
      const codes = await OBDService.readDTCCodes();
      if (codes.length === 0) {
        // No faults — clear any stale AI result and show clean state.
        // Running AI sensor analysis on a parked/idle car produces false positives
        // because the anomaly model is calibrated for steady driving conditions.
        setAiResult(null);
        Alert.alert('✅ Scan Complete', 'No fault codes detected. Vehicle systems are operating normally.');
      } else {
        Alert.alert('⚠️ Scan Complete', `Found ${codes.length} fault code(s): ${codes.join(', ')}`);
        await saveDTC(effectiveVehicleId, codes).catch(() => {});
        const freshData = await fetchDiagnostics();
        await runAIDiagnostics(codes, freshData?.details);
        await NotificationService.notifyMultipleFaults(codes.length, 'HIGH');
      }
    } catch {
      Alert.alert('Scan Error', 'Failed to read DTC codes from vehicle.');
    } finally {
      setScanning(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <TopBar />
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading Diagnostics…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Determine what to display ─────────────────────────────────────────────
  const aiDTCs   = aiResult?.dtc_analysis ?? [];
  const backDTCs = dtcData?.details ?? [];

  const aiToDisplaySev = (label: string) => {
    if (label === 'VERY_CRITICAL' || label === 'HIGH') return 'critical';
    if (label === 'MEDIUM') return 'warning';
    return 'low';
  };

  const overallSeverity: string = aiResult
    ? aiToDisplaySev(aiResult.severity_summary.highest_severity)
    : (dtcData?.severity ?? 'healthy');
  const overallCfg = getSeverityCfg(overallSeverity);

  const activeCodeCount = aiDTCs.length || backDTCs.length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bgPrimary} />
      <TopBar />
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Diagnostics</Text>
          <Text style={styles.pageSubtitle}>Real-time DTC codes + on-device AI analysis</Text>
        </View>

        {/* Scan + Clear row */}
        <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.scanBtn, { flex: 1 }]} onPress={handleScan} disabled={scanning || aiRunning || clearing} activeOpacity={0.85}>
            {(scanning || aiRunning)
              ? <ActivityIndicator color="#0A0E1A" size="small" />
              : <Text style={styles.scanBtnText}>🔍  Scan Vehicle</Text>
            }
          </TouchableOpacity>
          <TouchableOpacity style={styles.clearBtn} onPress={handleClearDTCs} disabled={scanning || aiRunning || clearing} activeOpacity={0.85}>
            {clearing
              ? <ActivityIndicator color={colors.critical} size="small" />
              : <Text style={styles.clearBtnText}>🗑 Clear</Text>
            }
          </TouchableOpacity>
        </View>

        {/* OBD banner */}
        {!isConnected && (
          <TouchableOpacity style={styles.notConnectedBanner} onPress={() => navigation.navigate('OBDConnection')}>
            <Text style={styles.notConnectedText}>OBD-II not connected — showing last scan. Tap to connect.</Text>
          </TouchableOpacity>
        )}

        {/* AI running indicator */}
        {aiRunning && (
          <View style={styles.aiRunningBanner}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.aiRunningText}>  Running AI analysis on-device…</Text>
          </View>
        )}

        {/* AI Health Score Card */}
        {aiResult && (
          <View style={[styles.healthCard, { borderColor: healthColor(aiResult.health.score) }]}>
            <View style={styles.healthScoreCircle}>
              <Text style={[styles.healthScoreNum, { color: healthColor(aiResult.health.score) }]}>
                {Math.round(aiResult.health.score)}
              </Text>
              <Text style={styles.healthScoreLabel}>/100</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.healthTitle}>Vehicle Health</Text>
              <Text style={[styles.healthStatus, { color: healthColor(aiResult.health.score) }]}>
                {aiResult.health.status}
              </Text>
              <Text style={styles.healthSummary}>{aiResult.health.summary}</Text>
            </View>
          </View>
        )}

        {/* Overall Status */}
        <View style={[styles.statusCard, { borderColor: overallCfg.border }]}>
          <View style={[styles.statusIconBox, { backgroundColor: overallCfg.bg }]}>
            <Icon name={overallCfg.icon} size={26} color={overallCfg.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>Overall Status</Text>
            <Text style={[styles.statusValue, { color: overallCfg.color }]}>
              {aiResult
                ? aiResult.severity_summary.highest_severity.replace('_', ' ')
                : overallSeverity.toUpperCase()}
            </Text>
            {aiResult && (
              <Text style={styles.userAction}>{aiResult.severity_summary.user_action}</Text>
            )}
          </View>
          <View style={styles.dtcCountBox}>
            <Text style={[styles.dtcCount, { color: activeCodeCount > 0 ? colors.warning : colors.healthy }]}>
              {activeCodeCount}
            </Text>
            <Text style={styles.dtcCountLabel}>Codes</Text>
          </View>
        </View>

        {/* AI DTC Analysis (shown when AI result is available) */}
        {aiDTCs.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>AI Fault Analysis</Text>
              <View style={styles.aiBadge}><Text style={styles.aiBadgeText}>ON-DEVICE AI</Text></View>
            </View>
            {aiDTCs.map((dtc) => {
              const cfg = getSeverityCfg(dtc.severity_label);
              const key = dtc.dtc_code;
              const isExpanded = expandedDTC === key;
              const hasSteps = (dtc.repair_steps?.length ?? 0) > 0;
              return (
                <View key={dtc.dtc_code} style={[styles.dtcCard, { borderColor: cfg.border }]}>
                  <View style={styles.dtcTopRow}>
                    <View style={[styles.dtcCodeBox, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
                      <Text style={[styles.dtcCode, { color: cfg.color }]}>{dtc.dtc_code}</Text>
                    </View>
                    <View style={styles.dtcMeta}>
                      <View style={styles.dtcSystemRow}>
                        <Icon name={systemIcons[dtc.category] ?? 'help-circle-outline'} size={13} color={cfg.color} />
                        <Text style={styles.dtcSystem}>{dtc.category}</Text>
                      </View>
                      <View style={[styles.dtcSeverityBadge, { backgroundColor: cfg.bg }]}>
                        <Text style={[styles.dtcSeverityText, { color: cfg.color }]}>
                          {dtc.severity_label.replace('_', ' ')}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {dtc.description ? (
                    <Text style={styles.dtcDescription}>{dtc.description}</Text>
                  ) : null}
                  {dtc.possible_causes ? (
                    <Text style={styles.dtcCauses}>Causes: {dtc.possible_causes}</Text>
                  ) : null}
                  {dtc.severity_why ? (
                    <Text style={styles.dtcWhy}>⚠ {dtc.severity_why}</Text>
                  ) : null}
                  <View style={styles.dtcConfidenceRow}>
                    <Text style={styles.dtcConfidenceLabel}>Confidence</Text>
                    <View style={styles.dtcConfidenceBar}>
                      <View style={[styles.dtcConfidenceFill, {
                        width: `${Math.round(dtc.confidence * 100)}%` as any,
                        backgroundColor: cfg.color,
                      }]} />
                    </View>
                    <Text style={[styles.dtcConfidencePct, { color: cfg.color }]}>
                      {Math.round(dtc.confidence * 100)}%
                    </Text>
                  </View>
                  {hasSteps && (
                    <TouchableOpacity
                      style={styles.repairToggle}
                      onPress={() => setExpandedDTC(isExpanded ? null : key)}
                      activeOpacity={0.75}>
                      <Text style={styles.repairToggleText}>
                        Repair Steps  {isExpanded ? '▲' : '▼'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {isExpanded && hasSteps && (
                    <View style={styles.repairSteps}>
                      {dtc.repair_steps!.map((step, si) => (
                        <View key={si} style={styles.repairStepRow}>
                          <View style={[styles.repairStepNum, { backgroundColor: cfg.bg }]}>
                            <Text style={[styles.repairStepNumText, { color: cfg.color }]}>{si + 1}</Text>
                          </View>
                          <Text style={styles.repairStepText}>{step}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}

            {/* Find Workshop button — shown after AI scan with at least one fault */}
            <TouchableOpacity
              style={styles.workshopBtn}
              onPress={() => navigation.navigate('Workshop', { workshopQuery: aiResult?.workshop_query })}
              activeOpacity={0.85}>
              <Text style={styles.workshopBtnText}>Find Nearby Workshop</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Sensor Health (from AI) */}
        {aiResult && Object.keys(aiResult.sensor_analysis).length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Sensor Health</Text>
            </View>
            {sortedSensors.map(([ch, v]) => {
                const cfg = v.status === 'ABNORMAL' ? getSeverityCfg('critical')
                          : v.status === 'MARGINAL'  ? getSeverityCfg('warning')
                          : getSeverityCfg('healthy');
                return (
                  <View key={ch} style={[styles.sensorRow, { borderColor: cfg.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sensorName}>{ch.replace(/_/g, ' ').toUpperCase()}</Text>
                      <Text style={[styles.sensorStatus, { color: cfg.color }]}>{v.status}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[styles.sensorScore, { color: cfg.color }]}>
                        {Math.round(v.anomaly_score * 100)}%
                      </Text>
                      {v.days_to_alert !== null && (
                        <Text style={styles.sensorAlert}>Alert in {v.days_to_alert}d</Text>
                      )}
                      <Text style={styles.sensorTrend}>{v.trend}</Text>
                    </View>
                  </View>
                );
              })}
          </>
        )}

        {/* Fallback: backend DTC codes (when no AI result yet) */}
        {!aiResult && backDTCs.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Active Fault Codes</Text>
            {backDTCs.map((dtc: any) => {
              const cfg = getSeverityCfg(dtc.severity);
              return (
                <View key={dtc.code ?? dtc.id} style={[styles.dtcCard, { borderColor: cfg.border }]}>
                  <View style={styles.dtcTopRow}>
                    <View style={[styles.dtcCodeBox, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
                      <Text style={[styles.dtcCode, { color: cfg.color }]}>{dtc.code}</Text>
                    </View>
                    <View style={styles.dtcMeta}>
                      <View style={styles.dtcSystemRow}>
                        <Icon name={systemIcons[dtc.system?.toLowerCase()] ?? 'help-circle-outline'} size={13} color={cfg.color} />
                        <Text style={styles.dtcSystem}>{dtc.system}</Text>
                      </View>
                      <View style={[styles.dtcSeverityBadge, { backgroundColor: cfg.bg }]}>
                        <Text style={[styles.dtcSeverityText, { color: cfg.color }]}>
                          {dtc.severity?.charAt(0).toUpperCase() + dtc.severity?.slice(1)}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <Text style={styles.dtcDescription}>{dtc.description}</Text>
                  {dtc.timestamp && (
                    <Text style={styles.dtcTimestamp}>
                      Detected: {new Date(dtc.timestamp).toLocaleDateString()}
                    </Text>
                  )}
                </View>
              );
            })}
          </>
        )}

        {/* No codes */}
        {!aiResult && backDTCs.length === 0 && (
          <View style={styles.noDtcBox}>
            <Text style={styles.noDtcIcon}>✅</Text>
            <Text style={styles.noDtcText}>No Active Fault Codes</Text>
            <Text style={styles.noDtcSub}>Tap Scan Vehicle to run AI diagnostics</Text>
          </View>
        )}

        {aiResult && aiDTCs.length === 0 && (
          <View style={styles.noDtcBox}>
            <Text style={styles.noDtcIcon}>✅</Text>
            <Text style={styles.noDtcText}>No Faults Detected</Text>
            <Text style={styles.noDtcSub}>AI analysis found no active fault codes</Text>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

type StyleColors = typeof colors;
const createStyles = (colors: StyleColors) => StyleSheet.create({
  safeArea:             { flex: 1, backgroundColor: colors.bgPrimary },
  scrollView:           { flex: 1 },
  scrollContent:        { paddingHorizontal: 16, paddingTop: 8 },
  loadingBox:           { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText:          { fontSize: 14, color: colors.textSecondary },
  pageHeader:           { paddingVertical: 14 },
  pageTitle:            { fontSize: 26, fontWeight: '800', color: colors.textPrimary },
  pageSubtitle:         { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  actionRow:            { flexDirection: 'row', gap: 10, marginBottom: 14 },
  scanBtn:              { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 6 },
  scanBtnText:          { color: '#0A0E1A', fontSize: 15, fontWeight: '800' },
  clearBtn:             { backgroundColor: '#FF525218', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FF525240' },
  clearBtnText:         { color: colors.critical, fontSize: 13, fontWeight: '700' },
  notConnectedBanner:   { backgroundColor: '#FFA72615', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: colors.warning },
  notConnectedText:     { fontSize: 13, color: colors.warning, fontWeight: '500', textAlign: 'center' },
  aiRunningBanner:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#40C4FF10', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: colors.info },
  aiRunningText:        { fontSize: 13, color: colors.info, fontWeight: '500' },
  // AI Health Card
  healthCard:           { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 2 },
  healthScoreCircle:    { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', alignContent: 'center' },
  healthScoreNum:       { fontSize: 28, fontWeight: '900' },
  healthScoreLabel:     { fontSize: 12, color: colors.textSecondary, alignSelf: 'flex-end', paddingBottom: 4 },
  healthTitle:          { fontSize: 13, color: colors.textSecondary },
  healthStatus:         { fontSize: 18, fontWeight: '800', marginTop: 2 },
  healthSummary:        { fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 17 },
  // Status Card
  statusCard:           { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1.5, gap: 14 },
  statusIconBox:        { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  statusTitle:          { fontSize: 13, color: colors.textSecondary },
  statusValue:          { fontSize: 20, fontWeight: '800', marginTop: 2 },
  userAction:           { fontSize: 12, color: colors.textSecondary, marginTop: 3, lineHeight: 16 },
  dtcCountBox:          { alignItems: 'center', backgroundColor: colors.bgSecondary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  dtcCount:             { fontSize: 24, fontWeight: '800' },
  dtcCountLabel:        { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  // Section headers
  sectionHeader:        { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  sectionTitle:         { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
  aiBadge:              { backgroundColor: colors.primary + '20', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: colors.primary },
  aiBadgeText:          { fontSize: 10, fontWeight: '800', color: colors.primary, letterSpacing: 0.5 },
  // DTC Cards
  dtcCard:              { backgroundColor: colors.bgCard, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1.5 },
  dtcTopRow:            { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 12 },
  dtcCodeBox:           { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1.5 },
  dtcCode:              { fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  dtcMeta:              { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dtcSystemRow:         { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dtcSystem:            { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  dtcSeverityBadge:     { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  dtcSeverityText:      { fontSize: 12, fontWeight: '700' },
  dtcDescription:       { fontSize: 13, color: colors.textPrimary, fontWeight: '500', lineHeight: 20 },
  dtcWhy:               { fontSize: 12, color: colors.warning, marginTop: 6, fontStyle: 'italic' },
  dtcTimestamp:         { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  // Confidence bar
  dtcConfidenceRow:     { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
  dtcConfidenceLabel:   { fontSize: 11, color: colors.textSecondary, width: 70 },
  dtcConfidenceBar:     { flex: 1, height: 6, backgroundColor: colors.bgSecondary, borderRadius: 3, overflow: 'hidden' },
  dtcConfidenceFill:    { height: 6, borderRadius: 3 },
  dtcConfidencePct:     { fontSize: 12, fontWeight: '700', width: 36, textAlign: 'right' },
  // Sensor rows
  sensorRow:            { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1 },
  sensorName:           { fontSize: 12, fontWeight: '700', color: colors.textPrimary, letterSpacing: 0.3 },
  sensorStatus:         { fontSize: 13, fontWeight: '600', marginTop: 2 },
  sensorScore:          { fontSize: 16, fontWeight: '800' },
  sensorAlert:          { fontSize: 11, color: colors.warning, marginTop: 2 },
  sensorTrend:          { fontSize: 11, color: colors.textMuted, textTransform: 'capitalize' },
  // Empty state
  noDtcBox:             { alignItems: 'center', paddingVertical: 32, backgroundColor: colors.bgCard, borderRadius: 16, marginBottom: 20, borderWidth: 1, borderColor: colors.border },
  noDtcIcon:            { fontSize: 48, marginBottom: 12 },
  noDtcText:            { fontSize: 17, fontWeight: '700', color: colors.healthy, marginBottom: 6 },
  noDtcSub:             { fontSize: 13, color: colors.textSecondary },
  // Possible causes
  dtcCauses:            { fontSize: 12, color: colors.textSecondary, marginTop: 5, fontStyle: 'italic', lineHeight: 17 },
  // Repair steps accordion
  repairToggle:         { marginTop: 10, flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.border },
  repairToggleText:     { fontSize: 13, fontWeight: '700', color: colors.primary },
  repairSteps:          { marginTop: 8, gap: 8 },
  repairStepRow:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  repairStepNum:        { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  repairStepNumText:    { fontSize: 11, fontWeight: '800' },
  repairStepText:       { flex: 1, fontSize: 13, color: colors.textPrimary, lineHeight: 19 },
  // Find Workshop button
  workshopBtn:          { backgroundColor: '#1A2340', borderWidth: 1.5, borderColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16, marginBottom: 4 },
  workshopBtnText:      { fontSize: 15, fontWeight: '800', color: colors.primary },
});

export default DiagnosticsScreen;
