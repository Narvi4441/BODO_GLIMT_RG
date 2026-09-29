export type RiskState = 'NORMAL' | 'PRECAUTION' | 'ALERT' | 'CRITICAL'
export type CommandName = 'SET_TELEMETRY_RATE' | 'REQUEST_CHECK_IN' | 'EMERGENCY_MODE' | 'NORMAL_MODE'
export interface Telemetry {
  node_id: string; timestamp: number; sequence: number; latitude: number; longitude: number;
  speed_kmh: number; acceleration_ms2: number; battery_percent: number; latency_ms: number;
  route_deviation_m: number; interval_seconds: number; emergency: boolean;
  risk: { state: RiskState; reasons: string[] }
}
export interface CommandRecord { command_id: string; command: CommandName; sent_at: number; status: 'PENDING' | 'EXECUTED' | 'REJECTED' | 'TIMEOUT'; ack: null | { message: string; timestamp: number } }
export interface Snapshot { mqtt_connected: boolean; telemetry: Telemetry | null; received_at: number; commands: CommandRecord[] }
