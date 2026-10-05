import { describe, expect, test } from "bun:test";
import { choose_download, download_ledger, type DownloadTarget } from "./blobs";

const WS = "11111111-1111-4111-8111-111111111111";
const BLOB = "abababab-abab-4bab-8bab-abababababab";

function target(overrides: Partial<DownloadTarget> = {}): DownloadTarget {
	return {
		owner_id: "22222222-2222-4222-8222-222222222222",
		storage_key: `${WS}/${BLOB}.png`,
		size_bytes: "3145728",
		is_member: false,
		deriv_key: `deriv/${WS}/${BLOB}/thumb.webp`,
		deriv_size_bytes: "204800",
		deriv_kind: "thumb",
		allow_download: true,
		...overrides,
	};
}

const ORIGINAL = {
	key: `${WS}/${BLOB}.png`,
	size_bytes: 3145728,
	gate_file_size: true,
	variant: "original",
} as const;

describe("choose_download", () => {
	test("a non-member gets the ready preview when previews are served, ungated at its own size", () => {
		expect(choose_download(target(), "serve")).toEqual({
			key: `deriv/${WS}/${BLOB}/thumb.webp`,
			size_bytes: 204800,
			gate_file_size: false,
			variant: "thumb",
		});
		expect(
			choose_download(
				target({ storage_key: `${WS}/${BLOB}.mp4`, deriv_key: `deriv/${WS}/${BLOB}/poster.jpg`, deriv_kind: "poster" }),
				"serve",
			),
		).toMatchObject({ key: `deriv/${WS}/${BLOB}/poster.jpg`, variant: "poster", gate_file_size: false });
	});

	test("members always get the original", () => {
		expect(choose_download(target({ is_member: true }), "serve")).toEqual(ORIGINAL);
	});

	test("without a preview a non-member gets the original through the size gate", () => {
		expect(choose_download(target({ deriv_key: null, deriv_size_bytes: null, deriv_kind: null }), "serve")).toEqual(
			ORIGINAL,
		);
	});

	test("generate and off never change what is signed", () => {
		expect(choose_download(target(), "generate")).toEqual(ORIGINAL);
		expect(choose_download(target(), "off")).toEqual(ORIGINAL);
	});

	test("an original on request skips a ready preview and keeps the size gate", () => {
		expect(choose_download(target(), "serve", true)).toEqual(ORIGINAL);
	});

	test("an original on request needs the author's Allow forks and downloads", () => {
		for (const mode of ["serve", "generate", "off"] as const) {
			expect(() => choose_download(target({ allow_download: false }), mode, true)).toThrow("download_not_allowed");
		}
		// members are not visitors: the flag is not theirs to pass
		expect(choose_download(target({ allow_download: false, is_member: true }), "serve", true)).toEqual(ORIGINAL);
		// viewing such a board is unchanged
		expect(choose_download(target({ allow_download: false }), "serve")).toMatchObject({ variant: "thumb" });
	});
});

describe("download_ledger", () => {
	test("members are never charged", () => {
		expect(download_ledger(target({ is_member: true }), false)).toBe("none");
		expect(download_ledger(target({ is_member: true }), true)).toBe("none");
	});

	test("viewing charges the owner, Download as .pile the downloader", () => {
		expect(download_ledger(target(), false)).toBe("owner");
		expect(download_ledger(target(), true)).toBe("downloader");
	});
});
