import { Box3, Group, Mesh, Vector3, type Material, type Object3D, type Texture } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

/**
 * Loading .glb/.gltf files. The Draco decoder is served from public/draco,
 * Meshopt's is built in: nothing comes from a CDN, so it works offline.
 */
let loader: GLTFLoader | null = null

function gltf_loader(): GLTFLoader {
	if (!loader) {
		const draco = new DRACOLoader().setDecoderPath(import.meta.env.BASE_URL + 'draco/')
		loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder)
	}
	return loader
}

/** `on_progress` gets the loaded share, or null while the size is unknown */
export async function load_model(url: string, on_progress: (share: number | null) => void): Promise<Object3D> {
	const gltf = await gltf_loader().loadAsync(url, event => {
		on_progress(event.lengthComputable && event.total ? event.loaded / event.total : null)
	})
	return gltf.scene
}

/**
 * Puts a model on the floor of a w×d box (scene units): centered, its bottom
 * at y = 0, as large as fits and at most `max_h` tall. Returns the holder to
 * add and the model's size after fitting.
 */
export function fit_model(model: Object3D, w: number, d: number, max_h: number): { holder: Group; size: Vector3 } {
	model.updateMatrixWorld(true)
	const box = new Box3().setFromObject(model)
	const size = box.getSize(new Vector3())
	const center = box.getCenter(new Vector3())
	const k = Math.min((w * 0.9) / Math.max(size.x, 1e-6), (d * 0.9) / Math.max(size.z, 1e-6), max_h / Math.max(size.y, 1e-6))
	model.position.sub(new Vector3(center.x, box.min.y, center.z))
	const holder = new Group()
	holder.add(model)
	holder.scale.setScalar(k)
	return { holder, size: size.multiplyScalar(k) }
}

/** Frees the GPU memory of everything under `root` */
export function dispose_tree(root: Object3D) {
	const textures = new Set<Texture>()
	root.traverse(object => {
		const mesh = object as Mesh
		if (!mesh.isMesh) return
		mesh.geometry.dispose()
		const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
		for (const material of materials) {
			for (const value of Object.values(material)) {
				if (value && (value as Texture).isTexture) textures.add(value as Texture)
			}
			material.dispose()
		}
	})
	for (const texture of textures) texture.dispose()
}
