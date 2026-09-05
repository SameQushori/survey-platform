import type {
  AssessmentDraftDTO,
  AssessmentListItemDTO,
  AbandonAttemptResponse,
  AttemptStateDTO,
  CreateAttemptRequest,
  CreateAttemptResponse,
  CreatedInvitationDTO,
  CreateInvitationBatchRequest,
  CreateAssessmentRequest,
  DistributionDTO,
  InvitationDTO,
  OrganizationMemberDTO,
  OrganizationMemberStatusDTO,
  OrganizationSummaryDTO,
  OrganizationWorkspaceDTO,
  OrganizerSessionDTO,
  OrganizerLoginChallengeDTO,
  OrganizerLoginVerificationDTO,
  OrganizerAttemptDetailDTO,
  OrganizerAttemptsPageDTO,
  PublishAssessmentResponse,
  ReopenPublicationResponse,
  PublicRuntimeConfigDTO,
  QuestionAnalysisDTO,
  ResolvedPublicationDTO,
  ResultsOverviewDTO,
  SaveAnswerRequest,
  SaveAnswerResponse,
  SubmitAttemptResponse,
} from '../../shared/contracts';
import { organizerLoginUrl } from './organizerLogin';

export type LocalIdentityRole = 'organizer' | 'super_admin';

const localIdentities = {
  organizer: {
    email: 'organizer@vecta.local',
    subject: 'local:organizer',
  },
  super_admin: {
    email: 'admin@vecta.local',
    subject: 'local:super-admin',
  },
} as const;

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly title: string | undefined;

  constructor(status: number, problem?: { code?: string; title?: string }) {
    super(problem?.title ?? `Vecta API request failed with status ${status}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = problem?.code;
    this.title = problem?.title;
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const problem = await response.json().catch(() => undefined) as { code?: string; title?: string } | undefined;
    throw new ApiRequestError(response.status, problem);
  }
  return response.json() as Promise<T>;
}

async function authorizedFetch(path: string, role: LocalIdentityRole, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers({ 'X-Requested-With': 'XMLHttpRequest' });

  for (const [name, value] of new Headers(init.headers)) headers.set(name, value);

  if (import.meta.env.DEV) {
    const identity = localIdentities[role];
    headers.set('X-Vecta-Local-Subject', identity.subject);
    headers.set('X-Vecta-Local-Email', identity.email);
  }

  return fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers,
  });
}

async function authorizedRequest<T>(path: string, role: LocalIdentityRole, init: RequestInit = {}): Promise<T> {
  const response = await authorizedFetch(path, role, init);
  return responseJson<T>(response);
}

async function publicRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers({ 'X-Requested-With': 'XMLHttpRequest' });
  for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
  const response = await fetch(path, { ...init, credentials: 'same-origin', headers });
  return responseJson<T>(response);
}

export function getOrganizerSession(role: LocalIdentityRole): Promise<OrganizerSessionDTO> {
  return authorizedRequest('/api/v1/session', role);
}

export function requestOrganizerLoginCode(email: string, turnstileToken: string): Promise<OrganizerLoginChallengeDTO> {
  return publicRequest('/api/v1/auth/request-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, turnstileToken }),
  });
}

export function verifyOrganizerLoginCode(challengeId: string, code: string): Promise<OrganizerLoginVerificationDTO> {
  return publicRequest('/api/v1/auth/verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId, code }),
  });
}

export function getOrganizations(): Promise<OrganizationSummaryDTO[]> {
  return authorizedRequest('/api/v1/organizations', 'super_admin');
}

export function createOrganization(input: { name: string; slug: string }): Promise<OrganizationSummaryDTO> {
  return authorizedRequest('/api/v1/organizations', 'super_admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function getOrganizationWorkspace(organizationId: string): Promise<OrganizationWorkspaceDTO> {
  return authorizedRequest(`/api/v1/organizations/${encodeURIComponent(organizationId)}/workspace`, 'super_admin');
}

export function getOrganizationMembers(organizationId: string): Promise<OrganizationMemberDTO[]> {
  return authorizedRequest(`/api/v1/organizations/${encodeURIComponent(organizationId)}/members`, 'super_admin');
}

export function addOrganizationMember(
  organizationId: string,
  input: { displayName: string; email: string },
): Promise<OrganizationMemberDTO> {
  return authorizedRequest(`/api/v1/organizations/${encodeURIComponent(organizationId)}/members`, 'super_admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateOrganizationMemberStatus(
  organizationId: string,
  membershipId: string,
  status: 'active' | 'disabled',
): Promise<OrganizationMemberStatusDTO> {
  return authorizedRequest(`/api/v1/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(membershipId)}`, 'super_admin', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

export function getAssessments(organizationId: string): Promise<AssessmentListItemDTO[]> {
  return authorizedRequest(`/api/v1/organizations/${encodeURIComponent(organizationId)}/assessments`, 'organizer');
}

export function createAssessment(
  organizationId: string,
  input: CreateAssessmentRequest,
): Promise<AssessmentListItemDTO> {
  return authorizedRequest(`/api/v1/organizations/${encodeURIComponent(organizationId)}/assessments`, 'organizer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function getAssessmentDraft(assessmentId: string): Promise<AssessmentDraftDTO> {
  return authorizedRequest(`/api/v1/assessments/${encodeURIComponent(assessmentId)}/draft`, 'organizer');
}

export function updateAssessmentDraft(
  assessmentId: string,
  revision: number,
  input: Omit<AssessmentDraftDTO, 'assessmentId' | 'organizationId' | 'revision'>,
): Promise<AssessmentDraftDTO> {
  return authorizedRequest(`/api/v1/assessments/${encodeURIComponent(assessmentId)}/draft`, 'organizer', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': `"${revision}"` },
    body: JSON.stringify(input),
  });
}

export function publishAssessment(
  assessmentId: string,
  revision: number,
  idempotencyKey: string,
): Promise<PublishAssessmentResponse> {
  return authorizedRequest(`/api/v1/assessments/${encodeURIComponent(assessmentId)}/publish`, 'organizer', {
    method: 'POST',
    headers: { 'If-Match': `"${revision}"`, 'Idempotency-Key': idempotencyKey },
  });
}

export function getDistribution(publicationId: string): Promise<DistributionDTO> {
  return authorizedRequest(`/api/v1/publications/${encodeURIComponent(publicationId)}/distribution`, 'organizer');
}

export function closePublication(publicationId: string): Promise<{ publicationId: string; status: 'closed' }> {
  return authorizedRequest(`/api/v1/publications/${encodeURIComponent(publicationId)}/close`, 'organizer', { method: 'POST' });
}

export function reopenPublication(publicationId: string): Promise<ReopenPublicationResponse> {
  return authorizedRequest(`/api/v1/publications/${encodeURIComponent(publicationId)}/reopen`, 'organizer', { method: 'POST' });
}

export function reviseAssessment(assessmentId: string): Promise<AssessmentDraftDTO> {
  return authorizedRequest(`/api/v1/assessments/${encodeURIComponent(assessmentId)}/revise`, 'organizer', { method: 'POST' });
}

export function rotatePublicationCode(publicationId: string): Promise<{ publicationId: string; code: string; codeHint: string }> {
  return authorizedRequest(`/api/v1/publications/${encodeURIComponent(publicationId)}/code/rotate`, 'organizer', { method: 'POST' });
}

export function getInvitations(publicationId: string): Promise<InvitationDTO[]> {
  return authorizedRequest(`/api/v1/publications/${encodeURIComponent(publicationId)}/invitations`, 'organizer');
}

export function createInvitationBatch(publicationId: string, input: CreateInvitationBatchRequest): Promise<CreatedInvitationDTO[]> {
  return authorizedRequest(`/api/v1/publications/${encodeURIComponent(publicationId)}/invitations/batch`, 'organizer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function revokeInvitation(invitationId: string): Promise<{ invitationId: string; status: 'revoked'; revokedAt: number }> {
  return authorizedRequest(`/api/v1/invitations/${encodeURIComponent(invitationId)}/revoke`, 'organizer', { method: 'POST' });
}

export function getPublicRuntimeConfig(): Promise<PublicRuntimeConfigDTO> {
  return publicRequest('/api/v1/public/config');
}

export function resolvePublication(code: string): Promise<ResolvedPublicationDTO> {
  return publicRequest('/api/v1/publications/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

export function createParticipantAttempt(input: CreateAttemptRequest): Promise<CreateAttemptResponse> {
  return publicRequest('/api/v1/attempts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

function attemptRequest<T>(attemptId: string, attemptToken: string, path = '', init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${attemptToken}`);
  return publicRequest(`/api/v1/attempts/${encodeURIComponent(attemptId)}${path}`, { ...init, headers });
}

