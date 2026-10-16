/**
 * Activity row subtitle line (mirrors app.js parseActivityNoteForRow / activitySubtitleLine).
 * Run: node scripts/activity-subtitle-test.mjs
 */
import assert from 'assert';

function parseActivityNoteForRow(noteRaw, catName) {
  const note = String(noteRaw || '').trim();
  if (!note) return { title: catName, noteTag: null };
  const parts = note.split(/\s*\u00B7\s*|\s*\u2022\s*/);
  if (parts.length >= 2) {
    return {
      title: parts[0].trim(),
      noteTag: parts.slice(1).join(' \u00B7 ').trim()
    };
  }
  return { title: note, noteTag: note };
}

function activitySubtitleLine(catName, titleText, noteTag) {
  catName = String(catName || '').trim();
  titleText = String(titleText || '').trim();
  const tag = noteTag != null ? String(noteTag).trim() : '';
  if (!tag) return catName;
  if (tag.toLowerCase() === titleText.toLowerCase()) return catName;
  return catName + ' \u00B7 ' + tag;
}

function rowSubtitle(catName, noteRaw) {
  const parsed = parseActivityNoteForRow(noteRaw, catName);
  if (!String(noteRaw || '').trim()) return null;
  return activitySubtitleLine(catName, parsed.title, parsed.noteTag);
}

assert.strictEqual(rowSubtitle('Groceries', 'Whole Foods'), 'Groceries');
assert.strictEqual(rowSubtitle('Gas', 'Shell'), 'Gas');
assert.strictEqual(rowSubtitle('Dining', 'Panera Bread \u00B7 Lunch'), 'Dining \u00B7 Lunch');
assert.strictEqual(rowSubtitle('Dining', '  panera bread \u00B7 Lunch'), 'Dining \u00B7 Lunch');
assert.strictEqual(rowSubtitle('Groceries', 'Whole Foods'), 'Groceries');
assert.strictEqual(rowSubtitle('Dining', 'Same \u00B7 same'), 'Dining');

console.log('activity-subtitle-test: PASS');
