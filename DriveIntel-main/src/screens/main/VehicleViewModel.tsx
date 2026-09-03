import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  StatusBar, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Polygon, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '../../context/ThemeContext';
import { darkColors } from '../../theme/colors';
import { useOBD } from '../../context/OBDContext';

interface Props { navigation: any; }

type ComponentStatus = 'healthy' | 'warning';

const DiamondIcon = () => {
  const rotateAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(rotateAnim, { toValue: 1, duration: 3000, useNativeDriver: true })).start();
  }, []);
  const rotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Svg width={80} height={120} viewBox="0 0 80 120">
        <Defs>
          <LinearGradient id="grad1" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#00E5CC" stopOpacity="1" />
            <Stop offset="1" stopColor="#00FF87" stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Polygon points="40,5 70,40 40,60 10,40" fill="none" stroke="#00E5CC" strokeWidth="1.5" />
        <Polygon points="40,60 70,80 40,115 10,80" fill="none" stroke="#00E5CC" strokeWidth="1.5" />
        <Line x1="10" y1="40" x2="10" y2="80" stroke="#00E5CC" strokeWidth="1.5" />
        <Line x1="70" y1="40" x2="70" y2="80" stroke="#00E5CC" strokeWidth="1.5" />
        <Line x1="40" y1="5" x2="40" y2="60" stroke="#00E5CC" strokeWidth="0.8" strokeOpacity="0.5" />
        <Line x1="10" y1="40" x2="70" y2="40" stroke="#00E5CC" strokeWidth="0.8" strokeOpacity="0.5" />
        <Line x1="40" y1="60" x2="40" y2="115" stroke="#00E5CC" strokeWidth="0.8" strokeOpacity="0.5" />
        <Line x1="10" y1="80" x2="70" y2="80" stroke="#00E5CC" strokeWidth="0.8" strokeOpacity="0.5" />
      </Svg>
    </Animated.View>
  );
};

function deriveComponents(liveData: any, isConnected: boolean): { label: string; status: ComponentStatus }[] {
  if (!isConnected || !liveData) return [
    { label: 'Engine', status: 'healthy' }, { label: 'Transmission', status: 'healthy' },
    { label: 'Brakes', status: 'healthy' }, { label: 'Suspension', status: 'healthy' },
    { label: 'Exhaust', status: 'healthy' }, { label: 'Cooling System', status: 'healthy' },
  ];
  return [
    { label: 'Engine',        status: (liveData.engineLoad > 95 || liveData.rpm > 6000) ? 'warning' : 'healthy' },
    { label: 'Transmission',  status: 'healthy' },
    { label: 'Brakes',        status: 'healthy' },
    { label: 'Suspension',    status: 'healthy' },
    { label: 'Exhaust',       status: 'healthy' },
    { label: 'Cooling System',status: liveData.engineTemp > 100 ? 'warning' : 'healthy' },
  ];
}

