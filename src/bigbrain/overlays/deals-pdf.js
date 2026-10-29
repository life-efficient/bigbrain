import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { openSync } from 'fontkit';
import { queryPagesByFrontmatter } from '../frontmatter-query.js';
import { DEALS_INVOLVEMENTS } from './deals.js';

const REGULAR = fileURLToPath(new URL('./fonts/NotoSans-Regular.ttf', import.meta.url));
const BOLD = fileURLToPath(new URL('./fonts/NotoSans-Bold.ttf', import.meta.url));
let coverage;
const exportError = message => Object.assign(new Error(message), { statusCode: 422 });

// This projection is the export boundary: no internal names, summaries, links,
// workflow state or legacy teaser fallbacks can reach the PDF renderer.
export async function readAnonymisedDeals(db) {
  const records = [];
  let cursor = 0;
  let expectedTotal;
  do {
    const page = await queryPagesByFrontmatter({ db, pathPrefix: 'deals', type: 'deals',
      filters: [{ field: 'page_kind', operator: 'eq', value: 'canonical' },
        { field: 'deal_involvement', operator: 'in', value: [...DEALS_INVOLVEMENTS] }],
      fields: ['anonymised_title', 'anonymised_description', 'anonymised_asks'],
      orderBy: [{ field: 'slug', direction: 'asc' }], limit: 100, cursor });
    expectedTotal ??= page.total;
    if (page.total !== expectedTotal) throw exportError('The deal list changed during export. Please retry.');
    for (const p of page.pages) {
      const f = p.frontmatter;
      if (typeof f.anonymised_title !== 'string' || !f.anonymised_title.trim()
        || typeof f.anonymised_description !== 'string' || !f.anonymised_description.trim()) {
        throw exportError('Some deals need an anonymised title or description. Complete those fields in Deals, then download again.');
      }
      if (!Array.isArray(f.anonymised_asks) || f.anonymised_asks.some(a => typeof a !== 'string' || !a.trim())) {
        throw exportError('Some deals have incomplete anonymised asks. Correct those fields in Deals, then download again.');
      }
      records.push({ title: f.anonymised_title.trim(), description: f.anonymised_description.trim(), asks: f.anonymised_asks.map(a => a.trim()) });
    }
    if (page.next_cursor !== null && (!Number.isInteger(page.next_cursor) || page.next_cursor <= cursor)) {
      throw exportError('The complete deal list could not be loaded. Please retry.');
    }
    cursor = page.next_cursor;
  } while (cursor !== null);
  if (records.length !== expectedTotal) throw exportError('The complete deal list could not be loaded. Please retry.');
  if (!records.length) throw exportError('There are no deals to export yet.');
  return records.sort((a, b) => a.title.localeCompare(b.title, 'en'));
}

export async function buildDealsPdf(config, db, { generatedAt = new Date() } = {}) {
  const records = await readAnonymisedDeals(db);
  coverage ||= openSync(REGULAR);
  for (const record of records) {
    for (const text of [record.title, record.description, ...record.asks]) {
      if ([...text].some(character => !/\s/u.test(character) && !coverage.hasGlyphForCodePoint(character.codePointAt(0)))) {
        throw exportError('An anonymised field contains a character the PDF font cannot display. Update that wording before exporting.');
      }
    }
  }
  const doc = new PDFDocument({ autoFirstPage: false, bufferPages: true, size: 'A4',
    margins: { top: 78, bottom: 60, left: 48, right: 48 }, font: REGULAR,
    info: { Title: 'Anonymised deal overview', Author: '', Subject: 'Anonymised deal descriptions and asks', Creator: 'BigBrain', CreationDate: generatedAt },
  });
  const chunks = [];
  const completed = new Promise((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.registerFont('Body', REGULAR).registerFont('Heading', BOLD);
  const width = 499.28;
  const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(generatedAt);
  doc.addPage();
  doc.font('Heading').fontSize(24).text('Deal overview', { width });
  doc.moveDown(0.35).font('Body').fontSize(10).text(`${records.length} anonymised ${records.length === 1 ? 'deal' : 'deals'}`, { width });
  doc.moveDown(1.5);
  for (const [index, record] of records.entries()) {
    const title = `${String(index + 1).padStart(2, '0')}  ${record.title}`;
    const titleHeight = doc.font('Heading').fontSize(13).heightOfString(title, { width, lineGap: 2 });
    const descriptionHeight = doc.font('Body').fontSize(10).heightOfString(record.description, { width, lineGap: 3 });
    const asksHeight = record.asks.reduce((sum, ask) => sum + doc.heightOfString(`• ${ask}`, { width: width - 10, lineGap: 3 }) + 6, 0);
    const blockHeight = titleHeight + descriptionHeight + asksHeight + (record.asks.length ? 30 : 0) + 30;
    const remaining = doc.page.height - doc.page.margins.bottom - doc.y;
    // Keep ordinary deal entries together; exceptionally long entries flow over
    // as many pages as needed without clipping or shrinking the body type.
    if (remaining < Math.min(blockHeight, titleHeight + 70) || (blockHeight < 650 && remaining < blockHeight)) doc.addPage();
    doc.font('Heading').fontSize(13).text(title, 48, doc.y, { width, lineGap: 2 });
    doc.moveDown(0.4).font('Body').fontSize(10).text(record.description, 48, doc.y, { width, lineGap: 3 });
    if (record.asks.length) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 50) doc.addPage();
      doc.moveDown(0.6).font('Heading').fontSize(9).text('ASKS', 48, doc.y, { width });
      doc.moveDown(0.35).font('Body').fontSize(10);
      for (const ask of record.asks) {
        doc.text(`• ${ask}`, 58, doc.y, { width: width - 10, lineGap: 3 });
        doc.moveDown(0.3);
      }
    }
    doc.moveDown(1.3);
    doc.x = 48;
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor('black').font('Heading').fontSize(10).text('ANONYMISED DEAL OVERVIEW', 48, 30, { width, lineBreak: false });
    doc.font('Body').fontSize(8).text(date, 48, 30, { width, align: 'right', lineBreak: false });
    doc.strokeColor('black').lineWidth(0.4).moveTo(48, 51).lineTo(547.28, 51).stroke();
    doc.font('Body').fontSize(8).fillColor('black').text(`${i + 1} / ${range.count}`, 48, doc.page.height - 35,
      { width, align: 'right', lineBreak: false });
  }
  doc.end();
  return completed;
}
