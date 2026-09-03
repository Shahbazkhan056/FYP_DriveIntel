import { PermissionsAndroid, Platform } from 'react-native';

export interface Coords {
  lat: number;
  lng: number;
  accuracy?: number;
}

let _Geo: any = null;
try {
  _Geo = require('@react-native-community/geolocation').default;
} catch {
  // Native module not linked — app needs a native rebuild.
}

class LocationServiceClass {
  private cachedCoords: Coords | null = null;
  private lastFetchTime = 0;
  private readonly CACHE_TTL_MS = 30_000;

  async requestPermission(): Promise<boolean> {
    if (Platform.OS === 'ios') {
      if (!_Geo) return false;
      try {
        if (typeof _Geo.requestAuthorization === 'function') {
          // v3+ API returns a promise-like; just call it and let getCurrentPosition handle the result
          _Geo.requestAuthorization('whenInUse');
        }
        return true;
      } catch {
        return true; // let getCurrentPosition surface the real error
      }
    }
    try {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'DriveIntel needs your location to find nearby workshops.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        },
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }

  async getCurrentLocation(forceRefresh = false): Promise<Coords> {
    if (!_Geo) {
      throw new Error(
        'Location unavailable — app needs a native rebuild after installing geolocation package.',
      );
    }

    const now = Date.now();
    if (
      !forceRefresh &&
      this.cachedCoords &&
      now - this.lastFetchTime < this.CACHE_TTL_MS
    ) {
      return this.cachedCoords;
    }

    const hasPermission = await this.requestPermission();
    if (!hasPermission) {
      throw new Error('Location permission denied');
    }

    // Try high-accuracy GPS first, fall back to network/cell positioning
    return this._getPosition(true).catch(() => this._getPosition(false));
  }

  private _getPosition(highAccuracy: boolean): Promise<Coords> {
    return new Promise((resolve, reject) => {
      _Geo.getCurrentPosition(
        (pos: any) => {
          const coords: Coords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          };
          this.cachedCoords = coords;
          this.lastFetchTime = Date.now();
          resolve(coords);
        },
        (err: any) => reject(new Error(err?.message ?? 'GPS unavailable')),
        {
          enableHighAccuracy: highAccuracy,
          timeout: highAccuracy ? 20_000 : 10_000,
          maximumAge: 0,
        },
      );
    });
  }

  distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  clearCache() {
    this.cachedCoords = null;
    this.lastFetchTime = 0;
  }
}

export const LocationService = new LocationServiceClass();
export default LocationService;
