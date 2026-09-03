import axios, { AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Base URL ──────────────────────────────────────────────────
// USB cable + `adb reverse tcp:8000 tcp:8000` makes the phone reach the
// Mac's backend through localhost. This is the standard dev setup.
// If you switch to WiFi, replace 'localhost' with your Mac's LAN IP (e.g. '192.168.1.10').
const API_PORT = 8000;
const API_HOST = 'localhost';

const BASE_URL = `http://${API_HOST}:${API_PORT}`;

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
});

export const getApiErrorMessage = (err: unknown, fallback: string): string => {
  const error = err as AxiosError<any>;
  const detail = error.response?.data?.detail;

  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map(item => item?.msg || item?.message)
      .filter(Boolean)
      .join('\n') || fallback;
  }

  if (isNetworkError(err)) {
    return `Could not connect to DriveIntel API at ${BASE_URL}. Make sure the backend server is running and reachable from this device.`;
  }

  return fallback;
};

// ── Offline Queue ─────────────────────────────────────────────
// When a POST fails due to network unavailability the payload is stored
// in AsyncStorage. On the next successful request the queue is drained
// automatically (auto-sync without requiring NetInfo native module).

const QUEUE_KEY = 'driveintel_offline_queue';

interface QueuedRequest {
  id:       string;
  url:      string;
  data:     any;
  queuedAt: number;
}

const isNetworkError = (err: unknown): boolean => {
  const e = err as AxiosError;
  return !e.response && (e.code === 'ECONNABORTED' || e.code === 'ERR_NETWORK' || !e.code);
};

const loadQueue = async (): Promise<QueuedRequest[]> => {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};

const saveQueue = async (queue: QueuedRequest[]): Promise<void> => {
  try { await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch { /* ignore */ }
};

const enqueue = async (url: string, data: any): Promise<void> => {
  const queue = await loadQueue();
  queue.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, url, data, queuedAt: Date.now() });
  await saveQueue(queue);
  console.log(`[Offline] Queued ${url} (${queue.length} items pending)`);
};

// Drain queue — called after every successful request so sync happens
// opportunistically without a separate background timer.
let draining = false;
const drainQueue = async (): Promise<void> => {
  if (draining) return;
  draining = true;
  try {
    const queue = await loadQueue();
    if (queue.length === 0) return;
    const remaining: QueuedRequest[] = [];
    for (const item of queue) {
      try {
        await api.post(item.url, item.data);
        console.log(`[Offline] Synced queued request: ${item.url}`);
      } catch (err) {
        if (isNetworkError(err)) {
          remaining.push(item);  // still offline — keep in queue
          break;                 // don't bother retrying remaining items
        }
        // Server error (4xx/5xx) — discard stale item rather than loop forever
        console.warn(`[Offline] Discarding queued ${item.url} after server error`);
      }
    }
    await saveQueue(remaining);
  } finally {
    draining = false;
  }
};

// Wrap POST calls with offline fallback
const postWithOfflineFallback = async (url: string, data: any): Promise<any> => {
  try {
    const res = await api.post(url, data);
    // Successful — try to drain any previously queued items
    drainQueue().catch(() => {});
    return res.data;
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueue(url, data);
      return { success: true, queued: true };
    }
    throw err;
  }
};

// ── AsyncStorage Keys ─────────────────────────────────────────
const STORAGE_KEY = 'driveintel_user';

// ── In-Memory Cache ───────────────────────────────────────────
let currentUser = {
  userId: '',
  userName: '',
  userEmail: '',
  userPhone: '',
  token: '',
};

// ── Persist to AsyncStorage ───────────────────────────────────
const persistUser = async (user: typeof currentUser) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch { /* ignore */ }
};

// ── Load user from AsyncStorage on startup ────────────────────
export const loadSavedUser = async (): Promise<boolean> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved?.userId && saved?.token) {
        currentUser = saved;
        return true;   // valid session found
      }
    }
  } catch { /* ignore */ }
  return false;
};

