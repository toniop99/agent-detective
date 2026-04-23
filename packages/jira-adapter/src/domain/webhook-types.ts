export interface SimplifiedJiraUser {
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
  active?: boolean;
}

export interface SimplifiedJiraProject {
  id?: string;
  key?: string;
  name?: string;
}

export interface SimplifiedJiraIssueType {
  id?: string;
  name?: string;
  subtask?: boolean;
}

export interface SimplifiedJiraStatus {
  id?: string;
  name?: string;
  statusCategory?: {
    id?: number;
    key?: string;
    name?: string;
  };
}

export interface SimplifiedJiraPriority {
  id?: string;
  name?: string;
}

export interface SimplifiedJiraFields {
  summary?: string;
  description?: string | null;
  issuetype?: SimplifiedJiraIssueType;
  priority?: SimplifiedJiraPriority;
  status?: SimplifiedJiraStatus;
  project?: SimplifiedJiraProject;
  assignee?: SimplifiedJiraUser | null;
  reporter?: SimplifiedJiraUser | null;
  labels?: string[];
  created?: string;
  updated?: string;
}

export interface SimplifiedJiraIssue {
  id?: string;
  key?: string;
  self?: string;
  fields?: SimplifiedJiraFields;
}

export interface SimplifiedJiraPayload {
  webhookEvent?: string;
  timestamp?: number;
  issue?: SimplifiedJiraIssue;
  user?: SimplifiedJiraUser;
}

export interface JiraWebhookResponse {
  status: 'success' | 'error' | 'ignored';
  taskId?: string;
  message?: string;
}
