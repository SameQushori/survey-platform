import type { AssessmentQuestion } from "./domain";
import type { PublicQuestionDTO } from "./contracts";

export function toPublicQuestionDTO(question: AssessmentQuestion): PublicQuestionDTO {
  const base = {
    id: question.id,
    text: question.text,
    position: question.position,
    required: question.required,
  };

  if (question.type === "rating") {
    return {
      ...base,
      type: "rating",
      scaleMin: question.scaleMin,
      scaleMax: question.scaleMax,
      ...(question.scaleMinLabel === undefined ? {} : { scaleMinLabel: question.scaleMinLabel }),
      ...(question.scaleMaxLabel === undefined ? {} : { scaleMaxLabel: question.scaleMaxLabel }),
    };
  }

  return {
    ...base,
    type: question.type,
    options: question.options.map(({ id, text, position }) => ({ id, text, position })),
  };
}
