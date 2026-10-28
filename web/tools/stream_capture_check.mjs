// 検証用の試合（owner: other）の除外などの純粋関数の確認（配信映像の取り込み UI は D74 で廃止）
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { startPreview } from './lib/preview_server.mjs';
import fs from 'node:fs';
import path from 'node:path';

import {
  isVerificationMatch,
  ownMatches,
  matchOwner
} from '../src/analysis.js';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const SH = path.resolve(WEB_DIR, '../docs/screenshots/stream-capture');
fs.mkdirSync(SH, { recursive: true });

const results = [];
const check = (name, ok, info = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
};

// ============================================================================
// 前半: Node直接importでの純粋関数検証
// ============================================================================

// 1. isVerificationMatch
{
  check('isVerificationMatch: owner "other" returns true',
    isVerificationMatch({ source: { owner: 'other' } }) === true
  );
  check('isVerificationMatch: owner "self" returns false',
    isVerificationMatch({ source: { owner: 'self' } }) === false
  );
  check('isVerificationMatch: missing owner in source returns false (backward compatible)',
    isVerificationMatch({ source: { kind: 'device' } }) === false
  );
  check('isVerificationMatch: empty source returns false',
    isVerificationMatch({ source: {} }) === false
  );
  check('isVerificationMatch: missing source returns false',
    isVerificationMatch({}) === false
  );
  check('isVerificationMatch: null returns false',
    isVerificationMatch(null) === false
  );
  check('isVerificationMatch: undefined returns false',
    isVerificationMatch(undefined) === false
  );
}

// 2. matchOwner
{
  check('matchOwner: "other" returns "other"',
    matchOwner({ source: { owner: 'other' } }) === 'other'
  );
  check('matchOwner: "self" returns "self"',
    matchOwner({ source: { owner: 'self' } }) === 'self'
  );
  check('matchOwner: empty or missing returns "self"',
    matchOwner({}) === 'self' && matchOwner(null) === 'self'
  );
}

// 3. ownMatches
{
  const m1 = { id: 'm1', source: { owner: 'self' } };
  const m2 = { id: 'm2', source: { owner: 'other' } };
  const m3 = { id: 'm3', source: { kind: 'device' } }; // legacy, self
  const m4 = { id: 'm4' }; // legacy, self
  const original = [m1, m2, m3, m4];
  const originalCopy = [...original];

  const filtered = ownMatches(original);
  check('ownMatches: removes verification match (owner "other")',
    filtered.length === 3 && !filtered.some(m => m.id === 'm2')
  );
  check('ownMatches: preserves order of remaining items',
    filtered[0].id === 'm1' && filtered[1].id === 'm3' && filtered[2].id === 'm4'
  );
  check('ownMatches: non-destructive to original array',
    original.length === originalCopy.length && original.every((m, i) => m === originalCopy[i])
  );
  check('ownMatches: empty or non-array returns empty array',
    Array.isArray(ownMatches([])) && ownMatches([]).length === 0 &&
    Array.isArray(ownMatches(null)) && ownMatches(null).length === 0
  );
}

console.log(`\nResult: ${results.filter(Boolean).length}/${results.length} checks passed.`);
process.exit(results.every(Boolean) ? 0 : 1);
