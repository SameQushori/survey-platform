export type TestStage = 'draft' | 'running' | 'completed';

export type TestCardData = {
  id: string;
  title: string;
  stage: TestStage;
  accent: 'blue' | 'green' | 'orange' | 'violet';
  updatedLabel?: string;
  answered?: number;
  invited?: number;
  averageScore?: number;
  publicationId?: string;
  publicationHistory: Array<{
    publicationId: string;
    title: string;
    version: number;
    status: 'published' | 'closed' | 'archived';
    publishedAt: number;
  }>;
};

export type ParticipantAnswerValue = string | string[] | number | null;

export type DraftQuestionType = 'single' | 'multiple' | 'scale';

export type DraftQuestion = {
  id: string;
  text: string;
  type: DraftQuestionType;
  options: string[];
  optionIds: string[];
  correct: number[];
  required: boolean;
  scored: boolean;
  points: number;
  min: number;
  max: number;
};

export type AssessmentDraft = {
  revision: number;
  questions: DraftQuestion[];
  participationMode: 'open' | 'controlled';
  showParticipantResult: boolean;
  singleAttempt: boolean;
};

export type PublicationCheck = {
  key: 'title' | 'questions' | 'content' | 'answerKey' | 'settings';
  label: string;
  description: string;
  ready: boolean;
};

export const stageLabels: Record<TestStage, string> = {
  draft: 'Черновики',
  running: 'Запущены',
  completed: 'Завершены',
};

export function canTransitionTest(from: TestStage, to: TestStage): boolean {
  return (
    (from === 'draft' && to === 'running') ||
    (from === 'running' && to === 'completed') ||
    (from === 'completed' && to === 'running') ||
    ((from === 'running' || from === 'completed') && to === 'draft')
  );
}

export function transitionPrompt(from: TestStage, to: TestStage): {
  title: string;
  description: string;
  action: string;
} | null {
  if (from === 'draft' && to === 'running') {
    return {
      title: 'Опубликовать тест?',
      description:
        'Перед запуском мы проверим вопросы и настройки. Опубликованная версия станет неизменяемой.',
      action: 'Перейти к проверке',
    };
  }

  if (from === 'running' && to === 'completed') {
    return {
      title: 'Завершить тест?',
      description:
        'Новые попытки станут недоступны, а собранные ответы и аналитика сохранятся.',
      action: 'Завершить тест',
    };
  }

  if (from === 'completed' && to === 'running') {
    return {
      title: 'Запустить тест снова?',
      description:
        'Публикация снова начнёт принимать участников. Уже собранные ответы и результаты сохранятся.',
      action: 'Запустить снова',
    };
  }

  if ((from === 'running' || from === 'completed') && to === 'draft') {
    return {
      title: 'Создать новую версию?',
      description:
        'Текущая публикация перестанет принимать новые попытки. Vecta создаст редактируемый черновик, а прежние ответы и результаты останутся в истории.',
      action: 'Создать черновик',
    };
  }

  return null;
}

export function hasParticipantAnswer(answer: ParticipantAnswerValue | undefined): boolean {
  if (Array.isArray(answer)) return answer.length > 0;
  return typeof answer === 'number' || (typeof answer === 'string' && answer.length > 0);
}

export function participantProgress(
  questionIds: string[],
  answers: Record<string, ParticipantAnswerValue>,
): { answered: number; unanswered: number } {
  const answered = questionIds.filter((questionId) => hasParticipantAnswer(answers[questionId])).length;
  return { answered, unanswered: questionIds.length - answered };
}

export function publicationChecklist(title: string, draft: AssessmentDraft): PublicationCheck[] {
  const hasQuestions = draft.questions.length > 0;
  const contentReady = hasQuestions && draft.questions.every((question) => {
    if (!question.text.trim()) return false;
    if (question.type === 'scale') return question.min < question.max;
    return question.options.length >= 2 && question.options.every((option) => option.trim());
  });
  const answerKeyReady = hasQuestions && draft.questions.every((question) => (
    question.type === 'scale' || !question.scored || (
      question.correct.length > 0 &&
      question.correct.every((index) => index >= 0 && index < question.options.length) &&
      Number.isInteger(question.points) && question.points > 0
    )
  ));

  return [
    { key: 'title', label: 'Название теста', description: 'Участники увидят его перед началом.', ready: title.trim().length > 0 },
    { key: 'questions', label: 'Добавлен хотя бы один вопрос', description: 'Пустой тест нельзя опубликовать.', ready: hasQuestions },
    { key: 'content', label: 'Формулировки и варианты заполнены', description: 'Для шкалы также проверяется корректный диапазон.', ready: contentReady },
    { key: 'answerKey', label: 'Правильные ответы и баллы заданы', description: 'Шкала и вопросы без оценки не требуют ключа.', ready: answerKeyReady },
    { key: 'settings', label: 'Правила участия выбраны', description: 'Режим доступа и правило повторной попытки сохранены.', ready: Boolean(draft.participationMode) },
  ];
}

export function canPublishAssessment(title: string, draft: AssessmentDraft): boolean {
  return publicationChecklist(title, draft).every((item) => item.ready);
}
