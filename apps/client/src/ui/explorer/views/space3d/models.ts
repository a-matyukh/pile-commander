import { Box3, Group, LoadingManager, Mesh, Vector3, type Material, type Object3D, type Skeleton, type SkinnedMesh, type Texture } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { limiter } from './limiter'

/**
 * Loading .glb/.gltf files. The Draco decoder is served from public/draco,
 * Meshopt's is built in: nothing comes from a CDN, so it works offline.
 * The Draco decoder (workers and WASM) lives while some 3D scene does.
 */
let draco: DRACOLoader | null = null
let scenes = 0

function draco_loader(): DRACOLoader {
	draco ??= new DRACOLoader().setDecoderPath(import.meta.env.BASE_URL + 'draco/')
	return draco
}

/** A 3D scene opened: the decoder may be needed */
export function retain_models() {
	scenes += 1
}

/** A 3D scene closed: with none left the decoder's workers go; a dispose()d decoder is not reused */
export function release_models() {
	scenes = Math.max(0, scenes - 1)
	if (scenes > 0 || !draco) return
	draco.dispose()
	draco = null
}

/** Models loading at once: each takes the network, a decoder and memory; the rest wait their turn */
const loads = limiter(3)

/**
 * `on_progress` gets the loaded share, or null while the size is unknown.
 * `signal` aborted: a model still waiting its turn is skipped, one on its
 * way stops downloading (each load has a loader and a manager of its own,
 * whose abort its requests listen to). The promise then rejects
 */
export async function load_model(url: string, on_progress: (share: number | null) => void, signal: AbortSignal): Promise<Object3D> {
	const gltf = await loads(async () => {
		const manager = new LoadingManager()
		const abort = () => manager.abort()
		signal.addEventListener('abort', abort)
		try {
			return await new GLTFLoader(manager)
				.setDRACOLoader(draco_loader())
				.setMeshoptDecoder(MeshoptDecoder)
				.loadAsync(url, event => {
					on_progress(event.lengthComputable && event.total ? event.loaded / event.total : null)
				})
		} finally {
			signal.removeEventListener('abort', abort)
		}
	}, () => !signal.aborted)
	if (!gltf) throw new Error('the model is no longer wanted')
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
	const skeletons = new Set<Skeleton>()
	root.traverse(object => {
		const mesh = object as Mesh
		if (!mesh.isMesh) return
		// an animated model's bones live in a texture of their own
		const skinned = object as SkinnedMesh
		if (skinned.isSkinnedMesh) skeletons.add(skinned.skeleton)
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
	for (const skeleton of skeletons) skeleton.dispose()
}
