export type JobStage = 'backlog' | 'ready' | 'scheduled' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
export type TaskStatus = 'pending' | 'done';

export type FieldTask = {
  id: string;
  title: string;
  dueAt: string;
  status: TaskStatus;
  completedAt: string;
  revision: number;
  updatedAt: string;
};

export type FieldMedia = {
  id: string;
  category: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  caption: string;
  createdAt: string;
};

export type FieldJob = {
  id: string;
  workNumber: string;
  title: string;
  serviceCategory: string;
  siteArea: string;
  stage: JobStage;
  priority: string;
  scheduledStart: string;
  scheduledEnd: string;
  assigneeMemberId: string;
  assigneeLabel: string;
  protectedJob: boolean;
  serviceAddress: string;
  revision: number;
  updatedAt: string;
  offlinePolicy: {
    containsPersonalData: boolean;
    maxAgeSeconds: number;
    purgeWhenUnassigned: boolean;
  };
  tasks: FieldTask[];
  media: FieldMedia[];
};

export type SyncChange = {
  sequence: number;
  entityType: string;
  entityId: string;
  operation: 'upsert' | 'delete';
  revision: number;
  changedAt?: string;
  entity?: FieldJob;
};

export type DevicePolicy = {
  minimumVersion?: string;
  latestVersion?: string;
  updateUrl?: string;
};

export type SyncResponse = {
  ok: boolean;
  contractVersion: number;
  bootstrap: boolean;
  serverTime: string;
  nextCursor: string;
  hasMore: boolean;
  changes: SyncChange[];
  devicePolicy?: DevicePolicy;
};

export type OfflineActionType = 'set_job_stage' | 'set_task_status' | 'add_time_entry';

export type OfflineAction = {
  clientActionId: string;
  type: OfflineActionType;
  workOrderId: string;
  taskId?: string;
  baseRevision: number;
  stage?: JobStage;
  status?: TaskStatus;
  workDate?: string;
  durationMinutes?: number;
  notes?: string;
};

export type QueueRow = {
  id: string;
  work_order_id: string;
  payload: string;
  status: 'queued' | 'retry' | 'conflict' | 'rejected';
  attempts: number;
  error_code: string;
  error_message: string;
  created_at: string;
};

export type UploadRow = {
  id: string;
  work_order_id: string;
  local_uri: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  category: string;
  caption: string;
  session_id: string;
  uploaded_parts: string;
  status: 'queued' | 'uploading' | 'retry' | 'completed' | 'rejected';
  attempts: number;
  error_message: string;
  created_at: string;
};

export type SyncState = {
  running: boolean;
  online: boolean;
  lastSyncedAt: string;
  queuedActions: number;
  queuedUploads: number;
  conflicts: number;
  updateRequired: string;
  message: string;
};
