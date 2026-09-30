export type NetworkStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE'
export type RiskStatus = 'NORMAL' | 'PRECAUTION' | 'ALERT' | 'CRITICAL'
export interface Risk { score: number; status: RiskStatus; reasons: string[] }
export interface Journey { journey_id: string; user_id: string; status: 'ACTIVE' | 'COMPLETED'; started_at: string; ended_at: string | null }
export interface SavedJourney { journey: Journey; stopPending: boolean }
export interface Telemetry {
  journey_id: string; user_id: string; latitude: number; longitude: number;
  accuracy: number | null; speed: number | null; heading: number | null;
  battery: number | null; latency_ms: number | null; packet_loss: null;
  network_status: NetworkStatus; route_deviation_m: number | null; timestamp: string;
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

export interface Coordinate { lat: number; lng: number }
export interface Destination extends Coordinate { name: string; address: string }
export interface RoutePlan {
  origin: Coordinate; destination: Coordinate;
  destinationName: string; destinationAddress: string;
  distance_m: number; duration_s: number; path: Coordinate[];
}
export interface TracePoint extends Coordinate { source: 'REAL' | 'DEMO'; timestamp: string }
export interface SafetyCamera extends Coordinate {
  id: string; hasCamera: boolean; hasHelpButton: boolean; hasSpeaker: boolean; distance_m?: number;
}
export interface RiskZone {
  zone_id: string; center: Coordinate; radius_m: number; incident_count: number; severity: 'YELLOW' | 'RED';
}
export interface DemoState { distance: number; moving: boolean; gpsAvailable: boolean; offset: 0 | 150 | 350 }
export interface DeviationEvent extends TracePoint { distance_m: number }
export interface EvidenceSnapshot {
  journey_id: string; destination: Destination | null; planned_path: Coordinate[]; actual_trace: TracePoint[];
  max_risk_status: RiskStatus | null; max_risk_score: number | null; deviation_events: DeviationEvent[];
  incident_note?: string;
}
export interface SavedEvidence extends EvidenceSnapshot { evidence_id: string; saved_at: number; expires_at: number }
export interface MonitorContact { id_tutor: number; nombre_completo: string; relacion: string }
export interface MonitorAccessRequest {
  journey_id: string; tutor_id: number; destination: Destination | null; planned_path: Coordinate[];
}
export interface MonitorSnapshot {
  journey_id: string; destination: Destination | null; planned_path: Coordinate[];
  current_position: Coordinate | null; risk_score: number | null; risk_status: RiskStatus | null;
  route_deviation_m: number | null; network_status: string | null; updated_at: string | null;
}
