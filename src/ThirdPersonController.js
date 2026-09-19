import * as THREE from 'three';

const MOVE_SPEED = 4.2; // meters/second
const TURN_SPEED = 10; // how fast the character rotates to face its movement direction
const MOUSE_SENSITIVITY = 0.0025;
const MIN_PITCH = -0.15; // radians, looking slightly upward
const MAX_PITCH = 1.3; // radians, looking down at the character
const MIN_DISTANCE = 2.5;
const MAX_DISTANCE = 8;

const KEY_TO_AXIS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'backward',
  ArrowDown: 'backward',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

/**
 * Orbit-follow third person controller: mouse orbits the camera around the
 * character (yaw + pitch), WASD moves the character relative to the camera's
 * current facing, and the character smoothly turns to face its heading.
 */
export class ThirdPersonController {
  constructor(camera, character, domElement) {
    this.camera = camera;
    this.character = character;
    this.domElement = domElement;

    this.input = { forward: false, backward: false, left: false, right: false };
    this.yaw = 0;
    this.pitch = 0.45;
    this.distance = 5;

    this._moveDir = new THREE.Vector3();
    this._camOffset = new THREE.Vector3();
    this._targetQuat = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onWheel = this._onWheel.bind(this);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    domElement.addEventListener('wheel', this._onWheel, { passive: true });

    this._updateCamera();
  }

  get isLocked() {
    return document.pointerLockElement === this.domElement;
  }

  _onKeyDown(e) {
    const axis = KEY_TO_AXIS[e.code];
    if (axis) this.input[axis] = true;
  }

  _onKeyUp(e) {
    const axis = KEY_TO_AXIS[e.code];
    if (axis) this.input[axis] = false;
  }

  _onMouseMove(e) {
    if (!this.isLocked) return;
    this.yaw -= e.movementX * MOUSE_SENSITIVITY;
    this.pitch -= e.movementY * MOUSE_SENSITIVITY;
    this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch));
  }

  _onWheel(e) {
    this.distance += e.deltaY * 0.003;
    this.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, this.distance));
  }

  update(delta) {
    this._updateMovement(delta);
    this._updateCamera();
  }

  _updateMovement(delta) {
    const { forward, backward, left, right } = this.input;
    this._moveDir.set(0, 0, 0);
    if (forward) this._moveDir.z -= 1;
    if (backward) this._moveDir.z += 1;
    if (left) this._moveDir.x -= 1;
    if (right) this._moveDir.x += 1;

    if (this._moveDir.lengthSq() === 0) return;

    this._moveDir.normalize().applyAxisAngle(this._up, this.yaw);
    this.character.position.addScaledVector(this._moveDir, MOVE_SPEED * delta);

    const targetYaw = Math.atan2(this._moveDir.x, this._moveDir.z);
    this._targetQuat.setFromAxisAngle(this._up, targetYaw);
    this.character.quaternion.slerp(this._targetQuat, 1 - Math.exp(-TURN_SPEED * delta));
  }

  _updateCamera() {
    const horizontalRadius = this.distance * Math.cos(this.pitch);
    this._camOffset.set(
      Math.sin(this.yaw) * horizontalRadius,
      this.distance * Math.sin(this.pitch) + 1.1,
      Math.cos(this.yaw) * horizontalRadius
    );

    const target = this.character.position.clone().add(new THREE.Vector3(0, 1.3, 0));
    this.camera.position.copy(target).add(this._camOffset);
    this.camera.lookAt(target);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    this.domElement.removeEventListener('wheel', this._onWheel);
  }
}
