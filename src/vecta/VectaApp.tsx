import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Briefcase,
  Buildings,
  CalendarBlank,
  CaretDown,
  CaretRight,
  ChartBar,
  Check,
  CheckCircle,
  ClipboardText,
  Clock,
  Copy,
  DeviceMobile,
  DotsSixVertical,
  DotsThreeVertical,
  DownloadSimple,
  EnvelopeSimple,
  Eye,
  FileText,
  GearSix,
  HardHat,
  House,
  Laptop,
  Lifebuoy,
  LinkSimple,
  ListChecks,
  MagnifyingGlass,
  Monitor,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  QrCode,
  ShieldCheck,
  SignOut,
  Star,
  TrendUp,
  Trash,
  User,
  UsersThree,
  WarningCircle,
  X,
  type Icon,
} from '@phosphor-icons/react';
import { QRCodeSVG } from 'qrcode.react';
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router-dom';

import boardPreview from '../assets/vecta/board-preview.webp';
import {
  canPublishAssessment,
  canTransitionTest,
  hasParticipantAnswer,
  participantProgress,
  publicationChecklist,
  stageLabels,
  transitionPrompt,
  type AssessmentDraft,
  type DraftQuestion,
  type DraftQuestionType,
  type ParticipantAnswerValue,
  type TestCardData,
  type TestStage,
} from './domain';
import { RevisionSaveQueue } from './revisionQueue';
import { clearOrganizerOtpDigit, emptyOrganizerOtp, fillOrganizerOtp, normalizeOrganizerOtp, ORGANIZER_OTP_LENGTH } from './otpCode';
import { abandonParticipantAttempt, ApiRequestError, closePublication, createAssessment, createInvitationBatch, createParticipantAttempt, downloadResultsCsv, getAssessmentDraft, getAssessments, getDistribution, getInvitations, getOrganizerAttemptDetail, getOrganizerAttempts, getOrganizerLoginUrl, getOrganizerSession, getParticipantAttempt, getPublicRuntimeConfig, getQuestionAnalysis, getResultsOverview, logoutOrganizer, publishAssessment, reopenPublication, requestOrganizerLoginCode, resolvePublication, reviseAssessment, revokeInvitation, rotatePublicationCode, saveParticipantAnswer, startOrganizerLogin, submitParticipantAttempt, updateAssessmentDraft, verifyOrganizerLoginCode, type LocalIdentityRole } from './api';
import { requiresOrganizerHandoff } from './organizerLogin';
import type { AssessmentDraftDTO, AssessmentListItemDTO, AttemptStateDTO, CreatedInvitationDTO, DistributionDTO, InvitationDTO, OrganizerAttemptDetailDTO, OrganizerAttemptListItemDTO, OrganizerSessionDTO, ParticipantResultDTO, PublicAssessmentDTO, PublishAssessmentResponse, QuestionAnalysisDTO, QuestionAnalysisItemDTO, ResolvedPublicationDTO, ResultsOverviewDTO, SaveAnswerRequest } from '../../shared/contracts';
import './vecta.css';

const stageOrder: TestStage[] = ['draft', 'running', 'completed'];
const AuthContext = createContext<OrganizerSessionDTO | null>(null);

type WorkspaceContextValue = {
  tests: TestCardData[];
  setTests: React.Dispatch<React.SetStateAction<TestCardData[]>>;
  drafts: Record<string, AssessmentDraft>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, AssessmentDraft>>>;
  openCreate: () => void;
  showMessage: (message: string) => void;
  loadState: 'loading' | 'ready' | 'error';
  reloadTests: () => Promise<void>;
  loadDraft: (assessmentId: string) => Promise<AssessmentDraft>;
};

type ParticipantAttemptContextValue = {
  attemptId: string;
  attemptToken: string;
  name: string;
  assessment: PublicAssessmentDTO;
  deadlineAt: number | null;
  answers: Record<string, SaveAnswerRequest['value']>;
  saveState: 'saving' | 'saved' | 'error';
  setAnswer: (questionId: string, answer: SaveAnswerRequest['value']) => void;
  submit: () => Promise<ParticipantResultDTO>;
  showResult: boolean;
  result: ParticipantResultDTO | null;
};

const createBlankQuestion = (): DraftQuestion => ({
  id: `question_${crypto.randomUUID()}`,
  text: '',
  type: 'single',
  options: ['', ''],
  optionIds: [`option_${crypto.randomUUID()}`, `option_${crypto.randomUUID()}`],
  correct: [],
  required: true,
  scored: true,
  points: 1,
  min: 1,
  max: 5,
});

const createBlankDraft = (revision = 1): AssessmentDraft => ({
  revision,
  questions: [createBlankQuestion()],
  participationMode: 'open',
  showParticipantResult: false,
  singleAttempt: true,
});

function testFromDto(test: AssessmentListItemDTO): TestCardData {
  const accents: TestCardData['accent'][] = ['blue', 'green', 'orange', 'violet'];
  const accentIndex = [...test.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % accents.length;
  const stage: TestStage = test.status === 'draft' ? 'draft' : test.status === 'published' ? 'running' : 'completed';
  return {
    id: test.id,
    title: test.title,
    stage,
    accent: accents[accentIndex] ?? 'blue',
    publicationHistory: test.publications ?? [],
    ...(test.status === 'draft' ? { updatedLabel: new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(test.updatedAt) } : {}),
    ...(test.currentPublicationId ? { publicationId: test.currentPublicationId } : {}),
    ...(test.completedAttempts > 0 ? { answered: test.completedAttempts, invited: test.completedAttempts } : {}),
  };
}

function draftFromDto(dto: AssessmentDraftDTO): AssessmentDraft {
  const questions = dto.questions.map((question): DraftQuestion => {
    if (question.type === 'rating') {
      return { id: question.id, text: question.text, type: 'scale', options: [], optionIds: [], correct: [], required: question.required, scored: false, points: 0, min: question.scaleMin, max: question.scaleMax };
    }
    return {
      id: question.id,
      text: question.text,
      type: question.type === 'single_choice' ? 'single' : 'multiple',
      options: question.options.map((option) => option.text),
      optionIds: question.options.map((option) => option.id),
      correct: question.options.flatMap((option, index) => option.isCorrect ? [index] : []),
      required: question.required,
      scored: question.scored,
      points: question.points,
      min: 1,
      max: 5,
    };
  });
  return {
    revision: dto.revision,
    questions: questions.length ? questions : [createBlankQuestion()],
    participationMode: dto.settings.accessMode,
    showParticipantResult: dto.settings.showParticipantResult,
    singleAttempt: dto.settings.openRepeatPolicy !== 'unlimited',
  };
}

function draftToApi(title: string, draft: AssessmentDraft): Omit<AssessmentDraftDTO, 'assessmentId' | 'organizationId' | 'revision'> {
  return {
    title: title.trim(),
    description: '',
    durationSeconds: null,
    questions: draft.questions.map((question, questionIndex) => {
      if (question.type === 'scale') {
        return { id: question.id, type: 'rating' as const, text: question.text, position: questionIndex, required: question.required, scored: false as const, points: 0 as const, scaleMin: question.min, scaleMax: question.max };
      }
      return {
        id: question.id,
        type: question.type === 'single' ? 'single_choice' as const : 'multiple_choice' as const,
        text: question.text,
        position: questionIndex,
        required: question.required,
        scored: question.scored,
        points: question.scored ? question.points : 0,
        options: question.options.map((option, optionIndex) => ({
          id: question.optionIds[optionIndex] ?? `option_${crypto.randomUUID()}`,
          text: option,
          position: optionIndex,
          isCorrect: question.scored && question.correct.includes(optionIndex),
        })),
      };
    }),
    settings: {
      accessMode: draft.participationMode,
      openRepeatPolicy: draft.participationMode === 'open' ? (draft.singleAttempt ? 'best_effort_once' : 'unlimited') : null,
      showParticipantResult: draft.showParticipantResult,
      opensAt: null,
      closesAt: null,
    },
  };
}

function VectaLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="vecta-logo" aria-label="Vecta">
      <PaperPlaneTilt aria-hidden size={compact ? 30 : 38} weight="regular" />
      <span>Vecta</span>
    </span>
  );
}

function OnboardingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const attemptAbandoned = new URLSearchParams(location.search).get('attempt') === 'abandoned';

  const submitCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(normalized)) {
      setCodeError('Введите код из 6 латинских букв или цифр');
      return;
    }
    setCodeError('');
    void navigate(`/join?code=${normalized}`);
  };

  return (
    <div className="onboarding-page">
      <header className="public-header">
        <a href="#top" className="logo-link"><VectaLogo /></a>
        <nav aria-label="Навигация по странице">
          <a href="#capabilities">Возможности</a>
          <a href="#how-it-works">Как это работает</a>
          <a href="#security">Безопасность</a>
        </nav>
        <a className="header-help" href="#support">Помощь</a>
      </header>

      <main id="top">
        <section className="onboarding-hero" aria-labelledby="onboarding-title">
          <div className="hero-story">
            <p className="eyebrow">Платформа для оценки знаний команды</p>
            <h1 id="onboarding-title">Проводите тестирование без лишней сложности</h1>
            <p className="hero-copy">
              Создавайте тесты, приглашайте участников по ссылке или коду и отслеживайте результаты в одном месте.
            </p>

            <ul className="trust-list" id="security">
              <li><Check aria-hidden weight="bold" />Без аккаунта для участников</li>
              <li><Check aria-hidden weight="bold" />Результаты в реальном времени</li>
              <li><Check aria-hidden weight="bold" />Данные организаций разделены</li>
            </ul>

            <div className="product-preview" aria-label="Предварительный просмотр доски тестов Vecta">
              <img src={boardPreview} alt="Доска тестов Vecta с колонками Черновики, Запущены и Завершены" width="960" height="683" loading="lazy" decoding="async" />
            </div>
          </div>

          <aside className="entry-panel" aria-labelledby="entry-title">
            <div className="entry-heading">
              <h2 id="entry-title">Начать работу</h2>
              <p>Выберите свой сценарий</p>
            </div>

            <div className="entry-role">
              <span className="role-icon role-icon-blue"><Briefcase aria-hidden size={25} /></span>
              <div>
                <h3>Организатор</h3>
                <p>Создавайте тесты и смотрите результаты</p>
              </div>
            </div>
            <button className="button button-primary button-wide" onClick={startOrganizerLogin}>
              Войти или зарегистрироваться
            </button>

            <div className="entry-divider"><span>или</span></div>

            <div className="entry-role participant-role">
              <span className="role-icon role-icon-green"><FileText aria-hidden size={25} /></span>
              <div>
                <h3>Участник</h3>
                <p>Пройдите тест по общему коду</p>
              </div>
            </div>
            <form onSubmit={submitCode} noValidate>
              <label className="field-label" htmlFor="test-code">Код теста</label>
              <input
                id="test-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className={codeError ? 'text-input input-error' : 'text-input'}
                placeholder="Например, 8K4M2Q"
                autoComplete="one-time-code"
                aria-describedby={codeError ? 'code-error' : 'code-help'}
              />
              {codeError ? <p className="field-error" id="code-error">{codeError}</p> : <p className="field-help" id="code-help">Регистрация не требуется</p>}
              <button className="button button-secondary button-wide" type="submit">Продолжить</button>
            </form>
            <button className="text-action entry-link" type="button">У меня персональная ссылка <CaretRight aria-hidden /></button>
            <div className="entry-support" id="support">
              <Lifebuoy aria-hidden />
              <span>Помощь и поддержка</span>
            </div>
          </aside>
        </section>

        <section className="product-facts" id="capabilities" aria-labelledby="facts-title">
          <h2 id="facts-title">Vecta в цифрах продукта</h2>
          <Fact icon={ListChecks} value="3" title="типа вопросов" copy="Один вариант, несколько вариантов и шкала" tone="blue" />
          <Fact icon={UsersThree} value="2" title="режима участия" copy="Открытый и контролируемый" tone="green" />
          <Fact icon={Buildings} value="1" title="рабочее пространство" copy="Тесты, участники и результаты вместе" tone="orange" />
        </section>

        <section className="how-it-works" id="how-it-works" aria-labelledby="how-title">
          <h2 id="how-title">От создания до результата — три шага</h2>
          <div className="steps-grid">
            <Step number="1" icon={PencilSimple} title="Создайте тест" copy="Добавьте вопросы и настройте правила" tone="blue" />
            <Step number="2" icon={LinkSimple} title="Поделитесь доступом" copy="Отправьте ссылку, код или QR" tone="green" />
            <Step number="3" icon={ChartBar} title="Следите за результатами" copy="Смотрите прогресс и анализируйте вопросы" tone="orange" />
          </div>
        </section>
      </main>

      <footer className="public-footer">
        <span>© 2026 Vecta</span>
      </footer>
      {attemptAbandoned && <PublicOverlayDialog eyebrow="Выход из теста" title="Попытка завершена" copy="Ответы не были отправлены, а эта попытка теперь считается использованной. Сессия организатора в других вкладках не затронута." icon={SignOut} tone="orange" primaryLabel="Понятно" onPrimary={() => navigate('/', { replace: true })} onClose={() => navigate('/', { replace: true })} />}
    </div>
  );
}

function Fact({ icon: FactIcon, value, title, copy, tone }: { icon: Icon; value: string; title: string; copy: string; tone: string }) {
  return (
    <article className="fact-item">
      <span className={`soft-icon soft-icon-${tone}`}><FactIcon aria-hidden size={25} /></span>
      <div><strong>{value}</strong><b>{title}</b><p>{copy}</p></div>
    </article>
  );
}

function Step({ number, icon: StepIcon, title, copy, tone }: { number: string; icon: Icon; title: string; copy: string; tone: string }) {
  return (
    <article className="step-item">
      <span className={`step-icon soft-icon-${tone}`}><StepIcon aria-hidden size={31} /></span>
      <span className={`step-number step-number-${tone}`}>{number}</span>
      <div><h3>{title}</h3><p>{copy}</p></div>
    </article>
  );
}

