import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  StatusBar, Switch, Alert, Modal, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../context/ThemeContext';
import { useI18n } from '../../context/I18nContext';
import { darkColors } from '../../theme/colors';
import { LANGUAGES } from '../../i18n/translations';
import Header from '../../components/common/Headers';
import { clearUser } from '../../services/api';
import { useContext } from 'react';
import { AuthContext } from '../../navigation/AppNavigator';

interface Props { navigation: any; }

const PREFS_KEY = 'driveintel_prefs';

const SettingsScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, isDark, toggleTheme } = useTheme();
  const { t, lang, setLang, languages } = useI18n();

  const [notifications, setNotifications] = useState(true);
  const [faultAlerts,   setFaultAlerts]   = useState(true);
  const [autoConnect,   setAutoConnect]   = useState(false);
  const [langModal,     setLangModal]     = useState(false);
  const { signOut } = useContext(AuthContext);

  useEffect(() => { loadPrefs(); }, []);

  const loadPrefs = async () => {
    try {
      const raw = await AsyncStorage.getItem(PREFS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p.notifications !== undefined) setNotifications(p.notifications);
        if (p.faultAlerts   !== undefined) setFaultAlerts(p.faultAlerts);
        if (p.autoConnect   !== undefined) setAutoConnect(p.autoConnect);
      }
    } catch { /* ignore */ }
  };

  const savePref = async (key: string, val: boolean) => {
    try {
      const raw = await AsyncStorage.getItem(PREFS_KEY);
      const p   = raw ? JSON.parse(raw) : {};
      await AsyncStorage.setItem(PREFS_KEY, JSON.stringify({ ...p, [key]: val }));
    } catch { /* ignore */ }
  };

  const handleSignOut = async () => {
    Alert.alert(t('signOut'), t('signOutConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('signOut'), style: 'destructive', onPress: async () => {
          await clearUser();
          signOut();
        },
      },
    ]);
  };

  const styles = useMemo(() => createStyles(colors), [colors]);

  const SettingRow = ({ icon, title, subtitle, toggle, value, onToggle, onPress }: any) => (
    <TouchableOpacity
      style={styles.row}
      onPress={toggle ? undefined : onPress}
      activeOpacity={toggle ? 1 : 0.7}
    >
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={styles.rowInfo}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      {toggle ? (
        <Switch
          value={value}
          onValueChange={onToggle}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#fff"
        />
      ) : (
        <Text style={styles.chevron}>›</Text>
      )}
    </TouchableOpacity>
  );

  const currentLangLabel = languages.find(l => l.code === lang)?.nativeLabel ?? 'English';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bgPrimary}
      />
      <Header title={t('settings')} onBack={() => navigation.goBack()} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <Text style={styles.section}>{t('vehicle')}</Text>
        <View style={styles.card}>
          <SettingRow
            icon="🚗" title={t('manageVehicle')}
            subtitle={t('manageVehicleSub')}
            onPress={() => navigation.navigate('Profile')}
          />
          <SettingRow
            icon="📡" title={t('obdConnection')}
            subtitle={t('obdConnectionSub')}
            onPress={() => navigation.navigate('OBDConnection')}
          />
          <SettingRow
            icon="🔄" title={t('autoConnect')}
            toggle value={autoConnect}
            onToggle={(v: boolean) => { setAutoConnect(v); savePref('autoConnect', v); }}
          />
        </View>

        <Text style={styles.section}>{t('notifications')}</Text>
        <View style={styles.card}>
          <SettingRow
            icon="🔔" title={t('pushNotifications')}
            toggle value={notifications}
            onToggle={(v: boolean) => { setNotifications(v); savePref('notifications', v); }}
          />
          <SettingRow
            icon="⚠️" title={t('faultAlerts')}
            toggle value={faultAlerts}
            onToggle={(v: boolean) => {
              setFaultAlerts(v);
              savePref('faultAlerts', v);
              Alert.alert(
                v ? t('faultAlertsEnabled') : t('faultAlertsDisabled'),
                v ? t('faultAlertsEnabledMsg') : t('faultAlertsDisabledMsg'),
              );
            }}
          />
          <SettingRow
            icon="🛢️" title={t('maintenanceReminders')}
            subtitle={t('maintenanceRemindersSub')}
            onPress={() => navigation.navigate('Maintenance')}
          />
        </View>

        <Text style={styles.section}>{t('app')}</Text>
        <View style={styles.card}>
          <SettingRow
            icon="🌙" title={t('darkMode')}
            toggle value={isDark}
            onToggle={(v: boolean) => toggleTheme(v)}
          />
          <SettingRow
            icon="🌐" title={t('language')}
            subtitle={currentLangLabel}
            onPress={() => setLangModal(true)}
          />
          <SettingRow
            icon="ℹ️" title={t('about')}
            subtitle={t('aboutVersion')}
            onPress={() => Alert.alert(
              'About DriveIntel',
              'Version: 1.0.0\nOBD Protocol: CAN Bus (ISO 15765-4)\nDeveloper: DriveIntel Team\n\nDriveIntel uses your ELM327 OBD-II adapter to read real-time vehicle data and provide AI-powered diagnostics.',
            )}
          />
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleSignOut} activeOpacity={0.8}>
          <Text style={styles.logoutText}>{t('signOut')}</Text>
        </TouchableOpacity>
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Language picker modal */}
      <Modal visible={langModal} transparent animationType="fade" onRequestClose={() => setLangModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setLangModal(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('language')}</Text>
            <FlatList
              data={LANGUAGES}
              keyExtractor={item => item.code}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.langRow, lang === item.code && styles.langRowActive]}
                  onPress={() => { setLang(item.code); setLangModal(false); }}
                  activeOpacity={0.75}
                >
                  <Text style={styles.langLabel}>{item.nativeLabel}</Text>
                  <Text style={styles.langSubLabel}>{item.label}</Text>
                  {lang === item.code && <Text style={styles.langCheck}>✓</Text>}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

