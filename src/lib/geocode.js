export async function geocodeAddress(address) {
  const search = async (query) => {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
    const results = await response.json();
    return results && results.length > 0 ? results[0] : null;
  };

  // Floor/suite/unit details confuse the geocoder, so retry without them
  const unitPattern = /[,\s]*(?:#\s*\w+|\b(?:suite|ste|unit|apt|apartment|floor|fl|room|rm|bldg|building)\b\.?\s*#?\s*\w+|\b\d+(?:st|nd|rd|th)\s+floor\b)/gi;
  const unitParts = address.match(unitPattern) || [];
  const stripped = address.replace(unitPattern, '').replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim();

  let location = await search(address);
  let unitSuffix = '';
  if (!location && stripped && stripped !== address) {
    location = await search(stripped);
    unitSuffix = unitParts.map((part) => part.replace(/^[,\s]+/, '')).join(', ');
  }
  if (!location) {
    throw new Error('Unable to locate that address.');
  }
  return {
    lat: Number(location.lat),
    lng: Number(location.lon),
    displayName: unitSuffix ? `${unitSuffix}, ${location.display_name}` : location.display_name,
  };
}
