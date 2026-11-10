/**
 * Keywords in the app (same /api/keywords data as the website's SEO Plan →
 * Keywords tab): the parser keeps good rows and drops broken ones, pin calls
 * the same API, volume lookups are parsed, and the shared keyword card shows
 * the server's measured labels as-is.
 */
import { render } from '@testing-library/react-native';

import { api } from '../src/api/client';
import { fetchKeywordVolumes, fetchKeywords, setKeywordPinned, volumeLabel } from '../src/api/endpoints/keywords';
import { KeywordCard } from '../src/components/keywords/keyword-card';

jest.mock('../src/api/client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
const mocked = api as unknown as { get: jest.Mock; post: jest.Mock };

const row = {
  id: 'kw:dental-implants-kolkata',
  keyword: 'dental implants kolkata',
  role: 'core',
  roleLabel: 'Focus keyword',
  owner: true,
  pinned: false,
  volumeText: '590 / month',
  volumeNote: 'across India',
  volume: 590,
  rankText: '#6',
  rank: 6,
  trend: 3,
  topCompetitor: { name: 'Apollo Dental', rank: 1 },
  competitorsAbove: [{ name: 'Apollo Dental', rank: 1, reviews: 900, rating: 4.8 }],
  verdictLabel: 'Quick win',
  tone: 'good',
  reason: 'Quick win: 590 Google searches a month; you are #6 on Google Maps.',
};

describe('keywords API', () => {
  it('parses the response and drops malformed rows', async () => {
    mocked.get.mockResolvedValueOnce({
      data: {
        success: true,
        hasResearch: true,
        yours: [row, { broken: true }],
        targets: [row],
        competitors: [row],
        gaps: [{ keyword: 'invisalign kolkata', volumeText: '90 / month', competitor: 'Apollo Dental', competitorRank: 2 }, null],
        searchTerms: [{ keyword: 'dentist near me', impressions: 64 }],
        searchTermsMonth: '2026-10',
        research: { candidates: 312, withVolume: 140, rankChecked: 48, ranAt: '2026-11-01T00:00:00.000Z' },
        googleConnected: true,
      },
    });
    const d = await fetchKeywords();
    expect(mocked.get).toHaveBeenCalledWith('/api/keywords');
    expect(d.yours).toHaveLength(1);
    expect(d.yours[0].rankText).toBe('#6');
    expect(d.gaps).toHaveLength(1);
    expect(d.research?.candidates).toBe(312);
  });

  it('tolerates an empty / not-yet-researched business', async () => {
    mocked.get.mockResolvedValueOnce({ data: { success: true, hasResearch: false, yours: [], targets: [], competitors: [], gaps: [], searchTerms: [], research: null, googleConnected: false } });
    const d = await fetchKeywords();
    expect(d.hasResearch).toBe(false);
    expect(d.targets).toEqual([]);
  });

  it('pins through the same API as the website', async () => {
    mocked.post.mockResolvedValueOnce({ data: { success: true, pinned: true } });
    await expect(setKeywordPinned('kw:x', true)).resolves.toBe(true);
    expect(mocked.post).toHaveBeenCalledWith('/api/keywords', { action: 'pin', id: 'kw:x' });
  });

  it('looks up volumes (null = few searches) and labels them like the website', async () => {
    mocked.post.mockResolvedValueOnce({ data: { success: true, volumes: { 'braces kolkata': 260, 'kids dentist kolkata': null }, limited: false } });
    const v = await fetchKeywordVolumes(['braces kolkata', 'kids dentist kolkata']);
    expect(v).toEqual({ 'braces kolkata': 260, 'kids dentist kolkata': null });
    expect(volumeLabel(2400)).toBe('2,400/mo');
    expect(volumeLabel(null)).toBe('few searches');
    await expect(fetchKeywordVolumes([])).resolves.toEqual({});
  });
});

describe('KeywordCard', () => {
  it('shows the measured labels, #1 competitor and reason', async () => {
    const { getByText } = await render(<KeywordCard row={row as any} showRole />);
    expect(getByText('dental implants kolkata')).toBeTruthy();
    expect(getByText('590 / month')).toBeTruthy();
    expect(getByText('#6')).toBeTruthy();
    expect(getByText('Focus keyword')).toBeTruthy();
    expect(getByText('Quick win')).toBeTruthy();
    expect(getByText(/Apollo Dental/)).toBeTruthy();
    expect(getByText(/590 Google searches a month/)).toBeTruthy();
  });
});
