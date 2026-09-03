import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, TextInput, StyleSheet,
  StatusBar, TouchableOpacity, ActivityIndicator,
  Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { darkColors } from '../../theme/colors';
import { useTheme } from '../../context/ThemeContext';
import TopBar from '../../components/common/TopBar';
import { getWorkshopsRecommend, getWorkshops, getUserId } from '../../services/api';
import { LocationService, Coords } from '../../services/LocationService';
import { useOBD } from '../../context/OBDContext';

interface WorkshopQuery {
  lat?: number;
  lng?: number;
  fault_categories?: string[];
  severity_level?: string;
  urgency?: string;
}

interface Props { navigation: any; route?: { params?: { workshopQuery?: WorkshopQuery } }; }

type Styles = ReturnType<typeof createStyles>;

const FILTERS = ['All', 'Open Now', 'Nearest', 'Top Rated', 'Recommended'];

const MapPlaceholder = ({ userCoords, workshops, styles, colors: c, onOpenMaps }: {
  userCoords: Coords | null;
  workshops: any[];
  styles: Styles;
  colors: typeof darkColors;
  onOpenMaps: () => void;
}) => (
  <View style={styles.mapBox}>
    {[20, 40, 60, 80].map(v => (
      <View key={`h${v}`} style={[styles.mapGridH, { top: `${v}%` as any }]} />
    ))}
    {[20, 40, 60, 80].map(v => (
      <View key={`v${v}`} style={[styles.mapGridV, { left: `${v}%` as any }]} />
    ))}
    {workshops.slice(0, 4).map((w, i) => {
      const positions: { top: any; left: any }[] = [
        { top: '25%', left: '22%' },
        { top: '55%', left: '65%' },
        { top: '40%', left: '45%' },
        { top: '70%', left: '30%' },
      ];
      const pos = positions[i] ?? { top: '50%', left: '50%' };
      const isRecommended = (w.matchScore ?? 0) > 0;
      return (
        <View key={w.id} style={[styles.mapPin, pos]}>
          <View style={[styles.mapPinDot, { backgroundColor: isRecommended ? c.warning : c.primary }]} />
          <Text style={styles.mapPinLabel} numberOfLines={1}>{w.name.split(' ')[0]}</Text>
        </View>
      );
    })}
    <View style={[styles.mapPin, { top: '45%' as any, left: '48%' as any }]}>
      <Svg width={28} height={36} viewBox="0 0 28 36">
        <Circle cx="14" cy="13" r="11" fill="none" stroke={c.primary} strokeWidth="2.5" />
        <Circle cx="14" cy="13" r="5" fill={c.primary} />
        <Path d="M14 24 L14 36" stroke={c.primary} strokeWidth="2" strokeLinecap="round" />
      </Svg>
    </View>
    <View style={styles.mapFooter}>
      {userCoords ? (
        <Text style={styles.mapCoordText}>
          {userCoords.lat.toFixed(4)}, {userCoords.lng.toFixed(4)}
        </Text>
      ) : (
        <Text style={styles.mapCoordText}>Locating...</Text>
      )}
      <TouchableOpacity onPress={onOpenMaps} activeOpacity={0.75}>
        <Text style={styles.mapOpenMapsBtn}>Open in Google Maps →</Text>
      </TouchableOpacity>
    </View>
  </View>
);

