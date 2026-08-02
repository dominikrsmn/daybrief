import { z } from 'zod';

export const BriefingSchema = z.object({
  text: z
    .string()
    .describe('A concise, practical morning briefing formatted as Markdown.'),
  wakeupTime: z
    .string()
    .nullable()
    .describe(
      'The next-day wake-up time stated by the user, preserving their wording, or null.',
    ),
  uncertainties: z
    .array(z.string())
    .describe(
      'Material ambiguities or missing information that affect the briefing.',
    ),
});

export type Briefing = z.infer<typeof BriefingSchema>;
