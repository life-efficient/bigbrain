export const OVERLAYS = [
  {
    id: 'deals',
    label: 'Deals',
    description: 'Our deals and opportunities from our network.',
    shortcut: 'B',
  },
  {
    id: 'keep-in-touch',
    label: 'Keep in Touch',
    description: 'Track deliberate follow-ups without changing person pages.',
    shortcut: 'K',
    dataEndpoint: '/api/overlays/keep-in-touch',
    enabledEndpoint: '/api/overlays/keep-in-touch/set-enabled',
  },
  {
    id: 'comprehension',
    label: 'Comprehension',
    description: 'Build durable understanding from important Brain pages.',
    shortcut: 'C',
  },
];

export function overlayById(overlayId) {
  return OVERLAYS.find((overlay) => overlay.id === overlayId) || null;
}