const WorkshopCard = ({ workshop, isRecommended, onCall, onDirections, styles, colors: c }: {
  workshop: any;
  isRecommended: boolean;
  onCall: () => void;
  onDirections: () => void;
  styles: Styles;
  colors: typeof darkColors;
}) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={[styles.card, isRecommended && styles.cardRecommended]}>
      {isRecommended && (workshop.matchScore ?? 0) > 0 && (
        <View style={styles.recommendedBanner}>
          <Text style={styles.recommendedText}>
            Recommended  ·  {workshop.matchedSpecialties?.slice(0, 2).join(', ')}
          </Text>
        </View>
      )}
      <TouchableOpacity onPress={() => setExpanded(e => !e)} activeOpacity={0.85}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.workshopName}>{workshop.name}</Text>
            <View style={styles.ratingRow}>
              <Text style={styles.star}>★</Text>
              <Text style={styles.rating}>{workshop.rating}</Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.distance}>{workshop.distance ?? '-- km'}</Text>
              {workshop.distanceKm !== undefined && (
                <Text style={styles.distanceAway}> away</Text>
              )}
            </View>
          </View>
          <View style={styles.headerRight}>
            <View style={[
              styles.openBadge,
              { backgroundColor: workshop.isOpen ? '#00E67615' : '#FF525215', borderColor: workshop.isOpen ? c.healthy : c.critical },
            ]}>
              <View style={[styles.openDot, { backgroundColor: workshop.isOpen ? c.healthy : c.critical }]} />
              <Text style={[styles.openText, { color: workshop.isOpen ? c.healthy : c.critical }]}>
                {workshop.isOpen ? 'Open' : 'Closed'}
              </Text>
            </View>
            <Text style={styles.expandArrow}>{expanded ? '▲' : '▼'}</Text>
          </View>
        </View>
      </TouchableOpacity>
      {expanded && (
        <>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>⊙</Text>
            <Text style={styles.infoText}>{workshop.address}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>◌</Text>
            <Text style={styles.infoText}>{workshop.phone}</Text>
          </View>
          <View style={styles.tagsRow}>
            {workshop.specialties?.map((s: string, i: number) => {
              const matched = workshop.matchedSpecialties?.includes(s);
              return (
                <View key={i} style={[styles.tag, matched && styles.tagMatched]}>
                  <Text style={[styles.tagText, matched && styles.tagTextMatched]}>{s}</Text>
                </View>
              );
            })}
          </View>
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.callBtn} onPress={onCall}>
              <Text style={styles.callBtnText}>Call</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dirBtn} onPress={onDirections}>
              <Text style={styles.dirBtnText}>Directions</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bookBtn}>
              <Text style={styles.bookBtnText}>Book</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
};

