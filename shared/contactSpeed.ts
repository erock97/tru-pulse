/** Evidence contract. Only the Worker computes aggregates; clients render them. */
export interface ContactEvent {
  id: string; at: string | null; channel: 'call'|'sms'|'zillow_message'|'email';
  direction: 'outbound'|'inbound'; agentId: string;
  deliveryStatus?: string;
  personal: boolean|null; timeVerified: boolean; explanation: string;
}
export interface ContactLead {
  orgId: string; leadId: string; leadName?: string; agentId: string; agentName: string; leadUrl: string;
  collectedAt?: string;
  createdAt: string; historyComplete: boolean; events: ContactEvent[];
  gap?: {statement: string; sourceId: string; recordedAt: string; checked: string};
  connection?: {sourceId: string; explanation: string};
}
export interface ContactSnapshot {
  version: 1; orgId: string; capturedAt: string; from: string; through: string;
  leads: ContactLead[];
}
export interface ContactResult {
  lead: ContactLead; status: 'measured'|'response_recorded'|'missing_record'|'connection'|'unknown';
  seconds: number|null; first: ContactEvent|null; reason: string;
}
export interface ContactAgentResult {
  agentId: string; agentName: string; total: number; measured: number;
  averageSeconds: number|null; responseCount?: number; averageIsUpperBound?: boolean; results: ContactResult[];
  skill: {from:string; through:string; fullWindow:boolean; callFirst:number; textFirst:number; textPercent:number|null; aboveThreshold:boolean; consistency:'observed_behavior'};
}
export interface ContactReport {
  from:string; through:string; capturedAt:string; agents:ContactAgentResult[];
}

