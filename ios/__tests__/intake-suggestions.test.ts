import { api } from '../src/api/client';
import { fetchIntake, saveIntake, suggestionKeywords, EMPTY_INTAKE } from '../src/api/endpoints/onboarding';

jest.mock('../src/api/client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
const mocked = api as unknown as { get: jest.Mock; post: jest.Mock };

describe('intake sourced suggestions (same as the web form)', () => {
  it('parses each known field and drops malformed or empty ones', async () => {
    mocked.get.mockResolvedValueOnce({
      data: {
        success: true,
        intakeCompleted: false,
        data: EMPTY_INTAKE,
        suggestions: {
          description: { value: 'Family bakery in Kasba.', source: 'website', sourceUrl: 'https://bake.example/about', label: 'From your website' },
          category: { value: 'Bakery', source: 'google_listing', label: 'From your Google listing' },
          services: { value: '', source: 'website', label: 'From your website' },
          offers: { value: '10% off', source: 'not_a_source', label: 'x' },
          keywords: { value: 'bakery kasba, cakes kolkata', source: 'seo_plan', label: 'From your SEO plan', items: [{ keyword: 'bakery kasba', source: 'measured' }, { keyword: '.', source: 'proposed' }] },
          somethingElse: { value: 'ignored', source: 'website', label: 'x' },
        },
      },
    });
    const r = await fetchIntake();
    expect(Object.keys(r.suggestions).sort()).toEqual(['category', 'description', 'keywords']);
    expect(r.suggestions.description?.sourceUrl).toBe('https://bake.example/about');
    expect(suggestionKeywords(r.suggestions.keywords!)).toEqual(['bakery kasba']);
  });

  it('survives a response with no suggestions', async () => {
    mocked.get.mockResolvedValueOnce({ data: { success: true, intakeCompleted: true, data: EMPTY_INTAKE } });
    const r = await fetchIntake();
    expect(r.suggestions).toEqual({});
    expect(r.intakeCompleted).toBe(true);
  });

  it('falls back to the comma-separated value when a keywords suggestion has no items', () => {
    expect(suggestionKeywords({ value: 'a b, 123, cakes', source: 'measured_report', label: '' })).toEqual(['a b', 'cakes']);
  });

  it('sends the used suggestions with the save', async () => {
    mocked.post.mockResolvedValueOnce({ data: { success: true } });
    await saveIntake(EMPTY_INTAKE, [{ field: 'description', source: 'website', sourceUrl: 'https://bake.example/about' }]);
    expect(mocked.post).toHaveBeenCalledWith('/api/onboarding/intake', {
      ...EMPTY_INTAKE,
      acceptedSuggestions: [{ field: 'description', source: 'website', sourceUrl: 'https://bake.example/about' }],
    });
  });
});
