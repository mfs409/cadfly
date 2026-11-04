import { describe, expect, test } from "vitest";
import { ExprError, RESERVED, type Vars, evaluateExpr } from "../src/cadfly/geometry/expr";

/** Like evaluateExpr, but NaN instead of an ExprError: what a field being typed into needs (an incomplete expression is not an error yet) */
function evalExpr(src: string, vars?: Vars): number {
  try {
    return evaluateExpr(src, vars);
  } catch (e) {
    if (e instanceof ExprError) return NaN;
    throw e;
  }
}

test("plain numbers", () => {
  expect(evalExpr("12")).toBe(12);
  expect(evalExpr("0.5")).toBe(0.5);
  expect(evalExpr(".5")).toBe(0.5);
  expect(evalExpr("25.")).toBe(25); // still being typed
  expect(evalExpr(" 7 ")).toBe(7);
});

test("operators and precedence", () => {
  expect(evalExpr("2+3*4")).toBe(14);
  expect(evalExpr("(2+3)*4")).toBe(20);
  expect(evalExpr("25.4/2")).toBeCloseTo(12.7);
  expect(evalExpr("10-4-3")).toBe(3);
  expect(evalExpr("12/4/3")).toBe(1);
});

test("unary signs and keypad symbols", () => {
  expect(evalExpr("-5")).toBe(-5);
  expect(evalExpr("3*-2")).toBe(-6);
  expect(evalExpr("--4")).toBe(4);
  expect(evalExpr("6×3−1")).toBe(17);
  expect(evalExpr("9÷3")).toBe(3);
});

test("incomplete or invalid input is NaN", () => {
  for (const bad of ["", "2+", "(", "(2", "2)", "abc", "1/0", "1..2", "*3"]) {
    expect(evalExpr(bad), bad).toBeNaN();
  }
});

test("variables, from a Map or an object", () => {
  expect(evalExpr("width / 4", { width: 40 })).toBe(10);
  expect(evalExpr("a + b*2", new Map([["a", 1], ["b", 3]]))).toBe(7);
  expect(evalExpr("w_1 - 1", { w_1: 5 })).toBe(4);
  expect(evalExpr("-x", { x: 3 })).toBe(-3);
});

test("pi is built in", () => {
  expect(evalExpr("2*pi")).toBeCloseTo(2 * Math.PI);
});

test("an unknown variable is not a number", () => {
  expect(evalExpr("width")).toBeNaN();
  expect(evalExpr("width + 1", { w: 1 })).toBeNaN();
});

test("words are not glued together across spaces", () => {
  expect(evalExpr("wid th", { width: 4 })).toBeNaN();
  expect(evalExpr("2 3")).toBeNaN();
  expect(evalExpr("  7  ")).toBe(7);
  expect(evalExpr("2 * ( 3 + 4 )")).toBe(14);
});

describe("evaluateExpr explains what is wrong", () => {
  const why = (src: string, vars = {}) => {
    try {
      evaluateExpr(src, vars);
    } catch (e) {
      expect(e).toBeInstanceOf(ExprError);
      return (e as Error).message;
    }
    return "no error";
  };

  test("messages", () => {
    expect(why("")).toMatch(/missing/);
    expect(why("2+")).toMatch(/missing/);
    expect(why("(2")).toMatch(/closing \)/);
    expect(why("2)")).toMatch(/unexpected "\)"/);
    expect(why("width")).toBe('unknown variable "width"');
    expect(why("1/0")).toBe("division by zero");
    expect(why("1/(2-2)")).toBe("division by zero");
    expect(why("2 3")).toMatch(/unexpected "3"/);
    expect(why("4 $")).toMatch(/unexpected "\$"/);
  });
});

