/**
 * The LL(1) language of the number fields: `25.4/2`, `width / 4`, `r * cos(a)`,
 * `i % 2 == 0`. `evaluateExpr` reads one and gives its value, or an ExprError
 * that says what is wrong with it.
 *
 * The language is implemented via a recursive descent parser. Spaces and tabs
 * are allowed between tokens:
 *
 *   <start>      ::= <or> EOF
 *   <or>         ::= <and> ( OR <and> )*
 *   <and>        ::= <not> ( AND <not> )*
 *   <not>        ::= NOT <not> | <comparison>
 *   <comparison> ::= <expr> ( <compare> <expr> )?
 *   <compare>    ::= EQEQ | NE | LT | LE | GT | GE
 *   <expr>       ::= <term> ( ( PLUS | MINUS ) <term> )*
 *   <term>       ::= <factor> ( ( STAR | SLASH | PERCENT ) <factor> )*
 *   <factor>     ::= ( PLUS | MINUS ) <factor>
 *                  | LPAREN <or> RPAREN
 *                  | NUMBER
 *                  | <named>
 *   <named>      ::= NAME ( LPAREN <args>? RPAREN )?
 *   <args>       ::= <or> ( COMMA <or> )*
 *
 * There is one function below for each production, in the same order.
 *
 * The tokens are the words OR, AND and NOT (`or`, `and`, `not`: so `order` is
 * a NAME); the operators EQEQ (==), NE (!=), LT, LE, GT, GE, PLUS,
 * MINUS, STAR, SLASH, PERCENT, LPAREN, COMMA and RPAREN, of which the longest
 * that fits is read (`<=`, not `<`); a NUMBER such as `3`, `2.5`, `4.` or
 * `.5`; and a NAME such as `width`: a letter or _ and then letters, digits and
 * _. A NAME followed by LPAREN is a call, and `true`, `false`, `pi` and the
 * variables are the other names. EOF is the end of the text.
 *
 * A value is either a number or a yes/no (a comparison, `true`, `false`, or
 * `and`, `or` or `not` of those).  `+` needs numbers. `and` needs yes/no
 * values.  A field wants one kind or the other (see `evaluateExpr`). The
 * grammar does not say which is which: the reader checks that as it goes.
 */

/**
 * Values for the names an expression may use.  A Map can be used as a
 * ReadonlyMap
 */
export type Vars = ReadonlyMap<string, number> | Readonly<Record<string, number>>;

/** Why an expression could not be evaluated, in words a person can act on */
export class ExprError extends Error {}

/**
 * The value of a name, or undefined if there is none. Only a plain object's own
 * properties count, so `constructor` and `toString` are not names.
 */
function lookup(vars: Vars, name: string): number | undefined {
  if (vars instanceof Map) return vars.get(name);
  return Object.hasOwn(vars, name) ? (vars as Readonly<Record<string, number>>)[name] : undefined;
}

/**
 * Round away the last digits of a trig result, so sin(30) is 0.5 and not
 * 0.49999999999999994
 */
function clean(v: number): number {
  return Math.round(v * 1e12) / 1e12;
}

/** Multiply degrees by this to get radians */
const RADIANS = Math.PI / 180;

/**
 * The functions an expression may call: how many numbers each takes (a range),
 * and what it does. Angles are in degrees. `min` and `max` take up to 8.  Many
 * take `[x]`, meaning "an array but I ignore all but the first element of the
 * array".
 */
const FUNCTIONS: Record<string, { min: number; max: number; run: (a: number[]) => number }> = {
  sqrt: { min: 1, max: 1, run: ([x]) => { if (x < 0) throw new ExprError("sqrt needs a number that is 0 or more"); return Math.sqrt(x); } },
  sin: { min: 1, max: 1, run: ([x]) => clean(Math.sin(x * RADIANS)) },
  cos: { min: 1, max: 1, run: ([x]) => clean(Math.cos(x * RADIANS)) },
  tan: { min: 1, max: 1, run: ([x]) => clean(Math.tan(x * RADIANS)) },
  abs: { min: 1, max: 1, run: ([x]) => Math.abs(x) },
  floor: { min: 1, max: 1, run: ([x]) => Math.floor(x) },
  ceil: { min: 1, max: 1, run: ([x]) => Math.ceil(x) },
  round: { min: 1, max: 1, run: ([x]) => Math.round(x) },
  min: { min: 1, max: 8, run: (a) => Math.min(...a) },
  max: { min: 1, max: 8, run: (a) => Math.max(...a) },
};

