export interface PrdImageRenameItem {
  documentPath: string;
  from: string;
  to: string;
  label: string;
  references: number;
}
export interface PrdImageRenamePreview {
  digest: string;
  items: PrdImageRenameItem[];
  documentCount: number;
  referenceCount: number;
  warnings: string[];
  backupParentDirectory?: string;
}
