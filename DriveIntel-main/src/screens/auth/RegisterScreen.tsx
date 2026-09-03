import React, { useState, useContext, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  StatusBar, KeyboardAvoidingView, Platform, ScrollView,
  TextInput, ActivityIndicator, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { darkColors } from '../../theme/colors';
import { AuthContext } from '../../navigation/AppNavigator';
import { registerUser, getApiErrorMessage } from '../../services/api';

interface Props { navigation: any; }

// ── Field & StepIndicator defined OUTSIDE the screen component ──
// If defined inside, React sees a new component type every render,
// causing TextInput to unmount/remount on every keystroke (loses focus).

interface FieldProps {
  label: string;
  icon: string;
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: any;
  rightIcon?: string;
  onRightIconPress?: () => void;
  styles: ReturnType<typeof createStyles>;
  placeholderTextColor: string;
}

const Field = React.memo(({
  label, icon, placeholder, value, onChangeText,
  secureTextEntry, keyboardType, rightIcon, onRightIconPress,
  styles, placeholderTextColor,
}: FieldProps) => (
  <View style={styles.fieldWrap}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <View style={styles.fieldBox}>
      <Text style={styles.fieldIcon}>{icon}</Text>
      <TextInput
        style={styles.fieldInput}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry ?? false}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {rightIcon != null && (
        <TouchableOpacity onPress={onRightIconPress}>
          <Text style={styles.fieldIcon}>{rightIcon}</Text>
        </TouchableOpacity>
      )}
    </View>
  </View>
));

interface StepProps {
  current: number;
  styles: ReturnType<typeof createStyles>;
}

const StepIndicator = React.memo(({ current, styles }: StepProps) => (
  <View style={styles.stepRow}>
    {[1, 2, 3].map((num, i) => (
      <React.Fragment key={num}>
        <View style={[styles.stepCircle, current >= num && styles.stepCircleActive]}>
          {current > num
            ? <Text style={styles.stepDoneIcon}>✓</Text>
            : <Text style={[styles.stepNum, current === num && styles.stepNumActive]}>{num}</Text>}
        </View>
        {i < 2 && <View style={[styles.stepLine, current > num && styles.stepLineDone]} />}
      </React.Fragment>
    ))}
  </View>
));

// ───────────────────────────────────────────────────────────────

const RegisterScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [step, setStep]                       = useState(1);
  const [name, setName]                       = useState('');
  const [email, setEmail]                     = useState('');
  const [password, setPassword]               = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword]       = useState(false);
  const [showConfirm, setShowConfirm]         = useState(false);
  const [vehicleMake, setVehicleMake]         = useState('');
  const [vehicleModel, setVehicleModel]       = useState('');
  const [vehicleYear, setVehicleYear]         = useState('');
  const [loading, setLoading]                 = useState(false);
  const { signIn } = useContext(AuthContext);

  const toggleShowPassword = useCallback(() => setShowPassword(v => !v), []);
  const toggleShowConfirm  = useCallback(() => setShowConfirm(v => !v),  []);

  const handleStep1 = useCallback(() => {
    if (!name || !email) { Alert.alert('Error', 'Please enter name and email'); return; }
    setStep(2);
  }, [name, email]);

  const handleStep2 = useCallback(() => {
    if (!password || !confirmPassword) { Alert.alert('Error', 'Please enter password'); return; }
    if (password !== confirmPassword)  { Alert.alert('Error', 'Passwords do not match'); return; }
    setStep(3);
  }, [password, confirmPassword]);

  const handleCreateAccount = useCallback(async () => {
    setLoading(true);
    try {
      const response = await registerUser({
        name, email, password, vehicleMake, vehicleModel,
        vehicleYear: vehicleYear ? parseInt(vehicleYear, 10) : 0,
      });
      if (response.success) signIn();
    } catch (error: any) {
      Alert.alert('Error', getApiErrorMessage(error, 'Registration failed'));
    } finally {
      setLoading(false);
    }
  }, [name, email, password, vehicleMake, vehicleModel, vehicleYear, signIn]);

  const getStrength = () => {
    if (!password) return { label: '', color: 'transparent', width: '0%' };
    if (password.length < 6)  return { label: 'Weak',   color: '#FF5252', width: '30%' };
    if (password.length < 10) return { label: 'Medium', color: '#FFA726', width: '60%' };
    return { label: 'Strong', color: '#00E676', width: '100%' };
  };
  const strength = getStrength();

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.bgPrimary} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoBox}>
            <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
          </View>

          {step === 1 && (
            <>
              <Text style={styles.title}>Create Account</Text>
              <Text style={styles.subtitle}>Join DriveIntel today</Text>
              <StepIndicator current={1} styles={styles} />
              <Field
                label="Full Name" icon="👤" placeholder="Enter your full name"
                value={name} onChangeText={setName}
                styles={styles} placeholderTextColor={colors.textMuted}
              />
              <Field
                label="Email Address" icon="✉️" placeholder="Enter your email"
                value={email} onChangeText={setEmail} keyboardType="email-address"
                styles={styles} placeholderTextColor={colors.textMuted}
              />
              <TouchableOpacity style={styles.continueBtn} onPress={handleStep1} activeOpacity={0.85}>
                <Text style={styles.continueBtnText}>Continue</Text>
              </TouchableOpacity>
              <View style={styles.signInRow}>
                <Text style={styles.signInGray}>Already have an account? </Text>
                <TouchableOpacity onPress={() => navigation.navigate('Login')}>
                  <Text style={styles.signInLink}>Sign In</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={styles.title}>Secure Your Account</Text>
              <Text style={styles.subtitle}>Set a strong password</Text>
              <StepIndicator current={2} styles={styles} />
              <Field
                label="Password" icon="🔒" placeholder="Create a strong password"
                value={password} onChangeText={setPassword} secureTextEntry={!showPassword}
                rightIcon={showPassword ? '🙈' : '👁️'} onRightIconPress={toggleShowPassword}
                styles={styles} placeholderTextColor={colors.textMuted}
              />
              <Field
                label="Confirm Password" icon="🔒" placeholder="Re-enter your password"
                value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry={!showConfirm}
                rightIcon={showConfirm ? '🙈' : '👁️'} onRightIconPress={toggleShowConfirm}
                styles={styles} placeholderTextColor={colors.textMuted}
              />
              <View style={styles.strengthWrap}>
                <Text style={styles.strengthLabel}>Password Strength</Text>
                <Text style={[styles.strengthValue, { color: strength.color }]}>{strength.label}</Text>
                <View style={styles.strengthBar}>
                  <View style={[styles.strengthFill, { width: strength.width as any, backgroundColor: strength.color }]} />
                </View>
              </View>
              <View style={styles.twoBtn}>
                <TouchableOpacity style={styles.backBtn} onPress={() => setStep(1)} activeOpacity={0.8}>
                  <Text style={styles.backBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.continueBtnSmall} onPress={handleStep2} activeOpacity={0.85}>
                  <Text style={styles.continueBtnText}>Continue</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === 3 && (
            <>
              <Text style={styles.title}>Add Your Vehicle</Text>
              <Text style={styles.subtitle}>Optional - complete your profile</Text>
              <StepIndicator current={3} styles={styles} />
              <Field
                label="Vehicle Make" icon="🚗" placeholder="e.g. BMW, Toyota, Honda"
                value={vehicleMake} onChangeText={setVehicleMake}
                styles={styles} placeholderTextColor={colors.textMuted}
              />
              <Field
                label="Vehicle Model" icon="🚗" placeholder="e.g. X5, Corolla, Civic"
                value={vehicleModel} onChangeText={setVehicleModel}
                styles={styles} placeholderTextColor={colors.textMuted}
              />
              <Field
                label="Year" icon="📅" placeholder="e.g. 2022"
                value={vehicleYear} onChangeText={setVehicleYear} keyboardType="numeric"
                styles={styles} placeholderTextColor={colors.textMuted}
              />
              <Text style={styles.optionalNote}>You can update vehicle information later in settings</Text>
              <View style={styles.twoBtn}>
                <TouchableOpacity style={styles.backBtn} onPress={() => setStep(2)} activeOpacity={0.8}>
                  <Text style={styles.backBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.continueBtnSmall} onPress={handleCreateAccount} activeOpacity={0.85}>
                  {loading
                    ? <ActivityIndicator color={colors.bgPrimary} />
                    : <Text style={styles.continueBtnText}>Create Account</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}

          <Text style={styles.footer}>DriveIntel © 2025 - Powered by AI</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const createStyles = (colors: typeof darkColors) => StyleSheet.create({
  safeArea:         { flex: 1, backgroundColor: colors.bgPrimary },
  flex:             { flex: 1 },
  scrollContent:    { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 32, alignItems: 'center' },
  logoBox:          { marginTop: 32, marginBottom: 16, alignItems: 'center', width: '100%' },
  logo:             { width: 260, height: 120 },
  title:            { fontSize: 26, fontWeight: '700', color: colors.primary, textAlign: 'center', marginBottom: 6 },
  subtitle:         { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 24 },
  stepRow:          { flexDirection: 'row', alignItems: 'center', marginBottom: 28, width: '100%', justifyContent: 'center' },
  stepCircle:       { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgCard, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepCircleActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepNum:          { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  stepNumActive:    { color: colors.bgPrimary },
  stepDoneIcon:     { fontSize: 14, fontWeight: '700', color: colors.bgPrimary },
  stepLine:         { flex: 1, height: 2, backgroundColor: colors.border, marginHorizontal: 6 },
  stepLineDone:     { backgroundColor: colors.primary },
  fieldWrap:        { width: '100%', marginBottom: 16 },
  fieldLabel:       { fontSize: 13, color: colors.textSecondary, marginBottom: 6, fontWeight: '500' },
  fieldBox:         { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: colors.border, gap: 10 },
  fieldIcon:        { fontSize: 16 },
  fieldInput:       { flex: 1, fontSize: 14, color: colors.textPrimary },
  strengthWrap:     { width: '100%', marginBottom: 20 },
  strengthLabel:    { fontSize: 13, color: colors.textSecondary },
  strengthValue:    { fontSize: 13, fontWeight: '700', textAlign: 'right', marginTop: -18 },
  strengthBar:      { height: 4, backgroundColor: colors.bgCard, borderRadius: 2, marginTop: 8 },
  strengthFill:     { height: 4, borderRadius: 2 },
  continueBtn:      { width: '100%', backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginBottom: 16, shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8 },
  continueBtnText:  { color: colors.bgPrimary, fontSize: 16, fontWeight: '800' },
  twoBtn:           { flexDirection: 'row', gap: 12, width: '100%', marginBottom: 16 },
  backBtn:          { flex: 1, backgroundColor: colors.bgCard, borderRadius: 12, paddingVertical: 15, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  backBtnText:      { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  continueBtnSmall: { flex: 1.5, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 15, alignItems: 'center', shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8 },
  signInRow:        { flexDirection: 'row', justifyContent: 'center', marginTop: 4 },
  signInGray:       { color: colors.textSecondary, fontSize: 14 },
  signInLink:       { color: colors.primary, fontSize: 14, fontWeight: '600' },
  optionalNote:     { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginBottom: 20, fontStyle: 'italic' },
  footer:           { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 40 },
});

export default RegisterScreen;