export function getParticipantAttempt(attemptId: string, attemptToken: string): Promise<AttemptStateDTO> {
  return attemptRequest(attemptId, attemptToken);
}

export function saveParticipantAnswer(attemptId: string, attemptToken: string, questionId: string, input: SaveAnswerRequest): Promise<SaveAnswerResponse> {
  return attemptRequest(attemptId, attemptToken, `/answers/${encodeURIComponent(questionId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function submitParticipantAttempt(attemptId: string, attemptToken: string, idempotencyKey: string): Promise<SubmitAttemptResponse> {
  return attemptRequest(attemptId, attemptToken, '/submit', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } });
}

export function abandonParticipantAttempt(attemptId: string, attemptToken: string): Promise<AbandonAttemptResponse> {
  return attemptRequest(attemptId, attemptToken, '/abandon', { method: 'POST' });
}

export function getResultsOverview(publicationId: string): Promise<ResultsOverviewDTO> {
  return authorizedRequest(`/api/v1/publications/${encodeURIComponent(publicationId)}/results/overview`, 'organizer');
}

export function getQuestionAnalysis(publicationId: string): Promise<QuestionAnalysisDTO> {
  return authorizedRequest(`/api/v1/publications/${encodeURIComponent(publicationId)}/results/questions`, 'organizer');
}

export function getOrganizerAttempts(publicationId: string, cursor?: string): Promise<OrganizerAttemptsPageDTO> {
  const query = new URLSearchParams({ limit: '50' });
  if (cursor) query.set('cursor', cursor);
  return authorizedRequest(`/api/v1/publications/${encodeURIComponent(publicationId)}/attempts?${query}`, 'organizer');
}

export function getOrganizerAttemptDetail(attemptId: string): Promise<OrganizerAttemptDetailDTO> {
  return authorizedRequest(`/api/v1/attempts/${encodeURIComponent(attemptId)}/detail`, 'organizer');
}

export async function downloadResultsCsv(publicationId: string): Promise<Blob> {
  const response = await authorizedFetch(`/api/v1/publications/${encodeURIComponent(publicationId)}/export.csv`, 'organizer');
  if (!response.ok) return responseJson<never>(response);
  return response.blob();
}

export function getOrganizerLoginUrl(): string {
  return organizerLoginUrl(window.location.origin, import.meta.env.VITE_ORGANIZER_ORIGIN);
}

export function startOrganizerLogin(): void {
  window.location.assign(getOrganizerLoginUrl());
}

export async function logoutOrganizer(): Promise<void> {
  if (import.meta.env.DEV) {
    window.location.assign('/');
    return;
  }
  try {
    await publicRequest('/api/v1/auth/logout', { method: 'POST' });
  } finally {
    window.location.assign('/');
  }
}