describe("functions and the remainder", () => {
  test("square root, and trig in degrees", () => {
    expect(evalExpr("sqrt(16)")).toBe(4);
    expect(evalExpr("40 / sqrt(2)")).toBeCloseTo(28.2842712);
    expect(evalExpr("sin(30)")).toBe(0.5);
    expect(evalExpr("cos(60)")).toBe(0.5);
    expect(evalExpr("cos(90)")).toBe(0);
    expect(evalExpr("tan(45)")).toBe(1);
    expect(evalExpr("2 * sin(90) + cos(0)")).toBe(3);
  });

  test("rounding, absolute value, smallest and largest", () => {
    expect(evalExpr("floor(2.7)")).toBe(2);
    expect(evalExpr("ceil(2.1)")).toBe(3);
    expect(evalExpr("round(2.5)")).toBe(3);
    expect(evalExpr("abs(0 - 4)")).toBe(4);
    expect(evalExpr("min(3, 1, 2)")).toBe(1);
    expect(evalExpr("max(3, 1+5)")).toBe(6);
  });

  test("functions nest and mix with variables", () => {
    expect(evalExpr("r * cos(i * 360 / n)", { r: 10, i: 1, n: 4 })).toBe(0);
    expect(evalExpr("max(sqrt(w), 1)", { w: 9 })).toBe(3);
    expect(evalExpr("-sqrt(4)")).toBe(-2);
  });

  test("the remainder is for 'every other one'", () => {
    expect(evalExpr("7 % 3")).toBe(1);
    expect(evalExpr("i % 2", { i: 5 })).toBe(1);
    expect(evalExpr("-1 % 3")).toBe(2);
    expect(evalExpr("2 + 7 % 4 * 2")).toBe(8); // % binds like * and /
    expect(evalExpr("5 % 0")).toBeNaN();
  });

  test("what is wrong with a call is said", () => {
    const why = (src: string) => {
      try {
        evaluateExpr(src);
      } catch (e) {
        expect(e).toBeInstanceOf(ExprError);
        return (e as Error).message;
      }
      throw new Error("expected an error");
    };
    expect(why("sqrt(0-4)")).toMatch(/0 or more/);
    expect(why("sqrt(1, 2)")).toMatch(/sqrt takes 1 number, not 2/);
    expect(why("sqrt()")).toMatch(/sqrt takes 1 number, not 0/);
    expect(why("min()")).toMatch(/min takes 1 to 8 numbers/);
    expect(why("cube(3)")).toMatch(/unknown function "cube"/);
    expect(why("sqrt(4")).toMatch(/closing \)/);
    expect(why("width(3)")).toMatch(/unknown function "width"/);
  });
});

/** Like evalExpr, for a field that wants a yes/no: 1 or 0, or NaN for an incomplete expression */
function evalTruth(src: string, vars?: Vars): number {
  try {
    return evaluateExpr(src, vars, "truth");
  } catch (e) {
    if (e instanceof ExprError) return NaN;
    throw e;
  }
}

describe("comparisons and logic", () => {
  test("a comparison is 1 when true and 0 when false", () => {
    expect(evalTruth("3 < 4")).toBe(1);
    expect(evalTruth("4 < 3")).toBe(0);
    expect(evalTruth("4 <= 4")).toBe(1);
    expect(evalTruth("5 > 4")).toBe(1);
    expect(evalTruth("4 >= 5")).toBe(0);
    expect(evalTruth("2 + 2 == 4")).toBe(1);
    expect(evalTruth("2 != 3")).toBe(1);
    expect(evalTruth("2 != 2")).toBe(0);
  });

  test("a single = is not an operator, and says to use ==", () => {
    expect(() => evaluateExpr("2 = 2")).toThrow(/use ==/);
    expect(() => evaluateExpr("i % 2 = 0", { i: 1 })).toThrow(/use ==/);
  });

  test("comparisons do not chain: 3 > 2 > 1 would be (1) > 1, so it is refused, and says to use and", () => {
    expect(() => evaluateExpr("1 < 2 < 3", {}, "truth")).toThrow(/cannot be chained.*and/);
    expect(() => evaluateExpr("3 > 2 > 1", {}, "truth")).toThrow(/cannot be chained/);
    expect(() => evaluateExpr("1 == 1 == 1", {}, "truth")).toThrow(/cannot be chained/);
    expect(evaluateExpr("1 < 2 and 2 < 3", {}, "truth")).toBe(1);
    expect(() => evaluateExpr("(1 < 2) < 3", {}, "truth")).toThrow(/needs a number/); // a yes/no is not a number
  });

  test("equality ignores the tiny error in sums like 0.1 + 0.2", () => {
    expect(evalTruth("0.1 + 0.2 == 0.3")).toBe(1);
    expect(evalTruth("0.1 + 0.2 < 0.3")).toBe(0);
    expect(evalTruth("sin(30) == 0.5")).toBe(1);
  });

  test("and, or, not, with the usual order", () => {
    expect(evalTruth("true and true")).toBe(1);
    expect(evalTruth("true and false")).toBe(0);
    expect(evalTruth("false or true")).toBe(1);
    expect(evalTruth("false or false")).toBe(0);
    expect(evalTruth("not false")).toBe(1);
    expect(evalTruth("not true")).toBe(0);
    expect(evalTruth("not true and false")).toBe(0); // (not true) and false
    expect(evalTruth("true or false and false")).toBe(1); // and binds tighter than or
    expect(evalTruth("not (true and false)")).toBe(1);
    expect(evalTruth("3 > 2 and 2 > 1")).toBe(1);
    expect(evalTruth("i % 2 == 0 or i == 5", { i: 5 })).toBe(1);
  });

  test("they work with variables and inside functions", () => {
    expect(evalTruth("n > 1", { n: 3 })).toBe(1);
    expect(evalTruth("n > 1 and n < max(5, 2)", { n: 3 })).toBe(1);
    expect(evalTruth("abs(w - 30) < 15", { w: 20 })).toBe(1);
  });

  test("words that only look like the operators are still names", () => {
    expect(evalExpr("order + 1", { order: 4 })).toBe(5);
    expect(evalExpr("android * 2", { android: 4 })).toBe(8);
    expect(evalExpr("nothing", { nothing: 3 })).toBe(3);
  });

  test("the operator words cannot be used as variables, and a dangling operator is not a number", () => {
    expect(evalTruth("and")).toBeNaN();
    expect(evalTruth("true and")).toBeNaN();
    expect(evalTruth("1 <")).toBeNaN();
    expect(evalTruth("not")).toBeNaN();
  });
});