const VehicleViewModel: React.FC<Props> = ({ navigation }) => {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { isConnected, liveData } = useOBD();
  const components = useMemo(() => deriveComponents(liveData, isConnected), [liveData, isConnected]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.bgPrimary} />
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>3D Vehicle View</Text>
          <Text style={styles.pageSubtitle}>Interactive component visualization</Text>
          <View style={styles.connectionBadge}>
            <View style={[styles.connectionDot, { backgroundColor: isConnected ? colors.healthy : colors.textMuted }]} />
            <Text style={styles.connectionText}>{isConnected ? 'OBD Connected — Live Data' : 'Not Connected'}</Text>
          </View>
        </View>

        <View style={styles.viewerCard}>
          <View style={styles.gridContainer}>
            {[...Array(8)].map((_, i) => <View key={`h${i}`} style={[styles.gridLineH, { top: `${(i + 1) * 12}%` as any }]} />)}
            {[...Array(8)].map((_, i) => <View key={`v${i}`} style={[styles.gridLineV, { left: `${(i + 1) * 12}%` as any }]} />)}
            <View style={styles.viewerInner}>
              <DiamondIcon />
              <Text style={styles.comingSoonTitle}>3D Visualization Coming Soon</Text>
              <Text style={styles.comingSoonDesc}>Interactive 3D vehicle model with real-time component health indicators powered by Three.js will be available here.</Text>
              <View style={styles.featureBadgesCol}>
                {['360° Rotation', 'Component Highlighting', 'Live Health Status'].map(label => (
                  <View key={label} style={styles.featureBadge}>
                    <Text style={styles.featureBadgeText}>{label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitleIcon}>🔄</Text>
            <Text style={styles.cardTitle}>View Controls</Text>
          </View>
          {[
            { icon: '🎯', label: 'Reset Camera Position', color: colors.primary },
            { icon: '🔄', label: 'Auto-Rotate',           color: colors.primary },
            { icon: 'ℹ️', label: 'Show Component Labels', color: colors.warning },
          ].map(({ icon, label, color }) => (
            <TouchableOpacity key={label} style={[styles.controlBtn, { borderColor: colors.border }]} activeOpacity={0.75}>
              <View style={[styles.controlBtnIcon, { borderColor: color }]}>
                <Text>{icon}</Text>
              </View>
              <Text style={styles.controlBtnLabel}>{label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.obdBtn, { borderColor: isConnected ? colors.healthy : colors.primary }]}
            onPress={() => navigation.navigate('OBDConnection')}
            activeOpacity={0.75}>
            <Text style={[styles.obdBtnText, { color: colors.textPrimary }]}>
              {isConnected ? '✅  OBD Connected' : '📡  Connect OBD-II'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Selectable Components</Text>
          <View style={styles.chipsGrid}>
            {components.map((c, i) => (
              <TouchableOpacity key={i} style={styles.chip} activeOpacity={0.8}>
                <Text style={styles.chipLabel}>{c.label}</Text>
                <View style={[styles.chipDot, { backgroundColor: c.status === 'healthy' ? colors.healthy : colors.warning }]} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: typeof darkColors) => StyleSheet.create({
  safeArea:          { flex: 1, backgroundColor: colors.bgPrimary },
  scrollView:        { flex: 1 },
  scrollContent:     { paddingHorizontal: 16, paddingTop: 8 },
  pageHeader:        { paddingVertical: 14, marginBottom: 4 },
  pageTitle:         { fontSize: 26, fontWeight: '800', color: colors.textPrimary },
  pageSubtitle:      { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  connectionBadge:   { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 },
  connectionDot:     { width: 8, height: 8, borderRadius: 4 },
  connectionText:    { fontSize: 12, color: colors.textSecondary },
  viewerCard:        { borderRadius: 16, overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  gridContainer:     { backgroundColor: '#0D1627', minHeight: 380, position: 'relative' },
  gridLineH:         { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#1E3050' },
  gridLineV:         { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#1E3050' },
  viewerInner:       { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24 },
  comingSoonTitle:   { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginTop: 20, marginBottom: 10 },
  comingSoonDesc:    { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  featureBadgesCol:  { alignItems: 'center', gap: 10 },
  featureBadge:      { backgroundColor: colors.bgCardLight, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 8, borderWidth: 1, borderColor: colors.border },
  featureBadgeText:  { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  card:              { backgroundColor: colors.bgCard, borderRadius: 16, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  cardTitleRow:      { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 8 },
  cardTitleIcon:     { fontSize: 18 },
  cardTitle:         { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: 14 },
  controlBtn:        { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgSecondary, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 14, marginBottom: 10, borderWidth: 1, gap: 12 },
  controlBtnIcon:    { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  controlBtnLabel:   { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
  obdBtn:            { borderRadius: 10, borderWidth: 1, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  obdBtnText:        { fontSize: 14, fontWeight: '600' },
  chipsGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip:              { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.bgSecondary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, width: '47%' },
  chipLabel:         { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
  chipDot:           { width: 9, height: 9, borderRadius: 5 },
});

export default VehicleViewModel;
