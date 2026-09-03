import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import NotificationService, { AppNotification } from '../../services/NotificationService';

const COLORS = {
  critical: { bg: '#FF525222', border: '#FF5252', icon: '🚨' },
  warning:  { bg: '#FFA72622', border: '#FFA726', icon: '⚠️'  },
  info:     { bg: '#40C4FF22', border: '#40C4FF', icon: 'ℹ️'  },
};

const AUTO_DISMISS_MS = 5000;

const BannerItem: React.FC<{ notif: AppNotification; onDismiss: () => void }> = ({ notif, onDismiss }) => {
  const slideY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
      Animated.timing(opacity,  { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => dismiss(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: -120, duration: 250, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => onDismiss());
  };

  const cfg = COLORS[notif.severity];

  return (
    <Animated.View style={[styles.banner, { backgroundColor: cfg.bg, borderColor: cfg.border, transform: [{ translateY: slideY }], opacity }]}>
      <Text style={styles.icon}>{cfg.icon}</Text>
      <View style={styles.textCol}>
        <Text style={[styles.title, { color: cfg.border }]} numberOfLines={1}>{notif.title}</Text>
        <Text style={styles.body} numberOfLines={2}>{notif.body}</Text>
      </View>
      <TouchableOpacity onPress={dismiss} style={styles.closeBtn}>
        <Text style={styles.closeText}>✕</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const NotificationBanner: React.FC = () => {
  const [queue, setQueue] = useState<AppNotification[]>([]);

  useEffect(() => {
    const unsub = NotificationService.subscribe(notif => {
      setQueue(q => [notif, ...q].slice(0, 3));
    });
    return unsub;
  }, []);

  const dismiss = (id: string) => setQueue(q => q.filter(n => n.id !== id));

  if (queue.length === 0) return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      {queue.map(n => (
        <BannerItem key={n.id} notif={n} onDismiss={() => dismiss(n.id)} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 9999,
    paddingHorizontal: 12, paddingTop: 52, gap: 8,
  },
  banner: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 14, borderWidth: 1.5,
    paddingHorizontal: 14, paddingVertical: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 10,
  },
  icon:       { fontSize: 22, marginRight: 10 },
  textCol:    { flex: 1 },
  title:      { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  body:       { fontSize: 12, color: '#AABBCC', lineHeight: 17 },
  closeBtn:   { padding: 4, marginLeft: 8 },
  closeText:  { fontSize: 13, color: '#8899BB', fontWeight: '700' },
});

export default NotificationBanner;