function TurnstileWidget({ onToken, action = 'attempt_start' }: { onToken: (token: string) => void; action?: 'attempt_start' | 'organizer_login' }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    let widgetId: string | undefined;
    const render = async () => {
      try {
        const { turnstileSitekey } = await getPublicRuntimeConfig();
        if (!active) return;
        const mount = () => {
          if (!active || !containerRef.current || !window.turnstile) return;
          widgetId = window.turnstile.render(containerRef.current, {
            sitekey: turnstileSitekey,
            action,
            callback: onToken,
            'error-callback': () => { onToken(''); setUnavailable(true); },
            'expired-callback': () => onToken(''),
            theme: 'light',
          });
        };
        if (window.turnstile) mount();
        else {
          const existing = document.querySelector<HTMLScriptElement>('script[data-vecta-turnstile]');
          const script = existing ?? Object.assign(document.createElement('script'), {
            src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
            async: true,
            defer: true,
          });
          script.dataset.vectaTurnstile = 'true';
          script.addEventListener('load', mount, { once: true });
          script.addEventListener('error', () => setUnavailable(true), { once: true });
          if (!existing) document.head.appendChild(script);
        }
      } catch {
        if (active) setUnavailable(true);
      }
    };
    void render();
    return () => {
      active = false;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [action, onToken]);
  return <div className="turnstile-slot">{unavailable ? <p className="field-error">Не удалось загрузить защитную проверку. Обновите страницу.</p> : <div ref={containerRef} />}</div>;
}

function participantAccessCopy(error: unknown): { title: string; copy: string } {
  if (error instanceof ApiRequestError) {
    if (error.status === 404) return { title: 'Код не найден', copy: 'Проверьте шесть символов или попросите организатора прислать новую ссылку.' };
    if (error.status === 409) return { title: 'Попытка уже использована', copy: 'Для этого участника или приглашения новая попытка недоступна.' };
    if (error.status === 410) return { title: 'Доступ к тесту завершён', copy: 'Срок ссылки истёк или организатор закрыл тест.' };
    if (error.status === 429) return { title: 'Слишком много попыток входа', copy: 'Подождите минуту и повторите — это защищает тест от автоматических запросов.' };
  }
  return { title: 'Не удалось проверить доступ', copy: 'Проверьте соединение и повторите запрос. Введённое имя останется на странице.' };
}

function ParticipantJoinPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const code = new URLSearchParams(location.search).get('code')?.trim().toUpperCase() ?? '';
  const invitationToken = new URLSearchParams(location.hash.slice(1)).get('invite')?.trim() ?? '';
  const [publication, setPublication] = useState<ResolvedPublicationDTO | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(code ? 'loading' : invitationToken ? 'ready' : 'error');
  const [accessError, setAccessError] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [validating, setValidating] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const onTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);

  useEffect(() => {
    if (!code) return;
    let active = true;
    setLoadState('loading');
    resolvePublication(code).then((value) => {
      if (active) { setPublication(value); setLoadState('ready'); }
    }).catch((reason: unknown) => {
      if (active) { setAccessError(reason); setLoadState('error'); }
    });
    return () => { active = false; };
  }, [code]);

  const continueToInstructions = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = name.trim();
    if (normalized.length < 2) { setError('Введите имя — минимум 2 символа'); return; }
    if (!turnstileToken) { setError('Завершите защитную проверку'); return; }
    setError('');
    setValidating(true);
    try {
      let participantIdentity = window.localStorage.getItem('vecta-participant-identity');
      if (!participantIdentity) {
        participantIdentity = crypto.randomUUID();
        window.localStorage.setItem('vecta-participant-identity', participantIdentity);
      }
      const attempt = await createParticipantAttempt({
        ...(code ? { code, participantIdentity } : { invitationToken }),
        displayName: normalized,
        turnstileToken,
      });
      window.sessionStorage.setItem(`vecta-attempt-${attempt.attemptId}`, JSON.stringify({ attemptToken: attempt.attemptToken }));
      void navigate(`/attempt/${attempt.attemptId}/instructions`, { replace: true });
    } catch (reason) {
      const copy = participantAccessCopy(reason);
      setError(`${copy.title}. ${copy.copy}`);
      setValidating(false);
    }
  };

  if (!code && !invitationToken) return <ParticipantAccessState title="Не указан код теста" copy="Вернитесь на главную и введите код из шести символов." action="Ввести код" onAction={() => navigate('/')} />;
  if (loadState === 'loading') return <div className="participant-page"><ParticipantPublicHeader /><main className="participant-main"><SystemPanel kind="loading" title="Проверяем код" copy="Получаем актуальные правила теста…" /></main><ParticipantFooter /></div>;
  if (loadState === 'error') {
    const copy = participantAccessCopy(accessError);
    return <ParticipantAccessState {...copy} action="Ввести другой код" onAction={() => navigate('/')} />;
  }
  const title = publication?.title ?? 'Персональное приглашение';
  const description = publication?.description || 'Организатор подготовил для вас индивидуальную попытку.';
  const duration = publication?.durationSeconds ? `${Math.ceil(publication.durationSeconds / 60)} мин` : 'Без таймера';
  return <div className="participant-page participant-entry-page"><ParticipantPublicHeader /><main className="participant-entry-layout"><section className="participant-entry-copy"><p className="eyebrow">Тест для участников</p><h1>{title}</h1><p>{description}</p><dl className="participant-facts"><div><dt><ListChecks aria-hidden />Вопросы</dt><dd>{publication?.questionCount ?? 'После входа'}</dd></div><div><dt><Clock aria-hidden />Время</dt><dd>{duration}</dd></div><div><dt><ShieldCheck aria-hidden />Результат</dt><dd>{publication?.showParticipantResult ? 'Баллы после отправки' : 'Подтверждение'}</dd></div></dl></section><section className="participant-entry-card" aria-labelledby="participant-entry-title"><span className="soft-icon soft-icon-green"><CheckCircle aria-hidden size={28} /></span><div><h2 id="participant-entry-title">Доступ подтверждён</h2><p>Осталось указать, как к вам обращаться.</p></div>{code && <div className="accepted-code"><span>Код теста</span><strong>{code}</strong><Check aria-hidden /></div>}<form onSubmit={continueToInstructions} noValidate><label className="field-label" htmlFor="participant-name">Ваше имя</label><input id="participant-name" className={error ? 'text-input input-error' : 'text-input'} value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Анна Петрова" autoComplete="name" autoFocus aria-describedby={error ? 'participant-name-error' : 'participant-name-help'} />{error ? <p className="field-error" id="participant-name-error">{error}</p> : <p className="field-help" id="participant-name-help">Аккаунт создавать не нужно</p>}<TurnstileWidget onToken={onTurnstileToken} /><button className="button button-primary button-wide" type="submit" disabled={validating || !turnstileToken}>{validating ? 'Создаём попытку…' : 'Продолжить'}</button></form><button className="text-action participant-back" onClick={() => navigate('/')}><ArrowLeft aria-hidden />Ввести другой код</button></section></main><ParticipantFooter /></div>;
}

function ParticipantAccessState({ title, copy, action, onAction }: { title: string; copy: string; action: string; onAction: () => void }) {
  return <><OnboardingPage /><PublicOverlayDialog eyebrow="Доступ к тесту" title={title} copy={copy} icon={WarningCircle} tone="orange" primaryLabel={action} primaryStyle="secondary" onPrimary={onAction} onClose={onAction} /></>;
}

function ParticipantPublicHeader({ name, onExit }: { name?: string; onExit?: () => void }) {
  return <header className="participant-header"><VectaLogo compact /><div className="participant-header-actions"><span>{name ? `Участник: ${name}` : 'Помощь и поддержка'}</span>{onExit && <button className="participant-exit" onClick={onExit}><SignOut aria-hidden />Выйти из теста</button>}</div></header>;
}

function ParticipantFooter() {
  return <footer className="participant-footer"><span>© 2026 Vecta</span></footer>;
}

function ParticipantAttemptLayout() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const storedSession = attemptId ? window.sessionStorage.getItem(`vecta-attempt-${attemptId}`) : null;
  let attemptToken = '';
  try { attemptToken = storedSession ? (JSON.parse(storedSession) as { attemptToken?: string }).attemptToken ?? '' : ''; } catch { attemptToken = ''; }
  const [state, setState] = useState<AttemptStateDTO | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [answers, setAnswers] = useState<Record<string, SaveAnswerRequest['value']>>({});
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saved');
  const [exitOpen, setExitOpen] = useState(false);
  const saveQueues = useRef(new Map<string, Promise<void>>());
  const canExit = location.pathname.includes('/questions/') || location.pathname.endsWith('/review');

  useEffect(() => {
    if (!attemptId || !attemptToken) { setLoadError(true); return; }
    let active = true;
    getParticipantAttempt(attemptId, attemptToken).then((value) => {
      if (!active) return;
      setState(value);
      setAnswers(value.answers);
    }).catch(() => active && setLoadError(true));
    return () => { active = false; };
  }, [attemptId, attemptToken]);

  const setAnswer = (questionId: string, answer: SaveAnswerRequest['value']) => {
    if (!attemptId || !attemptToken) return;
    setSaveState('saving');
    setAnswers((current) => ({ ...current, [questionId]: answer }));
    const previous = saveQueues.current.get(questionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      await saveParticipantAnswer(attemptId, attemptToken, questionId, { value: answer });
    });
    saveQueues.current.set(questionId, next);
    void next.then(() => setSaveState('saved')).catch(() => setSaveState('error'));
  };

  const submit = async () => {
    if (!attemptId || !attemptToken) throw new Error('Attempt session is missing');
    await Promise.all([...saveQueues.current.values()]);
    const response = await submitParticipantAttempt(attemptId, attemptToken, crypto.randomUUID());
    setState((current) => current ? { ...current, status: 'submitted', result: response.result } : current);
    return response.result;
  };

  const abandonAttempt = async () => {
    if (!attemptId || !attemptToken) return;
    try { await abandonParticipantAttempt(attemptId, attemptToken); } finally {
      window.sessionStorage.removeItem(`vecta-attempt-${attemptId}`);
      setExitOpen(false);
      void navigate('/?attempt=abandoned', { replace: true });
    }
  };

  if (loadError || !attemptId || !attemptToken) return <ParticipantAccessState title="Сессия попытки недоступна" copy="Откройте исходную ссылку заново. Если попытка уже завершена, создать новую по тому же приглашению нельзя." action="На главную" onAction={() => navigate('/')} />;
  if (!state) return <div className="participant-page"><ParticipantPublicHeader /><main className="participant-main"><SystemPanel kind="loading" title="Загружаем попытку" copy="Восстанавливаем вопросы и сохранённые ответы…" /></main><ParticipantFooter /></div>;
  if (state.status !== 'active' && !location.pathname.endsWith('/complete')) return <Navigate to={`/attempt/${attemptId}/complete`} replace />;
  const context: ParticipantAttemptContextValue = { attemptId, attemptToken, name: state.displayName, assessment: state.assessment, deadlineAt: state.deadlineAt, answers, saveState, setAnswer, submit, showResult: state.showParticipantResult, result: state.result };
  return <div className="participant-page participant-attempt-page"><ParticipantPublicHeader name={state.displayName} {...(canExit && state.status === 'active' ? { onExit: () => setExitOpen(true) } : {})} /><Outlet context={context} /><ParticipantFooter />{exitOpen && <Modal title="Выйти из теста?" onClose={() => setExitOpen(false)}><div className="attempt-exit-warning"><WarningCircle aria-hidden /><p><strong>Эта попытка будет использована</strong><span>Сохранённые ответы не отправятся, а вернуться к этой попытке уже не получится.</span></p></div><div className="modal-actions"><button className="button button-ghost" onClick={() => setExitOpen(false)}>Продолжить тест</button><button className="button button-danger" onClick={() => void abandonAttempt()}>Выйти и завершить попытку</button></div></Modal>}</div>;
}

function useParticipantAttempt() {
  return useOutletContext<ParticipantAttemptContextValue>();
}

function ParticipantInstructionsPage() {
  const navigate = useNavigate();
  const { attemptId, assessment, deadlineAt, name, showResult } = useParticipantAttempt();
  const [confirmed, setConfirmed] = useState(false);
  const duration = assessment.durationSeconds ? `${Math.ceil(assessment.durationSeconds / 60)} минут` : 'Без таймера';
  return <main className="participant-main"><section className="instruction-card"><span className="soft-icon soft-icon-blue"><ShieldCheck aria-hidden size={30} /></span><p className="eyebrow">Перед началом</p><h1>{assessment.title}</h1><p className="instruction-lead">{name}, прочитайте короткие правила — после старта ответы будут сохраняться автоматически.</p><div className="instruction-stats"><div><ListChecks aria-hidden /><span><strong>{assessment.questions.length} вопросов</strong><small>Тип ответа указан в каждом вопросе</small></span></div><div><Clock aria-hidden /><span><strong>{duration}</strong><small>{deadlineAt ? 'Срок контролируется сервером' : 'Жёсткого таймера нет'}</small></span></div><div><CheckCircle aria-hidden /><span><strong>{showResult ? 'Баллы после отправки' : 'Подтверждение отправки'}</strong><small>Правильные ответы не показываются</small></span></div></div><ul className="instruction-rules"><li>Можно возвращаться к предыдущим вопросам.</li><li>Перед отправкой Vecta покажет пропущенные вопросы.</li><li>Не закрывайте вкладку до подтверждения отправки.</li></ul><label className="instruction-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>Я прочитал правила и готов начать</span></label><button className="button button-primary button-wide" disabled={!confirmed} onClick={() => navigate(`/attempt/${attemptId}/questions/1`)}>Начать тест</button></section></main>;
}

