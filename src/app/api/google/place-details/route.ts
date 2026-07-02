import { NextResponse } from 'next/server';
import { GooglePlacesService } from '@/services/google/places';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const placeId = searchParams.get('placeId');

    if (!placeId) {
      return NextResponse.json({ success: false, error: 'Missing placeId' }, { status: 400 });
    }

    const details = await GooglePlacesService.getDetails(placeId);
    
    if (!details) {
      return NextResponse.json({ success: false, error: 'Details not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: details });
  } catch (error: any) {
    console.error("Place Details API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
