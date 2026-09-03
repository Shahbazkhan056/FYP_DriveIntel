import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

type HealthStatus = 'healthy' | 'warning' | 'critical';

interface Props {
  name: string;
  status: HealthStatus;
}

const STATUS_CFG = {
  healthy:  { color: '#00E676', label: 'Healthy',  icon: '✅' },
  warning:  { color: '#FFA726', label: 'Warning',  icon: '⚠️' },
  critical: { color: '#FF5252', label: 'Critical', icon: '🔴' },
};

const ComponentHealthRow: React.FC<Props> = ({ name, status }) => {
  const { colors } = useTheme();
  const cfg = STATUS_CFG[status];
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={styles.left}>
        <Text style={styles.icon}>{cfg.icon}</Text>
        <Text style={[styles.name, { color: colors.textPrimary }]}>{name}</Text>
      </View>
      <View style={[styles.badge, { backgroundColor: cfg.color + '22', borderColor: cfg.color }]}>
        <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  left:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon:      { fontSize: 18 },
  name:      { fontSize: 14, fontWeight: '600' },
  badge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  badgeText: { fontSize: 12, fontWeight: '600' },
});

export default ComponentHealthRow;
