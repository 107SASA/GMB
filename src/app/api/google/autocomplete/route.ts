import { NextResponse } from 'next/server';
import { GooglePlacesService } from '@/services/google/places';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query) {
      return NextResponse.json({ success: true, data: [] });
    }

    const results = await GooglePlacesService.autocomplete(query);
    return NextResponse.json({ success: true, data: results });
  } catch (error: any) {
    console.error("Autocomplete API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
