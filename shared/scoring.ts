import type {
  AssessmentQuestion,
  AttemptAnswers,
  EntityId,
  QuestionOption,
  ScoreResult,
} from "./domain";

function correctOptionIds(options: readonly QuestionOption[]): EntityId[] {
  return options.filter((option) => option.isCorrect).map((option) => option.id);
}

function isExactSet(actual: readonly string[], expected: readonly string[]): boolean {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);

  return (
    actualSet.size === actual.length &&
    actualSet.size === expectedSet.size &&
    [...expectedSet].every((value) => actualSet.has(value))
  );
}

export function isQuestionCorrect(
  question: AssessmentQuestion,
  answer: AttemptAnswers[string],
): boolean {
  if (!question.scored || answer === null || answer === undefined) {
    return false;
  }

  const expected = correctOptionIds(question.options);

  if (question.type === "single_choice") {
    return typeof answer === "string" && expected.length === 1 && answer === expected[0];
  }

  return Array.isArray(answer) && isExactSet(answer, expected);
}

export function calculateScore(
  questions: readonly AssessmentQuestion[],
  answers: AttemptAnswers,
): ScoreResult {
  let score = 0;
  let maxScore = 0;
  const correctQuestionIds: EntityId[] = [];

  for (const question of questions) {
    if (!question.scored) {
      continue;
    }

    maxScore += question.points;
    if (isQuestionCorrect(question, answers[question.id])) {
      score += question.points;
      correctQuestionIds.push(question.id);
    }
  }

  return { score, maxScore, correctQuestionIds };
}
