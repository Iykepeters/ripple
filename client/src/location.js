// Promise wrapper around the browser's geolocation API.
// Tries a fast network-based fix first, then falls back to a slower GPS fix.

function request(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      reject,
      options
    );
  });
}

const DENIED = 'Location permission was denied, so Auto mode stayed off.';

export async function getCoords({
  maximumAge = 10 * 60 * 1000,
  timeout = 20000,
  fallback = true
} = {}) {
  if (!('geolocation' in navigator)) {
    throw new Error('Location is not supported on this device.');
  }

  try {
    // Attempt 1: Wi-Fi / mobile-network position. A fix from the last 10 minutes is fine.
    return await request({ enableHighAccuracy: false, maximumAge, timeout });
  } catch (err) {
    if (err.code === 1) throw new Error(DENIED);
    if (!fallback) throw new Error('Could not get your location.');
  }

  try {
    // Attempt 2: ask for a GPS fix. Slower, but works when network positioning fails.
    return await request({ enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  } catch (err) {
    if (err.code === 1) throw new Error(DENIED);
    if (err.code === 3) {
      throw new Error('Finding your location took too long. Try near a window or outside, then tap Auto again.');
    }
    throw new Error('Your phone could not work out its location. Check that Location is switched on in your phone settings.');
  }
}