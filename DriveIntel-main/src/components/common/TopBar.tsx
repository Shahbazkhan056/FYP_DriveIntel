import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../context/ThemeContext';

const TopBar = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  return (
    <View style={[styles.topBar, { borderBottomColor: colors.border, backgroundColor: colors.bgPrimary }]}>
      <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
      <TouchableOpacity style={styles.profileBtn} onPress={() => navigation.navigate('Profile')} activeOpacity={0.8}>
        <View style={[styles.profileCircle, { backgroundColor: colors.bgCardLight, borderColor: colors.borderLight }]}>
          <Text style={styles.profileIcon}>👤</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  topBar:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  logo:          { width: 90, height: 36 },
  profileBtn:    { padding: 2 },
  profileCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  profileIcon:   { fontSize: 20 },
});

export default TopBar;
