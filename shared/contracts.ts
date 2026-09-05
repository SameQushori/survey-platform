import type {
  AccessMode,
  AssessmentQuestion,
  AssessmentStatus,
  AttemptStatus,
  EntityId,
  OpenRepeatPolicy,
  UnixMillis,
} from "./domain";

export const apiProblemCodes = [
  "bad_request",
  "validation_failed",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "assessment_closed",
  "access_expired",
  "attempt_already_used",
  "attempt_expired",
  "rate_limited",
  "turnstile_failed",
  "idempotency_conflict",
  "internal_error",
] as const;

export type ApiProblemCode = (typeof apiProblemCodes)[number];

export interface ApiProblem {
  type: `https://vecta.invalid/problems/${ApiProblemCode}`;
  title: string;
  status: number;
  code: ApiProblemCode;
  detail?: string;
  requestId: string;
  fieldErrors?: Record<string, string[]>;
  retryAfterSeconds?: number;
}

export interface OrganizerSessionDTO {
  user: {
    id: EntityId;
    displayName: string;
    email: string | null;
  };
  memberships: Array<{
    organizationId: EntityId;
    organizationName: string;
    role: "organizer";
  }>;
}

export interface OrganizerLoginChallengeDTO {
  challengeId: EntityId;
  expiresAt: UnixMillis;
}

export interface OrganizerLoginVerificationDTO {
  authenticated: true;
  expiresAt: UnixMillis;
}

export interface OrganizationWorkspaceDTO {
  organization: {
    id: EntityId;
    name: string;
    slug: string;
  };
  role: "organizer";
}

export interface PublicQuestionOptionDTO {
  id: EntityId;
  text: string;
  position: number;
}

interface PublicQuestionBaseDTO {
  id: EntityId;
  text: string;
  position: number;
  required: boolean;
}

export interface PublicSingleChoiceQuestionDTO extends PublicQuestionBaseDTO {
  type: "single_choice";
  options: PublicQuestionOptionDTO[];
}

export interface PublicMultipleChoiceQuestionDTO extends PublicQuestionBaseDTO {
  type: "multiple_choice";
  options: PublicQuestionOptionDTO[];
}

export interface PublicRatingQuestionDTO extends PublicQuestionBaseDTO {
  type: "rating";
  scaleMin: number;
  scaleMax: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
}

export type PublicQuestionDTO =
  | PublicSingleChoiceQuestionDTO
  | PublicMultipleChoiceQuestionDTO
  | PublicRatingQuestionDTO;

export interface PublicAssessmentDTO {
  publicationId: EntityId;
  title: string;
  description: string;
  durationSeconds: number | null;
  accessMode: AccessMode;
  questions: PublicQuestionDTO[];
}

export interface AssessmentListItemDTO {
  id: EntityId;
  title: string;
  status: AssessmentStatus;
  updatedAt: UnixMillis;
  publishedVersion: number | null;
  completedAttempts: number;
  currentPublicationId: EntityId | null;
  publications: AssessmentPublicationSummaryDTO[];
}

export interface AssessmentPublicationSummaryDTO {
  publicationId: EntityId;
  title: string;
  version: number;
  status: "published" | "closed" | "archived";
  publishedAt: UnixMillis;
}

export interface AssessmentDraftDTO {
  assessmentId: EntityId;
  organizationId: EntityId;
  revision: number;
  title: string;
  description: string;
  durationSeconds: number | null;
  questions: AssessmentQuestion[];
  settings: PublicationSettingsDTO;
}

export interface CreateAssessmentRequest {
  title: string;
}

export interface PublishAssessmentResponse {
  assessmentId: EntityId;
  publicationId: EntityId;
  version: number;
  publishedAt: UnixMillis;
  access: {
    mode: AccessMode;
    code: string | null;
    codeHint: string | null;
  };
}

export interface ReopenPublicationResponse {
  assessmentId: EntityId;
  publicationId: EntityId;
  status: "published";
  reopenedAt: UnixMillis;
  closesAt: UnixMillis | null;
}

export interface DistributionDTO {
  assessmentId: EntityId;
  publicationId: EntityId;
  title: string;
  status: "published" | "closed" | "archived";
  settings: PublicationSettingsDTO;
  codeHint: string | null;
  codeAvailable: false;
}

export interface InvitationDTO {
  id: EntityId;
  participantLabel: string;
  status: "active" | "used" | "revoked" | "expired";
  expiresAt: UnixMillis | null;
  createdAt: UnixMillis;
}