function ParticipantQuestionPage() {
  const { attemptId, position } = useParams();
  const navigate = useNavigate();
  const { assessment, answers, saveState, setAnswer } = useParticipantAttempt();
  const participantQuestions = assessment.questions;
  const questionIndex = Math.max(0, Number(position ?? '1') - 1);
  const question = participantQuestions[questionIndex];
  if (!question) return <Navigate to={`/attempt/${attemptId}/review`} replace />;
  const answer = answers[question.id];
  const selected = Array.isArray(answer) ? answer : typeof answer === 'string' ? [answer] : [];
  const nextRoute = questionIndex === participantQuestions.length - 1 ? `/attempt/${attemptId}/review` : `/attempt/${attemptId}/questions/${questionIndex + 2}`;
  const previousRoute = questionIndex > 0 ? `/attempt/${attemptId}/questions/${questionIndex}` : '';
  const typeLabel = question.type === 'single_choice' ? 'Один вариант ответа' : question.type === 'multiple_choice' ? 'Можно выбрать несколько' : 'Оценка по шкале';
  return <main className="participant-main question-stage"><section className="question-progress"><div><span>Вопрос {questionIndex + 1} из {participantQuestions.length}</span><span className={`attempt-save save-${saveState}`}>{!hasParticipantAnswer(answer) ? 'Ответ не выбран' : saveState === 'saving' ? 'Сохранение…' : saveState === 'error' ? 'Не удалось сохранить' : <><Check aria-hidden />Ответ сохранён</>}</span></div><progress max={participantQuestions.length} value={questionIndex + 1} /></section><section className="participant-question-card"><span className="question-type-label">{typeLabel}</span><h1>{question.text}</h1>{question.type === 'rating' ? <div className="participant-scale" role="radiogroup" aria-label={`Оценка от ${question.scaleMin} до ${question.scaleMax}`}>{Array.from({ length: question.scaleMax - question.scaleMin + 1 }, (_, index) => question.scaleMin + index).map((value) => <button key={value} className={answer === value ? 'active' : ''} onClick={() => setAnswer(question.id, value)} role="radio" aria-checked={answer === value}>{value}</button>)}</div> : <div className="participant-options">{question.options.map((option) => { const checked = selected.includes(option.id); return <label key={option.id} className={checked ? 'participant-option selected' : 'participant-option'}><input type={question.type === 'single_choice' ? 'radio' : 'checkbox'} name={question.type === 'single_choice' ? question.id : undefined} checked={checked} onChange={() => setAnswer(question.id, question.type === 'single_choice' ? option.id : checked ? selected.filter((item) => item !== option.id) : [...selected, option.id])} /><span>{option.text}</span></label>; })}</div>}<footer className="question-navigation"><button className="button button-ghost" disabled={!previousRoute} onClick={() => previousRoute && navigate(previousRoute)}><ArrowLeft aria-hidden />Назад</button><button className="button button-primary" onClick={() => navigate(nextRoute)}>{questionIndex === participantQuestions.length - 1 ? 'Проверить ответы' : 'Далее'}<ArrowRight aria-hidden /></button></footer></section></main>;
}

function ParticipantReviewPage() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const { assessment, answers, saveState, submit } = useParticipantAttempt();
  const participantQuestions = assessment.questions;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { answered, unanswered } = participantProgress(participantQuestions.map((question) => question.id), answers);
  const submitAttempt = async () => {
    setSubmitting(true);
    try { await submit(); void navigate(`/attempt/${attemptId}/complete`, { replace: true }); }
    catch { setSubmitting(false); }
  };
  const requiredMissing = participantQuestions.some((question) => question.required && !hasParticipantAnswer(answers[question.id]));
  return <main className="participant-main review-stage"><section className="review-card"><p className="eyebrow">Перед отправкой</p><h1>Проверьте ответы</h1><p>Отвечено {answered} из {participantQuestions.length}. К любому вопросу можно вернуться.</p><div className="review-summary"><div className="review-metric answered"><strong>{answered}</strong><span>Отвечено</span></div><div className="review-metric"><strong>{unanswered}</strong><span>Без ответа</span></div></div><div className="review-list">{participantQuestions.map((question, index) => { const complete = hasParticipantAnswer(answers[question.id]); return <button key={question.id} onClick={() => navigate(`/attempt/${attemptId}/questions/${index + 1}`)}><span className={complete ? 'review-number complete' : 'review-number'}>{complete ? <Check aria-hidden /> : index + 1}</span><span><strong>Вопрос {index + 1}{question.required ? ' · обязательный' : ''}</strong><small>{complete ? 'Ответ сохранён' : 'Без ответа'}</small></span><CaretRight aria-hidden /></button>; })}</div><div className="review-actions"><button className="button button-ghost" onClick={() => navigate(`/attempt/${attemptId}/questions/${participantQuestions.length}`)}><ArrowLeft aria-hidden />Вернуться к вопросам</button><button className="button button-primary" disabled={requiredMissing || saveState === 'saving'} onClick={() => setConfirmOpen(true)}>Отправить ответы</button></div></section>{confirmOpen && <Modal title="Отправить ответы?" onClose={() => !submitting && setConfirmOpen(false)}><p className="modal-copy">После отправки изменить ответы будет нельзя. Необязательные вопросы можно оставить без ответа.</p><div className="modal-actions"><button className="button button-ghost" disabled={submitting} onClick={() => setConfirmOpen(false)}>Отмена</button><button className="button button-primary" disabled={submitting} onClick={() => void submitAttempt()}>{submitting ? 'Отправляем…' : 'Подтвердить отправку'}</button></div></Modal>}</main>;
}

function ParticipantCompletePage() {
  const navigate = useNavigate();
  const { name, result } = useParticipantAttempt();
  const visibleResult = result?.resultVisible ? result : null;
  return <main className="participant-main"><section className="complete-card"><span className="completion-mark"><Check aria-hidden weight="bold" /></span><p className="eyebrow">Готово</p><h1>Попытка завершена</h1><p>{name}, сохранённые ответы обработаны. Повторная отправка этой попытки недоступна.</p>{visibleResult && <div className="participant-score"><span>Ваш результат</span><strong>{visibleResult.score} <small>из {visibleResult.maxScore}</small></strong><p>Правильные ответы не раскрываются организатором.</p></div>}<button className="button button-secondary" onClick={() => navigate('/')}>Вернуться на главную</button></section></main>;
}

function WorkspaceLayout() {
  const navigate = useNavigate();
  const session = useAuthSession();
  const organizationId = session.memberships[0]?.organizationId;
  const userName = session.user.displayName;
  const userInitials = userName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const [tests, setTests] = useState<TestCardData[]>([]);
  const [drafts, setDrafts] = useState<Record<string, AssessmentDraft>>({});
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [profileOpen, setProfileOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTestName, setNewTestName] = useState('');
  const [toast, setToast] = useState('');

  const reloadTests = useCallback(async () => {
    if (!organizationId) throw new Error('Organizer membership is unavailable');
    setLoadState('loading');
    try {
      const items = await getAssessments(organizationId);
      setTests(items.map(testFromDto));
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [organizationId]);

  const loadDraft = useCallback(async (assessmentId: string) => {
    const dto = await getAssessmentDraft(assessmentId);
    const draft = draftFromDto(dto);
    setDrafts((current) => ({ ...current, [assessmentId]: draft }));
    return draft;
  }, []);

  useEffect(() => {
    void reloadTests();
  }, [reloadTests]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setProfileOpen(false);
      setSupportOpen(false);
      setCreateOpen(false);
      setMobileNavOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  const createTest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = newTestName.trim();
    if (!title || !organizationId) return;
    try {
      const created = await createAssessment(organizationId, { title });
      const test = testFromDto(created);
      setTests((current) => [test, ...current]);
      setDrafts((current) => ({ ...current, [test.id]: createBlankDraft() }));
      setNewTestName('');
      setCreateOpen(false);
      void navigate(`/app/tests/${test.id}/edit`);
      setToast('Черновик создан — добавьте первый вопрос');
    } catch {
      setToast('Не удалось создать черновик. Попробуйте ещё раз');
    }
  };

  const context: WorkspaceContextValue = {
    tests,
    setTests,
    drafts,
    setDrafts,
    openCreate: () => setCreateOpen(true),
    showMessage: setToast,
    loadState,
    reloadTests,
    loadDraft,
  };

  return (
    <div className="workspace">
      <button className="mobile-menu-trigger" onClick={() => setMobileNavOpen(true)} aria-label="Открыть меню">
        <DotsSixVertical aria-hidden />
      </button>
      <aside className={mobileNavOpen ? 'workspace-sidebar sidebar-open' : 'workspace-sidebar'}>
        <button className="mobile-sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="Закрыть меню"><X aria-hidden /></button>
        <NavLink className="workspace-logo-link" to="/app" aria-label="Перейти в обзор Vecta"><VectaLogo /></NavLink>
        <nav className="workspace-nav" aria-label="Рабочее пространство">
          <NavItem to="/app" end icon={House}>Обзор</NavItem>
          <NavItem to="/app/tests" icon={ClipboardText}>Тесты</NavItem>
          <NavItem to="/app/results" icon={ChartBar}>Результаты</NavItem>
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-anchor">
            {profileOpen && <ProfileMenu onClose={() => setProfileOpen(false)} />}
            <button className="profile-trigger" aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)}>
              <span className="avatar">{userInitials}</span>
              <span className="profile-copy"><strong>{userName}</strong><small>Организатор</small></span>
              <CaretDown aria-hidden />
            </button>
          </div>
          <button className="support-trigger" onClick={() => setSupportOpen(true)}>
            <Lifebuoy aria-hidden />Помощь и поддержка
          </button>
        </div>
      </aside>

      {mobileNavOpen && <button className="mobile-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Закрыть меню" />}

      <div className="workspace-main">
        <header className="workspace-topbar">
          <span><CalendarBlank aria-hidden />30 августа 2026</span>
          <button className="icon-button" aria-label="Уведомления" onClick={() => setToast('Новых уведомлений нет')}><Bell aria-hidden /></button>
        </header>
        <Outlet context={context} />
        <footer className="workspace-footer"><span>© 2026 Vecta. Все права защищены.</span></footer>
      </div>

      {supportOpen && <SupportDrawer onClose={() => setSupportOpen(false)} />}
      {createOpen && (
        <Modal title="Новый тест" onClose={() => setCreateOpen(false)}>
          <form onSubmit={createTest}>
            <label className="field-label" htmlFor="new-test-name">Название</label>
            <input id="new-test-name" className="text-input" value={newTestName} onChange={(event) => setNewTestName(event.target.value)} autoFocus placeholder="Например, Основы охраны труда" />
            <p className="field-help">Сначала создадим черновик. Вопросы и настройки добавите следующим шагом.</p>
            <div className="modal-actions"><button className="button button-ghost" type="button" onClick={() => setCreateOpen(false)}>Отмена</button><button className="button button-primary" type="submit" disabled={!newTestName.trim()}>Создать черновик</button></div>
          </form>
        </Modal>
      )}
      {toast && <div className="toast" role="status"><Check aria-hidden weight="bold" />{toast}</div>}
    </div>
  );
}

function NavItem({ to, icon: NavIcon, end = false, children }: { to: string; icon: Icon; end?: boolean; children: ReactNode }) {
  return <NavLink end={end} to={to} className={({ isActive }) => isActive ? 'workspace-nav-link active' : 'workspace-nav-link'}><NavIcon aria-hidden />{children}</NavLink>;
}

function ProfileMenu({ onClose }: { onClose: () => void }) {
  const session = useAuthSession();
  return (
    <div className="profile-menu" role="menu">
      <div className="profile-menu-head"><strong>{session.user.displayName}</strong><span>{session.user.email}</span><span>{session.memberships[0]?.organizationName ?? 'Vecta'}</span></div>
      <button role="menuitem" autoFocus onClick={() => { onClose(); void logoutOrganizer(); }}><SignOut aria-hidden />Выйти</button>
    </div>
  );
}

function SupportDrawer({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const questions = [
    { title: 'Как создать и опубликовать тест', answer: 'Откройте раздел «Тесты», создайте черновик и заполните вопросы. Кнопка публикации станет доступна, когда обязательные проверки будут пройдены.' },
    { title: 'Как пригласить участников', answer: 'После публикации скопируйте общую ссылку, код или QR. Для персонального доступа используйте контролируемые приглашения.' },
    { title: 'Где посмотреть результаты', answer: 'Откройте «Результаты», выберите опубликованный тест и переключайтесь между обзором, вопросами и попытками участников.' },
  ];
  const filtered = questions.filter((question) => question.title.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));
  useDialogFocus(onClose, drawerRef, searchRef);
  return (
    <div className="drawer-layer">
      <div className="drawer-scrim" onMouseDown={onClose} aria-hidden="true" />
      <aside ref={drawerRef} className="support-drawer" role="dialog" aria-modal="true" aria-labelledby="support-title" tabIndex={-1}>
        <header><h2 id="support-title">Помощь и поддержка</h2><button className="icon-button" onClick={onClose} aria-label="Закрыть"><X aria-hidden /></button></header>
        <label className="search-field"><MagnifyingGlass aria-hidden /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти ответ" aria-label="Поиск в помощи" /></label>
        <section><h3>Популярные вопросы</h3><div className="support-links">{filtered.map((question) => <div className="support-question" key={question.title}><button aria-expanded={openQuestion === question.title} onClick={() => setOpenQuestion((current) => current === question.title ? null : question.title)}>{question.title}{openQuestion === question.title ? <CaretDown aria-hidden /> : <CaretRight aria-hidden />}</button>{openQuestion === question.title && <p className="support-answer">{question.answer}</p>}</div>)}{filtered.length === 0 && <p className="support-empty">По вашему запросу ничего не найдено</p>}</div></section>
        <p className="support-staging-note"><Lifebuoy aria-hidden /><span><strong>Vecta находится на этапе тестирования</strong>Канал обращения добавим перед публичным запуском. Сейчас здесь доступны встроенные инструкции.</span></p>
      </aside>
    </div>
  );
}

function OverviewPage() {
  const { openCreate, tests, loadState } = useWorkspace();
  const session = useAuthSession();
  const runningTests = tests.filter((test) => test.stage === 'running');
  const draftCount = tests.filter((test) => test.stage === 'draft').length;
  const completedCount = tests.filter((test) => test.stage === 'completed').length;
  const firstName = session.user.displayName.trim().split(/\s+/)[0] || 'организатор';
  return (
    <main className="workspace-page overview-page">
      <PageHeader eyebrow="Вот что происходит с тестированием команды" title={`Добрый день, ${firstName}`} action={<button className="button button-primary" onClick={openCreate}><Plus aria-hidden />Создать тест</button>} />
      <div className="overview-grid">
        <section className="overview-primary"><div className="section-title"><div><h2>Сейчас идут</h2><p>Тесты, которые активны и требуют внимания.</p></div></div>{loadState === 'loading' ? <SystemPanel kind="loading" title="Загружаем обзор" copy="Получаем актуальные тесты…" /> : runningTests.length > 0 ? <div className="active-test-list">{runningTests.map((test) => <ActiveTestRow key={test.id} test={test} />)}</div> : <SystemPanel kind="empty" title="Нет активных тестов" copy="Опубликуйте готовый черновик — он появится здесь." />}<NavLink to="/app/tests" className="overview-all-tests"><span className="soft-icon soft-icon-blue"><FileText aria-hidden /></span><span><strong>Все тесты</strong><small>Просматривайте черновики, запущенные и завершённые тесты.</small></span><CaretRight aria-hidden /></NavLink></section>
        <aside className="today-panel"><h2>Рабочее пространство</h2><TodayItem icon={FileText} tone="green" value={`${draftCount} ${draftCount === 1 ? 'черновик' : 'черновиков'}`} copy="Можно продолжить редактирование" /><TodayItem icon={TrendUp} tone="blue" value={`${runningTests.length} ${runningTests.length === 1 ? 'тест идёт' : 'тестов идут'}`} copy="Принимают участников" /><TodayItem icon={CalendarBlank} tone="orange" value={`${completedCount} завершено`} copy="Снимки версий сохранены" /><div className="recent-changes"><h3>Последние изменения</h3><p className="support-empty">Новые попытки и ответы сохраняются сразу после старта участника.</p></div></aside>
      </div>
    </main>
  );
}

