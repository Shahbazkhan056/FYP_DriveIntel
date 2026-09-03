import notifee, {
  AndroidImportance,
  AndroidVisibility,
  AuthorizationStatus,
} from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// ── Android notification channel IDs ────────────────────────────
const CH_CRITICAL = 'driveintel_critical';
const CH_WARNING  = 'driveintel_warning';
const CH_INFO     = 'driveintel_info';

const PREFS_KEY = 'driveintel_prefs';
const NOTIF_LOG = 'driveintel_notif_log';
const MAX_LOG   = 50;

export type NotifSeverity = 'info' | 'warning' | 'critical';

export interface AppNotification {
  id:        string;
  title:     string;
  body:      string;
  severity:  NotifSeverity;
  timestamp: number;
}

type Listener = (notif: AppNotification) => void;

class NotificationService {
  private listeners:       Listener[] = [];
  private channelsReady    = false;
  private permissionStatus: AuthorizationStatus | null = null;

  // ── One-time setup ─────────────────────────────────────────────
  // Call from App.tsx on mount (before any notification is sent).
  // Creates Android channels — must exist before displayNotification().
  async init(): Promise<void> {
    await this._ensureChannels();
  }

  // ── OS permission request ──────────────────────────────────────
  // iOS  : shows the system "Allow Notifications?" dialog once.
  // Android 13+ : shows POST_NOTIFICATIONS runtime-permission dialog once.
  // Android <13 : notifications are granted by default; this is a no-op.
  // Returns true when the user granted permission.
  async requestPermission(): Promise<boolean> {
    try {
      const settings = await notifee.requestPermission();
      this.permissionStatus = settings.authorizationStatus;
      const granted =
        settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
        settings.authorizationStatus === AuthorizationStatus.PROVISIONAL;
      return granted;
    } catch (e) {
      console.warn('[Notif] requestPermission failed:', e);
      return false;
    }
  }

  // ── In-app listener subscription ──────────────────────────────
  // Screens subscribe here to drive their own in-app banners/toasts.
  subscribe(fn: Listener) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  // ── Core emit (internal) ───────────────────────────────────────
  private async emit(notif: AppNotification): Promise<void> {
    // 1. Notify in-app subscribers (banner / toast inside the app)
    this.listeners.forEach(fn => fn(notif));
    // 2. Persist to async log
    this._persist(notif).catch(() => {});
    // 3. Post to phone notification bar
    await this._postSystemNotification(notif);
  }

  // ── Android channel creation ───────────────────────────────────
  private async _ensureChannels(): Promise<void> {
    if (this.channelsReady) return;
    if (Platform.OS === 'android') {
      await notifee.createChannel({
        id:         CH_CRITICAL,
        name:       'DriveIntel Critical Alerts',
        importance: AndroidImportance.HIGH,     // heads-up popup even in foreground
        vibration:  true,
        sound:      'default',
        visibility: AndroidVisibility.PUBLIC,   // show on lock screen
      });
      await notifee.createChannel({
        id:         CH_WARNING,
        name:       'DriveIntel Warnings',
        importance: AndroidImportance.DEFAULT,
        vibration:  true,
        sound:      'default',
      });
      await notifee.createChannel({
        id:         CH_INFO,
        name:       'DriveIntel Info',
        importance: AndroidImportance.LOW,
      });
    }
    this.channelsReady = true;
  }

  // ── System notification bar post ──────────────────────────────
  private async _postSystemNotification(notif: AppNotification): Promise<void> {
    try {
      await this._ensureChannels();
      const channelId =
        notif.severity === 'critical' ? CH_CRITICAL :
        notif.severity === 'warning'  ? CH_WARNING  : CH_INFO;

      const accentColor =
        notif.severity === 'critical' ? '#FF5252' :
        notif.severity === 'warning'  ? '#FFC107' : '#00E5CC';

      await notifee.displayNotification({
        id:    notif.id,
        title: notif.title,
        body:  notif.body,
        android: {
          channelId,
          // HIGH importance on critical = heads-up banner even when app is open
          importance:  notif.severity === 'critical'
                         ? AndroidImportance.HIGH
                         : AndroidImportance.DEFAULT,
          smallIcon:   'ic_launcher',  // monochrome icon shown in status bar
          color:       accentColor,
          pressAction: { id: 'default' },
          // Show timestamp so driver knows when the alert fired
          showTimestamp: true,
        },
        ios: {
          // Only play sound for warning/critical — info is silent
          sound: notif.severity !== 'info' ? 'default' : undefined,
        },
      });
    } catch (e) {
      console.warn('[Notif] displayNotification failed:', e);
    }
  }

