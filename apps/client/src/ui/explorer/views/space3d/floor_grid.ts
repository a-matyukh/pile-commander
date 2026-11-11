import { Mesh, PlaneGeometry, ShaderMaterial, Vector2, type Vector3 } from 'three'

/**
 * The endless floor: a grid with no edge, which melts away around the place
 * the camera looks at. The lines are worked out per pixel in the floor's own
 * coordinates, so they stay one pixel thin at any distance and line up with
 * the table's grid. The board's cells fade out where they get too dense to
 * read, and every fifth line carries on alone.
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
uniform float u_near;
uniform float u_far;
uniform float u_step;
uniform float u_width;
varying vec2 v_floor;

/* How much of this pixel the nearest line covers, for lines u_width px wide */
float lines(vec2 coord) {
	vec2 per_px = max(fwidth(coord), vec2(1e-6));
	vec2 off = abs(fract(coord - 0.5) - 0.5) / per_px;
	return clamp(u_width * 0.5 + 0.5 - min(off.x, off.y), 0.0, 1.0);
}

void main() {
	vec2 cell = v_floor / u_step;
	vec2 per_px = fwidth(cell);
	float cell_px = 1.0 / max(max(per_px.x, per_px.y), 1e-6);
	float minor = lines(cell) * smoothstep(5.0, 12.0, cell_px);
	float major = lines(cell / 5.0) * smoothstep(4.0, 10.0, cell_px * 5.0);
	float fade = 1.0 - smoothstep(u_near, u_far, distance(v_floor, u_center));
	float alpha = max(minor * 0.055, major * 0.085) * fade;
	if (alpha < 0.002) discard;
	gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
}
`

export type FloorGrid = {
	mesh: Mesh
	/**
	 * Centers the grid on what the camera looks at, `distance` away. The haze
	 * grows with the distance, so the floor has no edge at any zoom; `reach`
	 * is how far past the target the camera still draws, and the grid is gone
	 * before it
	 */
	aim(target: Vector3, distance: number, reach: number): void
	dispose(): void
}

/** `step`: one cell, scene units; `width`: a line, device px */
export function create_floor_grid(step: number, width: number): FloorGrid {
	const uniforms = {
		u_center: { value: new Vector2() },
		u_near: { value: 1 },
		u_far: { value: 2 },
		u_step: { value: step },
		u_width: { value: width },
	}
	const material = new ShaderMaterial({
		vertexShader: VERTEX,
		fragmentShader: FRAGMENT,
		uniforms,
		transparent: true,
		depthWrite: false,
	})
	const mesh = new Mesh(new PlaneGeometry(1, 1), material)
	mesh.rotation.x = -Math.PI / 2
	// under the items' shadows
	mesh.renderOrder = -1
	mesh.frustumCulled = false

	return {
		mesh,
		aim(target, distance, reach) {
			const far = Math.min(Math.max(4, distance * 2.4), reach * 0.9)
			const near = Math.min(Math.max(2, distance * 0.7), far * 0.5)
			uniforms.u_center.value.set(target.x, target.z)
			uniforms.u_near.value = near
			uniforms.u_far.value = far
			mesh.position.set(target.x, 0, target.z)
			mesh.scale.set(far * 2.2, far * 2.2, 1)
		},
		dispose() {
			mesh.geometry.dispose()
			material.dispose()
		},
	}
}
