import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

type Severity = 'low' | 'medium' | 'high' | 'critical';

interface SeverityIndicatorProps {
  severity: Severity;
  showLabel?: boolean;
}

const severityColors: Record<Severity, string> = {
  low: '#40C4FF',
  medium: '#FFA726',
  high: '#FF7043',
  critical: '#FF5252',
};

const severityBars: Record<Severity, number> = {
  low: 1, medium: 2, high: 3, critical: 4,
};

const severityLabels: Record<Severity, string> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
};

const SeverityIndicator: React.FC<SeverityIndicatorProps> = ({ severity, showLabel = true }) => {
  const { colors } = useTheme();
  const color = severityColors[severity];
  const bars = severityBars[severity];
  const label = severityLabels[severity];

  return (
    <View style={styles.row}>
      {[1, 2, 3, 4].map(i => (
        <View
          key={i}
          style={[
            styles.bar,
            { height: 6 + i * 3, backgroundColor: i <= bars ? color : colors.border },
          ]}
        />
      ))}
      {showLabel && <Text style={[styles.label, { color }]}>{label}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  bar: { width: 5, borderRadius: 2 },
  label: { fontSize: 12, fontWeight: '600', marginLeft: 6 },
});

export default SeverityIndicator;
