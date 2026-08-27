export const PLAYBOOKS = [
  {
    id: 'keep-in-touch',
    label: 'Keep in Touch',
    description: 'Track deliberate follow-ups without changing person pages.',
    shortcut: 'K',
  },
];

export function playbookById(playbookId) {
  return PLAYBOOKS.find((playbook) => playbook.id === playbookId) || null;
}
