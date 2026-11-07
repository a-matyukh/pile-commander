import { describe, expect, test } from 'vitest'
import { minimal_escape, protect_heading_end, protect_line_starts } from './escape'

describe('minimal_escape', () => {
	test('leaves text alone where markdown would read it the same', () => {
		for (const text of [
			'Note_1',
			'snake_case_name',
			'Привет_мир',
			'a < b',
			'a <',
			'AT&T',
			'5 * 3 = 15',
			'50% off!',
			'~5 min',
			'it`s',
			'C:\\path',
			'[draft]',
			'a] b',
			'#hashtag',
			'emoji 🎉',
		]) {
			expect(minimal_escape(text), text).toBe(text)
		}
	})

	test('escapes what would read as markup', () => {
		expect(minimal_escape('*not em*')).toBe('\\*not em\\*')
		expect(minimal_escape('2*3*4')).toBe('2\\*3\\*4')
		expect(minimal_escape('_init_')).toBe('\\_init\\_')
		expect(minimal_escape('`a`')).toBe('\\`a\\`')
		expect(minimal_escape('~~s~~')).toBe('\\~\\~s\\~\\~')
		expect(minimal_escape('[a](b)')).toBe('\\[a](b)')
		expect(minimal_escape('[a]: x')).toBe('\\[a]: x')
		expect(minimal_escape('[a][b]')).toBe('\\[a][b]')
		expect(minimal_escape('<b>')).toBe('&lt;b>')
		expect(minimal_escape('<!-- x -->')).toBe('&lt;!-- x -->')
		expect(minimal_escape('&copy;')).toBe('&amp;copy;')
		expect(minimal_escape('&#169;')).toBe('&amp;#169;')
		// A backslash before punctuation doubles; the star after it is escaped too.
		expect(minimal_escape('\\*')).toBe('\\\\\\*')
	})

	test('a lone backtick or tilde at the start of the text stays bare', () => {
		expect(minimal_escape('~70k / s')).toBe('~70k / s')
		expect(minimal_escape('`x')).toBe('`x')
	})

	test('inside a link every bracket is escaped', () => {
		expect(minimal_escape('a [b] c', true)).toBe('a \\[b\\] c')
		expect(minimal_escape('a ] b', true)).toBe('a \\] b')
	})
})

describe('protect_line_starts', () => {
	test('a line that would open a block gets a backslash', () => {
		expect(protect_line_starts('# x')).toBe('\\# x')
		expect(protect_line_starts('###')).toBe('\\###')
		expect(protect_line_starts('- x')).toBe('\\- x')
		expect(protect_line_starts('+ x')).toBe('\\+ x')
		expect(protect_line_starts('* x')).toBe('\\* x')
		expect(protect_line_starts('1. x')).toBe('1\\. x')
		expect(protect_line_starts('2) x')).toBe('2\\) x')
		expect(protect_line_starts('2024. A year')).toBe('2024\\. A year')
		expect(protect_line_starts('>_<')).toBe('\\>_<')
		expect(protect_line_starts('> x')).toBe('\\> x')
		expect(protect_line_starts('===')).toBe('\\===')
		expect(protect_line_starts('---')).toBe('\\---')
		expect(protect_line_starts('a\n- b\n1. c')).toBe('a\n\\- b\n1\\. c')
	})

	test('leading whitespace becomes an entity, so a Tab survives', () => {
		expect(protect_line_starts('\tTabbed')).toBe('&#9;Tabbed')
		expect(protect_line_starts('    four')).toBe('&#32;   four')
		expect(protect_line_starts('a\n\tb')).toBe('a\n&#9;b')
	})

	test('leaves ordinary line starts alone', () => {
		for (const line of ['#hashtag', '-1 degree', '1.5 kg', '[ ] not a task here', '*bold*', 'text']) {
			expect(protect_line_starts(line), line).toBe(line)
		}
	})
})

describe('protect_heading_end', () => {
	test('a closing # run is escaped, C# is not', () => {
		expect(protect_heading_end('Title #')).toBe('Title \\#')
		expect(protect_heading_end('Title ##  ')).toBe('Title \\##  ')
		expect(protect_heading_end('C#')).toBe('C#')
		expect(protect_heading_end('#')).toBe('\\#')
	})
})
