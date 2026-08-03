import { z } from 'zod';

const OptionalDetailSchema = z.string().min(1).max(240).nullable();
const OptionalTimingSchema = z.string().min(1).max(80).nullable();

export const TaskSchema = z.object({
  title: z.string().min(1).max(160),
  deadline: OptionalTimingSchema.describe(
    'The user-stated deadline as one or two compact words (for example, Wednesday or Wednesday, next week), or null.',
  ),
  priority: z
    .enum(['critical', 'high', 'normal'])
    .describe('Priority supported by urgency, consequences, or dependencies.'),
  priorityReason: OptionalDetailSchema.describe(
    'An internal classification reason only when it adds a consequence or dependency not already stated by the title or deadline, or null.',
  ),
  nextStep: OptionalDetailSchema.describe(
    'A distinct concrete action for today that materially advances the task without restating its title, timing, or deadline, or null.',
  ),
  dependency: OptionalDetailSchema.describe(
    'A person, input, or preceding action this task depends on, or null.',
  ),
});

export const CommitmentSchema = z.object({
  title: z.string().min(1).max(160),
  time: OptionalTimingSchema.describe(
    'The user-stated time or time range in compact 24-hour H:mm format (for example, 8:00 or 8:00 - 14:00), or null.',
  ),
  location: z.string().min(1).max(120).nullable(),
  context: OptionalDetailSchema.describe(
    'Information needed to prepare for or attend the commitment, or null.',
  ),
  relatedTasks: z
    .array(TaskSchema)
    .max(20)
    .describe(
      'Tasks performed as part of this commitment, such as work items during a fixed work block.',
    ),
  relatedContext: z
    .array(z.string().min(1).max(200))
    .max(10)
    .describe(
      'Non-actionable facts specifically relevant to this commitment or its related tasks.',
    ),
});

export const ReminderSchema = z.object({
  text: z.string().min(1).max(200),
  timing: OptionalTimingSchema,
});

export const OpenQuestionSchema = z.object({
  question: z.string().min(1).max(200),
  impact: z
    .string()
    .min(1)
    .max(200)
    .describe('Why answering this changes the plan.'),
});

/**
 * Channel-independent briefing facts. Presentation deliberately does not live
 * in this contract: renderers decide which sections and formatting suit each
 * delivery channel.
 */
export const BriefingSchema = z.object({
  language: z
    .enum(['en', 'de'])
    .describe('The dominant language of the transcript and briefing content.'),
  wakeupTime: OptionalTimingSchema.describe(
    'The next-day wake-up time stated by the user, preserving their wording, or null.',
  ),
  commitments: z
    .array(CommitmentSchema)
    .max(20)
    .describe(
      'Appointments, meetings, work hours, and other fixed obligations.',
    ),
  tasks: z
    .array(TaskSchema)
    .max(30)
    .describe('Flexible actions not performed as part of a fixed commitment.'),
  reminders: z
    .array(ReminderSchema)
    .max(20)
    .describe('Small things to remember that are not substantial tasks.'),
  context: z
    .array(z.string().min(1).max(200))
    .max(10)
    .describe(
      'Relevant non-actionable facts that shape the day and do not belong to a fixed commitment.',
    ),
  openQuestions: z
    .array(OpenQuestionSchema)
    .max(10)
    .describe('Material ambiguities whose answers would change the plan.'),
});

export type Briefing = z.infer<typeof BriefingSchema>;
