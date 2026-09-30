import { gpsFromPickerExif } from '@/lib/photoLocation';
import { geotagLine, postPlanLine, postStatusView } from '@/api/endpoints/content';

describe('gpsFromPickerExif', () => {
  it('reads iOS nested {GPS} EXIF', () => {
    expect(gpsFromPickerExif({ '{GPS}': { Latitude: 19.99751, LatitudeRef: 'N', Longitude: 73.78982, LongitudeRef: 'E' } })).toEqual({
      lat: 19.99751,
      lng: 73.78982,
    });
  });

  it('reads Android flat GPS tags as decimals or rationals, with hemispheres', () => {
    expect(gpsFromPickerExif({ GPSLatitude: 19.99751, GPSLatitudeRef: 'N', GPSLongitude: 73.78982, GPSLongitudeRef: 'E' })).toEqual({ lat: 19.99751, lng: 73.78982 });
    const r = gpsFromPickerExif({ GPSLatitude: '33/1,52/1,43020/10000', GPSLatitudeRef: 'S', GPSLongitude: '151/1,12/1,263520/10000', GPSLongitudeRef: 'W' });
    expect(r?.lat).toBeCloseTo(-33.86786, 4);
    expect(r?.lng).toBeCloseTo(-151.2073, 3);
  });

  it('returns null when there is no usable location — never invents one', () => {
    expect(gpsFromPickerExif(null)).toBeNull();
    expect(gpsFromPickerExif({ Make: 'Phone' })).toBeNull();
    expect(gpsFromPickerExif({ GPSLatitude: 0, GPSLongitude: 0 })).toBeNull();
    expect(gpsFromPickerExif({ GPSLatitude: 'garbage', GPSLongitude: 10 })).toBeNull();
  });
});

describe('post status wording', () => {
  it('only a Google-confirmed post is "Published"; blocked is "Not on Google"', () => {
    expect(postStatusView({ status: 'published', scheduledDate: null, failureReason: null, contentMeta: null }).label).toBe('Published');
    const b = postStatusView({ status: 'blocked', scheduledDate: '2026-10-01', failureReason: null, contentMeta: null });
    expect(b.label).toBe('Not on Google');
    expect(b.note).toMatch(/Google publishing has not been executed/);
    expect(postStatusView({ status: 'failed', scheduledDate: null, failureReason: 'PERMISSION_DENIED', contentMeta: null }).note).toBe('PERMISSION_DENIED');
    expect(postStatusView({ status: 'draft', scheduledDate: null, failureReason: null, contentMeta: { draftReason: 'failed the fact check' } }).label).toBe('Needs review');
  });

  it('plan line marks proposed keywords as not measured', () => {
    expect(postPlanLine({ contentMeta: { purpose: 'seo_theme', keyword: 'floor tiles nashik', keywordMeasured: false } })).toMatch(/proposed — not measured/);
    expect(postPlanLine({ contentMeta: null })).toBeNull();
  });

  it('geotag line states the source honestly', () => {
    expect(geotagLine({ status: 'photo_location_added', source: 'device_at_capture' })).toBe('Location: where the photo was taken');
    expect(geotagLine({ status: 'business_location_added' })).toBe('Location: your Google Business Profile location');
    expect(geotagLine(null)).toBeNull();
  });
});
