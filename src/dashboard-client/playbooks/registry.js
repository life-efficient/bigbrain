export const PLAYBOOKS = [
  {
    id: 'keep-in-touch',
    label: 'Keep in Touch',
    description: 'Track deliberate follow-ups without changing person pages.',
    shortcut: 'K',
  },
  {
    id: 'comprehension',
    label: 'Comprehension',
    description: 'Build durable understanding from important Brain pages.',
    shortcut: 'C',
  },
];

export function playbookById(playbookId) {
  return PLAYBOOKS.find((playbook) => playbook.id === playbookId) || null;
}
