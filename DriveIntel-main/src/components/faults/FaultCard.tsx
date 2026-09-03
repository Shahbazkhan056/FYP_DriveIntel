import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

type Severity = 'warning' | 'critical' | 'healthy';

interface FaultCardProps {
  code: string;
  severity: Severity;
  description: string;
  possibleCause: string;
  recommendedAction: string;
  onClear?: () => void;
  onGetHelp?: () => void;
}

const SEV_COLORS = {
  warning:  { color: '#FFA726', label: 'Warning',  icon: '⚠️', iconBg: '#FFA72622' },
  critical: { color: '#FF5252', label: 'Critical', icon: '🔴', iconBg: '#FF525222' },
  healthy:  { color: '#00E676', label: 'Healthy',  icon: '✅', iconBg: '#00E67622' },
};

const FaultCard: React.FC<FaultCardProps> = ({
  code, severity, description, possibleCause, recommendedAction, onClear, onGetHelp,
}) => {
  const { colors } = useTheme();
  const cfg = SEV_COLORS[severity];

  return (
    <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border, borderLeftColor: cfg.color }]}>
      <View style={styles.header}>
        <View style={[styles.iconCircle, { backgroundColor: cfg.iconBg, borderColor: cfg.color }]}>
          <Text style={styles.iconText}>{cfg.icon}</Text>
        </View>
        <View style={styles.codeBlock}>
          <Text style={[styles.code, { color: colors.textPrimary }]}>{code}</Text>
          <Text style={[styles.severityLabel, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
      </View>

      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Description</Text>
      <Text style={[styles.sectionValue, { color: colors.textPrimary }]}>{description}</Text>

      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Possible Cause</Text>
      <Text style={[styles.sectionValue, { color: colors.textPrimary }]}>{possibleCause}</Text>

      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Recommended Action</Text>
      <Text style={[styles.sectionValue, { color: colors.textPrimary }]}>{recommendedAction}</Text>

      {severity !== 'healthy' && (
        <View style={styles.buttonsRow}>
          <TouchableOpacity style={[styles.clearBtn, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]} onPress={onClear} activeOpacity={0.8}>
            <Text style={[styles.clearBtnText, { color: colors.textSecondary }]}>Clear Code</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.helpBtn, { backgroundColor: colors.primary, shadowColor: colors.primary }]} onPress={onGetHelp} activeOpacity={0.85}>
            <Text style={[styles.helpBtnText, { color: colors.bgPrimary }]}>Get Help</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card:         { borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderLeftWidth: 4 },
  header:       { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  iconCircle:   { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  iconText:     { fontSize: 18 },
  codeBlock:    { flex: 1 },
  code:         { fontSize: 18, fontWeight: '700', lineHeight: 22 },
  severityLabel:{ fontSize: 13, fontWeight: '500', marginTop: 1 },
  sectionLabel: { fontSize: 11, marginBottom: 3, marginTop: 10, letterSpacing: 0.3 },
  sectionValue: { fontSize: 14, fontWeight: '500', lineHeight: 20 },
  buttonsRow:   { flexDirection: 'row', gap: 10, marginTop: 16 },
  clearBtn:     { flex: 1, height: 44, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  clearBtnText: { fontSize: 14, fontWeight: '600' },
  helpBtn:      { flex: 1, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 6 },
  helpBtnText:  { fontSize: 14, fontWeight: '700' },
});

export default FaultCard;
