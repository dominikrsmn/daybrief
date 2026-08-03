import type { Briefing } from './briefing.schema';

const WHATSAPP_MESSAGE_LIMIT = 4_096;

type Task = Briefing['tasks'][number];
type RendererCopy = {
  title: string;
  greeting: string;
  fixedSchedule: string;
  tasks: string;
  reminders: string;
  goodToKnow: string;
  worthClarifying: string;
  locationPrefix: string;
  nextStepPrefix: string;
  dependencyPrefix: string;
  truncationNotice: string;
};

const COPY = {
  en: {
    title: 'Your day brief',
    greeting: "Good morning! Here's your overview for the day.",
    fixedSchedule: 'Fixed schedule',
    tasks: 'Tasks',
    reminders: 'Reminders',
    goodToKnow: 'Good to know',
    worthClarifying: 'Worth clarifying',
    locationPrefix: 'At',
    nextStepPrefix: 'Next:',
    dependencyPrefix: 'Needs:',
    truncationNotice: 'More details were omitted.',
  },
  de: {
    title: 'Dein Daybrief',
    greeting: 'Guten Morgen! Hier ist dein Überblick für den Tag.',
    fixedSchedule: 'Feste Termine',
    tasks: 'Aufgaben',
    reminders: 'Erinnerungen',
    goodToKnow: 'Gut zu wissen',
    worthClarifying: 'Noch zu klären',
    locationPrefix: 'Ort:',
    nextStepPrefix: 'Nächster Schritt:',
    dependencyPrefix: 'Benötigt:',
    truncationNotice: 'Weitere Details wurden ausgelassen.',
  },
} as const satisfies Readonly<Record<Briefing['language'], RendererCopy>>;

const PRIORITY_ORDER: Readonly<Record<Task['priority'], number>> = {
  critical: 0,
  high: 1,
  normal: 2,
};

const PRIORITY_EMOJI: Readonly<Record<Task['priority'], string>> = {
  critical: '🚨',
  high: '🔴',
  normal: '🟡',
};

/**
 * Renders semantic briefing facts as one WhatsApp message per visible section.
 * Keeping this deterministic makes the channel output consistent and keeps
 * formatting out of the model's responsibilities.
 */
export function renderWhatsAppBriefingMessages(
  briefing: Briefing,
): readonly string[] {
  const copy: RendererCopy = COPY[briefing.language];
  const sections = [
    renderCommitments(briefing.commitments, copy),
    renderTasks(briefing.tasks, copy),
    renderSection(copy.reminders, briefing.reminders, (reminder) =>
      reminder.timing ? `${reminder.text} (${reminder.timing})` : reminder.text,
    ),
    renderSection(copy.goodToKnow, briefing.context, (item) => item),
    renderSection(
      copy.worthClarifying,
      briefing.openQuestions,
      (item) => `${item.question}: ${item.impact}`,
    ),
  ].filter((section): section is string => section !== null);

  return [`*${copy.title}*\n${copy.greeting}`, ...sections].map((message) =>
    truncateMessage(message, copy.truncationNotice),
  );
}

function truncateMessage(message: string, notice: string): string {
  if (message.length <= WHATSAPP_MESSAGE_LIMIT) {
    return message;
  }

  const truncationNotice = `\n\n_${notice}_`;
  const availableLength = WHATSAPP_MESSAGE_LIMIT - truncationNotice.length;
  const lastCompleteLine = message.lastIndexOf('\n', availableLength);
  const cutAt = lastCompleteLine > 0 ? lastCompleteLine : availableLength;

  return `${message.slice(0, cutAt).trimEnd()}${truncationNotice}`;
}

function renderCommitments(
  commitments: Briefing['commitments'],
  copy: RendererCopy,
): string | null {
  return renderSection(copy.fixedSchedule, commitments, (commitment) => {
    const title = commitment.time
      ? `*${commitment.time}*: ${commitment.title}`
      : commitment.title;
    const details = [
      commitment.location
        ? `${copy.locationPrefix} ${commitment.location}`
        : null,
      commitment.context,
    ];
    const relatedItems = [
      ...sortTasks(commitment.relatedTasks).map(
        (task) => `• ${renderTask(task, copy)}`,
      ),
      ...commitment.relatedContext.map((item) => `• ${item}`),
    ];

    return [withDetails(title, details), ...relatedItems].join('\n');
  });
}

function renderTasks(
  tasks: Briefing['tasks'],
  copy: RendererCopy,
): string | null {
  return renderSection(copy.tasks, sortTasks(tasks), (task) =>
    renderTask(task, copy),
  );
}

function sortTasks(tasks: readonly Task[]): readonly Task[] {
  return tasks
    .map((task, originalIndex) => ({ originalIndex, task }))
    .sort(
      (left, right) =>
        PRIORITY_ORDER[left.task.priority] -
          PRIORITY_ORDER[right.task.priority] ||
        left.originalIndex - right.originalIndex,
    )
    .map(({ task }) => task);
}

function renderTask(task: Task, copy: RendererCopy): string {
  const deadline = task.deadline ? ` (${task.deadline})` : '';
  const title = `${PRIORITY_EMOJI[task.priority]}  ${task.title}${deadline}`;
  const nextStep =
    task.nextStep && !substantiallyRepeats(task.title, task.nextStep)
      ? `${copy.nextStepPrefix} ${task.nextStep}`
      : null;
  const dependency =
    task.dependency && !substantiallyRepeats(task.title, task.dependency)
      ? `${copy.dependencyPrefix} ${task.dependency}`
      : null;
  const details = [nextStep, dependency];

  return withDetails(title, details);
}

function renderSection<T>(
  heading: string,
  items: readonly T[],
  renderItem: (item: T) => string,
): string | null {
  if (items.length === 0) {
    return null;
  }

  const lines = items.map((item) =>
    renderItem(item)
      .split('\n')
      .map((line) => clean(line))
      .join('\n'),
  );
  return `*${heading}*\n${lines.join('\n')}`;
}

function withDetails(title: string, details: Array<string | null>): string {
  const renderedDetails = details.filter(
    (detail): detail is string => !!detail,
  );
  return renderedDetails.length > 0
    ? `${title}\n${renderedDetails.join(' · ')}`
    : title;
}

function clean(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s*—\s*/g, ': ')
    .replace(/\s*–\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

const COMPARISON_STOP_WORDS = new Set([
  'after',
  'and',
  'andere',
  'another',
  'appropriate',
  'das',
  'dem',
  'den',
  'der',
  'die',
  'eine',
  'einen',
  'einer',
  'for',
  'fur',
  'geeignete',
  'im',
  'ins',
  'morgen',
  'nach',
  'oder',
  'other',
  'the',
  'tomorrow',
  'und',
]);

/** Suppresses model phrasing that only rewords the task instead of advancing it. */
function substantiallyRepeats(title: string, detail: string): boolean {
  const titleTokens = comparableTokens(title);
  const detailTokens = comparableTokens(detail);

  if (titleTokens.size === 0 || detailTokens.size === 0) {
    return false;
  }

  const sharedTokenCount = [...titleTokens].filter((token) =>
    detailTokens.has(token),
  ).length;

  return (
    sharedTokenCount / Math.min(titleTokens.size, detailTokens.size) >= 0.75
  );
}

function comparableTokens(value: string): ReadonlySet<string> {
  return new Set(
    value
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(
        (token) => token.length >= 3 && !COMPARISON_STOP_WORDS.has(token),
      ),
  );
}
