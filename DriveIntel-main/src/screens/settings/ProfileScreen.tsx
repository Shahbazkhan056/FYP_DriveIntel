import React, { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  StatusBar, Switch, ActivityIndicator, Alert, Modal, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors } from '../../theme/colors';
import { useTheme } from '../../context/ThemeContext';
import { AuthContext } from '../../navigation/AppNavigator';
import {
  getProfile, getUserId, getUserName, getUserEmail, getUserPhone,
  updateProfile, updateVehicle, clearUser,
} from '../../services/api';
import { useOBD } from '../../context/OBDContext';

interface Props { navigation: any; }

const PREFS_KEY = 'driveintel_prefs';

interface EditModalProps {
  visible: boolean;
  title: string;
  fields: { label: string; value: string; onChange: (v: string) => void; keyboardType?: any; placeholder?: string }[];
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  styles: ReturnType<typeof createStyles>;
  colors: typeof darkColors;
}

const ProfileScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode]           = useState(true);
  const { signOut } = useContext(AuthContext);
  const { isConnected, vin, liveData } = useOBD();

  const [showPersonal, setShowPersonal] = useState(false);
  const [editName, setEditName]   = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [savingPersonal, setSavingPersonal] = useState(false);

  const [showVehicle, setShowVehicle] = useState(false);
  const [editMake,  setEditMake]  = useState('');
  const [editModel, setEditModel] = useState('');
  const [editYear,  setEditYear]  = useState('');
  const [savingVehicle, setSavingVehicle] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await getProfile(getUserId());
      setProfile(res);
    } catch {
      setProfile({
        name:  getUserName()  || 'User',
        email: getUserEmail() || '',
        phone: getUserPhone() || '',
        memberSince: '2025',
        vehicle: { make: '', model: '', year: 0, vin: '' },
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPrefs = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(PREFS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p.notifications !== undefined) setNotifications(p.notifications);
        if (p.darkMode      !== undefined) setDarkMode(p.darkMode);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchProfile();
    loadPrefs();
  }, [fetchProfile, loadPrefs]);

  const savePrefs = async (key: string, val: boolean) => {
    try {
      const raw = await AsyncStorage.getItem(PREFS_KEY);
      const p   = raw ? JSON.parse(raw) : {};
      await AsyncStorage.setItem(PREFS_KEY, JSON.stringify({ ...p, [key]: val }));
    } catch { /* ignore */ }
  };

  const handleSignOut = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive', onPress: async () => {
          await clearUser();
          signOut();
        },
      },
    ]);
  };

  const openPersonal = () => {
    setEditName(profile?.name  || '');
    setEditPhone(profile?.phone || '');
    setShowPersonal(true);
  };

  const savePersonal = async () => {
    if (!editName.trim()) {
      Alert.alert('Name required', 'Please enter your name.');
      return;
    }
    setSavingPersonal(true);
    try {
      await updateProfile(getUserId(), editName.trim(), editPhone.trim());
      setProfile((p: any) => ({ ...p, name: editName.trim(), phone: editPhone.trim() }));
      setShowPersonal(false);
    } catch {
      Alert.alert('Error', 'Failed to update profile. Try again.');
    } finally {
      setSavingPersonal(false);
    }
  };

  const openVehicle = () => {
    setEditMake(profile?.vehicle?.make   || '');
    setEditModel(profile?.vehicle?.model || '');
    setEditYear(profile?.vehicle?.year ? String(profile.vehicle.year) : '');
    setShowVehicle(true);
  };

  const saveVehicle = async () => {
    const year = parseInt(editYear, 10);
    if (editMake.trim() && editYear && (isNaN(year) || year < 1900 || year > 2100)) {
      Alert.alert('Invalid Year', 'Please enter a valid year (e.g. 2021).');
      return;
    }
    setSavingVehicle(true);
    try {
      await updateVehicle(getUserId(), editMake.trim(), editModel.trim(), year || 0);
      setProfile((p: any) => ({
        ...p,
        vehicle: { ...p.vehicle, make: editMake.trim(), model: editModel.trim(), year: year || 0 },
      }));
      setShowVehicle(false);
    } catch {
      Alert.alert('Error', 'Failed to update vehicle. Try again.');
    } finally {
      setSavingVehicle(false);
    }
  };

  const showEmailInfo = () =>
    Alert.alert(
      'Email Address',
      `Your login email is:\n\n${profile?.email || getUserEmail()}\n\nEmail cannot be changed as it is used for authentication.`,
    );

  const showPrivacy = () =>
    Alert.alert(
      'Privacy & Security',
      'Your data is stored locally on your device and your own server. DriveIntel does not share your vehicle data with any third parties.\n\nAll OBD-II communication stays on your device.',
    );

  const showTerms = () =>
    Alert.alert(
      'Terms of Service',
      'DriveIntel is provided for personal vehicle monitoring use only. The app does not replace professional automotive diagnosis. Always consult a certified mechanic for critical repairs.',
    );

  const showPrivacyPolicy = () =>
    Alert.alert(
      'Privacy Policy',
      'We collect only the vehicle data you generate while using the app. Data is stored on your local server and never uploaded to external cloud services without your consent.',
    );

  const showHelp = () =>
    Alert.alert(
      'Help & Support',
      'For assistance:\n\n• Ensure your ELM327 adapter is paired via Bluetooth\n• Check your local server is running\n• For bugs, contact: support@driveintel.app\n\nVersion 1.0.0',
    );

  const MenuRow = ({ icon, label, badge, value, onPress }: {
    icon: string; label: string; badge?: string; value?: string; onPress?: () => void;
  }) => (
    <TouchableOpacity style={styles.menuRow} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.menuRowLeft}>
        <Text style={styles.menuIcon}>{icon}</Text>
        <Text style={styles.menuLabel}>{label}</Text>
      </View>
      <View style={styles.menuRowRight}>
        {value ? <Text style={styles.menuValue}>{value}</Text> : null}
        {badge ? (
          <View style={styles.menuBadge}>
            <Text style={styles.menuBadgeText}>{badge}</Text>
          </View>
        ) : null}
        <Text style={styles.menuArrow}>›</Text>
      </View>
    </TouchableOpacity>
  );

  const ToggleRow = ({ icon, label, value, onToggle }: {
    icon: string; label: string; value: boolean; onToggle: (v: boolean) => void;
  }) => (
    <View style={styles.menuRow}>
      <View style={styles.menuRowLeft}>
        <Text style={styles.menuIcon}>{icon}</Text>
        <Text style={styles.menuLabel}>{label}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#fff"
        ios_backgroundColor={colors.border}
      />
    </View>
  );

  const EditModal: React.FC<EditModalProps> = ({ visible, title, fields, saving, onSave, onClose }) => (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <Text style={styles.modalTitle}>{title}</Text>
          {fields.map((f, i) => (
            <View key={i} style={styles.fieldWrap}>
              <Text style={styles.fieldLabel}>{f.label}</Text>
              <TextInput
                style={styles.fieldInput}
                value={f.value}
                onChangeText={f.onChange}
                keyboardType={f.keyboardType ?? 'default'}
                placeholder={f.placeholder ?? ''}
                placeholderTextColor={colors.textMuted}
              />
            </View>
          ))}
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalSave} onPress={onSave} disabled={saving}>
              {saving
                ? <ActivityIndicator color="#0A0E1A" size="small" />
                : <Text style={styles.modalSaveText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading Profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const initials = profile?.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || 'DI';
  const vehicleName = [profile?.vehicle?.make, profile?.vehicle?.model].filter(Boolean).join(' ') || 'No vehicle set';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.bgPrimary} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        <View style={styles.profileCard}>
          <TouchableOpacity style={styles.avatar} onPress={openPersonal} activeOpacity={0.8}>
            <Text style={styles.avatarText}>{initials}</Text>
          </TouchableOpacity>
          <Text style={styles.profileName}>{profile?.name}</Text>
          <Text style={styles.profileEmail}>{profile?.email}</Text>
          {profile?.phone ? <Text style={styles.profilePhone}>{profile.phone}</Text> : null}
          <View style={styles.certBadge}>
            <Text style={styles.certBadgeIcon}>📅</Text>
            <Text style={styles.certBadgeText}>Member since {profile?.memberSince}</Text>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>OBD-II Connection</Text>
          <TouchableOpacity
            style={[styles.obdRow, { borderColor: isConnected ? colors.healthy : colors.critical }]}
            onPress={() => navigation.navigate('OBDConnection')}
            activeOpacity={0.8}>
            <View style={[styles.obdDot, { backgroundColor: isConnected ? colors.healthy : colors.critical }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.obdStatus, { color: isConnected ? colors.healthy : colors.critical }]}>
                {isConnected ? 'ELM327 Connected' : 'ELM327 Disconnected'}
              </Text>
              {isConnected && liveData ? (
                <Text style={styles.obdLiveInfo}>
                  {liveData.speed} km/h  ·  {liveData.rpm} RPM  ·  {liveData.engineTemp}°C
                </Text>
              ) : (
                <Text style={styles.obdConnectHint}>Tap to connect to ELM327 adapter</Text>
              )}
            </View>
            <Text style={styles.obdArrow}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Vehicle</Text>
            <TouchableOpacity onPress={openVehicle}>
              <Text style={styles.addVehicleLink}>✏️ Edit</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.vehicleRow} onPress={openVehicle} activeOpacity={0.8}>
            <View style={styles.vehicleIconBox}>
              <Text style={styles.vehicleIcon}>🚗</Text>
            </View>
            <View style={styles.vehicleInfo}>
              <Text style={styles.vehicleName}>{vehicleName}</Text>
              <Text style={styles.vehicleMeta}>
                {profile?.vehicle?.year ? `${profile.vehicle.year}  ·  ` : ''}
                VIN: {vin || profile?.vehicle?.vin || 'N/A'}
              </Text>
            </View>
            <View style={styles.connectedBadge}>
              <View style={[styles.connectedDot, { backgroundColor: isConnected ? colors.healthy : colors.textMuted }]} />
              <Text style={[styles.connectedText, { color: isConnected ? colors.healthy : colors.textMuted }]}>
                {isConnected ? 'Live' : 'Offline'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Account</Text>
          <MenuRow icon="👤" label="Personal Information"
            value={profile?.name?.split(' ')[0]}
            onPress={openPersonal} />
          <MenuRow icon="✉️" label="Email Address"
            value={profile?.email}
            onPress={showEmailInfo} />
          <MenuRow icon="📞" label="Phone Number"
            value={profile?.phone || 'Not set'}
            onPress={openPersonal} />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Vehicle Settings</Text>
          <MenuRow icon="🚗" label="Edit Vehicle Details"
            value={vehicleName !== 'No vehicle set' ? vehicleName : undefined}
            onPress={openVehicle} />
          <MenuRow icon="📡" label="OBD-II Connection"
            onPress={() => navigation.navigate('OBDConnection')} />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Preferences</Text>
          <ToggleRow icon="🔔" label="Notifications" value={notifications}
            onToggle={(v) => { setNotifications(v); savePrefs('notifications', v); }} />
          <ToggleRow icon="🌙" label="Dark Mode" value={darkMode}
            onToggle={(v) => { setDarkMode(v); savePrefs('darkMode', v); }} />
          <MenuRow icon="🛡️" label="Privacy & Security" onPress={showPrivacy} />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Version</Text>
            <Text style={styles.aboutValue}>1.0.0</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>OBD Protocol</Text>
            <Text style={styles.aboutValue}>CAN Bus (ISO 15765-4)</Text>
          </View>
          <View style={[styles.aboutRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.aboutLabel}>Developer</Text>
            <Text style={[styles.aboutValue, { color: colors.primary }]}>DriveIntel Team</Text>
          </View>
          <TouchableOpacity style={styles.aboutBtn} onPress={showTerms}>
            <Text style={styles.aboutBtnText}>Terms of Service</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.aboutBtn} onPress={showPrivacyPolicy}>
            <Text style={styles.aboutBtnText}>Privacy Policy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.aboutBtn} onPress={showHelp}>
            <Text style={styles.aboutBtnText}>Help & Support</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.85}>
          <Text style={styles.signOutIcon}>→</Text>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>

      <EditModal
        visible={showPersonal}
        title="Personal Information"
        fields={[
          { label: 'Full Name', value: editName, onChange: setEditName, placeholder: 'e.g. John Doe' },
          { label: 'Phone Number', value: editPhone, onChange: setEditPhone, keyboardType: 'phone-pad', placeholder: 'e.g. +1 234 567 8900' },
        ]}
        saving={savingPersonal}
        onSave={savePersonal}
        onClose={() => setShowPersonal(false)}
        styles={styles}
        colors={colors}
      />

      <EditModal
        visible={showVehicle}
        title="Vehicle Details"
        fields={[
          { label: 'Make', value: editMake, onChange: setEditMake, placeholder: 'e.g. Toyota' },
          { label: 'Model', value: editModel, onChange: setEditModel, placeholder: 'e.g. Corolla' },
          { label: 'Year', value: editYear, onChange: setEditYear, keyboardType: 'numeric', placeholder: 'e.g. 2021' },
        ]}
        saving={savingVehicle}
        onSave={saveVehicle}
        onClose={() => setShowVehicle(false)}
        styles={styles}
        colors={colors}
      />
    </SafeAreaView>
  );
};

