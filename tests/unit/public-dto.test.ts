import { describe, expect, it } from "vitest";
import type { AssessmentQuestion } from "../../shared/domain";
import { toPublicQuestionDTO } from "../../shared/public-dto";

describe("participant DTO", () => {
  it("removes scoring metadata and answer key", () => {
    const question: AssessmentQuestion = {
      id: "question",
      type: "single_choice",
      text: "Question",
      position: 0,
      required: true,
      scored: true,
      points: 10,
      options: [
        { id: "correct", text: "Correct", position: 0, isCorrect: true },
        { id: "wrong", text: "Wrong", position: 1, isCorrect: false },
      ],
    };

    const publicQuestion = toPublicQuestionDTO(question);
    expect(publicQuestion).toEqual({
      id: "question",
      type: "single_choice",
      text: "Question",
      position: 0,
      required: true,
      options: [
        { id: "correct", text: "Correct", position: 0 },
        { id: "wrong", text: "Wrong", position: 1 },
      ],
    });
    expect(JSON.stringify(publicQuestion)).not.toContain("isCorrect");
    expect(JSON.stringify(publicQuestion)).not.toContain("points");
  });
});