function PageHeader({ title, eyebrow, action }: { title: string; eyebrow: string; action?: ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1><p>{eyebrow}</p></div>{action}</div>;
}

function ActiveTestRow({ test }: { test: TestCardData }) {
  return <article className="active-test-row"><span className="soft-icon soft-icon-blue"><ListChecks aria-hidden /></span><div className="active-title"><strong>{test.title}</strong><span>Публикация принимает ответы</span></div><div className="progress-cell"><span>Аналитика — Phase 8</span></div><div className="score-cell"><span>Статус</span><strong>Идёт</strong></div>{test.publicationId ? <NavLink to={`/app/publications/${test.publicationId}/distribute`}>Доступ<ArrowRight aria-hidden /></NavLink> : <NavLink to="/app/tests">Открыть<ArrowRight aria-hidden /></NavLink>}</article>;
}

function TodayItem({ icon: ItemIcon, tone, value, copy }: { icon: Icon; tone: string; value: string; copy: string }) {
  return <button className="today-item"><span className={`soft-icon soft-icon-${tone}`}><ItemIcon aria-hidden /></span><span><strong>{value}</strong><small>{copy}</small></span><CaretRight aria-hidden /></button>;
}

function TestBoardPage() {
  const { tests, setTests, setDrafts, openCreate, showMessage, loadState, reloadTests } = useWorkspace();
  const navigate = useNavigate();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingTransition, setPendingTransition] = useState<{ test: TestCardData; to: TestStage } | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const activeTest = activeId ? tests.find((test) => test.id === activeId) : undefined;
  const visibleState = loadState === 'loading' ? 'loading' : loadState === 'error' ? 'error' : tests.length === 0 ? 'empty' : null;

  if (visibleState) {
    return <main className="workspace-page tests-page"><PageHeader title="Тесты" eyebrow="Создавайте, управляйте и отслеживайте тесты для вашей команды" action={<button className="button button-primary" onClick={openCreate}><Plus aria-hidden />Создать тест</button>} />{visibleState === 'loading' ? <SystemPanel kind="loading" title="Загружаем тесты" copy="Получаем актуальные черновики и публикации…" /> : visibleState === 'empty' ? <SystemPanel kind="empty" title="Здесь появятся ваши тесты" copy="Создайте первый черновик — вопросы и настройки можно заполнить позже." action={<button className="button button-primary" onClick={openCreate}><Plus aria-hidden />Создать первый тест</button>} /> : <SystemPanel kind="error" title="Не удалось загрузить тесты" copy="Проверьте соединение и повторите запрос. Ваши данные не изменены." action={<button className="button button-secondary" onClick={() => void reloadTests()}>Повторить</button>} />}</main>;
  }

  const requestMove = (test: TestCardData, to: TestStage) => {
    if (test.stage === to) return;
    if (!canTransitionTest(test.stage, to)) {
      showMessage('Этот переход недоступен для выбранных этапов.');
      return;
    }
    setPendingTransition({ test, to });
  };

  const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    if (!event.over) return;
    const test = tests.find((item) => item.id === String(event.active.id));
    const to = String(event.over.id) as TestStage;
    if (test && stageOrder.includes(to)) requestMove(test, to);
  };

  const confirmMove = async () => {
    if (!pendingTransition || transitioning) return;
    if (pendingTransition.to === 'running') {
      if (pendingTransition.test.stage === 'draft') {
        const testId = pendingTransition.test.id;
        setPendingTransition(null);
        void navigate(`/app/tests/${testId}/publish`);
        return;
      }
    }
    const transition = pendingTransition;
    setTransitioning(true);
    try {
      if (transition.to === 'completed') {
        if (!transition.test.publicationId) throw new Error('Publication is missing');
        await closePublication(transition.test.publicationId);
        setTests((current) => current.map((test) => test.id === transition.test.id ? {
          ...test,
          stage: 'completed',
          publicationHistory: test.publicationHistory.map((publication) => publication.publicationId === transition.test.publicationId ? { ...publication, status: 'closed' } : publication),
        } : test));
        showMessage('Тест завершён');
      } else if (transition.to === 'running') {
        if (!transition.test.publicationId) throw new Error('Publication is missing');
        await reopenPublication(transition.test.publicationId);
        setTests((current) => current.map((test) => test.id === transition.test.id ? {
          ...test,
          stage: 'running',
          publicationHistory: test.publicationHistory.map((publication) => publication.publicationId === transition.test.publicationId ? { ...publication, status: 'published' } : publication),
        } : test));
        showMessage('Тест снова принимает участников');
      } else if (transition.to === 'draft') {
        const dto = await reviseAssessment(transition.test.id);
        setDrafts((current) => ({ ...current, [transition.test.id]: draftFromDto(dto) }));
        setTests((current) => current.map((test) => test.id === transition.test.id ? {
          ...test,
          title: dto.title,
          stage: 'draft',
          updatedLabel: new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(Date.now()),
          publicationHistory: test.publicationHistory.map((publication) => publication.publicationId === transition.test.publicationId && publication.status === 'published' ? { ...publication, status: 'closed' } : publication),
        } : test));
        showMessage('Создана новая редактируемая версия');
        void navigate(`/app/tests/${transition.test.id}/edit`);
      }
      setPendingTransition(null);
    } catch {
      showMessage(transition.to === 'running' ? 'Не удалось запустить тест снова' : transition.to === 'draft' ? 'Не удалось создать новую версию' : 'Не удалось завершить тест');
    } finally {
      setTransitioning(false);
    }
  };

  return (
    <main className="workspace-page tests-page">
      <PageHeader title="Тесты" eyebrow="Создавайте, управляйте и отслеживайте тесты для вашей команды" action={<button className="button button-primary" onClick={openCreate}><Plus aria-hidden />Создать тест</button>} />
      <p className="board-help"><DotsSixVertical aria-hidden />Перетаскивайте тесты между этапами</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="test-board">
          {stageOrder.map((stage) => <BoardColumn key={stage} stage={stage} tests={tests.filter((test) => test.stage === stage)} onMove={requestMove} onCreate={openCreate} />)}
        </div>
        <DragOverlay>{activeTest ? <TestCard test={activeTest} overlay onMove={requestMove} /> : null}</DragOverlay>
      </DndContext>
      {pendingTransition && (() => {
        const prompt = transitionPrompt(pendingTransition.test.stage, pendingTransition.to);
        if (!prompt) return null;
        return <Modal title={prompt.title} onClose={() => { if (!transitioning) setPendingTransition(null); }}><p className="modal-copy">{prompt.description}</p><div className="modal-actions"><button className="button button-ghost" disabled={transitioning} onClick={() => setPendingTransition(null)}>Отмена</button><button className="button button-primary" disabled={transitioning} onClick={confirmMove}>{transitioning ? 'Выполняем…' : prompt.action}</button></div></Modal>;
      })()}
    </main>
  );
}

function BoardColumn({ stage, tests, onMove, onCreate }: { stage: TestStage; tests: TestCardData[]; onMove: (test: TestCardData, stage: TestStage) => void; onCreate: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const total = tests.length;
  return <section ref={setNodeRef} className={isOver ? 'board-column column-over' : 'board-column'} aria-labelledby={`column-${stage}`}><header><h2 id={`column-${stage}`}>{stageLabels[stage]}</h2><span>{total}</span></header><div className="column-cards">{tests.map((test) => <TestCard key={test.id} test={test} onMove={onMove} />)}{tests.length === 0 && <div className="empty-drop">Перетащите тест сюда</div>}</div>{stage === 'draft' && <button className="column-action" onClick={onCreate}><Plus aria-hidden />Создать тест</button>}</section>;
}

function TestCard({ test, onMove, overlay = false }: { test: TestCardData; onMove: (test: TestCardData, stage: TestStage) => void; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: test.id, disabled: overlay });
  const [menuOpen, setMenuOpen] = useState(false);
  const percent = test.answered !== undefined && test.invited ? Math.round(test.answered / test.invited * 100) : undefined;
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  const TestIcon = test.accent === 'green' ? HardHat : test.accent === 'orange' ? Star : test.accent === 'violet' ? Laptop : UsersThree;
  return <article ref={setNodeRef} style={style} className={`test-card ${isDragging ? 'is-dragging' : ''} ${overlay ? 'drag-overlay-card' : ''}`}><div className="test-card-head"><button className="drag-handle" aria-label={`Перетащить ${test.title}`} {...listeners} {...attributes}><DotsSixVertical aria-hidden /></button><span className={`soft-icon soft-icon-${test.accent}`}><TestIcon aria-hidden /></span><strong>{test.title}</strong><button className="card-menu-trigger" aria-label={`Действия: ${test.title}`} onClick={() => setMenuOpen((value) => !value)}><DotsThreeVertical aria-hidden /></button>{menuOpen && <div className="card-menu"><span>Переместить</span>{stageOrder.filter((stage) => stage !== test.stage).map((stage) => <button key={stage} onClick={() => { setMenuOpen(false); onMove(test, stage); }}>{stageLabels[stage]}</button>)}</div>}</div>{test.updatedLabel && <p className="test-updated">{test.updatedLabel}</p>}{test.stage === 'draft' && <div className="draft-card-actions"><NavLink to={`/app/tests/${test.id}/edit`}><PencilSimple aria-hidden />Редактировать</NavLink><NavLink to={`/app/tests/${test.id}/preview`}><Eye aria-hidden />Preview</NavLink></div>}{test.stage === 'running' && test.publicationId && <div className="draft-card-actions"><NavLink to={`/app/publications/${test.publicationId}/distribute`}><LinkSimple aria-hidden />Доступ</NavLink><NavLink to="/app/results"><ChartBar aria-hidden />Результаты</NavLink></div>}{percent !== undefined && <><div className="test-metrics"><span>{test.answered} из {test.invited}</span>{test.averageScore !== undefined && <span>Средний балл {test.averageScore}%</span>}</div><div className={`card-progress progress-${test.stage}`}><progress max="100" value={percent} /><span>{percent}%</span></div></>}</article>;
}

