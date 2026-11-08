export interface PrdScreenshotMatch {
  asset: string;
  marker: string;
  pages: string[];
  error?: string;
}
export interface PrdScreenshotPlan {
  digest: string;
  document: string;
  items: PrdScreenshotMatch[];
  viewport: { width: number; height: number };
}
export interface PrdScreenshotResult {
  asset: string;
  marker: string;
  page: string;
  previewUrl?: string;
  error?: string;
}
export interface PrdScreenshotJob {
  jobId: string;
  items: PrdScreenshotResult[];
}
