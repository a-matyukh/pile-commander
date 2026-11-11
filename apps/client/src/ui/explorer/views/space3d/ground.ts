import { CircleGeometry, Mesh, ShaderMaterial, Vector2 } from 'three'

/**
 * The ground of the endless floor, for a horizon: a disc as far as the
 * camera sees, a shade darker than the background and a little denser
 * toward its edge. Where it ends, against the folder's background, is the
 * horizon, seen once the camera tilts toward it.
 */

const VERTEX = /* glsl */ `
varying vec2 v_floor;

void main() {
	vec4 world = modelMatrix * vec4(position, 1.0);
	v_floor = world.xz;
	gl_Position = projectionMatrix * viewMatrix * world;
}
`

const FRAGMENT = /* glsl */ `
uniform vec2 u_center;
uniform float u_radius;
varying vec2 v_floor;

void main() {
	float far = smoothstep(0.0, u_radius, distance(v_floor, u_center));
	gl_FragColor = vec4(0.06, 0.09, 0.16, mix(0.035, 0.09, far));
}
`

export type Ground = {
	mesh: Mesh
	/** Under the camera at (x, z), `radius` units out: just short of what it draws */
	aim(x: number, z: number, radius: number): void
	dispose(): void
}

export function create_ground(): Ground {
	const uniforms = { u_center: { value: new Vector2() }, u_radius: { value: 1 } }
	const material = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, transparent: true, depthWrite: false })
	const mesh = new Mesh(new CircleGeometry(1, 128), material)
	mesh.rotation.x = -Math.PI / 2
	mesh.position.y = -0.002
	// under the grid and the shadows
	mesh.renderOrder = -2
	mesh.frustumCulled = false
	return {
		mesh,
		aim(x, z, radius) {
			uniforms.u_center.value.set(x, z)
			uniforms.u_radius.value = radius
			mesh.position.x = x
			mesh.position.z = z
			mesh.scale.set(radius, radius, 1)
		},
		dispose() {
			mesh.geometry.dispose()
			material.dispose()
		},
	}
}
