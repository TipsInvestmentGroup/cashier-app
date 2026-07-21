// The Universal Payroll Framework's SAFE formula evaluator (Phase 2). Payroll
// math is configuration, not code — a FORMULA-method PayComponent (or a
// PayrollFormula row) carries an expression string that is evaluated HERE against
// a per-employee variable namespace. This is NOT JavaScript eval: it is a fixed
// grammar (arithmetic, comparisons, boolean ops, a whitelisted function set) over
// named numeric variables — no property access, no host calls, no I/O, no way to
// reach anything outside the provided variable map. See docs/payroll-framework-design.md §7.
//
// Grammar (lowest → highest precedence):
//   or        := and ( "||" and )*
//   and       := equality ( "&&" equality )*
//   equality  := relational ( ("==" | "!=") relational )*
//   relational:= additive ( ("<" | "<=" | ">" | ">=") additive )*
//   additive  := multiplicative ( ("+" | "-") multiplicative )*
//   multiplicative := unary ( ("*" | "/" | "%") unary )*
//   unary     := ("-" | "!") unary | primary
//   primary   := number | ident | ident "(" args ")" | "(" or ")"
// Booleans are numbers: true = 1, false = 0; any non-zero value is truthy.

export class FormulaError extends Error {}

// ── Whitelisted functions. Each takes evaluated numeric args and returns a
// number. Adding a function is the ONLY way to extend the DSL. ──
const FUNCTIONS: Record<string, { arity: number | [number, number]; fn: (args: number[]) => number }> = {
  min: { arity: [1, 99], fn: (a) => Math.min(...a) },
  max: { arity: [1, 99], fn: (a) => Math.max(...a) },
  abs: { arity: 1, fn: (a) => Math.abs(a[0]) },
  round: { arity: [1, 2], fn: (a) => { const d = a[1] ?? 0; const f = Math.pow(10, d); return Math.round(a[0] * f) / f } },
  floor: { arity: 1, fn: (a) => Math.floor(a[0]) },
  ceil: { arity: 1, fn: (a) => Math.ceil(a[0]) },
  // if(cond, whenTrue, whenFalse) — cond is truthy when non-zero.
  if: { arity: 3, fn: (a) => (a[0] !== 0 ? a[1] : a[2]) },
  // clamp(x, lo, hi)
  clamp: { arity: 3, fn: (a) => Math.min(Math.max(a[0], a[1]), a[2]) },
  // prorate(amount, worked, total) — total<=0 ⇒ full amount (no proration).
  prorate: { arity: 3, fn: (a) => (a[2] > 0 ? (a[0] * Math.min(a[1], a[2])) / a[2] : a[0]) },
}

const RESERVED = new Set(['true', 'false'])

type Tok =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'comma' }

function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  const two = ['<=', '>=', '==', '!=', '&&', '||']
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }
    if (c === '(') { toks.push({ t: 'lp' }); i++; continue }
    if (c === ')') { toks.push({ t: 'rp' }); i++; continue }
    if (c === ',') { toks.push({ t: 'comma' }); i++; continue }
    // numbers (integer or decimal; no exponent — payroll amounts don't need it)
    if (c >= '0' && c <= '9') {
      let j = i + 1
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++
      const raw = src.slice(i, j)
      if ((raw.match(/\./g) || []).length > 1) throw new FormulaError(`Malformed number "${raw}"`)
      toks.push({ t: 'num', v: parseFloat(raw) })
      i = j
      continue
    }
    // identifiers (variables and function names): letter/underscore then word chars
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++
      toks.push({ t: 'id', v: src.slice(i, j) })
      i = j
      continue
    }
    const pair = src.slice(i, i + 2)
    if (two.includes(pair)) { toks.push({ t: 'op', v: pair }); i += 2; continue }
    if ('+-*/%<>!'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue }
    throw new FormulaError(`Unexpected character "${c}" at position ${i}`)
  }
  return toks
}

class Parser {
  private pos = 0
  constructor(private toks: Tok[], private vars: Record<string, number>) {}

  private peek(): Tok | undefined { return this.toks[this.pos] }
  private next(): Tok | undefined { return this.toks[this.pos++] }
  private expect(pred: (t: Tok | undefined) => boolean, msg: string) {
    if (!pred(this.peek())) throw new FormulaError(msg)
    return this.next()!
  }

  parse(): number {
    const v = this.parseOr()
    if (this.pos !== this.toks.length) throw new FormulaError('Unexpected trailing tokens in expression')
    return v
  }

  private isOp(v: string): boolean {
    const t = this.peek()
    return !!t && t.t === 'op' && t.v === v
  }

