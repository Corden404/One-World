export const COMPACT_MEDIA = '(pointer: coarse) and (max-width: 512px), (pointer: coarse) and (max-height: 768px)';

export function sceneAssets(scene, compact = false) {
  if (!compact) return scene;
  const mobile = path => path?.replace('./assets/', './assets/mobile/');
  return { ...scene, image: mobile(scene.image), darkImage: mobile(scene.darkImage), connector: mobile(scene.connector) };
}