// ── Auth ──────────────────────────────────────────────────────
export const registerUser = async (data: any) => {
  const response = await api.post('/auth/register', data);
  if (response.data.success) {
    currentUser = {
      userId:    response.data.userId,
      userName:  response.data.name,
      userEmail: response.data.email,
      userPhone: '',
      token:     response.data.token,
    };
    await persistUser(currentUser);
  }
  return response.data;
};

export const loginUser = async (data: any) => {
  const response = await api.post('/auth/login', data);
  if (response.data.success) {
    currentUser = {
      userId:    response.data.userId,
      userName:  response.data.name,
      userEmail: response.data.email,
      userPhone: '',
      token:     response.data.token,
    };
    await persistUser(currentUser);
  }
  return response.data;
};

export const getUserId    = () => currentUser.userId    || '';
export const getUserName  = () => currentUser.userName;
export const getUserEmail = () => currentUser.userEmail;
export const getUserPhone = () => currentUser.userPhone;

export const clearUser = async () => {
  currentUser = { userId: '', userName: '', userEmail: '', userPhone: '', token: '' };
  try { await AsyncStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
};

// ── OBD Data ──────────────────────────────────────────────────
export const saveOBDData = async (data: {
  vehicle_id: string; speed: number; rpm: number;
  engine_temp: number; fuel_level: number; throttle: number;
  engine_load: number; voltage: number; intake_temp: number;
  maf: number; fuel_pressure: number;
}) => postWithOfflineFallback('/obd/data', data);

export const getOBDLatest = async (vehicleId: string) => {
  const response = await api.get(`/obd/latest/${vehicleId}`);
  return response.data;
};

// ── DTC ───────────────────────────────────────────────────────
export const saveDTC = async (vehicleId: string, codes: string[]) =>
  postWithOfflineFallback('/dtc/save', { vehicle_id: vehicleId, codes });

export const getDTCCodes = async (vehicleId: string) => {
  const response = await api.get(`/dtc/${vehicleId}`);
  return response.data;
};

export const clearDTCCodes = async (vehicleId: string) => {
  const response = await api.post(`/dtc/clear/${vehicleId}`);
  return response.data;
};

// ── Maintenance ───────────────────────────────────────────────
export const getMaintenance = async (vehicleId: string) => {
  const response = await api.get(`/maintenance/${vehicleId}`);
  return response.data;
};

export const updateOdometer = async (vehicleId: string, odometerKm: number) => {
  const response = await api.post('/maintenance/odometer', { vehicle_id: vehicleId, odometer_km: odometerKm });
  return response.data;
};

export const logMaintenanceService = async (
  vehicleId: string,
  service: string,
  doneAtKm: number,
  cost: number,
  notes: string,
) => {
  const response = await api.post('/maintenance/log', {
    vehicle_id: vehicleId,
    service,
    done_at_km: doneAtKm,
    cost,
    notes,
  });
  return response.data;
};

// ── Workshops ─────────────────────────────────────────────────
export const getWorkshops = async (lat?: number, lng?: number) => {
  const params: any = {};
  if (lat !== undefined && lng !== undefined) { params.lat = lat; params.lng = lng; }
  const response = await api.get('/workshops', { params });
  return response.data;
};

export const getWorkshopsRecommend = async (
  vehicleId: string,
  lat?: number,
  lng?: number,
) => {
  const params: any = {};
  if (lat !== undefined && lng !== undefined) { params.lat = lat; params.lng = lng; }
  const response = await api.get(`/workshops/recommend/${vehicleId}`, { params });
  return response.data;
};

// ── Profile ───────────────────────────────────────────────────
export const getProfile = async (userId: string) => {
  const response = await api.get(`/profile/${userId}`);
  return response.data;
};

export const updateProfile = async (userId: string, name: string, phone: string) => {
  const response = await api.put(`/profile/${userId}`, { name, phone });
  if (response.data.success) {
    currentUser.userName  = name;
    currentUser.userPhone = phone;
    await persistUser(currentUser);
  }
  return response.data;
};

export const updateVehicle = async (userId: string, make: string, model: string, year: number) => {
  const response = await api.put(`/profile/${userId}/vehicle`, { make, model, year });
  return response.data;
};

export { BASE_URL };
export default api;
