import { z } from "zod";

const idSchema = z.string().trim().min(1).max(100);
const textSchema = z.string().trim().min(1).max(2_000);

const optionSchema = z.object({
  id: idSchema,
  text: z.string().trim().min(1).max(500),
  position: z.number().int().min(0).max(199),
  isCorrect: z.boolean(),
});

const choiceBase = {
  id: idSchema,
  text: textSchema,
  position: z.number().int().min(0).max(199),
  required: z.boolean(),
  scored: z.boolean(),
  points: z.number().int().min(0).max(100),
  options: z.array(optionSchema).min(2).max(50),
};

export const singleChoiceQuestionSchema = z
  .object({
    ...choiceBase,
    type: z.literal("single_choice"),
  })
  .superRefine((question, context) => {
    const correctCount = question.options.filter((option) => option.isCorrect).length;
    if (question.scored && correctCount !== 1) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Scored single choice must have exactly one correct option",
      });
    }
    if (!question.scored && correctCount !== 0) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Unscored question cannot contain correct options",
      });
    }
    if ((question.scored && question.points < 1) || (!question.scored && question.points !== 0)) {
      context.addIssue({
        code: "custom",
        path: ["points"],
        message: "Points must be positive for scored questions and zero otherwise",
      });
    }
  });

export const multipleChoiceQuestionSchema = z
  .object({
    ...choiceBase,
    type: z.literal("multiple_choice"),
  })
  .superRefine((question, context) => {
    const correctCount = question.options.filter((option) => option.isCorrect).length;
    if (question.scored && correctCount < 1) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Scored multiple choice must have at least one correct option",
      });
    }
    if (!question.scored && correctCount !== 0) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Unscored question cannot contain correct options",
      });
    }
    if ((question.scored && question.points < 1) || (!question.scored && question.points !== 0)) {
      context.addIssue({
        code: "custom",
        path: ["points"],
        message: "Points must be positive for scored questions and zero otherwise",
      });
    }
  });

export const ratingQuestionSchema = z
  .object({
    id: idSchema,
    type: z.literal("rating"),
    text: textSchema,
    position: z.number().int().min(0).max(199),
    required: z.boolean(),
    scored: z.literal(false),
    points: z.literal(0),
    scaleMin: z.number().int().min(0).max(10),
    scaleMax: z.number().int().min(1).max(20),
    scaleMinLabel: z.string().trim().max(100).optional(),
    scaleMaxLabel: z.string().trim().max(100).optional(),
  })
  .refine((question) => question.scaleMax > question.scaleMin, {
    path: ["scaleMax"],
    message: "Scale maximum must be greater than scale minimum",
  });

export const assessmentQuestionSchema = z.union([
  singleChoiceQuestionSchema,
  multipleChoiceQuestionSchema,
  ratingQuestionSchema,
]);

export const draftAssessmentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).default(""),
  durationSeconds: z.number().int().min(60).max(86_400).nullable(),
  questions: z.array(assessmentQuestionSchema).min(1).max(200),
});

const editableOptionSchema = z.strictObject({
  id: idSchema,
  text: z.string().trim().max(500),
  position: z.number().int().min(0).max(49),
  isCorrect: z.boolean(),
});

const editableChoiceBase = {
  id: idSchema,
  text: z.string().trim().max(2_000),
  position: z.number().int().min(0).max(199),
  required: z.boolean(),
  scored: z.boolean(),
  points: z.number().int().min(0).max(100),
  options: z.array(editableOptionSchema).min(2).max(50),
};

const editableQuestionSchema = z.union([
  z.strictObject({ ...editableChoiceBase, type: z.literal("single_choice") }),
  z.strictObject({ ...editableChoiceBase, type: z.literal("multiple_choice") }),
  z.strictObject({
    id: idSchema,
    type: z.literal("rating"),
    text: z.string().trim().max(2_000),
    position: z.number().int().min(0).max(199),
    required: z.boolean(),
    scored: z.literal(false),
    points: z.literal(0),
    scaleMin: z.number().int().min(0).max(10),
    scaleMax: z.number().int().min(1).max(20),
    scaleMinLabel: z.string().trim().max(100).optional(),
    scaleMaxLabel: z.string().trim().max(100).optional(),
  }),
]);

