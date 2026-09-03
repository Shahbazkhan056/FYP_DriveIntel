import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

const Button: React.FC<ButtonProps> = ({
  title, onPress, variant = 'primary', loading = false, disabled = false, style,
}) => {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[
        styles.base,
        variant === 'primary'  && { backgroundColor: colors.primary, shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
        variant === 'outline'  && { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.primary },
        variant === 'ghost'    && { backgroundColor: 'transparent' },
        disabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      activeOpacity={0.8}
      disabled={disabled || loading}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.bgPrimary : colors.primary} />
      ) : (
        <Text style={[
          styles.text,
          variant === 'primary' && { color: colors.bgPrimary },
          (variant === 'outline' || variant === 'ghost') && { color: colors.primary },
        ]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base:     { height: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  disabled: { opacity: 0.5 },
  text:     { fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
});

export default Button;
