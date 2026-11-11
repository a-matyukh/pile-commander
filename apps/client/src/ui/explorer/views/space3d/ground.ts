import { BackSide, CircleGeometry, Mesh, ShaderMaterial, SphereGeometry, Vector2 } from 'three'

/**
 * Open country around the endless floor, for a horizon: a sky that lightens
 * toward the horizon, and the ground as far as the camera sees, which melts
 * into the same haze there. No hard line where floor and sky meet: that
 * reads as the corner of a room, not as distance.
 */

/** sRGB 0–1: the haze at the horizon, the sky overhead, the ground under the camera */
const HAZE = 'vec3(0.965, 0.969, 0.973)'
const SKY = 'vec3(0.800, 0.866, 0.945)'
const NEAR = 'vec3(0.902, 0.898, 0.886)'

const GROUND_VERTEX = /* glsl */ `
varying vec2 v_floor;

void main() {
	vec4 world = modelMatrix * vec4(position, 1.0);
	v_floor = world.xz;
	gl_Position = projectionMatrix * viewMatrix * world;
}
`

const GROUND_FRAGMENT = /* glsl */ `
uniform vec2 u_center;
uniform float u_radius;
varying vec2 v_floor;

void main() {
	// most of the way out the ground is already haze: the horizon is soft
	float far = smoothstep(0.0, u_radius * 0.55, distance(v_floor, u_center));
	gl_FragColor = vec4(mix(${NEAR}, ${HAZE}, pow(far, 0.6)), 1.0);
}
`

const SKY_VERTEX = /* glsl */ `
varying vec3 v_dir;

void main() {
	v_dir = normalize(position);
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const SKY_FRAGMENT = /* glsl */ `
varying vec3 v_dir;

void main() {
	float up = smoothstep(0.0, 0.2, v_dir.y);
	gl_FragColor = vec4(mix(${HAZE}, ${SKY}, up), 1.0);
}
`

export type Ground = {
	meshes: Mesh[]
	/** Around the camera at (x, z), `radius` units out: just short of what it draws */
	aim(x: number, y: number, z: number, radius: number): void
	dispose(): void
}

export function create_ground(): Ground {
	const uniforms = { u_center: { value: new Vector2() }, u_radius: { value: 1 } }
	const ground_material = new ShaderMaterial({ vertexShader: GROUND_VERTEX, fragmentShader: GROUND_FRAGMENT, uniforms, depthWrite: false })
	const ground = new Mesh(new CircleGeometry(1, 128), ground_material)
	ground.rotation.x = -Math.PI / 2
	ground.position.y = -0.002
	// under the grid, the shadows and everything else
	ground.renderOrder = -2
	ground.frustumCulled = false

	const sky_material = new ShaderMaterial({ vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: BackSide, depthWrite: false, depthTest: false })
	const sky = new Mesh(new SphereGeometry(1, 48, 24), sky_material)
	sky.renderOrder = -3
	sky.frustumCulled = false

	return {
		meshes: [sky, ground],
		aim(x, y, z, radius) {
			uniforms.u_center.value.set(x, z)
			uniforms.u_radius.value = radius
			ground.position.x = x
			ground.position.z = z
			ground.scale.set(radius, radius, 1)
			sky.position.set(x, y, z)
			sky.scale.setScalar(radius)
		},
		dispose() {
			ground.geometry.dispose()
			ground_material.dispose()
			sky.geometry.dispose()
			sky_material.dispose()
		},
	}
}