const createStyles = (colors: typeof darkColors) => StyleSheet.create({
  safeArea:        { flex: 1, backgroundColor: colors.bgPrimary },
  loadingBox:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText:     { fontSize: 14, color: colors.textSecondary },
  topBar:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:         { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon:        { fontSize: 32, color: colors.primary, lineHeight: 36 },
  topBarTitle:     { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  scrollView:      { flex: 1 },
  scrollContent:   { paddingHorizontal: 16, paddingTop: 12 },
  profileCard:     { backgroundColor: colors.bgCard, borderRadius: 16, padding: 24, marginBottom: 16, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  avatar:          { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  avatarText:      { fontSize: 28, fontWeight: '800', color: '#0A0E1A' },
  profileName:     { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  profileEmail:    { fontSize: 14, color: colors.textSecondary, marginBottom: 4 },
  profilePhone:    { fontSize: 13, color: colors.textMuted, marginBottom: 10 },
  certBadge:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#00E5CC15', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: colors.primary, gap: 6 },
  certBadgeIcon:   { fontSize: 13 },
  certBadgeText:   { fontSize: 12, color: colors.primary, fontWeight: '500' },
  sectionCard:       { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  sectionHeaderRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle:      { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
  addVehicleLink:    { fontSize: 13, color: colors.primary, fontWeight: '600' },
  obdRow:          { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgSecondary, borderRadius: 10, padding: 14, borderWidth: 1.5, gap: 12 },
  obdDot:          { width: 12, height: 12, borderRadius: 6 },
  obdStatus:       { fontSize: 14, fontWeight: '700' },
  obdLiveInfo:     { fontSize: 12, color: colors.textSecondary, marginTop: 3 },
  obdConnectHint:  { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  obdArrow:        { fontSize: 20, color: colors.textMuted },
  menuRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.bgSecondary, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 14, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  menuRowLeft:     { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  menuIcon:        { fontSize: 17 },
  menuLabel:       { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
  menuRowRight:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  menuValue:       { fontSize: 12, color: colors.textSecondary, maxWidth: 120 },
  menuBadge:       { backgroundColor: colors.primary, borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  menuBadgeText:   { fontSize: 11, fontWeight: '700', color: '#0A0E1A' },
  menuArrow:       { fontSize: 20, color: colors.textMuted },
  vehicleRow:      { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgSecondary, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 12 },
  vehicleIconBox:  { width: 40, height: 40, borderRadius: 10, backgroundColor: '#00E5CC18', borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  vehicleIcon:     { fontSize: 20 },
  vehicleInfo:     { flex: 1 },
  vehicleName:     { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 3 },
  vehicleMeta:     { fontSize: 12, color: colors.textSecondary },
  connectedBadge:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  connectedDot:    { width: 8, height: 8, borderRadius: 4 },
  connectedText:   { fontSize: 12, fontWeight: '600' },
  aboutRow:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  aboutLabel:      { fontSize: 14, color: colors.textSecondary },
  aboutValue:      { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
  aboutBtn:        { height: 44, borderRadius: 10, backgroundColor: colors.bgSecondary, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  aboutBtnText:    { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  signOutBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgCard, borderRadius: 12, height: 52, borderWidth: 1, borderColor: '#FF525240', gap: 8, marginBottom: 8 },
  signOutIcon:     { fontSize: 16, color: colors.critical },
  signOutText:     { fontSize: 15, fontWeight: '700', color: colors.critical },
  modalOverlay:    { flex: 1, backgroundColor: '#00000080', alignItems: 'center', justifyContent: 'center' },
  modalBox:        { width: '88%', backgroundColor: colors.bgCard, borderRadius: 18, padding: 24, borderWidth: 1, borderColor: colors.border },
  modalTitle:      { fontSize: 18, fontWeight: '800', color: colors.textPrimary, marginBottom: 18 },
  fieldWrap:       { marginBottom: 14 },
  fieldLabel:      { fontSize: 12, color: colors.textSecondary, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldInput:      { backgroundColor: colors.bgSecondary, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
  modalActions:    { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalCancel:     { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  modalSave:       { flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  modalSaveText:   { fontSize: 14, fontWeight: '800', color: '#0A0E1A' },
});

export default ProfileScreen;
