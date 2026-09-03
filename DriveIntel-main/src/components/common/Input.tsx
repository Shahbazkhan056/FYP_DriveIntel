import React from 'react';
import { View, TextInput, Text, TouchableOpacity, StyleSheet, TextInputProps } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

interface InputProps extends TextInputProps {
  label?: string;
  icon?: string;
  error?: string;
  rightIcon?: string;
  onRightIconPress?: () => void;
}

const Input: React.FC<InputProps> = ({ label, icon, error, rightIcon, onRightIconPress, ...textInputProps }) => {
  const { colors } = useTheme();
  return (
    <View style={styles.wrapper}>
      {label && <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>}
      <View style={[styles.container, { borderColor: error ? colors.critical : colors.border, backgroundColor: colors.bgSecondary }]}>
        {icon && <Text style={styles.icon}>{icon}</Text>}
        <TextInput
          style={[styles.input, { color: colors.textPrimary }]}
          placeholderTextColor={colors.textMuted}
          {...textInputProps}
        />
        {rightIcon && (
          <TouchableOpacity onPress={onRightIconPress} style={styles.rightBtn}>
            <Text style={styles.icon}>{rightIcon}</Text>
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={[styles.error, { color: colors.critical }]}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper:   { marginBottom: 18 },
  label:     { fontSize: 13, fontWeight: '500', marginBottom: 8, marginLeft: 2 },
  container: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, height: 52 },
  icon:      { fontSize: 16, marginRight: 10 },
  input:     { flex: 1, fontSize: 14, height: '100%' },
  rightBtn:  { padding: 4 },
  error:     { fontSize: 12, marginTop: 4, marginLeft: 2 },
});

export default Input;
