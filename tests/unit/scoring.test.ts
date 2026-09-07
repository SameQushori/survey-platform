import { describe, expect, it } from "vitest";
import type { AssessmentQuestion } from "../../shared/domain";
import { calculateScore, isQuestionCorrect } from "../../shared/scoring";

const questions: AssessmentQuestion[] = [
  {
    id: "single",
    type: "single_choice",
    text: "Single",
    position: 0,
    required: true,
    scored: true,
    points: 2,
    options: [
      { id: "a", text: "A", position: 0, isCorrect: true },
      { id: "b", text: "B", position: 1, isCorrect: false },
    ],
  },
  {
    id: "multiple",
    type: "multiple_choice",
    text: "Multiple",
    position: 1,
    required: false,
    scored: true,
    points: 3,
    options: [
      { id: "x", text: "X", position: 0, isCorrect: true },
      { id: "y", text: "Y", position: 1, isCorrect: false },
      { id: "z", text: "Z", position: 2, isCorrect: true },
    ],
  },
  {
    id: "rating",
    type: "rating",
    text: "Rating",
    position: 2,
    required: false,
    scored: false,
    points: 0,
    scaleMin: 1,
    scaleMax: 5,
  },
];

describe("scoring", () => {
  it("calculates weighted score and excludes rating from max score", () => {
    expect(calculateScore(questions, { single: "a", multiple: ["z", "x"], rating: 5 })).toEqual({
      score: 5,
      maxScore: 5,
      correctQuestionIds: ["single", "multiple"],
    });
  });

  it("does not award partial credit for multiple choice", () => {
    expect(isQuestionCorrect(questions[1]!, ["x"])).toBe(false);
    expect(calculateScore(questions, { single: "b", multiple: ["x"] })).toMatchObject({
      score: 0,
      maxScore: 5,
    });
  });

  it("rejects duplicated selections as an exact match", () => {
    expect(isQuestionCorrect(questions[1]!, ["x", "z", "z"])).toBe(false);
  });

  it("treats unanswered scored questions as zero", () => {
    expect(calculateScore(questions, {})).toEqual({
      score: 0,
      maxScore: 5,
      correctQuestionIds: [],
    });
  });
});
