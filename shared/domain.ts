export const assessmentStatuses = ["draft", "published", "closed", "archived"] as const;
export type AssessmentStatus = (typeof assessmentStatuses)[number];

export const questionTypes = ["single_choice", "multiple_choice", "rating"] as const;
export type QuestionType = (typeof questionTypes)[number];

export const accessModes = ["open", "controlled"] as const;
export type AccessMode = (typeof accessModes)[number];

export const openRepeatPolicies = ["unlimited", "best_effort_once"] as const;
export type OpenRepeatPolicy = (typeof openRepeatPolicies)[number];

export const attemptStatuses = ["active", "submitted", "expired"] as const;
export type AttemptStatus = (typeof attemptStatuses)[number];

export const membershipRoles = ["organizer"] as const;
export type MembershipRole = (typeof membershipRoles)[number];

export type EntityId = string;
export type UnixMillis = number;

export interface QuestionOption {
  id: EntityId;
  text: string;
  position: number;
  isCorrect: boolean;
}

interface QuestionBase {
  id: EntityId;
  text: string;
  position: number;
  required: boolean;
}

export interface SingleChoiceQuestion extends QuestionBase {
  type: "single_choice";
  scored: boolean;
  points: number;
  options: QuestionOption[];
}

export interface MultipleChoiceQuestion extends QuestionBase {
  type: "multiple_choice";
  scored: boolean;
  points: number;
  options: QuestionOption[];
}

export interface RatingQuestion extends QuestionBase {
  type: "rating";
  scored: false;
  points: 0;
  scaleMin: number;
  scaleMax: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
}

export type AssessmentQuestion =
  | SingleChoiceQuestion
  | MultipleChoiceQuestion
  | RatingQuestion;

export interface AssessmentVersion {
  id: EntityId;
  assessmentId: EntityId;
  version: number;
  title: string;
  description: string;
  durationSeconds: number | null;
  questions: AssessmentQuestion[];
  createdAt: UnixMillis;
  publishedAt: UnixMillis | null;
}

export interface PublicationPolicy {
  accessMode: AccessMode;
  openRepeatPolicy: OpenRepeatPolicy | null;
  showParticipantResult: boolean;
  opensAt: UnixMillis | null;
  closesAt: UnixMillis | null;
}

export type AnswerValue = string | string[] | number | null;
export type AttemptAnswers = Readonly<Record<EntityId, AnswerValue | undefined>>;

export interface ScoreResult {
  score: number;
  maxScore: number;
  correctQuestionIds: EntityId[];
}