test("only a plain object's own properties are names, not inherited ones", () => {
  expect(() => evaluateExpr("constructor", {})).toThrow(/unknown variable "constructor"/);
  expect(() => evaluateExpr("toString + 1", {})).toThrow(/unknown variable "toString"/);
  expect(evaluateExpr("width * 2", { width: 5 })).toBe(10);
});

test("an inherited name is not a function either", () => {
  expect(() => evaluateExpr("constructor(1)")).toThrow(/unknown function "constructor"/);
});

test("a function name on its own is not a variable: it says it needs a (", () => {
  expect(() => evaluateExpr("max + 1", { max: 5 })).toThrow(/max is a function/);
  expect(() => evaluateExpr("sin")).toThrow(/sin is a function/);
});

test("the names a variable may not have are the words, true, false, pi and the functions", () => {
  for (const name of ["and", "or", "not", "true", "false", "pi", "sqrt", "sin", "cos", "tan", "abs", "floor", "ceil", "round", "min", "max"]) {
    expect(RESERVED.has(name), name).toBe(true);
  }
  expect(RESERVED.has("width")).toBe(false);
});

describe("a value is a number or a yes/no, and the two are not mixed", () => {
  const truth = (src: string, vars?: Vars) => evaluateExpr(src, vars, "truth");

  test("a field that wants a yes/no takes comparisons, true, false, and and/or/not of them", () => {
    expect(truth("1 < 2")).toBe(1);
    expect(truth("true")).toBe(1);
    expect(truth("false")).toBe(0);
    expect(truth("not false")).toBe(1);
    expect(truth("i % 2 == 0 or i == 5", { i: 5 })).toBe(1);
    expect(truth("(1 < 2) and (3 < 4)")).toBe(1);
    expect(truth("(1 + 2) < 4")).toBe(1);
    expect(truth("not (1 < 2 and false)")).toBe(1);
  });

  test("a number is not a yes/no, and the message says to use a comparison", () => {
    expect(() => truth("5")).toThrow(/must be a yes\/no.*comparison/);
    expect(() => truth("i % 2", { i: 1 })).toThrow(/must be a yes\/no/);
    expect(() => truth("(1 + 2)")).toThrow(/must be a yes\/no/);
    expect(() => truth("sin(30)")).toThrow(/must be a yes\/no/);
  });

  test("a yes/no is not a number, in a field or in arithmetic", () => {
    expect(() => evaluateExpr("1 < 2")).toThrow(/must be a number/);
    expect(() => evaluateExpr("true")).toThrow(/must be a number/);
    expect(() => evaluateExpr("(1 < 2) + 1")).toThrow(/"\+" needs a number/);
    expect(() => evaluateExpr("2 * (1 < 2)")).toThrow(/"\*" needs a number/);
    expect(() => evaluateExpr("-(1 < 2)")).toThrow(/"-" needs a number/);
    expect(() => evaluateExpr("min(1 < 2, 3)")).toThrow(/min needs a number/);
    expect(() => evaluateExpr("(1 < 2) < 3")).toThrow(/"<" needs a number/);
  });

  test("and, or and not need a yes/no on each side", () => {
    expect(() => truth("1 and 2")).toThrow(/"and" needs a yes\/no/);
    expect(() => truth("true and 2")).toThrow(/"and" needs a yes\/no/);
    expect(() => truth("0 or true")).toThrow(/"or" needs a yes\/no/);
    expect(() => truth("not 5")).toThrow(/"not" needs a yes\/no/);
  });

  test("true and false are names a variable may not take", () => {
    expect(RESERVED.has("true")).toBe(true);
    expect(RESERVED.has("false")).toBe(true);
  });
});
