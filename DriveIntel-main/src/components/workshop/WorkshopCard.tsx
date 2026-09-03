import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

export interface Workshop {
  name: string;
  address: string;
  distance: number | string;
  rating: number | string;
  phone: string;
  isOpen: boolean;
  isVerified?: boolean;
  matchScore?: number;
}

interface WorkshopCardProps {
  workshop: Workshop;
  onPress?: () => void;
}

const WorkshopCard: React.FC<WorkshopCardProps> = ({ workshop, onPress }) => {
  const { colors } = useTheme();
  return (
    <TouchableOpacity style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.top}>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.textPrimary }]}>{workshop.name}</Text>
            {workshop.isVerified && (
              <View style={[styles.verifiedBadge, { backgroundColor: colors.primary + '20' }]}>
                <Text style={[styles.verifiedText, { color: colors.primary }]}>✓ Verified</Text>
              </View>
            )}
          </View>
          <Text style={[styles.address, { color: colors.textSecondary }]}>{workshop.address}</Text>
        </View>
        <View style={styles.rightCol}>
          <Text style={[styles.distance, { color: colors.primary }]}>{workshop.distance} km</Text>
          <View style={[styles.openBadge, { backgroundColor: workshop.isOpen ? '#00E67615' : '#FF525215' }]}>
            <Text style={[styles.openText, { color: workshop.isOpen ? colors.healthy : colors.critical }]}>
              {workshop.isOpen ? 'Open' : 'Closed'}
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Text style={[styles.rating, { color: colors.textSecondary }]}>⭐ {workshop.rating}</Text>
        <Text style={[styles.phone, { color: colors.textSecondary }]}>📞 {workshop.phone}</Text>
        <TouchableOpacity style={[styles.navBtn, { backgroundColor: colors.primary }]}>
          <Text style={[styles.navBtnText, { color: colors.bgPrimary }]}>Navigate →</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card:          { borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1 },
  top:           { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  info:          { flex: 1, marginRight: 10 },
  nameRow:       { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  name:          { fontSize: 15, fontWeight: '700' },
  verifiedBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  verifiedText:  { fontSize: 10, fontWeight: '600' },
  address:       { fontSize: 12, lineHeight: 16 },
  rightCol:      { alignItems: 'flex-end', gap: 6 },
  distance:      { fontSize: 14, fontWeight: '700' },
  openBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  openText:      { fontSize: 11, fontWeight: '600' },
  footer:        { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, paddingTop: 10, gap: 12 },
  rating:        { fontSize: 13 },
  phone:         { flex: 1, fontSize: 12 },
  navBtn:        { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  navBtnText:    { fontSize: 12, fontWeight: '700' },
});

export default WorkshopCard;