const createStyles = (colors: typeof darkColors) =>
  StyleSheet.create({
    safeArea:   { flex: 1, backgroundColor: colors.bgPrimary },
    scroll:     { flex: 1 },
    content:    { paddingHorizontal: 16, paddingTop: 16 },
    section:    { fontSize: 12, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, marginLeft: 4 },
    card:       { backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 20, overflow: 'hidden' },
    row:        { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
    rowIcon:    { fontSize: 20, marginRight: 14, width: 28, textAlign: 'center' },
    rowInfo:    { flex: 1 },
    rowTitle:   { fontSize: 15, fontWeight: '500', color: colors.textPrimary },
    rowSub:     { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    chevron:    { fontSize: 20, color: colors.textMuted },
    logoutBtn:  { backgroundColor: colors.critical + '20', borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.critical },
    logoutText: { color: colors.critical, fontSize: 15, fontWeight: '700' },
    // Language modal
    modalOverlay: { flex: 1, backgroundColor: '#00000088', justifyContent: 'center', alignItems: 'center', padding: 32 },
    modalCard:    { backgroundColor: colors.bgCard, borderRadius: 18, width: '100%', paddingVertical: 8, borderWidth: 1, borderColor: colors.border },
    modalTitle:   { fontSize: 16, fontWeight: '800', color: colors.textPrimary, textAlign: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
    langRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: colors.border },
    langRowActive:{ backgroundColor: colors.primary + '18' },
    langLabel:    { fontSize: 16, fontWeight: '600', color: colors.textPrimary, flex: 1 },
    langSubLabel: { fontSize: 13, color: colors.textSecondary, marginRight: 8 },
    langCheck:    { fontSize: 16, color: colors.primary, fontWeight: '800' },
  });

export default SettingsScreen;