export interface CreateInvitationBatchRequest {
  participantLabels: string[];
  expiresAt: UnixMillis | null;
}

export interface CreatedInvitationDTO extends InvitationDTO {
  invitationToken: string;
  joinPath: string;
}

export interface CreateAttemptRequest {
  code?: string;
  invitationToken?: string;
  displayName: string;
  participantIdentity?: string;
  turnstileToken: string;
}

export interface PublicRuntimeConfigDTO {
  turnstileSitekey: string;
}

export interface ResolvePublicationRequest {
  code: string;
}

export interface ResolvedPublicationDTO {
  publicationId: EntityId;
  title: string;
  description: string;
  durationSeconds: number | null;
  accessMode: AccessMode;
  questionCount: number;
  showParticipantResult: boolean;
}

export interface CreateAttemptResponse {
  attemptId: EntityId;
  attemptToken: string;
  deadlineAt: UnixMillis | null;
  showParticipantResult: boolean;
  assessment: PublicAssessmentDTO;
}

export interface SaveAnswerRequest {
  value: string | string[] | number | null;
}

export interface AttemptStateDTO {
  attemptId: EntityId;
  displayName: string;
  status: AttemptStatus;
  deadlineAt: UnixMillis | null;
  showParticipantResult: boolean;
  assessment: PublicAssessmentDTO;
  answers: Record<EntityId, SaveAnswerRequest["value"]>;
  result: ParticipantResultDTO | null;
}

export type ParticipantResultDTO =
  | { completed: true; resultVisible: false }
  | { completed: true; resultVisible: true; score: number; maxScore: number };

export interface PublicationSettingsDTO {
  accessMode: AccessMode;
  openRepeatPolicy: OpenRepeatPolicy | null;
  showParticipantResult: boolean;
  opensAt: UnixMillis | null;
  closesAt: UnixMillis | null;
}

export interface SubmitAttemptResponse {
  attemptId: EntityId;
  submittedAt: UnixMillis;
  result: ParticipantResultDTO;
}

export interface SaveAnswerResponse {
  attemptId: EntityId;
  questionId: EntityId;
  savedAt: UnixMillis;
}

export interface AbandonAttemptResponse {
  attemptId: EntityId;
  status: "expired";
  reason: "abandoned";
}

export interface ResultsOverviewDTO {
  publication: {
    id: EntityId;
    title: string;
    status: "published" | "closed" | "archived";
    accessMode: AccessMode;
    publishedAt: UnixMillis;
  };
  attempts: {
    total: number;
    active: number;
    completed: number;
    abandoned: number;
  };
  invitationsTotal: number | null;
  participationPercent: number | null;
  averageScorePercent: number | null;
  scoreDistribution: Array<{
    range: "0–49" | "50–69" | "70–84" | "85–100";
    count: number;
    percent: number;
  }>;
  responseTrend: Array<{
    date: string;
    responses: number;
  }>;
}

export interface QuestionAnalysisItemDTO {
  questionId: EntityId;
  position: number;
  text: string;
  type: "single_choice" | "multiple_choice" | "rating";
  scored: boolean;
  points: number;
  answeredCount: number;
  correctCount: number | null;
  correctPercent: number | null;
  averageRating: number | null;
}

export interface QuestionAnalysisDTO {
  publicationId: EntityId;
  items: QuestionAnalysisItemDTO[];
}

export interface OrganizerAttemptListItemDTO {
  id: EntityId;
  displayName: string;
  status: AttemptStatus;
  completionReason: "submitted" | "deadline" | "abandoned" | null;
  startedAt: UnixMillis;
  updatedAt: UnixMillis;
  completedAt: UnixMillis | null;
  score: number | null;
  maxScore: number | null;
  scorePercent: number | null;
}

export interface OrganizerAttemptsPageDTO {
  publicationId: EntityId;
  items: OrganizerAttemptListItemDTO[];
  nextCursor: string | null;
}

export interface OrganizerAttemptAnswerDTO {
  questionId: EntityId;
  position: number;
  questionText: string;
  answerText: string;
  correctAnswerText: string | null;
  isCorrect: boolean | null;
  pointsAwarded: number | null;
  maxPoints: number | null;
}

export interface OrganizerAttemptDetailDTO extends OrganizerAttemptListItemDTO {
  publicationId: EntityId;
  assessmentTitle: string;
  answers: OrganizerAttemptAnswerDTO[];
}
