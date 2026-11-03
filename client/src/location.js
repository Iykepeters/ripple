// Small promise wrapper around the browser's geolocation API.
export function getCoords({ maximumAge = 0, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Location is not supported on this device.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) =>
        reject(
          new Error(
            err.code === 1
              ? 'Location permission was denied, so Auto mode stayed off.'
              : 'Could not get your location. Please try again.'
          )
        ),
      { maximumAge, timeout, enableHighAccuracy: false }
    );
  });
}
