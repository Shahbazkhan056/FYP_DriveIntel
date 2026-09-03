import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  SafeAreaView, StatusBar, ActivityIndicator, Alert,
  RefreshControl, TextInput, Modal,
} from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { darkColors } from '../../theme/colors';
import TopBar from '../../components/common/TopBar';
import NotificationService from '../../services/NotificationService';
import {
  getMaintenance, getUserId,
  updateOdometer, logMaintenanceService,
} from '../../services/api';
import { useOBD } from '../../context/OBDContext';
import OBDService from '../../services/OBDService';

interface Props { navigation: any; }

interface UpcomingItem {
  service: string;
  interval_km: number;
  last_done_km: number;
  due_at_km: number;
  remaining_km: number;
  progress: number;
  dueLabel: string;
}

interface HistoryItem {
  id: string;
  service: string;
  date: string;
  done_at_km: number;
  cost: number;
  notes: string;
}

interface MaintenanceData {
  odometer_km: number;
  upcoming: UpcomingItem[];
  history: HistoryItem[];
  totalSpent: number;
  totalServices: number;
}

const MAINTENANCE_SERVICES = [
  'Oil Change', 'Tire Rotation', 'Air Filter', 'Brake Inspection',
  'Spark Plugs', 'Battery Check', 'Coolant Flush', 'Transmission Fluid',
  'Timing Belt / Chain', 'Major Service',
];

const MaintenanceScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { vehicleId, isConnected, ecuOdometerKm } = useOBD();
  const effectiveVehicleId = vehicleId || getUserId();

  const styles = useMemo(() => createStyles(colors), [colors]);

  const [data, setData] = useState<MaintenanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [odometerInput, setOdometerInput] = useState('');
  const [showOdometerModal, setShowOdometerModal] = useState(false);
  const [savingOdometer, setSavingOdometer] = useState(false);
  const [syncingECU, setSyncingECU] = useState(false);
  const [showSetupModal, setShowSetupModal]     = useState(false);
  const [setupInputs, setSetupInputs]           = useState<Record<string, string>>({});
  const [savingSetup, setSavingSetup]           = useState(false);

  const fetchMaintenance = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await getMaintenance(effectiveVehicleId);
      setData(res);
      // Notify for overdue/near-due items on first load
      if (!silent && res?.upcoming?.length) {
        await NotificationService.checkMaintenanceSchedule(
          res.upcoming.map((u: UpcomingItem) => ({ service: u.service, remaining_km: u.remaining_km })),
        );
      }
    } catch {
      Alert.alert('Connection Error', 'Could not load maintenance data. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [effectiveVehicleId]);

  useEffect(() => {
    fetchMaintenance();
  }, [fetchMaintenance]);

  // Auto-apply ECU odometer when OBD connects and no odometer has been set yet.
  useEffect(() => {
    if (ecuOdometerKm !== null && ecuOdometerKm >= 0 && data !== null && data.odometer_km === 0) {
      updateOdometer(effectiveVehicleId, ecuOdometerKm)
        .then(() => fetchMaintenance(true))
        .catch(() => {});
    }
  }, [ecuOdometerKm, data?.odometer_km, effectiveVehicleId, fetchMaintenance]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchMaintenance(true);
  }, [fetchMaintenance]);

  const handleUpdateOdometer = async () => {
    const km = parseInt(odometerInput, 10);
    if (isNaN(km) || km < 0) {
      Alert.alert('Invalid Value', 'Please enter a valid odometer reading in km.');
      return;
    }
    const isFirstTime = (data?.odometer_km ?? 0) === 0 && (data?.history?.length ?? 0) === 0;
    setSavingOdometer(true);
    try {
      await updateOdometer(effectiveVehicleId, km);
      setShowOdometerModal(false);
      setOdometerInput('');
      await fetchMaintenance(true);
      if (isFirstTime) setTimeout(() => setShowSetupModal(true), 400);
    } catch {
      Alert.alert('Error', 'Failed to update odometer. Try again.');
    } finally {
      setSavingOdometer(false);
    }
  };

  const handleSyncECU = async () => {
    setSyncingECU(true);
    const isFirstTime = (data?.odometer_km ?? 0) === 0 && (data?.history?.length ?? 0) === 0;
    try {
      const km = await OBDService.readOdometer();
      if (km >= 0) {  // -1 means unsupported; 0 is a valid reading (brand-new vehicle)
        await updateOdometer(effectiveVehicleId, km);
        await fetchMaintenance(true);
        Alert.alert('ECU Sync Complete', `Odometer updated to ${km.toLocaleString()} km from vehicle ECU.`);
        if (isFirstTime) setTimeout(() => setShowSetupModal(true), 400);
      } else {
        Alert.alert(
          'Not Supported',
          'Your vehicle ECU does not broadcast the odometer PID (0xA6). Please enter the reading manually.',
        );
      }
    } catch {
      Alert.alert('Sync Failed', 'Could not read odometer from ECU. Try again or enter manually.');
    } finally {
      setSyncingECU(false);
    }
  };

  const handleLogService = (item: UpcomingItem) => {
    let costInput = '';
    Alert.alert(
      `Log Service: ${item.service}`,
      `Current odometer: ${(data?.odometer_km ?? 0).toLocaleString()} km\nThis records the service as done at your current odometer reading.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log as Done',
          onPress: () => {
            Alert.prompt(
              'Service Cost (optional)',
              'Enter the cost of this service (0 if free):',
              [
                { text: 'Skip', onPress: () => submitLog(item, 0, '') },
                {
                  text: 'Save',
                  onPress: (value) => {
                    const cost = parseFloat(value ?? '0') || 0;
                    submitLog(item, cost, '');
                  },
                },
              ],
              'plain-text',
              '0',
              'numeric',
            );
          },
        },
      ],
    );
  };

  const submitLog = async (item: UpcomingItem, cost: number, notes: string) => {
    const currentKm = data?.odometer_km ?? 0;
    if (currentKm === 0) {
      Alert.alert(
        'Odometer Required',
        'Please set your current odometer reading first before logging a service.',
        [{ text: 'Set Odometer', onPress: () => setShowOdometerModal(true) }],
      );
      return;
    }
    try {
      await logMaintenanceService(effectiveVehicleId, item.service, currentKm, cost, notes);
      await fetchMaintenance(true);
      Alert.alert('Service Logged', `${item.service} recorded at ${currentKm.toLocaleString()} km.`);
    } catch {
      Alert.alert('Error', 'Failed to log service. Try again.');
    }
  };

  const saveSetupHistory = async () => {
    const entries = MAINTENANCE_SERVICES
      .map(s => ({ service: s, km: parseInt(setupInputs[s] ?? '', 10) }))
      .filter(e => !isNaN(e.km) && e.km >= 0);
    if (entries.length === 0) {
      setShowSetupModal(false);
      return;
    }
    setSavingSetup(true);
    try {
      await Promise.all(entries.map(e =>
        logMaintenanceService(effectiveVehicleId, e.service, e.km, 0, 'Initial history')
      ));
      setShowSetupModal(false);
      setSetupInputs({});
      await fetchMaintenance(true);
      Alert.alert('History Saved', `${entries.length} service record${entries.length > 1 ? 's' : ''} saved. Your maintenance schedule is now personalised.`);
    } catch {
      Alert.alert('Error', 'Failed to save service history. Try again.');
    } finally {
      setSavingSetup(false);
    }
  };

  const criticalItems = useMemo(() => data?.upcoming?.filter(i => i.progress >= 90) ?? [], [data]);
  const warningItems  = useMemo(() => data?.upcoming?.filter(i => i.progress >= 70 && i.progress < 90) ?? [], [data]);
  const odometerKm   = data?.odometer_km ?? 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <TopBar />
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading Maintenance...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bgPrimary} />
      <TopBar />
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Maintenance</Text>
          <Text style={styles.pageSubtitle}>Odometer-based service schedule</Text>
        </View>

        {/* Odometer card */}
        <TouchableOpacity
          style={styles.odometerCard}
          onPress={() => {
            const prefill = ecuOdometerKm ?? (odometerKm > 0 ? odometerKm : null);
            setOdometerInput(prefill ? String(prefill) : '');
            setShowOdometerModal(true);
          }}
          activeOpacity={0.8}
        >
          <View style={styles.odometerLeft}>
            <View style={styles.odometerIconBox}>
              <Text style={styles.odometerIconText}>km</Text>
            </View>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.odometerLabel}>Current Odometer</Text>
                {ecuOdometerKm != null && (
                  <View style={styles.ecuBadge}>
                    <Text style={styles.ecuBadgeText}>ECU</Text>
                  </View>
                )}
              </View>
              <Text style={styles.odometerValue}>
                {odometerKm > 0 ? `${odometerKm.toLocaleString()} km` : 'Tap to set'}
              </Text>
              {ecuOdometerKm != null && ecuOdometerKm !== odometerKm && (
                <Text style={styles.ecuSubtext}>ECU reads {ecuOdometerKm.toLocaleString()} km</Text>
              )}
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            {isConnected && (
              <TouchableOpacity
                style={[styles.ecuSyncBtn, syncingECU && { opacity: 0.6 }]}
                onPress={handleSyncECU}
                disabled={syncingECU}
                activeOpacity={0.8}
              >
                {syncingECU
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Text style={styles.ecuSyncText}>ECU Sync</Text>
                }
              </TouchableOpacity>
            )}
            <View style={styles.editBadge}>
              <Text style={styles.editBadgeText}>Update</Text>
            </View>
          </View>
        </TouchableOpacity>

        {odometerKm === 0 && (
          <View style={styles.noBanner}>
            <Text style={styles.noBannerText}>
              Set your odometer reading to get accurate maintenance alerts
            </Text>
          </View>
        )}

        {/* Setup History prompt — shown when odometer is set but no history logged */}
        {odometerKm > 0 && (data?.history?.length ?? 0) === 0 && (
          <TouchableOpacity
            style={styles.setupBanner}
            onPress={() => setShowSetupModal(true)}
            activeOpacity={0.85}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.setupBannerTitle}>Enter Service History</Text>
              <Text style={styles.setupBannerSub}>
                Record your past services so DriveIntel can predict the exact due dates
              </Text>
            </View>
            <Text style={styles.setupBannerArrow}>›</Text>
          </TouchableOpacity>
        )}

        {/* Critical alerts */}
        {criticalItems.map((item) => (
          <TouchableOpacity
            key={`crit-${item.service}`}
            style={[styles.alertBox, { borderColor: colors.critical }]}
            onPress={() => navigation.navigate('Workshop')}
            activeOpacity={0.85}
          >
            <View style={[styles.alertDot, { backgroundColor: colors.critical }]} />
            <View style={styles.alertText}>
              <Text style={[styles.alertTitle, { color: colors.critical }]}>
                {item.service} — {item.dueLabel}
              </Text>
              <Text style={styles.alertSub}>
                {item.dueLabel === 'OVERDUE'
                  ? `Overdue by ${(item.last_done_km + item.interval_km < odometerKm
                      ? odometerKm - (item.last_done_km + item.interval_km)
                      : 0).toLocaleString()} km`
                  : `Due at ${item.due_at_km.toLocaleString()} km`}
              </Text>
            </View>
            <View style={[styles.alertBtn, { backgroundColor: colors.critical }]}>
              <Text style={styles.alertBtnText}>Book</Text>
            </View>
          </TouchableOpacity>
        ))}

        {warningItems.map((item) => (
          <TouchableOpacity
            key={`warn-${item.service}`}
            style={[styles.alertBox, { borderColor: colors.warning }]}
            onPress={() => navigation.navigate('Workshop')}
            activeOpacity={0.85}
          >
            <View style={[styles.alertDot, { backgroundColor: colors.warning }]} />
            <View style={styles.alertText}>
              <Text style={[styles.alertTitle, { color: colors.warning }]}>
                {item.service} — {item.dueLabel}
              </Text>
              <Text style={styles.alertSub}>Due at {item.due_at_km.toLocaleString()} km</Text>
            </View>
            <View style={[styles.alertBtn, { backgroundColor: colors.warning }]}>
              <Text style={styles.alertBtnText}>Book</Text>
            </View>
          </TouchableOpacity>
        ))}

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={[styles.statNum, { color: colors.primary }]}>${data?.totalSpent ?? 0}</Text>
            <Text style={styles.statLbl}>Total Spent</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statNum, { color: colors.healthy }]}>{data?.totalServices ?? 0}</Text>
            <Text style={styles.statLbl}>Services Done</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statNum, { color: colors.warning }]}>{criticalItems.length + warningItems.length}</Text>
            <Text style={styles.statLbl}>Need Attention</Text>
          </View>
        </View>

        {/* Upcoming Maintenance */}
        <Text style={styles.sectionTitle}>Service Schedule</Text>
        {data?.upcoming?.map((item) => {
          const isOverdue  = item.dueLabel === 'OVERDUE';
          const isCritical = item.progress >= 90;
          const isWarning  = item.progress >= 70 && !isCritical;
          const barColor   = isOverdue || isCritical ? colors.critical
                           : isWarning               ? colors.warning
                           :                           colors.healthy;

          return (
            <View key={item.service} style={[styles.card, isOverdue && styles.cardOverdue]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardLeft}>
                  <View style={[styles.serviceInitial, { backgroundColor: barColor + '20', borderColor: barColor + '60' }]}>
                    <Text style={[styles.serviceInitialText, { color: barColor }]}>{item.service.charAt(0)}</Text>
                  </View>
                  <View>
                    <Text style={styles.serviceName}>{item.service}</Text>
                    <Text style={styles.serviceInterval}>Every {item.interval_km.toLocaleString()} km</Text>
                  </View>
                </View>
                <View style={[styles.progressBadge, {
                  backgroundColor: isOverdue || isCritical ? '#FF525220'
                                 : isWarning               ? '#FFA72620'
                                 :                           '#00E67620',
                }]}>
                  <Text style={[styles.progressText, { color: barColor }]}>
                    {isOverdue ? 'OVERDUE' : `${item.progress}%`}
                  </Text>
                </View>
              </View>

              <View style={styles.kmRow}>
                <Text style={styles.kmLabel}>
                  Last done: {item.last_done_km > 0 ? `${item.last_done_km.toLocaleString()} km` : 'Never'}
                </Text>
                <Text style={[styles.kmDue, { color: barColor }]}>
                  {isOverdue ? 'OVERDUE' : item.dueLabel}
                </Text>
              </View>

              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, {
                  width: `${item.progress}%` as any,
                  backgroundColor: barColor,
                }]} />
              </View>

              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.logBtn}
                  onPress={() => handleLogService(item)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.logBtnText}>Log Done</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.bookBtn}
                  onPress={() => navigation.navigate('Workshop')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.bookBtnText}>Workshop</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {/* Service History */}
        <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Service History</Text>
        {(data?.history?.length ?? 0) > 0 ? (
          data!.history.map((item) => (
            <View key={item.id} style={styles.historyRow}>
              <View style={styles.historyIcon}>
                <Text style={styles.historyCheckmark}>✓</Text>
              </View>
              <View style={styles.historyMid}>
                <Text style={styles.historyService}>{item.service}</Text>
                <Text style={styles.historyDate}>
                  {item.date}  ·  {item.done_at_km.toLocaleString()} km
                </Text>
                {item.notes ? <Text style={styles.historyNotes}>{item.notes}</Text> : null}
              </View>
              {item.cost > 0 && (
                <Text style={styles.historyCost}>${item.cost}</Text>
              )}
            </View>
          ))
        ) : (
          <View style={styles.emptyHistory}>
            <Text style={styles.emptyHistoryText}>No service history yet. Log a service above to track it.</Text>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Setup History Modal */}
      <Modal
        visible={showSetupModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSetupModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, styles.setupModalBox]}>
            <Text style={styles.modalTitle}>Enter Service History</Text>
            <Text style={styles.modalSub}>
              When did you last do each service? Enter the odometer reading (km) or leave blank if never done.
            </Text>
            <ScrollView
              style={styles.setupScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {MAINTENANCE_SERVICES.map(service => (
                <View key={service} style={styles.setupRow}>
                  <View style={styles.setupRowLeft}>
                    <View style={styles.setupInitial}>
                      <Text style={styles.setupInitialText}>{service.charAt(0)}</Text>
                    </View>
                    <Text style={styles.setupServiceName}>{service}</Text>
                  </View>
                  <TextInput
                    style={styles.setupInput}
                    placeholder="km or blank"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                    value={setupInputs[service] ?? ''}
                    onChangeText={v => setSetupInputs(prev => ({ ...prev, [service]: v }))}
                  />
                </View>
              ))}
              <View style={{ height: 8 }} />
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => { setShowSetupModal(false); setSetupInputs({}); }}
              >
                <Text style={styles.modalCancelText}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSave}
                onPress={saveSetupHistory}
                disabled={savingSetup}
              >
                {savingSetup
                  ? <ActivityIndicator color="#0A0E1A" size="small" />
                  : <Text style={styles.modalSaveText}>Save History</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Odometer Modal */}
      <Modal
        visible={showOdometerModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowOdometerModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Update Odometer</Text>
            <Text style={styles.modalSub}>
              {ecuOdometerKm != null
                ? `ECU reading: ${ecuOdometerKm.toLocaleString()} km (pre-filled from vehicle)`
                : 'Enter your current odometer reading in km'}
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. 85000"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={odometerInput}
              onChangeText={setOdometerInput}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => { setShowOdometerModal(false); setOdometerInput(''); }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSave}
                onPress={handleUpdateOdometer}
                disabled={savingOdometer}
              >
                {savingOdometer
                  ? <ActivityIndicator color="#0A0E1A" size="small" />
                  : <Text style={styles.modalSaveText}>Save</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const createStyles = (colors: typeof darkColors) => StyleSheet.create({
  safeArea:         { flex: 1, backgroundColor: colors.bgPrimary },
  scrollView:       { flex: 1 },
  scrollContent:    { paddingHorizontal: 16, paddingTop: 8 },
  loadingBox:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText:      { fontSize: 14, color: colors.textSecondary },

  pageHeader:       { paddingVertical: 14 },
  pageTitle:        { fontSize: 26, fontWeight: '800', color: colors.textPrimary },
  pageSubtitle:     { fontSize: 14, color: colors.textSecondary, marginTop: 4 },

  odometerCard:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bgCard, borderRadius: 14, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: colors.primary + '60',
  },
  odometerLeft:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  odometerIcon:     { fontSize: 28 },
  odometerLabel:    { fontSize: 12, color: colors.textSecondary },
  odometerValue:    { fontSize: 20, fontWeight: '800', color: colors.primary, marginTop: 2 },
  editBadge:        { backgroundColor: colors.primary + '20', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: colors.primary + '40' },
  editBadgeText:    { fontSize: 12, color: colors.primary, fontWeight: '700' },

  ecuBadge:         { backgroundColor: '#00BFFF20', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#00BFFF60' },
  ecuBadgeText:     { fontSize: 10, color: '#00BFFF', fontWeight: '700' },
  ecuSubtext:       { fontSize: 11, color: '#00BFFF', marginTop: 2 },
  ecuSyncBtn:       { backgroundColor: '#00BFFF15', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#00BFFF60', minWidth: 90, alignItems: 'center' },
  ecuSyncText:      { fontSize: 12, color: '#00BFFF', fontWeight: '700' },

  noBanner:         { backgroundColor: '#FFA72615', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: colors.warning },
  noBannerText:     { fontSize: 13, color: colors.warning, fontWeight: '500', textAlign: 'center' },

  alertBox:         {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FF525210',
    borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, gap: 10,
  },
  alertIcon:        { fontSize: 20 },
  alertText:        { flex: 1 },
  alertTitle:       { fontSize: 14, fontWeight: '700' },
  alertSub:         { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  alertBtn:         { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  alertBtnText:     { fontSize: 12, fontWeight: '700', color: '#0A0E1A' },

  statsRow:         { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statBox:          {
    flex: 1, backgroundColor: colors.bgCard, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  statNum:          { fontSize: 20, fontWeight: '800' },
  statLbl:          { fontSize: 11, color: colors.textSecondary, marginTop: 3, textAlign: 'center' },

  sectionTitle:     { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },

  card:             {
    backgroundColor: colors.bgCard, borderRadius: 14, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: colors.border,
  },
  cardOverdue:      { borderColor: colors.critical, borderWidth: 1.5 },
  cardHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardLeft:         { flexDirection: 'row', alignItems: 'center', gap: 12 },
  serviceIcon:      { fontSize: 26 },
  serviceName:      { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  serviceInterval:  { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  progressBadge:    { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  progressText:     { fontSize: 12, fontWeight: '700' },

  kmRow:            { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  kmLabel:          { fontSize: 12, color: colors.textSecondary },
  kmDue:            { fontSize: 12, fontWeight: '700' },

  progressBarBg:    { height: 6, backgroundColor: '#1E2D45', borderRadius: 3, marginBottom: 12 },
  progressBarFill:  { height: 6, borderRadius: 3 },

  cardActions:      { flexDirection: 'row', gap: 8 },
  logBtn:           {
    flex: 1, borderWidth: 1, borderColor: colors.healthy,
    borderRadius: 8, paddingVertical: 8, alignItems: 'center',
  },
  logBtnText:       { fontSize: 13, fontWeight: '700', color: colors.healthy },
  bookBtn:          {
    flex: 1, backgroundColor: colors.primary,
    borderRadius: 8, paddingVertical: 8, alignItems: 'center',
  },
  bookBtnText:      { fontSize: 13, fontWeight: '700', color: '#0A0E1A' },

  historyRow:       {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bgCard, borderRadius: 12, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: colors.border, gap: 12,
  },
  historyIcon:      {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#00E67615', alignItems: 'center', justifyContent: 'center',
  },
  historyMid:       { flex: 1 },
  historyService:   { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  historyDate:      { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  historyNotes:     { fontSize: 11, color: colors.textMuted, marginTop: 2, fontStyle: 'italic' },
  historyCost:      { fontSize: 16, fontWeight: '700', color: colors.primary },

  emptyHistory:     {
    backgroundColor: colors.bgCard, borderRadius: 12, padding: 24,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  emptyHistoryText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },

  // Odometer icon box (replaces car emoji)
  odometerIconBox:    {
    width: 42, height: 42, borderRadius: 10, backgroundColor: colors.primary + '18',
    borderWidth: 1, borderColor: colors.primary + '40', alignItems: 'center', justifyContent: 'center',
  },
  odometerIconText:   { fontSize: 11, fontWeight: '800', color: colors.primary, letterSpacing: 0.5 },

  // Alert dot (replaces emoji alert icon)
  alertDot:           { width: 10, height: 10, borderRadius: 5 },

  // Service initial letter circle (replaces service emoji)
  serviceInitial:     {
    width: 38, height: 38, borderRadius: 10, alignItems: 'center',
    justifyContent: 'center', borderWidth: 1,
  },
  serviceInitialText: { fontSize: 16, fontWeight: '800' },

  // History checkmark
  historyCheckmark:   { fontSize: 16, color: colors.healthy, fontWeight: '700' },

  // Setup History banner
  setupBanner:        {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary + '12',
    borderRadius: 12, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: colors.primary + '40',
  },
  setupBannerTitle:   { fontSize: 14, fontWeight: '700', color: colors.primary },
  setupBannerSub:     { fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
  setupBannerArrow:   { fontSize: 24, color: colors.primary, fontWeight: '300' },

  // Setup History Modal
  setupModalBox:      { maxHeight: '85%' },
  setupScroll:        { maxHeight: 400, marginBottom: 12 },
  setupRow:           {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  setupRowLeft:       { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  setupInitial:       {
    width: 30, height: 30, borderRadius: 8, backgroundColor: colors.primary + '20',
    borderWidth: 1, borderColor: colors.primary + '40', alignItems: 'center', justifyContent: 'center',
  },
  setupInitialText:   { fontSize: 13, fontWeight: '800', color: colors.primary },
  setupServiceName:   { fontSize: 13, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  setupInput:         {
    width: 110, backgroundColor: colors.bgSecondary, borderRadius: 8, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 7,
    fontSize: 13, fontWeight: '600', color: colors.textPrimary, textAlign: 'right',
  },

  // Modal
  modalOverlay:     {
    flex: 1, backgroundColor: '#00000080',
    alignItems: 'center', justifyContent: 'center',
  },
  modalBox:         {
    width: '85%', backgroundColor: colors.bgCard,
    borderRadius: 18, padding: 24, borderWidth: 1, borderColor: colors.border,
  },
  modalTitle:       { fontSize: 18, fontWeight: '800', color: colors.textPrimary, marginBottom: 6 },
  modalSub:         { fontSize: 13, color: colors.textSecondary, marginBottom: 18 },
  modalInput:       {
    backgroundColor: colors.bgSecondary, borderRadius: 10, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: 20,
  },
  modalActions:     { flexDirection: 'row', gap: 10 },
  modalCancel:      {
    flex: 1, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, paddingVertical: 12, alignItems: 'center',
  },
  modalCancelText:  { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  modalSave:        {
    flex: 1, backgroundColor: colors.primary,
    borderRadius: 10, paddingVertical: 12, alignItems: 'center',
  },
  modalSaveText:    { fontSize: 14, fontWeight: '800', color: '#0A0E1A' },
});

export default MaintenanceScreen;
