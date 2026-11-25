import { describe, expect, test } from 'vitest'
import { model_uris } from './modelRefs'

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

function glb(json: unknown, binary = new Uint8Array(8)): Uint8Array {
	const body = encode(json)
	const padded = new Uint8Array(Math.ceil(body.byteLength / 4) * 4).fill(0x20)
	padded.set(body)
	const out = new Uint8Array(12 + 8 + padded.byteLength + 8 + binary.byteLength)
	const view = new DataView(out.buffer)
	view.setUint32(0, 0x46546c67, true)
	view.setUint32(4, 2, true)
	view.setUint32(8, out.byteLength, true)
	view.setUint32(12, padded.byteLength, true)
	view.setUint32(16, 0x4e4f534a, true)
	out.set(padded, 20)
	view.setUint32(20 + padded.byteLength, binary.byteLength, true)
	view.setUint32(24 + padded.byteLength, 0x004e4942, true)
	out.set(binary, 28 + padded.byteLength)
	return out
}

describe('model_uris', () => {
	test('a .gltf names its buffers and images; what is inside the file is left out', () => {
		expect(model_uris(encode({
			buffers: [{ uri: 'scene.bin' }, { uri: 'data:application/octet-stream;base64,AAAA' }],
			images: [{ uri: 'https://evil.example/t.png' }, { bufferView: 0 }, { uri: ' //evil.example/u.png ' }],
		}))).toEqual(['scene.bin', 'https://evil.example/t.png', '//evil.example/u.png'])
	})

	test('a .glb is read from its JSON chunk', () => {
		expect(model_uris(glb({ buffers: [{ byteLength: 8 }], images: [{ uri: 'http://192.168.1.1/x.png' }] }))).toEqual(['http://192.168.1.1/x.png'])
		expect(model_uris(glb({ buffers: [{ byteLength: 8 }] }))).toEqual([])
	})

	test('something that is not a model names nothing', () => {
		expect(model_uris(new Uint8Array([1, 2, 3]))).toEqual([])
		expect(model_uris(encode('just a string'))).toEqual([])
		expect(model_uris(new Uint8Array())).toEqual([])
	})
})
