// The phone's GPS in the showcase: a fix at the demo post (San Juan, La Union), found after a moment
const POST = { latitude: 16.66912, longitude: 120.32218 };
const Geolocation = {
  setRNConfiguration() {},
  requestAuthorization(ok) { setTimeout(() => ok && ok(), 50); },
  getCurrentPosition(ok) {
    setTimeout(() => ok({ coords: { latitude: POST.latitude + 0.00031, longitude: POST.longitude + 0.00022, accuracy: 9, altitude: null, heading: null, speed: null }, timestamp: Date.now(), mocked: false }), 900);
  },
  watchPosition() { return 1; },
  clearWatch() {},
  stopObserving() {},
};
export default Geolocation;
