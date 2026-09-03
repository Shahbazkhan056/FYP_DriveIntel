import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import OBDService from '../services/OBDService';
import { HybridBrand, HybridMode, DetectionResult } from '../services/HybridService';

export interface LiveData {
  // Standard ICE fields
  speed:        number;
  rpm:          number;
  engineTemp:   number;
  throttle:     number;
  fuelLevel:    number;   // petrol tank % — always distinct from HV battery
  engineLoad:   number;
  voltage:      number;
  intakeTemp:   number;
  maf:          number;
  fuelPressure: number;
  healthScore:  number;
  // Hybrid-specific (undefined for ICE vehicles)
  isHybrid?:            boolean;
  hybridBrand?:         HybridBrand;
  hybridMode?:          HybridMode;
  hvBatteryPct?:        number;   // HV battery % — never mixed with fuelLevel
  hvBatteryVoltage?:    number;
  hvBatteryCurrent?:    number;
  hvBatteryTemp?:       number;
  motorSpeed?:          number;
  mg2Speed?:            number;
  hybridSystemPower?:   number;
  regenPower?:          number;
  fuelRate?:            number;
  ambientTemp?:         number;
  hvBatteryAlert?:      string;
  staleCache?:          boolean;
}

interface OBDContextType {
  isConnected:      boolean;
  vehicleId:        string;
  vin:              string;
  liveData:         LiveData | null;
  ecuOdometerKm:    number | null;
  hybridDetection:  DetectionResult | null;
  setConnected:     (v: boolean) => void;
  setVehicleId:     (id: string) => void;
}

const OBDContext = createContext<OBDContextType>({
  isConnected:     false,
  vehicleId:       '',
  vin:             '',
  liveData:        null,
  ecuOdometerKm:   null,
  hybridDetection: null,
  setConnected:    () => {},
  setVehicleId:    () => {},
});

function calcHealthScore(d: any): number {
  let score = 100;
  if (d.engine_temp > 110) score -= 30;
  else if (d.engine_temp > 100) score -= 15;
  if (d.fuel_level < 10) score -= 20;
  else if (d.fuel_level < 20) score -= 10;
  if (d.voltage < 10.5) score -= 25;
  else if (d.voltage < 11.5) score -= 10;
  if (d.engine_load > 95) score -= 10;
  else if (d.engine_load > 80) score -= 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export const OBDProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected,     setIsConnected]     = useState(false);
  const [vehicleId,       setVehicleIdState]  = useState('');
  const [vin,             setVin]             = useState('');
  const [liveData,        setLiveData]        = useState<LiveData | null>(null);
  const [ecuOdometerKm,   setEcuOdometerKm]   = useState<number | null>(null);
  const [hybridDetection, setHybridDetection] = useState<DetectionResult | null>(null);

  // Holds last stable sensor values to show during TRANSITION mode
  const stableDataRef = useRef<Partial<LiveData>>({});

  useEffect(() => {
    OBDService.setVinCallback((detectedVin: string) => {
      if (detectedVin) setVin(detectedVin);
    });

    OBDService.setDataCallback((raw: any) => {
      const isHybrid = !!raw.is_hybrid;
      const hybridMode: HybridMode | undefined = raw.hybrid_mode;

      // Rule 4: During TRANSITION hold last stable sensor values — only update mode
      if (isHybrid && hybridMode === 'TRANSITION') {
        setLiveData(prev => {
          if (!prev) return prev;
          return { ...prev, hybridMode: 'TRANSITION', staleCache: false };
        });
        return;
      }

      const next: LiveData = {
        speed:        Math.round(raw.speed         ?? 0),
        rpm:          Math.round(raw.rpm           ?? 0),
        engineTemp:   Math.round(raw.engine_temp   ?? 0),
        throttle:     Math.round(raw.throttle      ?? 0),
        fuelLevel:    Math.round(raw.fuel_level    ?? 0),
        engineLoad:   Math.round(raw.engine_load   ?? 0),
        voltage:      parseFloat((raw.voltage      ?? 12.0).toFixed(1)),
        intakeTemp:   Math.round(raw.intake_temp   ?? 0),
        maf:          parseFloat((raw.maf          ?? 0).toFixed(2)),
        fuelPressure: Math.round(raw.fuel_pressure ?? 0),
        healthScore:  calcHealthScore(raw),
        // Hybrid fields
        ...(isHybrid && {
          isHybrid:           true,
          hybridBrand:        raw.hybrid_brand,
          hybridMode:         hybridMode,
          hvBatteryPct:       Math.round(raw.hv_battery_pct        ?? 0),
          hvBatteryVoltage:   parseFloat((raw.hv_battery_voltage   ?? 0).toFixed(1)),
          hvBatteryCurrent:   parseFloat((raw.hv_battery_current   ?? 0).toFixed(1)),
          hvBatteryTemp:      Math.round(raw.hv_battery_temp       ?? 0),
          motorSpeed:         Math.round(raw.motor_speed           ?? 0),
          mg2Speed:           Math.round(raw.mg2_speed             ?? 0),
          hybridSystemPower:  Math.round(raw.hybrid_system_power   ?? 0),
          regenPower:         Math.round(raw.regen_power           ?? 0),
          fuelRate:           parseFloat((raw.fuel_rate            ?? 0).toFixed(2)),
          ambientTemp:        Math.round(raw.ambient_temp          ?? 0),
          hvBatteryAlert:     raw.hv_battery_alert ?? '',
          staleCache:         !!raw.stale_cache,
        }),
      };

      if (isHybrid) stableDataRef.current = next;

      // Skip state update when all sensor values are identical (e.g. parked with
      // engine off). Prevents needless React re-renders every 2 s when nothing moves.
      setLiveData(prev => {
        if (
          prev &&
          prev.speed       === next.speed       &&
          prev.rpm         === next.rpm         &&
          prev.engineTemp  === next.engineTemp  &&
          prev.throttle    === next.throttle    &&
          prev.fuelLevel   === next.fuelLevel   &&
          prev.engineLoad  === next.engineLoad  &&
          prev.voltage     === next.voltage     &&
          prev.maf         === next.maf         &&
          prev.intakeTemp  === next.intakeTemp  &&
          prev.hybridMode  === next.hybridMode  &&
          prev.hvBatteryPct === next.hvBatteryPct
        ) return prev;
        return next;
      });
    });

    OBDService.setHybridDetectionCallback((result: DetectionResult) => {
      setHybridDetection(result);
    });

    OBDService.setOdometerCallback((km: number) => {
      setEcuOdometerKm(km);
    });

    OBDService.setDisconnectCallback(() => {
      setIsConnected(false);
      setVehicleIdState('');
      setVin('');
      setLiveData(null);
      setEcuOdometerKm(null);
      setHybridDetection(null);
      stableDataRef.current = {};
    });

    return () => {
      OBDService.setDataCallback(null);
      OBDService.setDisconnectCallback(null);
      OBDService.setVinCallback(null);
      OBDService.setOdometerCallback(null);
      OBDService.setHybridDetectionCallback(null);
    };
  }, []);

  const setConnected = (val: boolean) => {
    setIsConnected(val);
    if (!val) { setLiveData(null); setVin(''); }
  };

  return (
    <OBDContext.Provider value={{
      isConnected,
      vehicleId,
      vin,
      liveData,
      ecuOdometerKm,
      hybridDetection,
      setConnected,
      setVehicleId: setVehicleIdState,
    }}>
      {children}
    </OBDContext.Provider>
  );
};

export const useOBD = () => useContext(OBDContext);
export default OBDContext;
