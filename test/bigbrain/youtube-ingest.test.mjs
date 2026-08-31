import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertExistingYouTubeRecordCompatible,
  buildYouTubeIdentity,
  findYouTubeRecordById,
  parseYouTubeChapters,
  validateYouTubeMetadata,
  validateYouTubeSidecar,
} from '../../src/bigbrain/youtube-ingest.js';

const metadata = {
  id: 'FGC4ofTcg2k',
  title: 'Why AI Demand Is Outrunning Compute Supply',
  channel: 'a16z',
};

const description = `Timestamps:
00:00 - Intro
01:06 - Finding the Bear Case: Why Gavin Can't Find One
08:06 - How's This All Gonna Go Wrong? An "And" Thing, Not an "Or"
09:09 - Will Labs Reinvest All Their Profits Into Training Forever?
14:44 - The Demand Side: 30 Million Heavy Users & the Diffusion Question
19:16 - From Reactive Coding to Fully Autonomous Agents
30:18 - What Happens If There's a Massive Supply Shortage?
34:21 - Orbital Data Centers: The SpaceX Compute Play
40:00 - Starlink's $2 Trillion Market & the Heads-You-Win Compute Bet
44:04 - The Most Futuristic SpaceX Idea: Asteroid Mining
54:01 - Who Becomes the Abstraction Layer of Intelligence?
57:57 - Harvey, Cursor & Vertical AI Winners
01:00:26 - Jensen, Nvidia & the Central Bank of AI
01:12:16 - How Chip Deal Structures Reveal True Customer Preference

Resources:
Follow the speakers.`;

test('YouTube identity preserves exact metadata and derives only the display suffix and basename', () => {
  const exactMetadata = {
    id: 'abc123',
    title: 'A Title: “Quoted” & Un-normalized!',
    channel: 'The Channel / Name',
  };
  const identity = buildYouTubeIdentity(exactMetadata);

  assert.deepEqual(validateYouTubeMetadata(exactMetadata), {
    youtubeId: exactMetadata.id,
    youtubeTitle: exactMetadata.title,
    channel: exactMetadata.channel,
  });
  assert.equal(identity.displayTitle, 'A Title: “Quoted” & Un-normalized! - The Channel / Name');
  assert.equal(identity.basename, 'a-title-quoted-un-normalized-the-channel-name');
});

test('YouTube metadata rejects missing, placeholder, and conflicting identity values', () => {
  for (const invalid of [
    { ...metadata, title: '' },
    { ...metadata, channel: 'unknown' },
    { ...metadata, id: null },
    { ...metadata, title: 'Exact title', youtube_title: 'Different title' },
    { ...metadata, channel: 'Channel A', uploader: 'Channel B' },
  ]) {
    assert.throws(() => validateYouTubeMetadata(invalid), /Stop before writing|Conflicting/);
  }
});

test('YouTube chapter parsing preserves exact labels and chronological order', () => {
  const chapters = parseYouTubeChapters(description);

  assert.equal(chapters.length, 14);
  assert.deepEqual(chapters.map((chapter) => chapter.label), [
    'Intro',
    "Finding the Bear Case: Why Gavin Can't Find One",
    'How\'s This All Gonna Go Wrong? An "And" Thing, Not an "Or"',
    'Will Labs Reinvest All Their Profits Into Training Forever?',
    'The Demand Side: 30 Million Heavy Users & the Diffusion Question',
    'From Reactive Coding to Fully Autonomous Agents',
    "What Happens If There's a Massive Supply Shortage?",
    'Orbital Data Centers: The SpaceX Compute Play',
    "Starlink's $2 Trillion Market & the Heads-You-Win Compute Bet",
    'The Most Futuristic SpaceX Idea: Asteroid Mining',
    'Who Becomes the Abstraction Layer of Intelligence?',
    'Harvey, Cursor & Vertical AI Winners',
    'Jensen, Nvidia & the Central Bank of AI',
    'How Chip Deal Structures Reveal True Customer Preference',
  ]);
  assert.equal(chapters[12].startSeconds, 3626);
  assert.equal(chapters[12].heading, '01:00:26 - Jensen, Nvidia & the Central Bank of AI');
});