  // ── AsyncStorage persistence ───────────────────────────────────
  private async _persist(notif: AppNotification): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(NOTIF_LOG);
      const log: AppNotification[] = raw ? JSON.parse(raw) : [];
      log.unshift(notif);
      await AsyncStorage.setItem(NOTIF_LOG, JSON.stringify(log.slice(0, MAX_LOG)));
    } catch { /* storage errors are non-fatal */ }
  }

  private async _isEnabled(...prefs: string[]): Promise<boolean> {
    try {
      const raw = await AsyncStorage.getItem(PREFS_KEY);
      if (!raw) return true;
      const p = JSON.parse(raw);
      return prefs.every(key => p[key] !== false);
    } catch { return true; }
  }

  // ── Public notification triggers ──────────────────────────────

  async notifyFault(
    code:        string,
    description: string,
    severity:    'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_CRITICAL',
  ): Promise<void> {
    if (!(await this._isEnabled('faultAlerts', 'notifications'))) return;

    const sev: NotifSeverity =
      severity === 'VERY_CRITICAL' || severity === 'HIGH' ? 'critical' :
      severity === 'MEDIUM' ? 'warning' : 'info';

    await this.emit({
      id:        `fault-${code}-${Date.now()}`,
      title:     sev === 'critical' ? `Critical Fault: ${code}` : `Fault Detected: ${code}`,
      body:      description || `DTC code ${code} has been detected on your vehicle.`,
      severity:  sev,
      timestamp: Date.now(),
    });
  }

  async notifyMultipleFaults(count: number, highestSeverity: string): Promise<void> {
    if (!(await this._isEnabled('faultAlerts', 'notifications'))) return;

    const isCritical = highestSeverity === 'VERY_CRITICAL' || highestSeverity === 'HIGH';
    await this.emit({
      id:        `faults-${Date.now()}`,
      title:     isCritical
                   ? `${count} Critical Fault(s) Found`
                   : `${count} Fault(s) Detected`,
      body:      isCritical
                   ? 'Your vehicle has critical faults. Visit a workshop immediately.'
                   : `${count} fault code(s) were found. Run AI diagnostics for details.`,
      severity:  isCritical ? 'critical' : 'warning',
      timestamp: Date.now(),
    });
  }

  async notifyMaintenanceDue(service: string, remainingKm: number): Promise<void> {
    if (!(await this._isEnabled('notifications'))) return;

    const isOverdue = remainingKm <= 0;
    await this.emit({
      id:        `maint-${service}-${Date.now()}`,
      title:     isOverdue ? `${service} Overdue` : `${service} Due Soon`,
      body:      isOverdue
                   ? `${service} is overdue by ${Math.abs(remainingKm)} km. Schedule service now.`
                   : `${service} is due in ${remainingKm} km.`,
      severity:  isOverdue ? 'critical' : 'warning',
      timestamp: Date.now(),
    });
  }

  async checkMaintenanceSchedule(
    upcoming: { service: string; remaining_km: number }[],
  ): Promise<void> {
    if (!(await this._isEnabled('notifications'))) return;
    const urgent = upcoming.filter(u => u.remaining_km <= 500);
    for (const item of urgent) {
      await this.notifyMaintenanceDue(item.service, item.remaining_km);
    }
  }

  // ── Log access ─────────────────────────────────────────────────
  async getLog(): Promise<AppNotification[]> {
    try {
      const raw = await AsyncStorage.getItem(NOTIF_LOG);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  async clearLog(): Promise<void> {
    try { await AsyncStorage.removeItem(NOTIF_LOG); } catch { /* ignore */ }
  }
}

export default new NotificationService();
