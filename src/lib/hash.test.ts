import { describe, it, expect } from 'vitest';
import { parseHash } from './hash';

describe('parseHash', () => {
  it('parses org and site', () =>
    expect(parseHash('#/tyge68/experience-workspace-demo')).toEqual({ org: 'tyge68', site: 'experience-workspace-demo' }));
  it('ignores deeper path', () => expect(parseHash('#/a/b/c/d.html')).toEqual({ org: 'a', site: 'b' }));
  it('handles org only', () => expect(parseHash('#/a')).toEqual({ org: 'a', site: null }));
  it('handles empty', () => expect(parseHash('')).toEqual({ org: null, site: null }));
});
