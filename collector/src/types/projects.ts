export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';
export type ProjectRole = 'active' | 'informed' | 'muted';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'edited';
export type ProposalAction = 'approve' | 'reject' | 'edit';

export interface ProjectParticipant {
  name: string;
  role?: string;
  source?: string;
}

export interface ProjectSource {
  type: string; // 'jira_project' | 'slack_channel' | 'github_repo' | 'drive_folder' | 'confluence_space'
  identifier: string; // e.g., 'PROJ', '#channel-name', 'org/repo'
  name?: string;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  goals: string[];
  status: ProjectStatus;
  myRole: ProjectRole;
  participants: ProjectParticipant[];
  sources: ProjectSource[];
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Proposal {
  id: string;
  projectId: string | null; // null = new project
  sessionId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  status: ProposalStatus;
  reviewedAt: string | null;
  createdAt: string;
}

export interface DiscoverySession {
  id: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt: string | null;
  proposalCount: number;
  error?: string;
}

// Request/Response DTOs
export interface CreateProjectRequest {
  title: string;
  description: string;
  goals?: string[];
  status?: ProjectStatus;
  myRole?: ProjectRole;
  participants?: ProjectParticipant[];
  sources?: ProjectSource[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateProjectRequest {
  title?: string;
  description?: string;
  goals?: string[];
  status?: ProjectStatus;
  myRole?: ProjectRole;
  participants?: ProjectParticipant[];
  sources?: ProjectSource[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateProposalRequest {
  projectId?: string | null;
  sessionId: string;
  field: string;
  oldValue?: unknown;
  newValue: unknown;
  reason: string;
}

export interface ReviewProposalRequest {
  action: ProposalAction;
  editedValue?: unknown;
}

export interface BatchReviewRequest {
  proposalIds: string[];
  action: ProposalAction;
}

export interface ProposalGroup {
  projectId: string | null;
  projectTitle?: string;
  isNew: boolean;
  proposals: Proposal[];
}
