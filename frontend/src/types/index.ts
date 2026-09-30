export type NetworkStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE'
export type RiskStatus = 'NORMAL' | 'PRECAUTION' | 'ALERT' | 'CRITICAL'
export interface Risk { score: number; status: RiskStatus; reasons: string[] }
export interface Journey { journey_id: string; user_id: string; status: 'ACTIVE' | 'COMPLETED'; started_at: string; ended_at: string | null }
export interface SavedJourney { journey: Journey; stopPending: boolean }
export interface Telemetry {
  journey_id: string; user_id: string; latitude: number; longitude: number;
  accuracy: number | null; speed: number | null; heading: number | null;
  battery: number | null; latency_ms: number | null; packet_loss: null;
  network_status: NetworkStatus; route_deviation_m: null; timestamp: string;
}
export type AckStatus = 'RECEIVED' | 'EXECUTING' | 'EXECUTED' | 'FAILED'
export interface Command { command_id: string; journey_id: string; user_id: string; action: string; value: string | number | null; status: string; message?: string }
export interface TelemetryResult { status: string; risk: Risk; automatic_command: Command | null }
export type RealtimeEvent = { type: 'telemetry'; data: Telemetry & { risk_score: number; risk_status: RiskStatus; risk_reasons: string[] } } | { type: 'command' | 'command_ack'; data: Command }
export type PendingItem = { id?: number; kind: 'telemetry'; payload: Telemetry } | { id?: number; kind: 'ack'; command_id: string; payload: {status: AckStatus; message: string} }
export interface User { id_usuario: number; nombre_completo: string; email: string }
export interface LoginResult { success: boolean; access_token: string; token_type: 'bearer'; user: User }
export interface Tutor { nombre_completo: string; telefono: string; email: string; relacion: string }
export interface Registration { nombre_completo: string; telefono: string; email: string; password: string; confirm_password: string; tutor: Tutor }
