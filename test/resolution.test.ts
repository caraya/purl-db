import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveTargetUrl, selectBestMapping } from '../src/resolution.ts';

describe('PURL resolution', () => {
  test('selects the longest active mapping on a path boundary', () => {
    const mappings = [
      { path: '/research', targetUrl: 'https://example.org/general', isActive: true },
      { path: '/research/data', targetUrl: 'https://example.org/datasets', isActive: true },
      { path: '/research/data-old', targetUrl: 'https://example.org/old', isActive: true },
      { path: '/research/data/private', targetUrl: 'https://example.org/private', isActive: false },
    ];

    assert.equal(selectBestMapping('/research/data/report.pdf', mappings), mappings[1]);
    assert.equal(selectBestMapping('/research/data-old', mappings), mappings[2]);
    assert.equal(selectBestMapping('/research/dataset', mappings), mappings[0]);
    assert.equal(selectBestMapping('/archive', mappings), undefined);
  });

  test('appends nested paths to a target base path and preserves its query', () => {
    assert.equal(
      resolveTargetUrl('https://example.org/archive?download=1', '/research/data', '/research/data/report.pdf'),
      'https://example.org/archive/report.pdf?download=1',
    );
  });

  test('does not append a path for an exact PURL match', () => {
    assert.equal(
      resolveTargetUrl('https://example.org/archive', '/research/data', '/research/data'),
      'https://example.org/archive',
    );
  });
});