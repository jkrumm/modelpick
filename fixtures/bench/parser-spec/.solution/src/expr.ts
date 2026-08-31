const WHITESPACE = /\s/;

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

/**
 * Evaluates an arithmetic expression by recursive descent.
 *
 *   expr   := term (("+" | "-") term)*
 *   term   := factor (("*" | "/" | "%") factor)*
 *   factor := "-" factor | "(" expr ")" | number
 *   number := digit+ ("." digit+)?
 *
 * Arithmetic is plain IEEE-754: division and modulo by zero yield Infinity or
 * NaN rather than throwing. Malformed input throws a `SyntaxError` whose
 * message ends with the 0-based offset of the first offending character, or
 * with `src.length` when the input simply ran out.
 */
export function evaluate(src: string): number {
  let pos = 0;

  function skipWhitespace(): void {
    while (pos < src.length && WHITESPACE.test(src[pos] ?? "")) pos++;
  }

  function fail(): never {
    if (pos >= src.length) throw new SyntaxError(`unexpected end of input at ${src.length}`);
    throw new SyntaxError(`unexpected token at ${pos}`);
  }

  function parseNumber(): number {
    const start = pos;
    while (isDigit(src[pos])) pos++;
    if (src[pos] === ".") {
      pos++;
      if (!isDigit(src[pos])) fail();
      while (isDigit(src[pos])) pos++;
    }
    return Number(src.slice(start, pos));
  }

  function parseFactor(): number {
    skipWhitespace();
    const char = src[pos];
    if (char === undefined) fail();
    if (char === "-") {
      pos++;
      return -parseFactor();
    }
    if (char === "(") {
      pos++;
      const value = parseExpr();
      skipWhitespace();
      if (src[pos] !== ")") fail();
      pos++;
      return value;
    }
    if (!isDigit(char)) fail();
    return parseNumber();
  }

  function parseTerm(): number {
    let value = parseFactor();
    for (;;) {
      skipWhitespace();
      const operator = src[pos];
      if (operator !== "*" && operator !== "/" && operator !== "%") return value;
      pos++;
      const right = parseFactor();
      value = operator === "*" ? value * right : operator === "/" ? value / right : value % right;
    }
  }

  function parseExpr(): number {
    let value = parseTerm();
    for (;;) {
      skipWhitespace();
      const operator = src[pos];
      if (operator !== "+" && operator !== "-") return value;
      pos++;
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
  }

  const result = parseExpr();
  skipWhitespace();
  if (pos < src.length) throw new SyntaxError(`unexpected token at ${pos}`);
  return result;
}
