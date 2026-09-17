export const PLAYBOOKS = [
  {
    id: 'keep-in-touch',
    label: 'Keep in Touch',
    description: 'Track deliberate follow-ups without changing person pages.',
    shortcut: 'K',
    dataEndpoint: '/api/playbooks/keep-in-touch',
    enabledEndpoint: '/api/playbooks/keep-in-touch/set-enabled',
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
