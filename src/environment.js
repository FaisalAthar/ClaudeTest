import * as THREE from 'three';

/**
 * Builds a minimal empty test environment: a flat ground plane with a grid
 * for spatial reference, sky-colored background/fog, and basic lighting.
 */
export function buildEnvironment(scene) {
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 40, 220);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x445544, 2.2);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
  sunLight.position.set(30, 45, 20);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -60;
  sunLight.shadow.camera.right = 60;
  sunLight.shadow.camera.top = 60;
  sunLight.shadow.camera.bottom = -60;
  sunLight.shadow.camera.far = 150;
  scene.add(sunLight);

  const fillLight = new THREE.DirectionalLight(0xbfd4ff, 0.8);
  fillLight.position.set(-20, 15, -25);
  scene.add(fillLight);

  const groundSize = 300;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshStandardMaterial({ color: 0x3f8f4f, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(groundSize, groundSize / 2, 0x1f5c2b, 0x2c6e3a);
  grid.position.y = 0.01;
  scene.add(grid);

  return { ground };
}