function QuestionEditorPage() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const { tests, setTests, drafts, setDrafts, loadDraft, loadState } = useWorkspace();
  const test = tests.find((item) => item.id === testId);
  const draft = testId ? drafts[testId] : undefined;
  const [activeTab, setActiveTab] = useState<'content' | 'settings'>('content');
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saved');
  const [saveRetry, setSaveRetry] = useState(0);
  const [draftLoadError, setDraftLoadError] = useState(false);
  const lastSavedSnapshot = useRef<string | null>(null);
  const latestSnapshot = useRef<string | null>(null);
  const queuedSnapshots = useRef(new Set<string>());
  const saveQueue = useRef(new RevisionSaveQueue(1));
  const editorAssessmentId = useRef<string | null>(null);
  const testTitle = test?.title ?? '';
  const questions = useMemo(() => draft?.questions ?? [], [draft?.questions]);
  const [activeQuestionId, setActiveQuestionId] = useState(questions[0]?.id ?? 'question-1');
  const activeQuestion = questions.find((question) => question.id === activeQuestionId) ?? questions[0];

  useEffect(() => {
    if (!testId || !test || draft) return;
    let active = true;
    loadDraft(testId).catch(() => active && setDraftLoadError(true));
    return () => { active = false; };
  }, [draft, loadDraft, test, testId]);

  useEffect(() => {
    if (!test || !draft) return;
    const input = draftToApi(test.title, draft);
    const snapshot = JSON.stringify(input);
    latestSnapshot.current = snapshot;
    if (editorAssessmentId.current !== test.id) {
      editorAssessmentId.current = test.id;
      saveQueue.current = new RevisionSaveQueue(draft.revision);
      lastSavedSnapshot.current = snapshot;
      queuedSnapshots.current.clear();
      setSaveState('saved');
      return;
    }
    if (lastSavedSnapshot.current === snapshot || queuedSnapshots.current.has(snapshot)) return;
    setSaveState('saving');
    const timeout = window.setTimeout(() => {
      queuedSnapshots.current.add(snapshot);
      const assessmentId = test.id;
      const queue = saveQueue.current;
      void queue.enqueue(async (expectedRevision) => {
        if (editorAssessmentId.current !== assessmentId || lastSavedSnapshot.current === snapshot) {
          return { revision: expectedRevision, skipped: true as const };
        }
        try {
          const saved = await updateAssessmentDraft(assessmentId, expectedRevision, input);
          return { ...saved, skipped: false as const };
        } catch (error) {
          if (!(error instanceof ApiRequestError) || error.status !== 409) throw error;
          const remote = await getAssessmentDraft(assessmentId);
          const remoteSnapshot = JSON.stringify(draftToApi(remote.title, draftFromDto(remote)));
          if (remoteSnapshot !== snapshot) throw error;
          return { ...remote, skipped: false as const };
        }
      }).then((saved) => {
          if (saved.skipped) return;
          const isCurrentEditor = editorAssessmentId.current === assessmentId;
          if (isCurrentEditor) lastSavedSnapshot.current = snapshot;
          setDrafts((current) => {
            const currentDraft = current[assessmentId];
            return currentDraft ? { ...current, [assessmentId]: { ...currentDraft, revision: saved.revision } } : current;
          });
          setTests((current) => current.map((item) => item.id === assessmentId ? { ...item, ...(isCurrentEditor && latestSnapshot.current === snapshot ? { title: saved.title } : {}), updatedLabel: 'Только что' } : item));
          if (isCurrentEditor) setSaveState(latestSnapshot.current === snapshot ? 'saved' : 'saving');
        }).catch(() => {
          if (editorAssessmentId.current === assessmentId && latestSnapshot.current === snapshot) setSaveState('error');
        }).finally(() => {
          queuedSnapshots.current.delete(snapshot);
        });
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [draft, saveRetry, setDrafts, setTests, test]);

  if (!test || !draft || !activeQuestion) {
    if ((loadState === 'loading' || (test && !draft)) && !draftLoadError) {
      return <main className="workspace-page editor-page"><SystemPanel kind="loading" title="Загружаем черновик" copy="Получаем последнюю сохранённую revision из D1…" /></main>;
    }
    return <main className="workspace-page editor-page"><section className="editor-missing"><h1>Черновик не найден</h1><p>Вернитесь к доске и создайте новый тест.</p><button className="button button-secondary" onClick={() => navigate('/app/tests')}>К тестам</button></section></main>;
  }

  const updateDraft = (patch: Partial<AssessmentDraft>) => setDrafts((current) => {
    const currentDraft = current[test.id] ?? draft;
    return { ...current, [test.id]: { ...currentDraft, ...patch } };
  });
  const updateQuestion = (patch: Partial<DraftQuestion>) => updateDraft({ questions: questions.map((question) => question.id === activeQuestion.id ? { ...question, ...patch } : question) });
  const updateOption = (index: number, value: string) => updateQuestion({ options: activeQuestion.options.map((option, optionIndex) => optionIndex === index ? value : option) });
  const toggleCorrect = (index: number) => updateQuestion({ correct: activeQuestion.type === 'single' ? [index] : activeQuestion.correct.includes(index) ? activeQuestion.correct.filter((item) => item !== index) : [...activeQuestion.correct, index] });
  const addQuestion = () => {
    const question = createBlankQuestion();
    updateDraft({ questions: [...questions, question] });
    setActiveQuestionId(question.id);
    setActiveTab('content');
  };
  const removeQuestion = () => {
    if (questions.length === 1) return;
    const nextQuestions = questions.filter((question) => question.id !== activeQuestion.id);
    updateDraft({ questions: nextQuestions });
    setActiveQuestionId(nextQuestions[0]?.id ?? activeQuestion.id);
  };
  const setTestTitle = (title: string) => setTests((current) => current.map((item) => item.id === test.id ? { ...item, title } : item));
  const saveTitle = () => setTests((current) => current.map((item) => item.id === test.id ? { ...item, title: item.title.trim() || 'Новый тест' } : item));
  const publishReady = canPublishAssessment(testTitle, draft);

  return (
    <main className="workspace-page editor-page">
      <header className="editor-header">
        <button className="editor-back" onClick={() => navigate('/app/tests')}><ArrowLeft aria-hidden />К тестам</button>
        <div className="editor-title-block">
          <input aria-label="Название теста" value={testTitle} onChange={(event) => setTestTitle(event.target.value)} onBlur={saveTitle} />
          <span className={`save-state save-${saveState}`}>{saveState === 'saving' ? 'Сохранение…' : saveState === 'error' ? <button onClick={() => setSaveRetry((value) => value + 1)}>Повторить сохранение</button> : <><Check aria-hidden />Сохранено</>}</span>
        </div>
        <div className="editor-actions">
          <button className="button button-ghost" disabled={saveState !== 'saved'} onClick={() => { saveTitle(); void navigate(`/app/tests/${test.id}/preview`); }}><Eye aria-hidden />Preview</button>
          <button className="button button-primary" disabled={saveState !== 'saved'} onClick={() => { saveTitle(); void navigate(`/app/tests/${test.id}/publish`); }}>Опубликовать{!publishReady ? <span className="sr-only"> — есть ошибки</span> : null}</button>
        </div>
      </header>

      <nav className="editor-tabs" aria-label="Разделы редактора">
        <button className={activeTab === 'content' ? 'active' : ''} onClick={() => setActiveTab('content')}><PencilSimple aria-hidden />Содержание</button>
        <button className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}><GearSix aria-hidden />Настройки</button>
      </nav>

      {activeTab === 'content' ? (
        <div className="editor-grid">
          <aside className="question-rail" aria-label="Список вопросов">
            <header><div><span>Вопросы</span><b>{questions.length}</b></div><button className="icon-button" onClick={addQuestion} aria-label="Добавить вопрос"><Plus aria-hidden /></button></header>
            <div className="question-list">
              {questions.map((question, index) => <button key={question.id} className={question.id === activeQuestion.id ? 'question-item active' : 'question-item'} onClick={() => setActiveQuestionId(question.id)}><span>{index + 1}</span><span><strong>{question.text || 'Новый вопрос'}</strong><small>{question.type === 'single' ? 'Один вариант' : question.type === 'multiple' ? 'Несколько вариантов' : 'Шкала'}</small></span></button>)}
            </div>
            <button className="rail-add" onClick={addQuestion}><Plus aria-hidden />Добавить вопрос</button>
          </aside>

          <section className="question-editor-card">
            <header><span>Вопрос {questions.findIndex((question) => question.id === activeQuestion.id) + 1}</span><select aria-label="Тип вопроса" value={activeQuestion.type} onChange={(event) => { const type = event.target.value as DraftQuestionType; updateQuestion({ type, scored: type === 'scale' ? false : activeQuestion.scored, correct: type === 'scale' ? [] : activeQuestion.correct }); }}><option value="single">Один вариант</option><option value="multiple">Несколько вариантов</option><option value="scale">Шкала</option></select></header>
            <label className="editor-field"><span>Формулировка</span><textarea rows={4} value={activeQuestion.text} onChange={(event) => updateQuestion({ text: event.target.value })} placeholder="Введите вопрос" autoFocus /></label>
            {activeQuestion.type === 'scale' ? <div className="scale-editor"><label><span>От</span><input type="number" min="0" max="9" value={activeQuestion.min} onChange={(event) => updateQuestion({ min: Number(event.target.value) })} /></label><span>—</span><label><span>До</span><input type="number" min="1" max="10" value={activeQuestion.max} onChange={(event) => updateQuestion({ max: Number(event.target.value) })} /></label><p>Шкала используется для аналитики и не участвует в итоговом балле.</p></div> : <div className="answer-editor"><div className="answer-heading"><span>Варианты ответа</span><small>{activeQuestion.scored ? 'Отметьте правильный ответ' : 'Без оценки'}</small></div>{activeQuestion.options.map((option, index) => <div className="answer-row" key={activeQuestion.optionIds[index] ?? `${activeQuestion.id}-${index}`}><input type={activeQuestion.type === 'single' ? 'radio' : 'checkbox'} name={`correct-${activeQuestion.id}`} aria-label={`Правильный вариант ${index + 1}`} checked={activeQuestion.correct.includes(index)} disabled={!activeQuestion.scored} onChange={() => toggleCorrect(index)} /><input value={option} aria-label={`Вариант ${index + 1}`} onChange={(event) => updateOption(index, event.target.value)} placeholder={`Вариант ${index + 1}`} /><button aria-label={`Удалить вариант ${index + 1}`} disabled={activeQuestion.options.length <= 2} onClick={() => updateQuestion({ options: activeQuestion.options.filter((_, optionIndex) => optionIndex !== index), optionIds: activeQuestion.optionIds.filter((_, optionIndex) => optionIndex !== index), correct: activeQuestion.correct.filter((item) => item !== index).map((item) => item > index ? item - 1 : item) })}><X aria-hidden /></button></div>)}<button className="add-option" onClick={() => updateQuestion({ options: [...activeQuestion.options, ''], optionIds: [...activeQuestion.optionIds, `option_${crypto.randomUUID()}`] })}><Plus aria-hidden />Добавить вариант</button></div>}
          </section>

          <aside className="question-properties">
            <h2>Свойства вопроса</h2>
            <label className="property-toggle"><span><strong>Обязательный</strong><small>Нельзя пропустить вопрос</small></span><input type="checkbox" checked={activeQuestion.required} onChange={(event) => updateQuestion({ required: event.target.checked })} /></label>
            {activeQuestion.type !== 'scale' && <><label className="property-toggle"><span><strong>Оцениваемый</strong><small>Учитывать в итоговом балле</small></span><input type="checkbox" checked={activeQuestion.scored} onChange={(event) => updateQuestion({ scored: event.target.checked, correct: event.target.checked ? activeQuestion.correct : [], points: event.target.checked ? Math.max(1, activeQuestion.points) : 0 })} /></label><label className="points-field"><span>Баллы за ответ</span><input type="number" min="1" max="100" value={activeQuestion.points} disabled={!activeQuestion.scored} onChange={(event) => updateQuestion({ points: Math.max(1, Number(event.target.value)) })} /></label></>}
            <div className="property-note"><ListChecks aria-hidden /><p>Перед публикацией Vecta проверит формулировки, варианты и правильные ответы.</p></div>
            <button className="delete-question" onClick={removeQuestion} disabled={questions.length === 1}><Trash aria-hidden />Удалить вопрос</button>
          </aside>
        </div>
      ) : (
        <section className="test-settings-card">
          <header><h2>Настройки теста</h2><p>Базовые правила прохождения можно изменить до публикации.</p></header>
          <label className="settings-row"><span><strong>Режим участия</strong><small>Как участники получают доступ</small></span><select value={draft.participationMode} onChange={(event) => { const participationMode = event.target.value as AssessmentDraft['participationMode']; updateDraft({ participationMode, ...(participationMode === 'controlled' ? { singleAttempt: true } : {}) }); }}><option value="open">Открытый — по ссылке или коду</option><option value="controlled">Контролируемый — по приглашениям</option></select></label>
          <label className="settings-row"><span><strong>Показывать результат</strong><small>Участник увидит набранный и максимальный балл без правильных ответов</small></span><input type="checkbox" checked={draft.showParticipantResult} onChange={(event) => updateDraft({ showParticipantResult: event.target.checked })} /></label>
          <label className="settings-row"><span><strong>Одна попытка</strong><small>{draft.participationMode === 'controlled' ? 'Обязательно для персональных приглашений' : 'Повторное прохождение будет недоступно'}</small></span><input type="checkbox" checked={draft.singleAttempt} disabled={draft.participationMode === 'controlled'} onChange={(event) => updateDraft({ singleAttempt: event.target.checked })} /></label>
        </section>
      )}
      <div className="editor-mobile-actions"><span>{saveState === 'saving' ? 'Сохранение…' : saveState === 'error' ? 'Ошибка сохранения' : 'Сохранено'}</span><button className="button button-primary" disabled={saveState !== 'saved'} onClick={() => navigate(`/app/tests/${test.id}/publish`)}>Опубликовать</button></div>
    </main>
  );
}

function AssessmentPreviewPage() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const { tests, drafts, loadDraft, loadState } = useWorkspace();
  const test = tests.find((item) => item.id === testId);
  const draft = testId ? drafts[testId] : undefined;
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, ParticipantAnswerValue>>({});
  const [draftLoadError, setDraftLoadError] = useState(false);

  useEffect(() => {
    if (!testId || !test || draft) return;
    let active = true;
    loadDraft(testId).catch(() => active && setDraftLoadError(true));
    return () => { active = false; };
  }, [draft, loadDraft, test, testId]);

  if (!test || !draft) {
    if ((loadState === 'loading' || (test && !draft)) && !draftLoadError) return <main className="workspace-page organizer-flow-page"><SystemPanel kind="loading" title="Загружаем Preview" copy="Получаем последнюю сохранённую версию черновика…" /></main>;
    return <OrganizerMissingState title="Черновик не найден" onBack={() => navigate('/app/tests')} />;
  }

  const checks = publicationChecklist(test.title, draft);
  const previewReady = checks.find((item) => item.key === 'questions')?.ready && checks.find((item) => item.key === 'content')?.ready;
  const question = draft.questions[questionIndex];
  const answer = question ? previewAnswers[question.id] : undefined;
  const selected = Array.isArray(answer) ? answer : [];

  return (
    <main className="workspace-page organizer-flow-page">
      <header className="flow-header">
        <button className="editor-back" onClick={() => navigate(`/app/tests/${test.id}/edit`)}><ArrowLeft aria-hidden />К редактору</button>
        <div><p className="eyebrow">Предпросмотр</p><h1>{test.title}</h1></div>
        <button className="button button-primary" onClick={() => navigate(`/app/tests/${test.id}/publish`)}>К публикации<ArrowRight aria-hidden /></button>
      </header>

      <section className="preview-toolbar" aria-label="Настройки предпросмотра">
        <div><Eye aria-hidden /><span><strong>Режим предпросмотра</strong><small>Ответы и результаты не сохраняются</small></span></div>
        <div className="device-toggle" role="group" aria-label="Размер экрана">
          <button className={device === 'desktop' ? 'active' : ''} onClick={() => setDevice('desktop')}><Monitor aria-hidden />Компьютер</button>
          <button className={device === 'mobile' ? 'active' : ''} onClick={() => setDevice('mobile')}><DeviceMobile aria-hidden />Телефон</button>
        </div>
      </section>

      {!previewReady || !question ? (
        <section className="flow-empty-state"><span className="soft-icon soft-icon-orange"><WarningCircle aria-hidden /></span><h2>Предпросмотр пока недоступен</h2><p>Заполните формулировку вопроса и варианты ответа. Vecta покажет участнику только готовый контент.</p><button className="button button-secondary" onClick={() => navigate(`/app/tests/${test.id}/edit`)}>Исправить черновик</button></section>
      ) : (
        <div className={`preview-canvas preview-${device}`}>
          <article className="preview-device">
            <header><VectaLogo compact /><span>Предпросмотр для участника</span></header>
            <div className="preview-progress"><span>Вопрос {questionIndex + 1} из {draft.questions.length}</span><progress max={draft.questions.length} value={questionIndex + 1} /></div>
            <section className="preview-question">
              <span className="question-type-label">{question.type === 'single' ? 'Один вариант ответа' : question.type === 'multiple' ? 'Можно выбрать несколько' : 'Оценка по шкале'}</span>
              <h2>{question.text}</h2>
              {question.type === 'scale' ? (
                <div className="participant-scale" role="radiogroup" aria-label={`Оценка от ${question.min} до ${question.max}`}>
                  {Array.from({ length: question.max - question.min + 1 }, (_, index) => question.min + index).map((value) => <button key={value} className={answer === value ? 'active' : ''} onClick={() => setPreviewAnswers((current) => ({ ...current, [question.id]: value }))} role="radio" aria-checked={answer === value}>{value}</button>)}
                </div>
              ) : (
                <div className="participant-options">{question.options.map((option) => { const checked = selected.includes(option); return <label key={option} className={checked ? 'participant-option selected' : 'participant-option'}><input type={question.type === 'single' ? 'radio' : 'checkbox'} name={question.type === 'single' ? `preview-${question.id}` : undefined} checked={checked} onChange={() => setPreviewAnswers((current) => ({ ...current, [question.id]: question.type === 'single' ? [option] : checked ? selected.filter((item) => item !== option) : [...selected, option] }))} /><span>{option}</span></label>; })}</div>
              )}
              <footer className="question-navigation"><button className="button button-ghost" disabled={questionIndex === 0} onClick={() => setQuestionIndex((index) => Math.max(0, index - 1))}><ArrowLeft aria-hidden />Назад</button><button className="button button-primary" disabled={questionIndex === draft.questions.length - 1} onClick={() => setQuestionIndex((index) => Math.min(draft.questions.length - 1, index + 1))}>Далее<ArrowRight aria-hidden /></button></footer>
            </section>
            <footer>Preview не создаёт попытку и не влияет на аналитику</footer>
          </article>
        </div>
      )}
    </main>
  );
}

