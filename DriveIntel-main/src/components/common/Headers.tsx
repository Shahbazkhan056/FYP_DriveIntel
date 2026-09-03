import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

interface HeaderProps {
  title: string;
  onBack?: () => void;
  rightAction?: { icon: string; onPress: () => void };
}

const Header: React.FC<HeaderProps> = ({ title, onBack, rightAction }) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} style={styles.btn}>
          <Text style={[styles.btnText, { color: colors.primary }]}>←</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.placeholder} />
      )}
      <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
      {rightAction ? (
        <TouchableOpacity onPress={rightAction.onPress} style={styles.btn}>
          <Text style={[styles.btnText, { color: colors.primary }]}>{rightAction.icon}</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.placeholder} />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  title:       { fontSize: 16, fontWeight: '700' },
  btn:         { padding: 8, width: 40, alignItems: 'center' },
  btnText:     { fontSize: 18 },
  placeholder: { width: 40 },
});

export default Header;
