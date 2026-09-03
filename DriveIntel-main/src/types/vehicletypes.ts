export type HealthStatus = 'healthy' | 'warning' | 'critical';

export interface ComponentHealth {
  id: string;
  name: string;
  status: HealthStatus;
  icon: string;
}

export interface VehicleData {
  speed: number;
  rpm: number;
  engineTemp: number;
  throttle: number;
  fuelLevel: number;
  batteryVoltage: number;
  healthScore: number;
}

export interface FaultCode {
  id: string;
  code: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  timestamp: string;
}

export interface Workshop {
  id: string;
  name: string;
  address: string;
  distance: string;
  rating: number;
  phone: string;
  latitude: number;
  longitude: number;
}