test('sidecar validation requires one exact primary heading per YouTube chapter', () => {
  const identity = buildYouTubeIdentity(metadata);
  const headings = parseYouTubeChapters(description).map((chapter) => `### ${chapter.heading}`).join('\n\n');
  const body = `# ${identity.displayTitle}\n\n## Chronological Exposition\n\n${headings}\n`;
  const frontmatter = {
    title: identity.displayTitle,
    youtube_title: identity.youtubeTitle,
    youtube_id: identity.youtubeId,
    channel: identity.channel,
  };

  assert.doesNotThrow(() => validateYouTubeSidecar({ metadata, description, frontmatter, body }));
  assert.throws(
    () => validateYouTubeSidecar({
      metadata,
      description,
      frontmatter,
      body: body.replace('### 01:06 - Finding the Bear Case: Why Gavin Can\'t Find One', '### Opening frame and the search for a bear case'),
    }),
    /preserve every YouTube chapter/,
  );
  assert.throws(
    () => validateYouTubeSidecar({
      metadata,
      description,
      frontmatter,
      body: body.replace(`# ${identity.displayTitle}`, '# A generated topic label'),
    }),
    /sidecar H1/,
  );
});

test('sidecar validation labels agent-authored chronology when YouTube has no chapters', () => {
  const identity = buildYouTubeIdentity(metadata);
  assert.doesNotThrow(() => validateYouTubeSidecar({
    metadata,
    description: 'A video description without a timestamp section.',
    frontmatter: {
      title: identity.displayTitle,
      youtube_title: identity.youtubeTitle,
      youtube_id: identity.youtubeId,
      channel: identity.channel,
      chapter_source: 'none',
    },
    body: `# ${identity.displayTitle}\n\n## Chronological Exposition\n\n### Agent-authored chronological section`,
  }));
  assert.throws(() => validateYouTubeSidecar({
    metadata,
    description: 'A video description without a timestamp section.',
    frontmatter: {
      title: identity.displayTitle,
      youtube_title: identity.youtubeTitle,
      youtube_id: identity.youtubeId,
      channel: identity.channel,
    },
    body: `# ${identity.displayTitle}\n\n## Chronological Exposition\n\n### Agent-authored chronological section`,
  }), /chapter_source: none/);
});

test('metadata validation fails before a raw or sidecar write', () => {
  let writes = 0;
  assert.throws(() => {
    validateYouTubeMetadata({ ...metadata, title: '' });
    writes += 1;
  }, /Stop before writing/);
  assert.equal(writes, 0);
});

test('duplicate YouTube IDs are read before mutation and conflicting duplicates stop', () => {
  const existing = { youtube_id: metadata.id, youtube_title: metadata.title, channel: metadata.channel, path: 'concepts/.raw/existing.md' };
  assert.equal(findYouTubeRecordById([existing], metadata.id), existing);
  assert.doesNotThrow(() => assertExistingYouTubeRecordCompatible(existing, buildYouTubeIdentity(metadata)));
  assert.throws(() => assertExistingYouTubeRecordCompatible(
    { ...existing, youtube_title: 'A different title' },
    buildYouTubeIdentity(metadata),
  ), /conflicting exact title/);
  assert.throws(() => findYouTubeRecordById([existing, { ...existing, path: 'concepts/.raw/duplicate.md' }], metadata.id), /Multiple existing Brain records/);
});

test('same title and channel for different videos gets an ID disambiguator', () => {
  const first = buildYouTubeIdentity(metadata);
  const second = buildYouTubeIdentity({ ...metadata, id: 'OtherVideo' }, { disambiguator: 'OtherVideo' });
  assert.notEqual(first.basename, second.basename);
  assert.equal(second.basename, 'why-ai-demand-is-outrunning-compute-supply-othervideo-a16z');
});