function PublicationChecklistPage() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const { tests, setTests, drafts, setDrafts, loadDraft, loadState, showMessage } = useWorkspace();
  const test = tests.find((item) => item.id === testId);
  const draft = testId ? drafts[testId] : undefined;
  const [publishing, setPublishing] = useState(false);
  const [draftLoadError, setDraftLoadError] = useState(false);

  useEffect(() => {
    if (!testId || !test || draft) return;
    let active = true;
    loadDraft(testId).catch(() => active && setDraftLoadError(true));
    return () => { active = false; };
  }, [draft, loadDraft, test, testId]);

  if (!test || !draft) {
    if ((loadState === 'loading' || (test && !draft)) && !draftLoadError) return <main className="workspace-page organizer-flow-page"><SystemPanel kind="loading" title="Проверяем черновик" copy="Загружаем сохранённые вопросы и настройки…" /></main>;
    return <OrganizerMissingState title="Черновик не найден" onBack={() => navigate('/app/tests')} />;
  }

  const checks = publicationChecklist(test.title, draft);
  const readyCount = checks.filter((item) => item.ready).length;
  const ready = readyCount === checks.length;
  const publish = async () => {
    if (!ready || publishing) return;
    setPublishing(true);
    try {
      const result: PublishAssessmentResponse = await publishAssessment(test.id, draft.revision, crypto.randomUUID());
      setTests((current) => current.map((item) => {
        if (item.id !== test.id) return item;
        const { updatedLabel: _updatedLabel, ...publishedItem } = item;
        return {
          ...publishedItem,
          stage: 'running',
          publicationId: result.publicationId,
          publicationHistory: [{ publicationId: result.publicationId, title: publishedItem.title, version: result.version, status: 'published', publishedAt: result.publishedAt }, ...publishedItem.publicationHistory],
        };
      }));
      setDrafts((current) => {
        const next = { ...current };
        delete next[test.id];
        return next;
      });
      void navigate(`/app/publications/${result.publicationId}/distribute`, { state: { accessCode: result.access.code } });
    } catch {
      setPublishing(false);
      showMessage('Не удалось опубликовать тест. Обновите черновик и повторите');
    }
  };

  return (
    <main className="workspace-page organizer-flow-page publish-page">
      <header className="flow-header">
        <button className="editor-back" onClick={() => navigate(`/app/tests/${test.id}/edit`)}><ArrowLeft aria-hidden />К редактору</button>
        <div><p className="eyebrow">Публикация</p><h1>Проверка перед запуском</h1></div>
        <button className="button button-ghost" onClick={() => navigate(`/app/tests/${test.id}/preview`)}><Eye aria-hidden />Preview</button>
      </header>

      <div className="publish-layout">
        <section className="checklist-card">
          <header><div><h2>{test.title}</h2><p>{ready ? 'Черновик готов к публикации.' : 'Исправьте отмеченные пункты — публикация пока заблокирована.'}</p></div><span className={ready ? 'check-progress ready' : 'check-progress'}>{readyCount} из {checks.length}</span></header>
          <div className="checklist-items">{checks.map((item) => <article className={item.ready ? 'checklist-item ready' : 'checklist-item blocked'} key={item.key}><span>{item.ready ? <Check aria-hidden weight="bold" /> : <WarningCircle aria-hidden />}</span><div><strong>{item.label}</strong><p>{item.description}</p></div>{!item.ready && <button className="text-action" onClick={() => navigate(`/app/tests/${test.id}/edit`)}>Исправить<CaretRight aria-hidden /></button>}</article>)}</div>
        </section>

        <aside className="publish-summary">
          <h2>После публикации</h2>
          <div className="immutable-note"><ShieldCheck aria-hidden /><p><strong>Будет создана неизменяемая версия</strong><span>Новые правки потребуют следующей версии и не изменят начатые попытки.</span></p></div>
          <dl><div><dt>Режим участия</dt><dd>{draft.participationMode === 'open' ? 'Открытый' : 'По приглашениям'}</dd></div><div><dt>Повторная попытка</dt><dd>{draft.singleAttempt ? 'Недоступна' : 'Разрешена'}</dd></div><div><dt>Результат участнику</dt><dd>{draft.showParticipantResult ? 'Баллы без answer key' : 'Только подтверждение'}</dd></div><div><dt>Вопросов</dt><dd>{draft.questions.length}</dd></div></dl>
          <button className="button button-primary button-wide" disabled={!ready || publishing} onClick={publish}>{publishing ? 'Создаём версию…' : 'Опубликовать тест'}</button>
          {!ready && <p className="publish-blocked-copy">Кнопка станет доступна после устранения всех блокирующих ошибок.</p>}
        </aside>
      </div>
    </main>
  );
}

function DistributionPage() {
  const { publicationId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { showMessage } = useWorkspace();
  const stateCode = typeof location.state === 'object' && location.state !== null && 'accessCode' in location.state && typeof location.state.accessCode === 'string' ? location.state.accessCode : null;
  const [distribution, setDistribution] = useState<DistributionDTO | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(stateCode);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rotating, setRotating] = useState(false);
  const [inviteLabels, setInviteLabels] = useState('');
  const [invitations, setInvitations] = useState<InvitationDTO[]>([]);
  const [createdInvitations, setCreatedInvitations] = useState<CreatedInvitationDTO[]>([]);
  const [creatingInvitations, setCreatingInvitations] = useState(false);
  const joinUrl = joinCode ? `${window.location.origin}/join?code=${encodeURIComponent(joinCode)}` : '';

  useEffect(() => {
    if (!stateCode) return;
    void navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, navigate, stateCode]);

  useEffect(() => {
    if (!publicationId) {
      setLoadState('error');
      return;
    }
    let active = true;
    getDistribution(publicationId)
      .then((value) => {
        if (!active) return;
        setDistribution(value);
        setLoadState('ready');
        if (value.settings.accessMode === 'controlled') {
          void getInvitations(value.publicationId).then((items) => active && setInvitations(items)).catch(() => undefined);
        }
      })
      .catch(() => active && setLoadState('error'));
    return () => { active = false; };
  }, [publicationId]);

  if (loadState === 'loading') return <main className="workspace-page organizer-flow-page"><SystemPanel kind="loading" title="Загружаем публикацию" copy="Получаем правила доступа и безопасную ссылку…" /></main>;
  if (loadState === 'error' || !distribution || !publicationId) return <OrganizerMissingState title="Публикация не найдена" onBack={() => navigate('/app/tests')} />;

  const copy = (value: string, label: string) => {
    navigator.clipboard?.writeText(value).then(() => showMessage(`${label} скопирован`)).catch(() => showMessage('Не удалось скопировать автоматически'));
  };
  const rotateCode = async () => {
    if (rotating) return;
    setRotating(true);
    try {
      const rotated = await rotatePublicationCode(publicationId);
      setJoinCode(rotated.code);
      showMessage('Новый код выпущен. Предыдущий код больше не действует');
    } catch {
      showMessage('Не удалось выпустить новый код');
    } finally {
      setRotating(false);
    }
  };
  const createInvitations = async () => {
    const participantLabels = [...new Set(inviteLabels.split(/\r?\n/).map((label) => label.trim()).filter(Boolean))];
    if (participantLabels.length === 0 || creatingInvitations) return;
    setCreatingInvitations(true);
    try {
      const created = await createInvitationBatch(publicationId, { participantLabels, expiresAt: distribution.settings.closesAt });
      setCreatedInvitations(created);
      setInvitations((current) => [...created.map((invitation) => ({
        id: invitation.id,
        participantLabel: invitation.participantLabel,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
      })), ...current]);
      setInviteLabels('');
      showMessage(`Создано приглашений: ${created.length}`);
    } catch {
      showMessage('Не удалось создать приглашения');
    } finally {
      setCreatingInvitations(false);
    }
  };
  const revoke = async (invitationId: string) => {
    try {
      await revokeInvitation(invitationId);
      setInvitations((current) => current.map((item) => item.id === invitationId ? { ...item, status: 'revoked' } : item));
      showMessage('Приглашение отозвано');
    } catch {
      showMessage('Не удалось отозвать приглашение');
    }
  };

  return (
    <main className="workspace-page organizer-flow-page distribution-page">
      <header className="flow-header distribution-header">
        <button className="editor-back" onClick={() => navigate('/app/tests')}><ArrowLeft aria-hidden />К тестам</button>
        <div><p className="eyebrow">Тест опубликован</p><h1>Поделитесь доступом</h1><span>{distribution.title}</span></div>
        <button className="button button-ghost" onClick={() => navigate('/app/results')}>Открыть результаты<ChartBar aria-hidden /></button>
      </header>

      <section className="distribution-mode" aria-label="Режим распространения">
        <button className={distribution.settings.accessMode === 'open' ? 'active' : ''} disabled={distribution.settings.accessMode !== 'open'}><LinkSimple aria-hidden /><span><strong>Ссылка, код и QR</strong><small>Для открытого доступа</small></span></button>
        <button className={distribution.settings.accessMode === 'controlled' ? 'active' : ''} disabled={distribution.settings.accessMode !== 'controlled'}><UsersThree aria-hidden /><span><strong>Персональные приглашения</strong><small>Одна ссылка на участника</small></span></button>
      </section>

      {distribution.settings.accessMode === 'open' ? (
        <div className="distribution-layout">
          <section className="share-card">
            <header><span className="soft-icon soft-icon-blue"><LinkSimple aria-hidden /></span><div><h2>Открытый доступ</h2><p>Участник вводит имя после проверки кода.</p></div></header>
            {joinCode ? <><label className="share-field"><span>Ссылка на тест</span><div><input readOnly value={joinUrl} /><button onClick={() => copy(joinUrl, 'Ссылка')} aria-label="Скопировать ссылку"><Copy aria-hidden />Копировать</button></div></label><label className="share-field code-field"><span>Код теста</span><div><strong>{joinCode}</strong><button onClick={() => copy(joinCode, 'Код')} aria-label="Скопировать код"><Copy aria-hidden />Копировать</button></div></label><div className="share-actions"><button className="button button-primary" onClick={() => copy(joinUrl, 'Ссылка')}><Copy aria-hidden />Скопировать ссылку</button><a className="button button-ghost" href={joinUrl} target="_blank" rel="noreferrer"><Eye aria-hidden />Проверить вход</a></div></> : <div className="immutable-note code-rotation-note"><ShieldCheck aria-hidden /><p><strong>Код не хранится открытым</strong><span>{distribution.codeHint ? `Сохранённый код заканчивается на ••${distribution.codeHint}. ` : ''}Чтобы показать новый код, выпустите его повторно. Старый перестанет действовать.</span></p><button className="button button-secondary" disabled={rotating} onClick={rotateCode}>{rotating ? 'Выпускаем…' : 'Выпустить новый код'}</button></div>}
          </section>
          <aside className="qr-card">{joinUrl ? <QRCodeSVG value={joinUrl} size={190} marginSize={2} level="M" /> : <span className="soft-icon soft-icon-blue"><QrCode aria-hidden /></span>}<h2>QR-код</h2><p>{joinUrl ? 'Покажите его на экране или добавьте в материалы для участников.' : 'QR появится вместе с новым открытым кодом.'}</p></aside>
        </div>
      ) : (
        <section className="invitation-card">
          <div><p className="eyebrow">Контролируемый доступ</p><h2>Персональные приглашения</h2><p>Добавьте по одному имени или идентификатору на строку. Каждая ссылка даёт ровно одну попытку.</p><label className="field-label" htmlFor="participant-labels">Участники</label><textarea id="participant-labels" className="text-input invitation-labels" value={inviteLabels} onChange={(event) => setInviteLabels(event.target.value)} placeholder={'Анна Петрова\nИван Смирнов'} rows={5} /><button className="button button-primary" disabled={!inviteLabels.trim() || creatingInvitations} onClick={() => void createInvitations()}>{creatingInvitations ? 'Создаём…' : 'Создать приглашения'}</button>{createdInvitations.length > 0 && <div className="invitation-secrets"><div className="local-delivery-note"><ShieldCheck aria-hidden /><span><strong>Скопируйте ссылки сейчас</strong><small>Исходные токены больше нельзя будет получить после обновления страницы.</small></span></div>{createdInvitations.map((invitation) => { const url = `${window.location.origin}${invitation.joinPath}`; return <label className="share-field" key={invitation.id}><span>{invitation.participantLabel}</span><div><input readOnly value={url} /><button onClick={() => copy(url, 'Ссылка')}><Copy aria-hidden />Копировать</button></div></label>; })}</div>}<div className="invitation-list"><h3>Выданные приглашения</h3>{invitations.length === 0 ? <p>Приглашений пока нет.</p> : invitations.map((invitation) => <article key={invitation.id}><span><strong>{invitation.participantLabel}</strong><small>{invitation.status === 'active' ? 'Активно' : invitation.status === 'used' ? 'Использовано' : invitation.status === 'revoked' ? 'Отозвано' : 'Истекло'}</small></span>{invitation.status === 'active' && <button className="text-action" onClick={() => void revoke(invitation.id)}>Отозвать</button>}</article>)}</div></div>
        </section>
      )}

      <section className="distribution-rules"><h2>Правила этой публикации</h2><div><span><ShieldCheck aria-hidden /><strong>Версия защищена от изменений</strong></span><span><User aria-hidden /><strong>{distribution.settings.openRepeatPolicy === 'unlimited' ? 'Повторные попытки разрешены' : 'Одна попытка'}</strong></span><span><Eye aria-hidden /><strong>{distribution.settings.showParticipantResult ? 'Баллы видны после отправки' : 'Результат скрыт'}</strong></span></div></section>
    </main>
  );
}

function OrganizerMissingState({ title, onBack }: { title: string; onBack: () => void }) {
  return <main className="workspace-page organizer-flow-page"><section className="flow-empty-state"><span className="soft-icon soft-icon-orange"><WarningCircle aria-hidden /></span><h1>{title}</h1><p>Вернитесь к доске и выберите доступный тест.</p><button className="button button-secondary" onClick={onBack}>К тестам</button></section></main>;
}