/** Reserved names (not available to use as variable names) */
export const RESERVED = new Set(["and", "or", "not", "true", "false", "pi", ...Object.keys(FUNCTIONS)]);

/**
 * Evaluator for the simple grammar defined at the top of this file.
 *
 * Throws ExprError, with a readable reason, for anything incomplete or invalid
 * (including division by zero), and for a number where a yes/no is wanted or
 * the other way around.
 *
 * Notes:
 * - A comparison allows for rounding, so `0.1 + 0.2 == 0.3` is true.
 * - A comparison produces a yes/no, not a number
 * - `%` is the remainder that is never negative for a positive divisor: `-7 %
 *   3` is 2.
 * - A number has no exponent (`1e3` is refused)
 *
 * @param src The expression.
 * @param vars The values of the names it may use (default: none).
 * @param want What the field needs: a number (the default) or a yes/no, which
 *             is given as 1 for yes and 0 for no.
 */
export function evaluateExpr(src: string, vars: Vars = {}, want: "number" | "truth" = "number"): number {
  const s = src.replace(/−/g, "-").replace(/×/g, "*").replace(/÷/g, "/");

  // How far through `s` the reader has got
  let i = 0;

  // Is the value just read a yes/no (and not a number)?
  let truth = false;

  /** Throw unless the value just read is a number */
  function needNumber(by: string) {
    if (truth) throw new ExprError(`${by} needs a number, but this is a yes/no (a comparison, true or false)`);
  }

  /** Throw unless the value just read is a yes/no */
  function needTruth(by: string) {
    if (!truth) throw new ExprError(`${by} needs a yes/no (a comparison such as x > 0, or true or false), but this is a number`);
  }

  /**
   * The next character that is not a space or tab (the reader moves past the
   * spaces)
   */
  function peek() {
    while (s[i] === " " || s[i] === "\t") i++;
    return s[i];
  }

  /**
   * True if the next thing is this word (not just the start of a longer name)
   */
  function isWord(w: string) {
    peek();
    return s.startsWith(w, i) && !/[A-Za-z0-9_]/.test(s[i + w.length] ?? "");
  }

  /** <start> ::= <or> EOF */
  function start(): number {
    const v = or();
    if (peek() !== undefined) throw new ExprError(`unexpected "${s.slice(i, i + 6).trim()}"`);
    return v;
  }

  /** <or> ::= <and> ( OR <and> )* */
  function or(): number {
    let v = and();
    while (isWord("or")) {
      needTruth('"or"');
      i += 2;
      const r = and();
      needTruth('"or"');
      v = v !== 0 || r !== 0 ? 1 : 0;
    }
    return v;
  }

  /** <and> ::= <not> ( AND <not> )* */
  function and(): number {
    let v = not();
    while (isWord("and")) {
      needTruth('"and"');
      i += 3;
      const r = not();
      needTruth('"and"');
      v = v !== 0 && r !== 0 ? 1 : 0;
    }
    return v;
  }

  /** <not> ::= NOT <not> | <comparison> */
  function not(): number {
    if (isWord("not")) {
      i += 3;
      const v = not();
      needTruth('"not"');
      return v === 0 ? 1 : 0;
    }
    return comparison();
  }

  /** <comparison> ::= <expr> ( <compare> <expr> )? */
  function comparison(): number {
    const v = expr();
    const op = compare();
    if (!op) return v;
    needNumber(`"${op}"`);
    i += op.length;
    const r = expr();
    needNumber(`"${op}"`);
    // only one comparison: `a < b < c` is written `a < b and b < c`
    if (compare()) throw new ExprError('a comparison cannot be chained: join the two with "and", as in a < b and b < c');
    // values this close count as equal, to allow for rounding
    const same = Math.abs(v - r) <= 1e-9 * Math.max(1, Math.abs(v), Math.abs(r));
    truth = true;
    return (op === "==" ? same : op === "!=" ? !same : op === "<" ? v < r && !same : op === ">" ? v > r && !same : op === "<=" ? v < r || same : v > r || same) ? 1 : 0;
  }

  /**
   * <compare> ::= EQEQ | NE | LT | LE | GT | GE
   *
   * Gives the operator next, or undefined if there is none. (It is not
   * consumed. A single = is an error: it is not an operator.)
   */
  function compare(): string | undefined {
    peek();
    const rest = s.slice(i);
    if (/^=(?!=)/.test(rest)) throw new ExprError("use == to compare two numbers (a single = is not an operator)");
    return /^(==|!=|<=|>=|<|>)/.exec(rest)?.[0];
  }

  /** <expr> ::= <term> ( ( PLUS | MINUS ) <term> )* */
  function expr(): number {
    let v = term();
    for (let c = peek(); c === "+" || c === "-"; c = peek()) {
      needNumber(`"${c}"`);
      i++;
      const r = term();
      needNumber(`"${c}"`);
      v = c === "+" ? v + r : v - r;
    }
    return v;
  }

  /** <term> ::= <factor> ( ( STAR | SLASH | PERCENT ) <factor> )* */
  function term(): number {
    let v = factor();
    for (let c = peek(); c === "*" || c === "/" || c === "%"; c = peek()) {
      needNumber(`"${c}"`);
      i++;
      const r = factor();
      needNumber(`"${c}"`);
      if ((c === "/" || c === "%") && r === 0) throw new ExprError("division by zero");
      v = c === "*" ? v * r : c === "/" ? v / r : v - r * Math.floor(v / r); // % is the remainder, never negative for a positive divisor
    }
    return v;
  }

  /**
   * <factor> ::= ( PLUS | MINUS ) <factor>
   *            | LPAREN <or> RPAREN
   *            | NUMBER
   *            | <named>
   */
  function factor(): number {
    const c = peek();
    if (c === undefined) throw new ExprError("incomplete: a number or variable is missing");
    if (c === "-") {
      i++;
      const v = factor();
      needNumber('"-"');
      return -v;
    }
    if (c === "+") {
      i++;
      const v = factor();
      needNumber('"+"');
      return v;
    }
    if (c === "(") {
      i++;
      const v = or();
      if (peek() !== ")") throw new ExprError("a closing ) is missing");
      i++;
      return v; // a ( ) group is whichever kind of value is inside it
    }
    const num = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      truth = false;
      return Number(num[0]);
    }
    return named();
  }

  /** <named> ::= NAME ( LPAREN <args>? RPAREN )? */
  function named(): number {
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i))?.[0];
    if (!word) throw new ExprError(`unexpected "${s.slice(i, i + 6).trim()}"`);
    i += word.length;
    if (peek() === "(") {
      // a call
      const fn = Object.hasOwn(FUNCTIONS, word) ? FUNCTIONS[word] : undefined;
      if (!fn) throw new ExprError(`unknown function "${word}" (the functions are ${Object.keys(FUNCTIONS).join(", ")})`);
      i++; // the (
      const values = peek() === ")" ? [] : args(word);
      if (peek() !== ")") throw new ExprError(`a closing ) is missing after ${word}(`);
      i++;
      if (values.length < fn.min || values.length > fn.max) {
        throw new ExprError(`${word} takes ${fn.min === fn.max ? `${fn.min} number${fn.min === 1 ? "" : "s"}` : `${fn.min} to ${fn.max} numbers`}, not ${values.length}`);
      }
      const result = fn.run(values);
      truth = false;
      return result;
    }
    if (word === "true" || word === "false") {
      truth = true;
      return word === "true" ? 1 : 0;
    }
    truth = false;
    if (word === "pi") return Math.PI;
    if (Object.hasOwn(FUNCTIONS, word)) throw new ExprError(`${word} is a function: it needs a ( after it, as in ${word}(...)`);
    if (RESERVED.has(word)) throw new ExprError(`unexpected "${word}"`);
    const v = lookup(vars, word);
    if (v === undefined) throw new ExprError(`unknown variable "${word}"`);
    return v;
  }

  /**
   * <args> ::= <or> ( COMMA <or> )*
   *
   * (`fn` is the function the values are for: each must be a number)
   */
  function args(fn: string): number[] {
    const values = [or()];
    needNumber(fn);
    while (peek() === ",") {
      i++;
      values.push(or());
      needNumber(fn);
    }
    return values;
  }

  const v = start();
  if (want === "truth" && !truth) throw new ExprError("this must be a yes/no: a comparison such as i % 2 == 0, or true or false");
  if (want === "number" && truth) throw new ExprError("this must be a number, but it is a yes/no (a comparison, true or false)");
  if (!Number.isFinite(v)) throw new ExprError("the result is not a finite number");
  return v;
}
