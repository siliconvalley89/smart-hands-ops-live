const GOOGLE_FIELD_MASK = 'reviews,rating,userRatingCount,googleMapsUri';

function googleReviewsFromPlace(place) {
  const summary = place?.googleMapsUri
    ? { rating: place.rating ?? null, count: place.userRatingCount ?? null, url: place.googleMapsUri }
    : null;
  const reviews = (Array.isArray(place?.reviews) ? place.reviews : [])
    .filter((item) => Number.isInteger(item.rating) && (item.text?.text || item.originalText?.text))
    .map((item) => ({
      id: `google-${item.name || item.publishTime}`,
      name: item.authorAttribution?.displayName || 'Google user',
      company: '',
      rating: item.rating,
      text: item.text?.text || item.originalText?.text,
      createdAt: item.publishTime ? Date.parse(item.publishTime) : null,
      source: 'google',
      url: item.authorAttribution?.uri || place.googleMapsUri,
    }));
  return { reviews, summary };
}

async function fetchGooglePlace(apiKey, placeId) {
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': GOOGLE_FIELD_MASK },
  });
  if (!response.ok) {
    const detail = await response.json().then((body) => body?.error?.message).catch(() => '');
    throw new Error(`Google Places responded ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return response.json();
}

module.exports = { googleReviewsFromPlace, fetchGooglePlace };
