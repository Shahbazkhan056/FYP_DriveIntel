import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DashboardScreen from '../screens/main/DashboardScreen';
import DiagnosticsScreen from '../screens/main/DiagnosticsScreen';
import VehicleViewModel from '../screens/main/VehicleViewModel';
import MaintenanceScreen from '../screens/main/MaintenanceScreen';
import WorkshopScreen from '../screens/main/WorkshopScreen';
import { useTheme } from '../context/ThemeContext';
import { darkColors } from '../theme/colors';

const Tab = createBottomTabNavigator();

const TABS = [
  { name: 'Dashboard',  label: 'Dashboard',   icon: 'speedometer-medium' },
  { name: 'Diagnostics',label: 'Diagnostics', icon: 'stethoscope'        },
  { name: 'Vehicle3D',  label: '',            icon: 'car'                },
  { name: 'Maintenance',label: 'Maintenance', icon: 'wrench-outline'     },
  { name: 'Workshop',   label: 'Workshop',    icon: 'map-marker-outline' },
];

const CustomTabBar: React.FC<BottomTabBarProps> = ({ state, navigation }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.tabBar}>
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const isMiddle  = index === 2;
        const tab       = TABS[index];
        return (
          <TouchableOpacity
            key={route.key}
            style={[styles.tabItem, isMiddle && styles.tabItemMiddle]}
            onPress={() => navigation.navigate(route.name)}
            activeOpacity={0.7}>
            {isMiddle ? (
              <View style={[styles.middleButton, isFocused && styles.middleButtonActive]}>
                <Icon name="car" size={26} color={colors.bgPrimary} />
              </View>
            ) : (
              <>
                <Icon
                  name={tab.icon}
                  size={22}
                  color={isFocused ? colors.primary : colors.textMuted}
                />
                <Text style={[styles.tabLabel, isFocused && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
              </>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const MainNavigator = () => (
  <Tab.Navigator
    tabBar={(props) => <CustomTabBar {...props} />}
    screenOptions={{ headerShown: false }}>
    <Tab.Screen name="Dashboard"  component={DashboardScreen} />
    <Tab.Screen name="Diagnostics"component={DiagnosticsScreen} />
    <Tab.Screen name="Vehicle3D"  component={VehicleViewModel} />
    <Tab.Screen name="Maintenance"component={MaintenanceScreen} />
    <Tab.Screen name="Workshop"   component={WorkshopScreen} />
  </Tab.Navigator>
);

const createStyles = (colors: typeof darkColors) => StyleSheet.create({
  tabBar:             { flexDirection: 'row', backgroundColor: colors.bgCard, borderTopWidth: 1, borderTopColor: colors.border, paddingBottom: 8, paddingTop: 8, paddingHorizontal: 4 },
  tabItem:            { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4, gap: 3 },
  tabItemMiddle:      { marginTop: -20 },
  tabLabel:           { fontSize: 10, color: colors.textMuted, fontWeight: '500' },
  tabLabelActive:     { color: colors.primary, fontWeight: '700' },
  middleButton:       { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 10 },
  middleButtonActive: { backgroundColor: colors.primaryGradientEnd },
});

export default MainNavigator;