export const publicationSettingsSchema = z
  .strictObject({
    accessMode: z.enum(["open", "controlled"]),
    openRepeatPolicy: z.enum(["unlimited", "best_effort_once"]).nullable(),
    showParticipantResult: z.boolean(),
    opensAt: z.number().int().nonnegative().nullable(),
    closesAt: z.number().int().nonnegative().nullable(),
  })
  .superRefine((settings, context) => {
    if (settings.accessMode === "open" && settings.openRepeatPolicy === null) {
      context.addIssue({ code: "custom", path: ["openRepeatPolicy"], message: "Open access requires a repeat policy" });
    }
    if (settings.accessMode === "controlled" && settings.openRepeatPolicy !== null) {
      context.addIssue({ code: "custom", path: ["openRepeatPolicy"], message: "Controlled access cannot use an open repeat policy" });
    }
    if (settings.opensAt !== null && settings.closesAt !== null && settings.closesAt <= settings.opensAt) {
      context.addIssue({ code: "custom", path: ["closesAt"], message: "Close time must be later than open time" });
    }
  });

export const editableAssessmentDraftSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000),
    durationSeconds: z.number().int().min(60).max(86_400).nullable(),
    questions: z.array(editableQuestionSchema).max(200),
    settings: publicationSettingsSchema,
  })
  .superRefine((draft, context) => {
    const questionIds = draft.questions.map((question) => question.id);
    const positions = draft.questions.map((question) => question.position);
    if (new Set(questionIds).size !== questionIds.length) {
      context.addIssue({ code: "custom", path: ["questions"], message: "Question IDs must be unique" });
    }
    if (new Set(positions).size !== positions.length) {
      context.addIssue({ code: "custom", path: ["questions"], message: "Question positions must be unique" });
    }
    for (const [index, question] of draft.questions.entries()) {
      if (question.type === "rating") continue;
      const optionIds = question.options.map((option) => option.id);
      const optionPositions = question.options.map((option) => option.position);
      if (new Set(optionIds).size !== optionIds.length || new Set(optionPositions).size !== optionPositions.length) {
        context.addIssue({ code: "custom", path: ["questions", index, "options"], message: "Option IDs and positions must be unique" });
      }
    }
  });

export const createAssessmentSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
});

export const answerValueSchema = z.union([
  idSchema,
  z.array(idSchema).min(1).max(50).refine((items) => new Set(items).size === items.length, {
    message: "Answer option IDs must be unique",
  }),
  z.number().int().min(0).max(20),
  z.null(),
]);

export const resolvePublicationSchema = z.strictObject({
  code: z.string().trim().toUpperCase().length(6).regex(/^[A-HJ-NP-Z2-9]{6}$/),
});

export const createAttemptSchema = z
  .strictObject({
    code: z.string().trim().min(4).max(32).optional(),
    invitationToken: z.string().trim().min(32).max(512).optional(),
    displayName: z.string().trim().min(1).max(120),
    participantIdentity: z.string().trim().min(32).max(128).optional(),
    turnstileToken: z.string().min(1).max(2_048),
  })
  .superRefine((value, context) => {
    if (Number(Boolean(value.code)) + Number(Boolean(value.invitationToken)) !== 1) {
      context.addIssue({ code: "custom", message: "Provide exactly one access credential", path: ["code"] });
    }
    if (value.code && !value.participantIdentity) {
      context.addIssue({ code: "custom", message: "Open access requires a local participant identity", path: ["participantIdentity"] });
    }
  });

export const createInvitationBatchSchema = z.strictObject({
  participantLabels: z.array(z.string().trim().min(1).max(200)).min(1).max(100)
    .refine((labels) => new Set(labels.map((label) => label.toLocaleLowerCase("ru"))).size === labels.length, {
      message: "Participant labels must be unique",
    }),
  expiresAt: z.number().int().positive().nullable(),
});

const organizationStatusSchema = z.enum(["active", "disabled"]);
const normalizedEmailSchema = z
  .email()
  .max(320)
  .transform((value) => value.trim().toLowerCase());

export const createOrganizationSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export const updateOrganizationSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    status: organizationStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one organization field",
  });

export const addOrganizationMemberSchema = z.strictObject({
  email: normalizedEmailSchema,
  displayName: z.string().trim().min(1).max(200),
});

export const updateMembershipSchema = z.strictObject({
  status: z.enum(["active", "disabled"]),
});