function SystemPanel({ kind, title, copy, action }: { kind: 'loading' | 'empty' | 'error'; title: string; copy: string; action?: ReactNode }) {
  return <section className={`system-panel system-${kind}`} aria-live="polite">{kind === 'loading' ? <span className="loading-ring" aria-hidden /> : <span className={`soft-icon ${kind === 'error' ? 'soft-icon-orange' : 'soft-icon-blue'}`}>{kind === 'error' ? <WarningCircle aria-hidden /> : <ClipboardText aria-hidden />}</span>}<h2>{title}</h2><p>{copy}</p>{action}</section>;
}

function OrganizerLoginDialog() {
  const navigate = useNavigate();
  const location = useLocation();
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const localButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const copyId = useId();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [codeDigits, setCodeDigits] = useState<string[]>(emptyOrganizerOtp);
  const [challengeId, setChallengeId] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileVersion, setTurnstileVersion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const onTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);
  const code = codeDigits.join('');
  const close = useCallback(() => { void navigate('/'); }, [navigate]);
  useDialogFocus(close, dialogRef, import.meta.env.DEV ? localButtonRef : inputRef);

  const destination = typeof location.state === 'object'
    && location.state !== null
    && 'from' in location.state
    && typeof location.state.from === 'string'
    && location.state.from.startsWith('/')
    ? location.state.from
    : '/app';

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      if (step === 'email') {
        const normalized = email.trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(normalized)) { setError('Введите корректный рабочий email'); return; }
        if (!turnstileToken) { setError('Завершите защитную проверку'); return; }
        const challenge = await requestOrganizerLoginCode(normalized, turnstileToken);
        setEmail(normalized);
        setChallengeId(challenge.challengeId);
        setStep('code');
        setTurnstileToken('');
        window.setTimeout(() => inputRef.current?.focus(), 0);
      } else {
        const normalized = code.replace(/\D/g, '');
        if (normalized.length !== 6) { setError('Введите шестизначный код'); return; }
        await verifyOrganizerLoginCode(challengeId, normalized);
        void navigate(destination, { replace: true });
      }
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.title ?? 'Не удалось войти' : 'Не удалось войти');
        if (step === 'email') {
          setTurnstileToken('');
          setTurnstileVersion((value) => value + 1);
        }
    } finally {
      setSubmitting(false);
    }
  };

  const focusOtpCell = (index: number) => {
    window.setTimeout(() => otpRefs.current[Math.max(0, Math.min(index, ORGANIZER_OTP_LENGTH - 1))]?.focus(), 0);
  };

  const updateOtpCell = (index: number, value: string) => {
    const digits = normalizeOrganizerOtp(value);
    if (!digits) {
      setCodeDigits((current) => clearOrganizerOtpDigit(current, index));
      return;
    }
    setCodeDigits((current) => fillOrganizerOtp(current, index, digits));
    focusOtpCell(index + digits.length);
  };

  const pasteOtp = (index: number, event: ReactClipboardEvent<HTMLInputElement>) => {
    const digits = normalizeOrganizerOtp(event.clipboardData.getData('text'));
    if (!digits) return;
    event.preventDefault();
    setCodeDigits((current) => fillOrganizerOtp(current, index, digits));
    focusOtpCell(index + digits.length);
  };

  const navigateOtp = (index: number, event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !codeDigits[index] && index > 0) {
      event.preventDefault();
      setCodeDigits((current) => clearOrganizerOtpDigit(current, index - 1));
      focusOtpCell(index - 1);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      focusOtpCell(index - 1);
    } else if (event.key === 'ArrowRight' && index < ORGANIZER_OTP_LENGTH - 1) {
      event.preventDefault();
      focusOtpCell(index + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOtpCell(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOtpCell(ORGANIZER_OTP_LENGTH - 1);
    }
  };

  const localLogin = () => { void navigate(destination, { replace: true }); };
  const changeEmail = () => {
    setStep('email');
    setCodeDigits(emptyOrganizerOtp());
    setChallengeId('');
    setError('');
    setTurnstileToken('');
    setTurnstileVersion((value) => value + 1);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className="modal-layer public-overlay-layer">
      <div className="modal-scrim" onMouseDown={close} aria-hidden="true" />
      <section ref={dialogRef} className="dialog public-overlay-dialog organizer-login-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={copyId} tabIndex={-1}>
        <button className="icon-button public-dialog-close" onClick={close} aria-label="Закрыть"><X aria-hidden /></button>
        <span className="soft-icon soft-icon-blue"><ShieldCheck aria-hidden /></span>
        <p className="eyebrow">Вход и регистрация</p>
        <h2 id={titleId}>{step === 'email' ? 'Продолжите по email' : 'Введите код из письма'}</h2>
        <p id={copyId} className="public-dialog-copy">{step === 'email' ? 'Отправим одноразовый код. Если аккаунта ещё нет, после подтверждения создадим личное рабочее пространство.' : `Мы отправили шестизначный код на ${email}. Он действует 10 минут.`}</p>
        {import.meta.env.DEV ? (
          <button ref={localButtonRef} className="button button-primary button-wide" onClick={localLogin}>Продолжить локально</button>
        ) : (
          <form className="organizer-login-form" onSubmit={submit} noValidate>
            {step === 'email' ? <><label className="field-label" htmlFor="organizer-email">Email</label><input ref={inputRef} id="organizer-email" type="email" className={error ? 'text-input input-error' : 'text-input'} autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" aria-describedby={error ? 'organizer-login-error' : 'organizer-email-help'} /><p className="field-help" id="organizer-email-help">Новый аккаунт создастся после подтверждения почты</p><TurnstileWidget key={turnstileVersion} action="organizer_login" onToken={onTurnstileToken} /></> : <><fieldset className="organizer-otp-fieldset"><legend className="field-label">Код из письма</legend><div className={error ? 'organizer-otp-grid has-error' : 'organizer-otp-grid'}>{codeDigits.map((digit, index) => <input key={index} ref={(element) => { otpRefs.current[index] = element; if (index === 0) inputRef.current = element; }} type="text" className={digit ? 'organizer-otp-cell is-filled' : 'organizer-otp-cell'} autoComplete={index === 0 ? 'one-time-code' : 'off'} inputMode="numeric" pattern="[0-9]*" maxLength={index === 0 ? ORGANIZER_OTP_LENGTH : 1} value={digit} onChange={(event) => updateOtpCell(index, event.target.value)} onPaste={(event) => pasteOtp(index, event)} onKeyDown={(event) => navigateOtp(index, event)} onFocus={(event) => event.currentTarget.select()} aria-label={`Цифра ${index + 1} из ${ORGANIZER_OTP_LENGTH}`} aria-invalid={Boolean(error)} aria-describedby={error ? 'organizer-login-error' : 'organizer-code-help'} />)}</div></fieldset><p className="field-help" id="organizer-code-help">Не пересылайте код другим людям</p><div className="login-delivery-note"><EnvelopeSimple aria-hidden /><p><strong>Письмо не видно?</strong><span>Проверьте папку «Спам» — первое сообщение иногда попадает туда.</span></p></div></>}
            {error && <p className="field-error" id="organizer-login-error" role="alert">{error}</p>}
            <button className="button button-primary button-wide" disabled={submitting || (step === 'email' ? !turnstileToken : code.length !== 6)}>{submitting ? (step === 'email' ? 'Отправляем…' : 'Проверяем…') : (step === 'email' ? 'Получить код' : 'Войти')}</button>
            {step === 'code' && <button className="text-action login-change-email" type="button" onClick={changeEmail}>Изменить email или отправить новый код</button>}
          </form>
        )}
        <p className="login-privacy-note"><ShieldCheck aria-hidden />Код одноразовый. Сессия завершится автоматически через 12 часов.</p>
      </section>
    </div>
  );
}

function PublicSystemPage({ kind }: { kind: 'login' | 'denied' | 'not-found' }) {
  const navigate = useNavigate();
  const organizerLoginTarget = getOrganizerLoginUrl();
  const handoffOrganizerLogin = kind === 'login' && requiresOrganizerHandoff(window.location.origin, organizerLoginTarget);
  useEffect(() => {
    if (handoffOrganizerLogin) window.location.replace(organizerLoginTarget);
  }, [handoffOrganizerLogin, organizerLoginTarget]);
  if (kind === 'login') return handoffOrganizerLogin ? <OnboardingPage /> : <><OnboardingPage /><OrganizerLoginDialog /></>;
  const content = kind === 'denied' ? { eyebrow: 'Нет доступа', title: 'Рабочее пространство недоступно', copy: 'Не удалось создать или открыть личное пространство. Завершите сессию и повторите регистрацию.', action: 'Завершить сессию' } : { eyebrow: 'Ошибка 404', title: 'Такой страницы нет', copy: 'Возможно, ссылка устарела или адрес был скопирован не полностью.', action: 'На главную Vecta' };
  const action = () => {
    if (kind === 'denied') void logoutOrganizer();
    else void navigate('/');
  };
  return <><OnboardingPage /><PublicOverlayDialog eyebrow={content.eyebrow} title={content.title} copy={content.copy} icon={kind === 'denied' ? ShieldCheck : MagnifyingGlass} tone={kind === 'denied' ? 'orange' : 'blue'} primaryLabel={content.action} primaryStyle="secondary" onPrimary={action} onClose={() => navigate('/')} /></>;
}


function ResultsPage() {
  const { tests, loadState, showMessage } = useWorkspace();
  const [tab, setTab] = useState<'overview' | 'questions' | 'attempts'>('overview');
  const publications = useMemo(() => tests.flatMap((test) => test.publicationHistory.map((publication) => ({
    publicationId: publication.publicationId,
    title: test.publicationHistory.length > 1 ? `${publication.title} · версия ${publication.version}` : publication.title,
    publishedAt: publication.publishedAt,
  }))).sort((left, right) => right.publishedAt - left.publishedAt), [tests]);
  const [publicationId, setPublicationId] = useState('');
  const [overview, setOverview] = useState<ResultsOverviewDTO | null>(null);
  const [questions, setQuestions] = useState<QuestionAnalysisDTO | null>(null);
  const [attempts, setAttempts] = useState<OrganizerAttemptListItemDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refreshKey, setRefreshKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const tabs = ['overview', 'questions', 'attempts'] as const;

  const moveResultsTab = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.indexOf(tab);
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const nextTab = tabs[next];
    if (!nextTab) return;
    setTab(nextTab);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  useEffect(() => {
    if (publications.length === 0) {
      setPublicationId('');
      return;
    }
    if (!publications.some((test) => test.publicationId === publicationId)) {
      setPublicationId(publications[0]?.publicationId ?? '');
    }
  }, [publicationId, publications]);

  useEffect(() => {
    if (!publicationId) return;
    let active = true;
    setState('loading');
    Promise.all([
      getResultsOverview(publicationId),
      getQuestionAnalysis(publicationId),
      getOrganizerAttempts(publicationId),
    ]).then(([overviewData, questionData, attemptPage]) => {
      if (!active) return;
      setOverview(overviewData);
      setQuestions(questionData);
      setAttempts(attemptPage.items);
      setNextCursor(attemptPage.nextCursor);
      setState('ready');
    }).catch(() => active && setState('error'));
    return () => { active = false; };
  }, [publicationId, refreshKey]);

  const loadMore = async () => {
    if (!publicationId || !nextCursor) return;
    try {
      const page = await getOrganizerAttempts(publicationId, nextCursor);
      setAttempts((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      showMessage('Не удалось загрузить следующую страницу попыток');
    }
  };

  const exportCsv = async () => {
    if (!publicationId) return;
    setExporting(true);
    try {
      const blob = await downloadResultsCsv(publicationId);
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = 'vecta-results.csv';
      link.click();
      URL.revokeObjectURL(href);
      showMessage('CSV-отчёт подготовлен');
    } catch {
      showMessage('Не удалось экспортировать результаты');
    } finally {
      setExporting(false);
    }
  };

  if (loadState === 'loading') return <main className="workspace-page results-page"><SystemPanel kind="loading" title="Загружаем результаты" copy="Получаем список опубликованных тестов…" /></main>;
  if (publications.length === 0) return <main className="workspace-page results-page"><PageHeader title="Результаты" eyebrow="Аналитика появится после публикации первого теста" /><SystemPanel kind="empty" title="Пока нечего анализировать" copy="Опубликуйте тест и пригласите участников — результаты появятся здесь." /></main>;

  const status = overview?.publication.status === 'published' ? 'Идёт' : overview?.publication.status === 'closed' ? 'Завершён' : 'В архиве';
  return (
    <main className="workspace-page results-page">
      <div className="results-header"><h1>Результаты</h1><label className="test-select"><ListChecks aria-hidden /><select aria-label="Выберите тест" value={publicationId} onChange={(event) => setPublicationId(event.target.value)}>{publications.map((test) => <option key={test.publicationId} value={test.publicationId}>{test.title}</option>)}</select></label><span className={`status-badge status-${overview?.publication.status ?? 'published'}`}>{status}</span><button className="text-action" disabled={state !== 'ready' || exporting} onClick={() => void exportCsv()}><DownloadSimple aria-hidden />{exporting ? 'Готовим…' : 'Экспортировать'}</button></div>
      <div className="results-tabs" role="tablist" aria-label="Разделы результатов"><button id="results-tab-overview" aria-controls="results-panel-overview" aria-selected={tab === 'overview'} tabIndex={tab === 'overview' ? 0 : -1} className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')} onKeyDown={moveResultsTab} role="tab">Обзор</button><button id="results-tab-questions" aria-controls="results-panel-questions" aria-selected={tab === 'questions'} tabIndex={tab === 'questions' ? 0 : -1} className={tab === 'questions' ? 'active' : ''} onClick={() => setTab('questions')} onKeyDown={moveResultsTab} role="tab">По вопросам</button><button id="results-tab-attempts" aria-controls="results-panel-attempts" aria-selected={tab === 'attempts'} tabIndex={tab === 'attempts' ? 0 : -1} className={tab === 'attempts' ? 'active' : ''} onClick={() => setTab('attempts')} onKeyDown={moveResultsTab} role="tab">Попытки</button></div>
      <div id={`results-panel-${tab}`} role="tabpanel" aria-labelledby={`results-tab-${tab}`} tabIndex={0}>{state === 'loading' ? <SystemPanel kind="loading" title="Считаем показатели" copy="Сверяем попытки, ответы и баллы…" /> : state === 'error' ? <SystemPanel kind="error" title="Не удалось загрузить результаты" copy="Данные не изменены. Повторите запрос." action={<button className="button button-secondary" onClick={() => setRefreshKey((value) => value + 1)}>Повторить</button>} /> : <>{tab === 'overview' && overview && <ResultsOverview overview={overview} questions={questions?.items ?? []} onOpenQuestions={() => setTab('questions')} />}{tab === 'questions' && <QuestionAnalysis items={questions?.items ?? []} />}{tab === 'attempts' && <AttemptsTable attempts={attempts} nextCursor={nextCursor} onLoadMore={() => void loadMore()} />}</>}</div>
    </main>
  );
}

function formatPercent(value: number | null): string { return value === null ? '—' : `${value.toLocaleString('ru-RU')}%`; }
function formatResultDate(value: number | null): string { return value === null ? '—' : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(value); }

function ResultsOverview({ overview, questions, onOpenQuestions }: { overview: ResultsOverviewDTO; questions: QuestionAnalysisItemDTO[]; onOpenQuestions: () => void }) {
  const attention = questions.filter((question) => question.correctPercent !== null).sort((left, right) => (left.correctPercent ?? 101) - (right.correctPercent ?? 101)).slice(0, 2);
  const trend = overview.responseTrend.map((point) => ({ ...point, date: point.date.slice(5).split('-').reverse().join('.') }));
  const participationDetail = overview.invitationsTotal === null ? 'открытый доступ' : `из ${overview.invitationsTotal} приглашений`;
  return <><section className="result-summary"><Metric label="Начали" value={String(overview.attempts.total)} {...(overview.attempts.active > 0 ? { detail: `${overview.attempts.active} сейчас проходят` } : {})} /><Metric label="Завершили" value={String(overview.attempts.completed)} {...(overview.attempts.abandoned > 0 ? { detail: `${overview.attempts.abandoned} вышли` } : {})} /><Metric label="Средний балл" value={formatPercent(overview.averageScorePercent)} /><Metric label="Участие" value={formatPercent(overview.participationPercent)} detail={participationDetail} /></section><div className="charts-grid"><section className="chart-panel distribution"><h2>Распределение результатов</h2>{overview.scoreDistribution.map(({ range, percent, count }) => <div className="distribution-row" key={range}><span>{range}</span><progress max="100" value={percent} aria-label={`Диапазон ${range}: ${percent}%`} /><strong>{count} ({percent}%)</strong></div>)}<footer><span>Оценённых результатов</span><strong>{overview.scoreDistribution.reduce((sum, item) => sum + item.count, 0)}</strong></footer></section><section className="chart-panel trend-chart"><h2>Динамика завершений</h2>{trend.length > 0 ? <TrendChart points={trend} /> : <div className="chart-empty">Завершённых попыток пока нет</div>}<footer><span>Всего завершили</span><strong>{overview.attempts.completed}</strong></footer></section></div><section className="attention-panel"><h2>Требуют внимания</h2>{attention.length > 0 ? attention.map((question) => <Insight key={question.questionId} question={`Вопрос ${question.position + 1}`} percent={`${formatPercent(question.correctPercent)} правильных`} />) : <p className="results-muted">Недостаточно ответов для выводов</p>}<button className="text-action" onClick={onOpenQuestions}>Открыть анализ вопросов<CaretRight aria-hidden /></button></section></>;
}

function TrendChart({ points }: { points: Array<{ date: string; responses: number }> }) {
  const width = 640;
  const height = 220;
  const inset = 28;
  const maximum = Math.max(1, ...points.map((point) => point.responses));
  const coordinates = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? width / 2 : inset + index * (width - inset * 2) / (points.length - 1),
    y: height - inset - point.responses / maximum * (height - inset * 2),
  }));
  const path = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const description = points.map((point) => `${point.date}: ${point.responses}`).join('; ');
  return <div className="chart-box"><svg className="trend-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Завершения по датам. ${description}`} preserveAspectRatio="none"><g aria-hidden="true">{[0, 1, 2, 3].map((line) => { const y = inset + line * (height - inset * 2) / 3; return <line key={line} x1={inset} x2={width - inset} y1={y} y2={y} className="trend-grid-line" />; })}<path d={path} className="trend-line" />{coordinates.map((point) => <g key={point.date}><circle cx={point.x} cy={point.y} r="5" className="trend-point" /><text x={point.x} y={height - 7} textAnchor="middle" className="trend-label">{point.date}</text></g>)}</g></svg></div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>; }
function Insight({ question, percent }: { question: string; percent: string }) { return <article className="insight"><span className="soft-icon soft-icon-orange"><WarningCircle aria-hidden /></span><span><strong>{question}</strong><small>Ниже среднего по тесту</small></span><b>{percent}</b></article>; }

function QuestionAnalysis({ items }: { items: QuestionAnalysisItemDTO[] }) {
  return <section className="secondary-results"><header><div><h2>Анализ вопросов</h2><p>Доля правильных ответов и средняя оценка по шкалам.</p></div></header>{items.length === 0 ? <div className="inline-empty">В опубликованной версии нет вопросов.</div> : <div className="question-analysis-list">{items.map((item) => { const value = item.scored ? formatPercent(item.correctPercent) : item.averageRating === null ? '—' : item.averageRating.toLocaleString('ru-RU'); return <article key={item.questionId}><span className="question-analysis-number">{item.position + 1}</span><span><strong>{item.text}</strong><small>{item.answeredCount} ответов · {item.scored ? `${item.points} балл${item.points === 1 ? '' : 'а'}` : 'без оценки'}</small></span><span className="question-analysis-score"><strong>{value}</strong><small>{item.scored ? 'правильных' : 'средняя оценка'}</small></span></article>; })}</div>}</section>;
}

function attemptStatus(attempt: OrganizerAttemptListItemDTO): string {
  if (attempt.status === 'active') return 'В процессе';
  if (attempt.completionReason === 'abandoned') return 'Вышел';
  if (attempt.completionReason === 'deadline') return 'Время истекло';
  return 'Завершена';
}

function AttemptsTable({ attempts, nextCursor, onLoadMore }: { attempts: OrganizerAttemptListItemDTO[]; nextCursor: string | null; onLoadMore: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrganizerAttemptDetailDTO | null>(null);
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error'>('loading');
  const filtered = attempts.filter((attempt) => attempt.displayName.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setDetailState('loading');
    setDetail(null);
    getOrganizerAttemptDetail(selectedId).then((value) => { if (active) { setDetail(value); setDetailState('ready'); } }).catch(() => active && setDetailState('error'));
    return () => { active = false; };
  }, [selectedId]);
  return <section className="secondary-results"><header><div><h2>Попытки участников</h2><p>Откройте запись, чтобы увидеть сохранённые ответы и начисленные баллы.</p></div><label className="compact-search"><MagnifyingGlass aria-hidden /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти участника" aria-label="Найти участника" /></label></header>{attempts.length === 0 ? <div className="inline-empty">Участники ещё не начали тест.</div> : <><div className="attempt-table-scroll"><table className="attempt-table"><thead><tr><th>Участник</th><th>Статус</th><th>Результат</th><th>Обновлено</th><th><span className="visually-hidden">Действие</span></th></tr></thead><tbody>{filtered.map((attempt) => <tr key={attempt.id}><td>{attempt.displayName}</td><td>{attemptStatus(attempt)}</td><td>{attempt.score === null || attempt.maxScore === null ? '—' : `${attempt.score} из ${attempt.maxScore}`}</td><td>{formatResultDate(attempt.updatedAt)}</td><td><button className="text-action attempt-open" onClick={() => setSelectedId(attempt.id)} aria-label={`Открыть попытку: ${attempt.displayName}`}>Открыть<CaretRight aria-hidden /></button></td></tr>)}</tbody></table></div>{filtered.length === 0 && <div className="inline-empty">По этому имени попыток не найдено.</div>}{nextCursor && !query.trim() && <button className="button button-secondary attempts-more" onClick={onLoadMore}>Показать ещё</button>}</>}{selectedId && <Modal title={detail?.displayName ?? 'Детали попытки'} onClose={() => setSelectedId(null)}>{detailState === 'loading' ? <div className="detail-loading"><span className="loading-ring" aria-hidden />Загружаем ответы…</div> : detailState === 'error' || !detail ? <div className="inline-empty">Не удалось загрузить попытку.</div> : <div className="attempt-detail"><div className="attempt-detail-summary"><span><small>Статус</small><strong>{attemptStatus(detail)}</strong></span><span><small>Результат</small><strong>{detail.score === null || detail.maxScore === null ? '—' : `${detail.score} из ${detail.maxScore}`}</strong></span><span><small>Завершено</small><strong>{formatResultDate(detail.completedAt)}</strong></span></div><div className="attempt-answer-list">{detail.answers.map((answer) => <article key={answer.questionId} className={answer.isCorrect === false ? 'incorrect' : answer.isCorrect === true ? 'correct' : ''}><header><span>Вопрос {answer.position + 1}</span>{answer.pointsAwarded !== null && answer.maxPoints !== null && <strong>{answer.pointsAwarded} / {answer.maxPoints}</strong>}</header><h3>{answer.questionText}</h3><p><small>Ответ участника</small>{answer.answerText}</p>{answer.correctAnswerText && answer.isCorrect === false && <p><small>Правильный ответ</small>{answer.correctAnswerText}</p>}</article>)}</div></div>}</Modal>}</section>;
}

function useDialogFocus(
  onClose: () => void,
  containerRef: React.RefObject<HTMLElement | null>,
  initialFocusRef: React.RefObject<HTMLElement | null>,
) {
  const closeHandlerRef = useRef(onClose);
  useEffect(() => { closeHandlerRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const frame = window.requestAnimationFrame(() => initialFocusRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeHandlerRef.current();
        return;
      }
      if (event.key !== 'Tab' || !containerRef.current) return;
      const focusable = [...containerRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute('hidden') && element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        containerRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [containerRef, initialFocusRef]);
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  useDialogFocus(onClose, dialogRef, closeRef);
  return <div className="modal-layer"><div className="modal-scrim" onMouseDown={onClose} aria-hidden="true" /><section ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><header><h2 id={titleId}>{title}</h2><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Закрыть"><X aria-hidden /></button></header>{children}</section></div>;
}

function PublicOverlayDialog({ eyebrow, title, copy, icon: DialogIcon, tone, primaryLabel, primaryStyle = 'primary', onPrimary, onClose }: { eyebrow: string; title: string; copy: string; icon: Icon; tone: 'blue' | 'orange'; primaryLabel: string; primaryStyle?: 'primary' | 'secondary'; onPrimary: () => void; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const copyId = useId();
  useDialogFocus(onClose, dialogRef, closeRef);
  return <div className="modal-layer public-overlay-layer"><div className="modal-scrim" onMouseDown={onClose} aria-hidden="true" /><section ref={dialogRef} className="dialog public-overlay-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={copyId} tabIndex={-1}><button ref={closeRef} className="icon-button public-dialog-close" onClick={onClose} aria-label="Закрыть"><X aria-hidden /></button><span className={`soft-icon soft-icon-${tone}`}><DialogIcon aria-hidden /></span><p className="eyebrow">{eyebrow}</p><h2 id={titleId}>{title}</h2><p id={copyId} className="public-dialog-copy">{copy}</p><button className={`button button-${primaryStyle}`} onClick={onPrimary}>{primaryLabel}</button></section></div>;
}

function useWorkspace() { return useOutletContext<WorkspaceContextValue>(); }

function useAuthSession(): OrganizerSessionDTO {
  const session = useContext(AuthContext);
  if (!session) throw new Error('Auth session is unavailable outside AuthGate');
  return session;
}

function AuthGate({ role, children }: { role: LocalIdentityRole; children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<{ session: OrganizerSessionDTO | null; status: 'loading' | 'ready' | 'unauthorized' | 'forbidden' | 'error' }>({ session: null, status: 'loading' });

  useEffect(() => {
    let active = true;
    getOrganizerSession(role)
      .then((session) => {
        if (!active) return;
        const allowed = session.memberships.length > 0;
        setState({ session, status: allowed ? 'ready' : 'forbidden' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const status = error instanceof ApiRequestError && error.status === 401
          ? 'unauthorized'
          : error instanceof ApiRequestError && error.status === 403
            ? 'forbidden'
            : 'error';
        setState({ session: null, status });
      });
    return () => { active = false; };
  }, [role]);

  if (state.status === 'loading') return <div className="public-system-page"><main><SystemPanel kind="loading" title="Проверяем доступ" copy="Получаем защищённую сессию Vecta…" /></main></div>;
  if (state.status === 'unauthorized') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (state.status === 'forbidden') return <Navigate to="/access-denied" replace />;
  if (state.status === 'error' || !state.session) return <><OnboardingPage /><PublicOverlayDialog eyebrow="Вход организатора" title="Не удалось проверить доступ" copy="Проверьте соединение и повторите запрос. Если ошибка сохранится, обратитесь в поддержку." icon={WarningCircle} tone="orange" primaryLabel="Повторить" primaryStyle="secondary" onPrimary={() => window.location.reload()} onClose={() => navigate('/')} /></>;
  return <AuthContext.Provider value={state.session}>{children}</AuthContext.Provider>;
}

export default function VectaApp() {
  return <BrowserRouter><Routes><Route path="/" element={<OnboardingPage />} /><Route path="/login" element={<PublicSystemPage kind="login" />} /><Route path="/access-denied" element={<PublicSystemPage kind="denied" />} /><Route path="/join" element={<ParticipantJoinPage />} /><Route path="/attempt/:attemptId" element={<ParticipantAttemptLayout />}><Route path="instructions" element={<ParticipantInstructionsPage />} /><Route path="questions/:position" element={<ParticipantQuestionPage />} /><Route path="review" element={<ParticipantReviewPage />} /><Route path="complete" element={<ParticipantCompletePage />} /></Route><Route path="/app" element={<AuthGate role="organizer"><WorkspaceLayout /></AuthGate>}><Route index element={<OverviewPage />} /><Route path="tests" element={<TestBoardPage />} /><Route path="tests/:testId/edit" element={<QuestionEditorPage />} /><Route path="tests/:testId/preview" element={<AssessmentPreviewPage />} /><Route path="tests/:testId/publish" element={<PublicationChecklistPage />} /><Route path="publications/:publicationId/distribute" element={<DistributionPage />} /><Route path="results" element={<ResultsPage />} /></Route><Route path="/admin/*" element={<Navigate to="/app" replace />} /><Route path="*" element={<PublicSystemPage kind="not-found" />} /></Routes></BrowserRouter>;
}
