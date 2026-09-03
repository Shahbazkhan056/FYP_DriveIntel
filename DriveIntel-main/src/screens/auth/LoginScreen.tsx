import React, { useState, useContext, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  StatusBar, KeyboardAvoidingView, Platform, ScrollView,
  TextInput, ActivityIndicator, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { darkColors } from '../../theme/colors';
import { AuthContext } from '../../navigation/AppNavigator';
import { loginUser, getApiErrorMessage } from '../../services/api';

interface Props { navigation: any; }

const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signIn } = useContext(AuthContext);

  const handleSignIn = async () => {
    if (!email || !password) { Alert.alert('Error', 'Please enter email and password'); return; }
    setLoading(true);
    try {
      const response = await loginUser({ email, password });
      if (response.success) signIn();
    } catch (err: any) { Alert.alert('Error', getApiErrorMessage(err, 'Login failed. Please try again.')); }
    finally { setLoading(false); }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.bgPrimary} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <View style={styles.logoContainer}>
            <Image source={require('../../assets/logo.png')} style={styles.logoImage} resizeMode="contain" />
          </View>

          <Text style={styles.welcomeTitle}>Welcome Back</Text>
          <Text style={styles.welcomeSubtitle}>Sign in to access your vehicle data</Text>

          <View style={styles.form}>
            <Text style={styles.inputLabel}>Email Address</Text>
            <View style={styles.inputBox}>
              <Text style={styles.inputIcon}>✉️</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your email"
                placeholderTextColor={colors.textMuted}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <Text style={styles.inputLabel}>Password</Text>
            <View style={styles.inputBox}>
              <Text style={styles.inputIcon}>🔒</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor={colors.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                <Text style={styles.inputIcon}>{showPassword ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.forgotContainer}
              onPress={() => Alert.alert('Forgot Password', 'Password reset is not yet available. Please contact support@driveintel.app for assistance.')}
            >
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.signInBtn} onPress={handleSignIn} activeOpacity={0.85}>
              {loading ? <ActivityIndicator color={colors.bgPrimary} /> : <Text style={styles.signInBtnText}>Sign In</Text>}
            </TouchableOpacity>

            <View style={styles.createAccountRow}>
              <Text style={styles.createAccountGray}>Don't have an account? </Text>
              <TouchableOpacity onPress={() => navigation.navigate('Register')}>
                <Text style={styles.createAccountLink}>Create Account</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.footer}>DriveIntel © 2025 - Powered by AI</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const createStyles = (colors: typeof darkColors) => StyleSheet.create({
  safeArea:           { flex: 1, backgroundColor: colors.bgPrimary },
  flex:               { flex: 1 },
  scrollContent:      { flexGrow: 1, alignItems: 'center', paddingHorizontal: 24, paddingBottom: 32 },
  logoContainer:      { marginTop: 40, marginBottom: 20, alignItems: 'center' },
  logoImage:          { width: 280, height: 140 },
  welcomeTitle:       { fontSize: 26, fontWeight: '700', color: colors.primary, textAlign: 'center', marginBottom: 6 },
  welcomeSubtitle:    { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 32 },
  form:               { width: '100%' },
  inputLabel:         { fontSize: 13, color: colors.textSecondary, marginBottom: 6, fontWeight: '500' },
  inputBox:           { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 16, gap: 10 },
  inputIcon:          { fontSize: 16 },
  input:              { flex: 1, fontSize: 14, color: colors.textPrimary },
  forgotContainer:    { alignSelf: 'flex-end', marginBottom: 24, marginTop: -8 },
  forgotText:         { color: colors.primary, fontSize: 14, fontWeight: '500' },
  signInBtn:          { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginBottom: 16, shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8 },
  signInBtnText:      { color: colors.bgPrimary, fontSize: 16, fontWeight: '800' },
  createAccountRow:   { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  createAccountGray:  { color: colors.textSecondary, fontSize: 14 },
  createAccountLink:  { color: colors.primary, fontSize: 14, fontWeight: '600' },
  footer:             { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 40 },
});

export default LoginScreen;