const WorkshopScreen: React.FC<Props> = ({ route }) => {
  const { colors: themeColors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  const { vehicleId } = useOBD();
  const effectiveVehicleId = vehicleId || getUserId();
  const aiQuery = route?.params?.workshopQuery;

  const [workshops, setWorkshops] = useState<any[]>([]);
  const [neededSpecialties, setNeededSpecialties] = useState<string[]>([]);
  const [dtcCodes, setDtcCodes] = useState<string[]>([]);
  const [userCoords, setUserCoords] = useState<Coords | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [search, setSearch] = useState(aiQuery?.fault_categories?.join(' ') ?? '');
  const [activeFilter, setActiveFilter] = useState(
    aiQuery?.fault_categories?.length ? 'Recommended' : 'All',
  );

  const initialized = useRef(false);

  const getLocation = useCallback(async (): Promise<Coords | null> => {
    setLocating(true);
    setLocationError(null);
    try {
      const coords = await LocationService.getCurrentLocation(true);
      setUserCoords(coords);
      return coords;
    } catch (err: any) {
      const msg = err?.message ?? 'GPS unavailable';
      setLocationError(msg);
      setUserCoords(null);
      return null;
    } finally {
      setLocating(false);
    }
  }, []);

  const fetchWorkshops = useCallback(async (coords: Coords | null) => {
    try {
      const res = await getWorkshopsRecommend(
        effectiveVehicleId,
        coords?.lat,
        coords?.lng,
      );
      setWorkshops(res.recommended ?? []);
      setNeededSpecialties(res.neededSpecialties ?? []);
      setDtcCodes(res.dtcCodes ?? []);
    } catch {
      try {
        const res = await getWorkshops(coords?.lat, coords?.lng);
        setWorkshops(
          (res.workshops ?? []).map((w: any) => ({ ...w, matchScore: 0, matchedSpecialties: [] })),
        );
      } catch {
        setWorkshops([]);
      }
    } finally {
      setLoading(false);
    }
  }, [effectiveVehicleId]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      const coords = await getLocation();
      await fetchWorkshops(coords);
    })();
  }, [getLocation, fetchWorkshops]);

  const handleRefresh = async () => {
    setLoading(true);
    LocationService.clearCache();
    const coords = await getLocation();
    await fetchWorkshops(coords);
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let result = workshops.filter(w =>
      w.name.toLowerCase().includes(q) ||
      w.specialties?.some((s: string) => s.toLowerCase().includes(q)),
    );
    if (activeFilter === 'Open Now')    result = result.filter(w => w.isOpen);
    if (activeFilter === 'Nearest')     result = [...result].sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
    if (activeFilter === 'Top Rated')   result = [...result].sort((a, b) => b.rating - a.rating);
    if (activeFilter === 'Recommended') result = [...result].sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
    return result;
  }, [workshops, search, activeFilter]);

  const handleCall = (phone: string) => {
    const stripped = phone.replace(/\s/g, '');
    Linking.openURL(`tel:${stripped}`).catch(() =>
      Alert.alert('Error', 'Cannot open phone dialler'),
    );
  };

  const handleDirections = (w: any) => {
    const destination = `${w.lat},${w.lng}`;
    const origin = userCoords ? `${userCoords.lat},${userCoords.lng}` : '';
    const url = origin
      ? `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`
      : `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
    Linking.openURL(url).catch(() =>
      Alert.alert('Error', 'Cannot open Google Maps'),
    );
  };

  // Opens Google Maps centred on the user's location with a nearby auto repair search.
  const handleOpenMaps = useCallback(() => {
    if (userCoords) {
      const url = `https://www.google.com/maps/search/auto+repair+workshop/@${userCoords.lat},${userCoords.lng},14z`;
      Linking.openURL(url).catch(() => Alert.alert('Error', 'Cannot open Google Maps'));
    } else {
      Alert.alert(
        'Location Not Yet Found',
        'Your location is still being detected. Please wait a moment and try again, or check that location permissions are granted.',
      );
    }
  }, [userCoords]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={themeColors.bgPrimary} />
      <TopBar />

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>

        <View style={styles.pageHeader}>
          <View style={styles.pageTitleRow}>
            <Text style={styles.pageTitle}>Nearby Workshops</Text>
            <TouchableOpacity style={styles.refreshBtn} onPress={handleRefresh} disabled={loading || locating}>
              {(loading || locating)
                ? <ActivityIndicator size="small" color={themeColors.primary} />
                : <Text style={styles.refreshIcon}>⟳</Text>}
            </TouchableOpacity>
          </View>
          <Text style={styles.pageSubtitle}>
            {userCoords
              ? `Location found${userCoords.accuracy ? ` (±${Math.round(userCoords.accuracy)}m)` : ''} · ${workshops.length} workshops nearby`
              : locationError
                ? `${locationError} — showing all workshops`
                : 'Detecting location...'}
          </Text>
        </View>

        {aiQuery?.urgency && (
          <View style={[styles.dtcBanner, {
            borderColor: aiQuery.severity_level === 'VERY_CRITICAL' || aiQuery.severity_level === 'HIGH'
              ? themeColors.critical : themeColors.warning,
          }]}>
            <Text style={styles.dtcBannerTitle}>
              AI Recommendation · {aiQuery.urgency}
            </Text>
            {aiQuery.fault_categories && aiQuery.fault_categories.length > 0 && (
              <Text style={styles.dtcBannerNeeds}>
                Fault systems: {aiQuery.fault_categories.slice(0, 4).join(', ')}
              </Text>
            )}
          </View>
        )}

        {!aiQuery && dtcCodes.length > 0 && neededSpecialties.length > 0 && (
          <View style={styles.dtcBanner}>
            <Text style={styles.dtcBannerTitle}>Workshops ranked for your fault codes</Text>
            <Text style={styles.dtcBannerCodes}>
              Active DTCs: {dtcCodes.slice(0, 4).join(', ')}
              {dtcCodes.length > 4 ? ` +${dtcCodes.length - 4} more` : ''}
            </Text>
            <Text style={styles.dtcBannerNeeds}>
              Needed: {neededSpecialties.slice(0, 3).join(' · ')}
            </Text>
          </View>
        )}

        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⊘</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search workshops or specialties..."
            placeholderTextColor={themeColors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Text style={styles.clearSearch}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        <MapPlaceholder userCoords={userCoords} workshops={filtered} styles={styles} colors={themeColors} onOpenMaps={handleOpenMaps} />

        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: themeColors.primary }]} />
            <Text style={styles.legendText}>Workshop</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: themeColors.warning }]} />
            <Text style={styles.legendText}>Recommended</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: themeColors.healthy }]} />
            <Text style={styles.legendText}>You</Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.filterBtn, activeFilter === f && styles.filterBtnActive]}
              onPress={() => setActiveFilter(f)}>
              <Text style={[styles.filterText, activeFilter === f && styles.filterTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={themeColors.primary} />
            <Text style={styles.loadingText}>
              {locating ? 'Getting your location...' : 'Loading workshops...'}
            </Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>◎</Text>
            <Text style={styles.emptyText}>No workshops match "{search}"</Text>
            <TouchableOpacity onPress={() => { setSearch(''); setActiveFilter('All'); }}>
              <Text style={styles.emptyReset}>Clear filters</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filtered.map(w => (
            <WorkshopCard
              key={w.id}
              workshop={w}
              isRecommended={(w.matchScore ?? 0) > 0}
              onCall={() => handleCall(w.phone)}
              onDirections={() => handleDirections(w)}
              styles={styles}
              colors={themeColors}
            />
          ))
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: typeof darkColors) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bgPrimary },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8 },
  pageHeader: { paddingVertical: 14 },
  pageTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pageTitle: { fontSize: 26, fontWeight: '800', color: colors.textPrimary },
  pageSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  refreshBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  refreshIcon: { fontSize: 18, color: colors.primary, fontWeight: '700' },
  dtcBanner: { backgroundColor: '#00E5CC10', borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: colors.primary },
  dtcBannerTitle: { fontSize: 13, fontWeight: '700', color: colors.primary, marginBottom: 4 },
  dtcBannerCodes: { fontSize: 12, color: colors.warning, marginBottom: 2 },
  dtcBannerNeeds: { fontSize: 12, color: colors.textSecondary },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, borderColor: colors.border, marginBottom: 14, gap: 8 },
  searchIcon: { fontSize: 15 },
  searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary },
  clearSearch: { fontSize: 14, color: colors.textMuted, paddingHorizontal: 4 },
  mapBox: { height: 170, backgroundColor: colors.bgSecondary, borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', position: 'relative' },
  mapGridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.border },
  mapGridV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.border },
  mapPin: { position: 'absolute', alignItems: 'center' },
  mapPinDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.bgPrimary },
  mapPinLabel: { fontSize: 9, color: colors.textSecondary, marginTop: 2, maxWidth: 50, textAlign: 'center' },
  mapFooter: { position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center' },
  mapCoordText: { fontSize: 11, color: colors.primary, fontWeight: '600' },
  mapOpenMapsBtn: { fontSize: 12, color: colors.primary, fontWeight: '700', marginTop: 4, paddingVertical: 3, paddingHorizontal: 8, backgroundColor: colors.primary + '18', borderRadius: 8, overflow: 'hidden' },
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginBottom: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: colors.textSecondary },
  filtersScroll: { marginBottom: 14 },
  filterBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 8, backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border },
  filterBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  filterTextActive: { color: '#0A0E1A', fontWeight: '700' },
  loadingBox: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  loadingText: { fontSize: 14, color: colors.textSecondary },
  emptyBox: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyIcon: { fontSize: 40 },
  emptyText: { fontSize: 15, color: colors.textSecondary, fontWeight: '600' },
  emptyReset: { fontSize: 13, color: colors.primary, fontWeight: '600', marginTop: 4 },
  card: { backgroundColor: colors.bgCard, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  cardRecommended: { borderColor: colors.primary, borderWidth: 1.5 },
  recommendedBanner: { backgroundColor: '#00E5CC10', borderRadius: 8, padding: 8, marginBottom: 10 },
  recommendedText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  workshopName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 4, flexShrink: 1 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  star: { fontSize: 13 },
  rating: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  dot: { fontSize: 12, color: colors.textMuted },
  distance: { fontSize: 13, fontWeight: '700', color: colors.primary },
  distanceAway: { fontSize: 11, color: colors.textSecondary },
  headerRight: { alignItems: 'flex-end', gap: 6 },
  openBadge: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, gap: 4 },
  openDot: { width: 6, height: 6, borderRadius: 3 },
  openText: { fontSize: 11, fontWeight: '700' },
  expandArrow: { fontSize: 10, color: colors.textMuted },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  infoIcon: { fontSize: 13, width: 18 },
  infoText: { fontSize: 13, color: colors.textSecondary, flex: 1 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 8 },
  tag: { backgroundColor: colors.bgSecondary, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: colors.border },
  tagMatched: { backgroundColor: '#00E5CC12', borderColor: colors.primary },
  tagText: { fontSize: 11, color: colors.textSecondary },
  tagTextMatched: { color: colors.primary, fontWeight: '600' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  callBtn: { flex: 1, height: 38, borderRadius: 10, backgroundColor: colors.bgSecondary, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  callBtnText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  dirBtn: { flex: 1, height: 38, borderRadius: 10, backgroundColor: '#00E5CC12', borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  dirBtnText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  bookBtn: { flex: 1, height: 38, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  bookBtnText: { fontSize: 12, color: '#0A0E1A', fontWeight: '700' },
});

export default WorkshopScreen;
