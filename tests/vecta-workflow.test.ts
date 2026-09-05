import { describe, expect, it } from 'vitest';

import { canPublishAssessment, canTransitionTest, hasParticipantAnswer, participantProgress, publicationChecklist, transitionPrompt, type AssessmentDraft } from '../src/vecta/domain';

describe('Vecta test board lifecycle', () => {
  it('allows only forward lifecycle transitions', () => {
    expect(canTransitionTest('draft', 'running')).toBe(true);
    expect(canTransitionTest('running', 'completed')).toBe(true);
    expect(canTransitionTest('draft', 'completed')).toBe(false);
    expect(canTransitionTest('completed', 'running')).toBe(true);
    expect(canTransitionTest('running', 'draft')).toBe(true);
    expect(canTransitionTest('completed', 'draft')).toBe(true);
  });

  it('requires an explicit confirmation prompt for every allowed transition', () => {
    expect(transitionPrompt('draft', 'running')?.action).toBe('Перейти к проверке');
    expect(transitionPrompt('running', 'completed')?.action).toBe('Завершить тест');
    expect(transitionPrompt('completed', 'running')?.action).toBe('Запустить снова');
    expect(transitionPrompt('running', 'draft')?.action).toBe('Создать черновик');
    expect(transitionPrompt('completed', 'draft')?.action).toBe('Создать черновик');
  });
});

describe('Vecta participant progress', () => {
  it('counts single, multiple and scale answers without exposing answer correctness', () => {
    const answers = { q1: ['selected'], q2: [], q3: 4 };

    expect(hasParticipantAnswer(answers.q1)).toBe(true);
    expect(hasParticipantAnswer(answers.q2)).toBe(false);
    expect(hasParticipantAnswer(answers.q3)).toBe(true);
    expect(participantProgress(['q1', 'q2', 'q3', 'q4'], answers)).toEqual({ answered: 2, unanswered: 2 });
  });

  it('treats scale value zero as an explicit answer', () => {
    expect(hasParticipantAnswer(0)).toBe(true);
  });
});

describe('Vecta publication checklist', () => {
  const readyDraft: AssessmentDraft = {
    revision: 1,
    participationMode: 'open',
    showParticipantResult: false,
    singleAttempt: true,
    questions: [{ id: 'q1', text: 'Выберите вариант', type: 'single', options: ['Первый', 'Второй'], optionIds: ['o1', 'o2'], correct: [0], required: true, scored: true, points: 2, min: 1, max: 5 }],
  };

  it('allows publishing only when every blocking check passes', () => {
    expect(publicationChecklist('Готовый тест', readyDraft).every((item) => item.ready)).toBe(true);
    expect(canPublishAssessment('Готовый тест', readyDraft)).toBe(true);
  });

  it('reports incomplete content and answer key separately', () => {
    const invalidDraft: AssessmentDraft = { ...readyDraft, questions: [{ ...readyDraft.questions[0]!, text: '', correct: [] }] };
    const checks = publicationChecklist('Черновик', invalidDraft);

    expect(checks.find((item) => item.key === 'content')?.ready).toBe(false);
    expect(checks.find((item) => item.key === 'answerKey')?.ready).toBe(false);
    expect(canPublishAssessment('Черновик', invalidDraft)).toBe(false);
  });
});
