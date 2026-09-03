import React, { useState, useEffect, createContext } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AuthNavigator from './AuthNavigator';
import MainNavigator from './MainNavigator';
import ProfileScreen from '../screens/settings/ProfileScreen';
import SettingsScreen from '../screens/settings/SettingScreen';
import OBDConnectionScreen from '../screens/main/OBDConnectionScreen';
import { OBDProvider } from '../context/OBDContext';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { I18nProvider } from '../context/I18nContext';
import NotificationBanner from '../components/common/NotificationBanner';
import { loadSavedUser, clearUser } from '../services/api';

export const AuthContext = createContext<{
  signIn: () => void;
  signOut: () => void;
}>({ signIn: () => {}, signOut: () => {} });

const AppShell = () => {
  const Stack = createNativeStackNavigator();
  const { colors } = useTheme();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    (async () => {
      const hasSession = await loadSavedUser();
      if (hasSession) setIsLoggedIn(true);
      setBootstrapping(false);
    })();
  }, []);

  if (bootstrapping) {
    return (
      <View style={[styles.splash, { backgroundColor: colors.bgPrimary }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <AuthContext.Provider value={{
      signIn:  () => setIsLoggedIn(true),
      signOut: () => { clearUser(); setIsLoggedIn(false); },
    }}>
      <OBDProvider>
        <NavigationContainer>
          {isLoggedIn ? (
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Main"          component={MainNavigator} />
              <Stack.Screen name="Profile"       component={ProfileScreen} />
              <Stack.Screen name="Settings"      component={SettingsScreen} />
              <Stack.Screen name="OBDConnection" component={OBDConnectionScreen} />
            </Stack.Navigator>
          ) : (
            <AuthNavigator />
          )}
        </NavigationContainer>
        <NotificationBanner />
      </OBDProvider>
    </AuthContext.Provider>
  );
};

const AppNavigator = () => (
  <ThemeProvider>
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  </ThemeProvider>
);

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

export default AppNavigator;