  private parseOr(): number {
    let left = this.parseAnd()
    while (this.isOp('||')) { this.next(); const r = this.parseAnd(); left = left !== 0 || r !== 0 ? 1 : 0 }
    return left
  }
  private parseAnd(): number {
    let left = this.parseEquality()
    while (this.isOp('&&')) { this.next(); const r = this.parseEquality(); left = left !== 0 && r !== 0 ? 1 : 0 }
    return left
  }
  private parseEquality(): number {
    let left = this.parseRelational()
    while (this.isOp('==') || this.isOp('!=')) {
      const op = (this.next() as { v: string }).v
      const r = this.parseRelational()
      left = op === '==' ? (left === r ? 1 : 0) : (left !== r ? 1 : 0)
    }
    return left
  }
  private parseRelational(): number {
    let left = this.parseAdditive()
    while (this.isOp('<') || this.isOp('<=') || this.isOp('>') || this.isOp('>=')) {
      const op = (this.next() as { v: string }).v
      const r = this.parseAdditive()
      left = op === '<' ? (left < r ? 1 : 0) : op === '<=' ? (left <= r ? 1 : 0) : op === '>' ? (left > r ? 1 : 0) : (left >= r ? 1 : 0)
    }
    return left
  }
  private parseAdditive(): number {
    let left = this.parseMultiplicative()
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.next() as { v: string }).v
      const r = this.parseMultiplicative()
      left = op === '+' ? left + r : left - r
    }
    return left
  }
  private parseMultiplicative(): number {
    let left = this.parseUnary()
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = (this.next() as { v: string }).v
      const r = this.parseUnary()
      if ((op === '/' || op === '%') && r === 0) throw new FormulaError('Division by zero')
      left = op === '*' ? left * r : op === '/' ? left / r : left % r
    }
    return left
  }
  private parseUnary(): number {
    if (this.isOp('-')) { this.next(); return -this.parseUnary() }
    if (this.isOp('!')) { this.next(); return this.parseUnary() === 0 ? 1 : 0 }
    return this.parsePrimary()
  }
  private parsePrimary(): number {
    const t = this.peek()
    if (!t) throw new FormulaError('Unexpected end of expression')
    if (t.t === 'num') { this.next(); return t.v }
    if (t.t === 'lp') {
      this.next()
      const v = this.parseOr()
      this.expect((x) => !!x && x.t === 'rp', 'Expected ")"')
      return v
    }
    if (t.t === 'id') {
      this.next()
      const name = t.v
      // function call?
      if (this.peek()?.t === 'lp') {
        this.next() // consume (
        const args: number[] = []
        if (this.peek()?.t !== 'rp') {
          args.push(this.parseOr())
          while (this.peek()?.t === 'comma') { this.next(); args.push(this.parseOr()) }
        }
        this.expect((x) => !!x && x.t === 'rp', `Expected ")" closing ${name}(`)
        const fn = FUNCTIONS[name]
        if (!fn) throw new FormulaError(`Unknown function "${name}"`)
        const [lo, hi] = Array.isArray(fn.arity) ? fn.arity : [fn.arity, fn.arity]
        if (args.length < lo || args.length > hi) throw new FormulaError(`${name}() expects ${Array.isArray(fn.arity) ? `${lo}–${hi}` : lo} argument(s), got ${args.length}`)
        return fn.fn(args)
      }
      // literal booleans
      if (name === 'true') return 1
      if (name === 'false') return 0
      // variable
      if (!(name in this.vars)) throw new FormulaError(`Unknown variable "${name}"`)
      const val = this.vars[name]
      if (typeof val !== 'number' || Number.isNaN(val)) throw new FormulaError(`Variable "${name}" is not a number`)
      return val
    }
    throw new FormulaError(`Unexpected token in expression`)
  }
}

/**
 * Evaluate a payroll expression against a variable namespace. Throws
 * FormulaError on any parse/eval problem (unknown var/function, bad syntax,
 * division by zero) — callers catch and mark the component errored, never crash
 * the whole payslip.
 */
export function evaluateExpression(expr: string, vars: Record<string, number>): number {
  if (!expr || !expr.trim()) throw new FormulaError('Empty expression')
  const result = new Parser(tokenize(expr), vars).parse()
  if (!Number.isFinite(result)) throw new FormulaError('Expression did not evaluate to a finite number')
  return result
}

/**
 * Static analysis: return the set of variable names an expression references
 * (identifiers that are not function names or boolean literals). Used for
 * dependency ordering and write-time validation. Never evaluates.
 */
export function extractVariables(expr: string): string[] {
  const out = new Set<string>()
  let toks: Tok[]
  try { toks = tokenize(expr) } catch { return [] }
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.t !== 'id') continue
    if (RESERVED.has(t.v)) continue
    // function name if immediately followed by "("
    if (toks[i + 1]?.t === 'lp' && FUNCTIONS[t.v]) continue
    out.add(t.v)
  }
  return [...out]
}

/** Validate an expression parses and only references allowed vars/functions.
 *  Returns null if valid, else the error message. */
export function validateExpression(expr: string, allowedVars: string[]): string | null {
  try {
    // Parse with every referenced var set to 1 so syntax/function checks run
    // without needing real values.
    const vars: Record<string, number> = {}
    for (const v of extractVariables(expr)) vars[v] = 1
    evaluateExpression(expr, vars)
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  if (allowedVars.length) {
    const unknown = extractVariables(expr).filter((v) => !allowedVars.includes(v))
    if (unknown.length) return `References unknown variable(s): ${unknown.join(', ')}`
  }
  return null
}
