import type { Briefing } from './briefing.schema';

const WHATSAPP_MESSAGE_LIMIT = 4_096;
const TRUNCATION_NOTICE = '\n\n_More details were omitted._';

type Task = Briefing['tasks'][number];

const PRIORITY_ORDER: Readonly<Record<Task['priority'], number>> = {
  critical: 0,
  high: 1,
  normal: 2,
};

/**
 * Renders semantic briefing facts for WhatsApp. Keeping this deterministic
 * makes the channel output consistent and keeps formatting out of the model's
 * responsibilities.
 */
export function renderWhatsAppBriefing(briefing: Briefing): string {
  const sections = [
    renderWakeupTime(briefing.wakeupTime),
    renderCommitments(briefing.commitments),
    renderTasks(briefing.tasks),
    renderSimpleList('Reminders', briefing.reminders, (reminder) =>
      reminder.timing ? `${reminder.text} — ${reminder.timing}` : reminder.text,
    ),
    renderSimpleList('Good to know', briefing.context, (item) => item),
    renderSimpleList(
      'Worth clarifying',
      briefing.openQuestions,
      (item) => `${item.question} — ${item.impact}`,
    ),
  ].filter((section): section is string => section !== null);

  const message = ['*Your day brief*', ...sections].join('\n\n');

  if (message.length <= WHATSAPP_MESSAGE_LIMIT) {
    return message;
  }

  const availableLength = WHATSAPP_MESSAGE_LIMIT - TRUNCATION_NOTICE.length;
  const lastCompleteLine = message.lastIndexOf('\n', availableLength);
  const cutAt = lastCompleteLine > 0 ? lastCompleteLine : availableLength;

  return `${message.slice(0, cutAt).trimEnd()}${TRUNCATION_NOTICE}`;
}

function renderWakeupTime(wakeupTime: string | null): string | null {
  return wakeupTime ? `*Wake-up*\n• ${clean(wakeupTime)}` : null;
}

function renderCommitments(
  commitments: Briefing['commitments'],
): string | null {
  return renderSimpleList('Fixed schedule', commitments, (commitment) => {
    const title = commitment.time
      ? `${commitment.time} — ${commitment.title}`
      : commitment.title;
    const details = [
      commitment.location ? `At ${commitment.location}` : null,
      commitment.context,
    ];

    return withDetails(title, details);
  });
}

function renderTasks(tasks: Briefing['tasks']): string | null {
  const sortedTasks = tasks
    .map((task, originalIndex) => ({ originalIndex, task }))
    .sort(
      (left, right) =>
        PRIORITY_ORDER[left.task.priority] -
          PRIORITY_ORDER[right.task.priority] ||
        left.originalIndex - right.originalIndex,
    );

  return renderSimpleList('Tasks', sortedTasks, ({ task }) => {
    const priority =
      task.priority === 'normal' ? null : `[${capitalize(task.priority)}]`;
    const title = [
      priority,
      task.title,
      task.deadline && `Due ${task.deadline}`,
    ]
      .filter(Boolean)
      .join(' — ');
    const details = [
      task.priorityReason,
      task.nextStep ? `Next: ${task.nextStep}` : null,
      task.dependency ? `Needs: ${task.dependency}` : null,
    ];

    return withDetails(title, details);
  });
}

function renderSimpleList<T>(
  heading: string,
  items: readonly T[],
  renderItem: (item: T) => string,
): string | null {
  if (items.length === 0) {
    return null;
  }

  const lines = items.map((item) => {
    const [title, ...details] = renderItem(item).split('\n');
    const detailLines = details.map((detail) => clean(detail));

    return [`• ${clean(title)}`, ...detailLines].join('\n');
  });
  return `*${heading}*\n${lines.join('\n')}`;
}

function withDetails(title: string, details: Array<string | null>): string {
  const renderedDetails = details.filter(
    (detail): detail is string => !!detail,
  );
  return renderedDetails.length > 0
    ? `${title}\n  ${renderedDetails.join(' · ')}`
    : title;
}

function clean(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
