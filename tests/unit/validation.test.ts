import { describe, expect, it } from "vitest";
import {
  createAttemptSchema,
  draftAssessmentSchema,
  multipleChoiceQuestionSchema,
  ratingQuestionSchema,
  singleChoiceQuestionSchema,
} from "../../shared/validation";

const options = [
  { id: "a", text: "A", position: 0, isCorrect: true },
  { id: "b", text: "B", position: 1, isCorrect: false },
];

describe("question validation", () => {
  it("accepts a valid scored single-choice question", () => {
    expect(
      singleChoiceQuestionSchema.safeParse({
        id: "q1",
        type: "single_choice",
        text: "Question",
        position: 0,
        required: true,
        scored: true,
        points: 1,
        options,
      }).success,
    ).toBe(true);
  });

  it("requires exactly one correct option for scored single choice", () => {
    const invalid = options.map((option) => ({ ...option, isCorrect: true }));
    expect(
      singleChoiceQuestionSchema.safeParse({
        id: "q1",
        type: "single_choice",
        text: "Question",
        position: 0,
        required: true,
        scored: true,
        points: 1,
        options: invalid,
      }).success,
    ).toBe(false);
  });

  it("requires a correct option for scored multiple choice", () => {
    expect(
      multipleChoiceQuestionSchema.safeParse({
        id: "q2",
        type: "multiple_choice",
        text: "Question",
        position: 0,
        required: true,
        scored: true,
        points: 2,
        options: options.map((option) => ({ ...option, isCorrect: false })),
      }).success,
    ).toBe(false);
  });

  it("keeps rating questions unscored and validates the range", () => {
    expect(
      ratingQuestionSchema.safeParse({
        id: "q3",
        type: "rating",
        text: "Rating",
        position: 0,
        required: false,
        scored: false,
        points: 0,
        scaleMin: 5,
        scaleMax: 5,
      }).success,
    ).toBe(false);
  });
});

describe("assessment and attempt validation", () => {
  it("rejects an assessment without questions", () => {
    expect(
      draftAssessmentSchema.safeParse({
        title: "Assessment",
        description: "",
        durationSeconds: null,
        questions: [],
      }).success,
    ).toBe(false);
  });

  it("requires exactly one access credential for a new attempt", () => {
    const base = { displayName: "Participant", turnstileToken: "token" };
    const participantIdentity = crypto.randomUUID();
    expect(createAttemptSchema.safeParse({ ...base, code: "VECTA1", participantIdentity }).success).toBe(true);
    expect(
      createAttemptSchema.safeParse({ ...base, code: "VECTA1", participantIdentity, invitationToken: "x".repeat(32) })
        .success,
    ).toBe(false);
    expect(createAttemptSchema.safeParse(base).success).toBe(false);
  });
});
