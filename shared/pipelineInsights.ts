export interface PipelineInsightEvidence {
  id: string; reportId: string; occurredAt: string | null; period: string;
  lead: string; url: string | null; quote: string;
}
export interface PipelineInsight {
  id: string; kind: 'metric' | 'coaching'; title: string; observation: string;
  interpretation: string; action: string; evidence: PipelineInsightEvidence[];
  metric: { label: string; numerator: number; denominator: number } | null;
}
export interface PipelineInsightResult {
  snapshotId: string; generatedAt: string; evidenceVersion: string; promptVersion: string;
  insights: PipelineInsight[]; coverage: string; cached: boolean;
}
