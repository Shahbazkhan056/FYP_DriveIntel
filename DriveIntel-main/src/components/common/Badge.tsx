import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

type BadgeVariant = 'healthy' | 'warning' | 'critical' | 'info' | 'default';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

const Badge: React.FC<BadgeProps> = ({ label, variant = 'default' }) => {
  const { colors } = useTheme();

  const variantMap: Record<BadgeVariant, { color: string; bg: string }> = {
    healthy:  { color: colors.healthy,       bg: '#00E67615' },
    warning:  { color: colors.warning,       bg: '#FFA72615' },
    critical: { color: colors.critical,      bg: '#FF525215' },
    info:     { color: colors.info,          bg: '#40C4FF15' },
    default:  { color: colors.textSecondary, bg: colors.border },
  };

  const { color, bg } = variantMap[variant];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  text:  { fontSize: 12, fontWeight: '600' },
});

export default Badge;
