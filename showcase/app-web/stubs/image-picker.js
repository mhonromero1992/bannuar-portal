// The camera and photo library in the showcase: a demo picture (window.__showcasePhotos, set by the
// capture script; an illustrated guard and an illustrated sample license, never a real person)
const pick = (kind) => async () => {
  const photos = window.__showcasePhotos || {};
  const uri = (kind === 'camera' ? photos.camera : photos.library) || photos.camera || '';
  await new Promise((r) => setTimeout(r, 300));
  return { assets: [{ uri, type: 'image/jpeg', fileName: `${kind}.jpg`, fileSize: 184320, width: 1080, height: 1440 }] };
};
export const launchCamera = pick('camera');
export const launchImageLibrary = pick('library');
export default { launchCamera, launchImageLibrary };
